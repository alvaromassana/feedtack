#!/usr/bin/env node
/**
 * qa-tandas.mjs — ¿la agrupación de correos AGRUPA, y sabe NO agrupar?
 *
 * Corre el worker en local (miniflare, vía `wrangler dev --local`) con D1, R2 y el
 * Durable Object simulados, y sustituye Resend por un servidor propio que solo apunta
 * lo que le llega. Cero correos de verdad, cero escrituras en la base real.
 *
 * 🔒 Por qué existe: la agrupación falla de dos formas y las dos son MUDAS. Si agrupa
 * de más, un aviso se queda esperando para siempre; si agrupa de menos, el buzón sigue
 * igual y nadie lo nota hasta el día siguiente. Así que cada caso mide el NÚMERO de
 * correos, no que "no haya error".
 *
 * Casos (los tres últimos son el control negativo):
 *   1. tres comentarios dentro de la ventana → UN correo con los tres dentro
 *   2. corte por número (CORTE=3) → sale sin esperar la ventana
 *   3. cabecera References igual en dos correos de la misma web, distinta entre webs
 *   4. eliminado → correo INSTANTÁNEO y aparte, no espera a nadie
 *   5. TANDAS=no → tres comentarios, TRES correos (o sea: sabe no agrupar)
 *   6. un adjunto por encima del presupuesto → va ENLAZADO y el correo lo dice
 *
 * Uso:  node qa/qa-tandas.mjs            (desde projects/feedtack/worker)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PUERTO_RESEND = 8795;
const ORIGEN = 'http://localhost:8791';

/* 🔴 Un puerto distinto por caso, y no por gusto: con el puerto compartido, el `/salud`
   del caso siguiente lo contestaba el worker del caso anterior mientras se apagaba, así
   que dos casos midieron el worker equivocado y fallaron sin que nada estuviera roto.
   `npx` además es un intermediario: hay que matar el GRUPO de procesos y esperar a que
   muera de verdad, no mandar la señal y seguir. */
let PUERTO_WORKER = 8800;

let fallos = 0;
const correos = [];

function comprobar(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ✅' : '  ❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
}

// ─────────────────────────────────────────────── el Resend de mentira

/* El retraso se puede subir para dejar una tanda "en vuelo" y comprobar que otra que
   entre a la vez no manda lo mismo otra vez. Sin retraso el caso no se puede provocar. */
let retrasoResend = 0;
let fallaResend = 0;   // cuántas veces seguidas contesta que no

const capturador = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', t => { cuerpo += t; });
  req.on('end', () => {
    setTimeout(() => {
      if (fallaResend > 0) {
        fallaResend--;
        res.writeHead(422, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'no me da la gana' }));
      }
      try { correos.push(JSON.parse(cuerpo)); }
      catch { correos.push({ ilegible: cuerpo.slice(0, 200) }); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'falso-' + correos.length }));
    }, retrasoResend);
  });
});

// ─────────────────────────────────────────────── arrancar y parar el worker

let proceso = null;
let estadoActual = null;

async function arrancar(vars) {
  PUERTO_WORKER += 1;
  const estado = estadoActual = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-qa-'));

  /* 🔴 El esquema se aplica ANTES de arrancar el servidor, y esto costó una vuelta:
     `wrangler d1 execute --local` con el `dev` ya en marcha son dos procesos sobre el
     mismo SQLite, y el servidor puede no ver nunca la tabla nueva (a mano funcionó, en
     la batería no: dependía del momento). Con la base preparada antes, no hay dos
     escritores y el resultado es el mismo siempre. */
  await esquemaLocal(estado);

  /* 🔴 Y esta puerta es la que faltaba, y costó tres vueltas de diagnóstico: si el puerto
     ya está ocupado (un `wrangler` huérfano de un intento anterior, que sobrevive porque
     `npx` es un intermediario), el `/salud` lo contesta ESE worker, con su base vieja, y
     la batería mide una cosa distinta de la que cree. Un banco de pruebas que puede medir
     el proceso equivocado no vale: aquí para y lo dice. */
    if (await ocupado(PUERTO_WORKER)) {
    console.error(`el puerto ${PUERTO_WORKER} ya está ocupado: hay un worker de otra ejecución vivo.`);
    console.error('   míralo con:  ss -ltn | grep 88   y mátalo antes de repetir.');
    process.exit(2);
  }

  const args = [
    'dev', '-c', 'wrangler.local.toml', '--local', '--port', String(PUERTO_WORKER),
    '--persist-to', estado, '--inspector-port', '0',
    '--var', `RESEND_URL:http://127.0.0.1:${PUERTO_RESEND}`,
    '--var', 'RESEND_API_KEY:falsa',
    '--var', 'CLAVE_ADMIN:clave-de-prueba',
    '--var', `BASE_PUBLICA:http://127.0.0.1:${PUERTO_WORKER}`,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])
  ];
  proceso = spawn('npx', ['wrangler', ...args], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let salida = '';
  proceso.stdout.on('data', d => { salida += d; });
  proceso.stderr.on('data', d => { salida += d; });

  /* Esperar a que /salud CONTESTE, sea lo que sea. Ojo: contesta 500 a propósito hasta
     que exista la tabla de la cola, y la tabla se crea justo después, así que esperar un
     200 aquí deja el arranque colgado para siempre (pasó). Si no arranca, se enseña su
     salida: un worker que no levanta y un caso que falla no se pueden confundir. */
  for (let i = 0; i < 60; i++) {
    await esperar(1000);
    let dice = null;
    try { dice = await (await fetch(`http://127.0.0.1:${PUERTO_WORKER}/salud`)).json(); }
    catch { continue; }                      // todavía no escucha, o no ejecuta el código
    if (!dice || dice.servicio !== 'feedtack') continue;

    /* 🔒 Cinturón antes del primer caso: si el esquema no está, los casos fallarían todos
       con "fallo interno" y parecería un defecto del worker. Aquí se para y se dice. */
    if (dice.ok !== true) {
      console.error('el esquema no está en la base local, no se puede medir nada:', JSON.stringify(dice));
      await parar();
      process.exit(2);
    }
    return;
  }
  console.error('el worker no arrancó:\n' + salida.slice(-3000));
  process.exit(2);
}

async function esquemaLocal(estado) {
  await new Promise((res, rej) => {
    const p = spawn('npx', ['wrangler', 'd1', 'execute', 'tack', '--local',
      '-c', 'wrangler.local.toml', '--persist-to', estado, '--file', 'esquema.sql', '-y'],
      { cwd: RAIZ, stdio: 'ignore' });
    p.on('exit', c => (c === 0 ? res() : rej(new Error('d1 execute salió ' + c))));
  });
}

async function parar() {
  if (!proceso) return;
  const p = proceso;
  proceso = null;
  const muerto = new Promise(r => p.once('exit', r));
  try { process.kill(-p.pid, 'SIGTERM'); } catch { p.kill('SIGTERM'); }
  const aTiempo = await Promise.race([muerto.then(() => true), esperar(8000).then(() => false)]);
  if (!aTiempo) {
    try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); }
    await Promise.race([muerto, esperar(3000)]);
  }
  await esperar(300);
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

/* ¿Hay alguien escuchando ya en ese puerto? Se comprueba intentando escuchar nosotros. */
const ocupado = puerto => new Promise(res => {
  const s = http.createServer();
  s.once('error', () => res(true));
  s.listen(puerto, '127.0.0.1', () => s.close(() => res(false)));
});

// ─────────────────────────────────────────────── llamadas al worker

async function comentar(mensaje, { site = 'prueba', adjunto = null } = {}) {
  const form = new FormData();
  form.set('site', site);
  form.set('autor_id', 'autor-de-prueba');
  form.set('autor', 'Quien Prueba');
  form.set('mensaje', mensaje);
  form.set('contexto', JSON.stringify({ url: 'http://localhost:8791/', ruta: '/', titulo: 'Portada' }));
  if (adjunto) form.set('adjunto1', new Blob([adjunto.datos], { type: 'image/png' }), adjunto.nombre);
  const r = await fetch(`http://127.0.0.1:${PUERTO_WORKER}/api/feedback`, {
    method: 'POST', headers: { Origin: ORIGEN }, body: form
  });
  const j = await r.json();
  if (!j.ok) throw new Error('el comentario no se guardó: ' + JSON.stringify(j));
  return j.id;
}

async function eliminar(id) {
  const r = await fetch(`http://127.0.0.1:${PUERTO_WORKER}/api/comentarios/${id}`, {
    method: 'DELETE',
    headers: { Origin: ORIGEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave: 'clave-de-prueba' })
  });
  return r.json();
}

const tarjetas = correo => (correo.html.match(/Comentario nuevo|Respuesta|Comentario editado/g) || []).length;

// ─────────────────────────────────────────────── los casos

async function caso1y3() {
  console.log('\n1) tres comentarios dentro de la ventana → UN correo');
  await arrancar({ VENTANA_MINUTOS: '0.05', CORTE_COMENTARIOS: '10' });   // 3 segundos
  correos.length = 0;
  await comentar('el hero se sale por la derecha');
  await comentar('la tipografía del menú es distinta');
  await comentar('falta el teléfono en el pie');
  await esperar(1200);
  comprobar('todavía no ha salido nada (la ventana sigue abierta)', correos.length === 0, `${correos.length} correos`);
  await esperar(4000);
  comprobar('sale UN solo correo', correos.length === 1, `${correos.length} correos`);
  if (correos.length === 1) {
    comprobar('lleva los tres dentro', tarjetas(correos[0]) === 3, `${tarjetas(correos[0])} tarjetas`);
    comprobar('el asunto es FIJO por web (lo que Gmail necesita)', correos[0].subject === '💬 Feedtack · prueba', correos[0].subject);
    comprobar('y lo que cambia va en la vista previa', /3 comentarios/.test(correos[0].html), (correos[0].html.match(/>[^<]*3 comentarios[^<]*</) || [''])[0]);
    comprobar('los tres mensajes están en el cuerpo',
      ['hero se sale', 'tipografía del menú', 'teléfono en el pie'].every(t => correos[0].html.includes(t)));
    comprobar('lleva cabecera References', !!correos[0].headers?.References, correos[0].headers?.References);
  }

  console.log('\n3) el hilo de Gmail: mismo asunto y mismo References, y otra web aparte');
  const asuntoPrimero = correos[0] && correos[0].subject;
  correos.length = 0;
  await comentar('otro de la misma web');
  await comentar('uno de OTRA web', { site: 'otra-web' });
  await esperar(4500);
  const deA = correos.filter(c => c.subject.includes('prueba'));
  const deB = correos.filter(c => c.subject.includes('otra-web'));
  comprobar('cada web manda su propio correo', deA.length === 1 && deB.length === 1, `${deA.length} y ${deB.length}`);
  /* 🔴 Medido contra Gmail real el 8-sep: con References idénticos pero asunto distinto,
     Gmail abre DOS hilos. Así que el asunto de dos tandas de la misma web tiene que ser
     IDÉNTICO, byte a byte, o la capa 0 no sirve para nada. */
  comprobar('el asunto de la segunda tanda es idéntico al de la primera',
    deA[0] && deA[0].subject === asuntoPrimero, `${asuntoPrimero} vs ${deA[0] && deA[0].subject}`);
  if (deA.length && deB.length) {
    comprobar('el References de la web es el mismo que antes', deA[0].headers.References.includes('prueba'));
    comprobar('y el de la otra web es distinto',
      deA[0].headers.References !== deB[0].headers.References,
      `${deA[0].headers.References} vs ${deB[0].headers.References}`);
  }
  await parar();
}

async function caso2() {
  console.log('\n2) corte por número (CORTE=3) → sale sin esperar la ventana');
  await arrancar({ VENTANA_MINUTOS: '30', CORTE_COMENTARIOS: '3' });
  correos.length = 0;
  await comentar('uno');
  await comentar('dos');
  comprobar('con dos todavía espera', correos.length === 0, `${correos.length} correos`);
  await comentar('tres');
  await esperar(2000);
  comprobar('al tercero sale', correos.length === 1, `${correos.length} correos`);
  if (correos.length === 1) {
    comprobar('lleva los tres', tarjetas(correos[0]) === 3, `${tarjetas(correos[0])} tarjetas`);
    comprobar('la vista previa avisa de que la tanda se llenó', /tanda llena/.test(correos[0].html));
  }
  await parar();
}

async function caso4() {
  console.log('\n4) el ELIMINADO no espera a nadie');
  await arrancar({ VENTANA_MINUTOS: '30', CORTE_COMENTARIOS: '10' });
  correos.length = 0;
  const id = await comentar('esto lo voy a borrar');
  await esperar(800);
  comprobar('el comentario nuevo sí espera', correos.length === 0, `${correos.length} correos`);
  const r = await eliminar(id);
  await esperar(1500);
  comprobar('el borrado se ha hecho', r.ok === true, JSON.stringify(r));
  comprobar('y su correo sale en el acto', correos.length === 1, `${correos.length} correos`);
  if (correos.length === 1) {
    comprobar('es el de eliminado, con asunto PROPIO para que no se entierre en el hilo',
    /ELIMINADO/.test(correos[0].subject) && correos[0].subject !== '💬 Feedtack · prueba', correos[0].subject);
    comprobar('lleva el texto de lo borrado', correos[0].html.includes('esto lo voy a borrar'));
  }
  await parar();
}

async function caso5() {
  console.log('\n5) CONTROL NEGATIVO: con TANDAS=no vuelve a un correo por evento');
  await arrancar({ VENTANA_MINUTOS: '0.05', CORTE_COMENTARIOS: '10', TANDAS: 'no' });
  correos.length = 0;
  await comentar('primero');
  await comentar('segundo');
  await comentar('tercero');
  await esperar(2000);
  comprobar('salen TRES correos', correos.length === 3, `${correos.length} correos`);
  comprobar('y aun así van al mismo hilo', new Set(correos.map(c => c.headers?.References)).size === 1);
  await parar();
}

async function caso6() {
  console.log('\n6) un adjunto que no cabe en el correo va enlazado, y se dice');
  await arrancar({ VENTANA_MINUTOS: '0.05', CORTE_COMENTARIOS: '10' });
  correos.length = 0;
  const pequeno = Buffer.alloc(1024, 7);
  await comentar('mira esta captura pequeña', { adjunto: { nombre: 'chica.png', datos: pequeno } });
  await esperar(4000);
  comprobar('la pequeña viaja DENTRO del correo', correos[0]?.attachments?.length === 1,
    `${correos[0]?.attachments?.length} adjuntos`);
  comprobar('y además lleva enlace para abrirla', /\/adjuntos\//.test(correos[0]?.html || ''));

  // El enlace tiene que servir el fichero de verdad, no dar 404.
  const enlace = (correos[0]?.html || '').match(/href="(http[^"]*\/adjuntos\/[^"]*)"/)?.[1];
  if (enlace) {
    const r = await fetch(enlace);
    const bytes = new Uint8Array(await r.arrayBuffer());
    comprobar('el enlace descarga el fichero entero', r.status === 200 && bytes.length === 1024,
      `HTTP ${r.status}, ${bytes.length} bytes`);
  } else {
    comprobar('el enlace descarga el fichero entero', false, 'no había enlace que probar');
  }
  // Una clave a medias no puede servir nada.
  const r404 = await fetch(`http://127.0.0.1:${PUERTO_WORKER}/adjuntos/prueba/`);
  comprobar('una clave incompleta da 404', r404.status === 404, `HTTP ${r404.status}`);

  console.log('   y ahora una por encima del presupuesto (16 MB con presupuesto de 15)');
  correos.length = 0;
  const grande = Buffer.alloc(16 * 1024 * 1024, 3);
  await comentar('mira esta captura enorme', { adjunto: { nombre: 'enorme.png', datos: grande } });
  await esperar(5000);
  comprobar('el correo sale igual', correos.length === 1, `${correos.length} correos`);
  comprobar('la grande NO viaja dentro', (correos[0]?.attachments || []).length === 0,
    `${(correos[0]?.attachments || []).length} adjuntos`);
  comprobar('y el correo dice que no cabía', /no cabía en el correo/.test(correos[0]?.html || ''));
  await parar();
}

async function caso7() {
  console.log('\n7) NINGÚN aviso sale dos veces, ni con el corte disparando a la vez');
  /* Es el hallazgo más grave que trajo la refutación: mientras una tanda sube a Resend,
     el Durable Object SIGUE aceptando eventos (un await que no es de su almacén no
     bloquea), así que el corte reentraba, leía las mismas filas y mandaba el correo dos
     veces. Se provoca a propósito: Resend tarda 1,5 s y entran 15 comentarios de golpe
     con corte a 5. Lo que se mide no es el número de correos (depende del reparto), es
     que cada mensaje aparezca EXACTAMENTE UNA VEZ en todo lo que ha salido. */
  await arrancar({ VENTANA_MINUTOS: '0.05', CORTE_COMENTARIOS: '5' });
  correos.length = 0;
  retrasoResend = 1500;
  const mensajes = Array.from({ length: 15 }, (_, i) => `evento numero ${i + 1} de la avalancha`);
  await Promise.all(mensajes.map(m => comentar(m)));
  await esperar(12000);
  retrasoResend = 0;

  /* Se quita la línea de vista previa antes de contar: el primer mensaje de cada tanda
     sale también ahí, así que contarla haría que un correo correcto pareciera un duplicado
     (pasó, y el fallo era de esta cuenta, no del worker). */
  const todo = correos.map(c => c.html.replace(/<div style="display:none[\s\S]*?<\/div>/, '')).join('\n');
  const repetidos = mensajes.filter(m => todo.split(m).length - 1 !== 1);
  comprobar('los 15 han llegado y ninguno repetido', repetidos.length === 0,
    repetidos.length ? `mal: ${repetidos.map(m => `${m} x${todo.split(m).length - 1}`).join(', ')}` : `${correos.length} correos, 15 avisos`);
  await parar();
}

async function caso8() {
  console.log('\n8) sin URL pública configurada, un adjunto NO se difiere (o se perdería)');
  /* La plantilla del repo sale con BASE_PUBLICA vacía. Diferir entonces un adjunto lo
     dejaba en R2 sin enlace posible y el correo decía "1 adjunto" sin llevarlo. */
  await arrancar({ VENTANA_MINUTOS: '30', CORTE_COMENTARIOS: '10', BASE_PUBLICA: '' });
  correos.length = 0;
  await comentar('con captura y sin sitio de donde bajarla', { adjunto: { nombre: 'x.png', datos: Buffer.alloc(2048, 9) } });
  await esperar(1500);
  comprobar('sale en el acto en vez de esperar 30 min', correos.length === 1, `${correos.length} correos`);
  comprobar('y la captura viaja dentro', (correos[0]?.attachments || []).length === 1);
  console.log('   y un comentario SIN adjuntos sí se sigue agrupando');
  correos.length = 0;
  await comentar('este no lleva nada');
  await esperar(1500);
  comprobar('el de texto sí espera', correos.length === 0, `${correos.length} correos`);
  await parar();
}

async function caso9() {
  console.log('\n9) /salud DELATA que la agrupación está configurada y no puede funcionar');
  await arrancar({ VENTANA_MINUTOS: '30', CORTE_COMENTARIOS: '10' });
  const antes = await (await fetch(`http://127.0.0.1:${PUERTO_WORKER}/salud`)).json();
  comprobar('con la tabla puesta dice que están activas', antes.ok === true && antes.tandas === 'activas', JSON.stringify(antes));
  comprobar('y cuenta la cola', !!antes.cola && typeof antes.cola.pendientes === 'number', JSON.stringify(antes.cola));

  // Sabotaje mínimo: quitar SOLO la tabla nueva. El resto del worker sigue entero.
  await new Promise((res, rej) => {
    const p = spawn('npx', ['wrangler', 'd1', 'execute', 'tack', '--local', '-c', 'wrangler.local.toml',
      '--persist-to', estadoActual, '--command', 'DROP TABLE avisos_pendientes', '-y'],
      { cwd: RAIZ, stdio: 'ignore' });
    p.on('exit', c => (c === 0 ? res() : rej(new Error('no se pudo sabotear: ' + c))));
  });
  const r = await fetch(`http://127.0.0.1:${PUERTO_WORKER}/salud`);
  const despues = await r.json();
  comprobar('sin la tabla NO dice que todo va bien', r.status === 500 && despues.ok === false, `HTTP ${r.status} ${JSON.stringify(despues)}`);
  comprobar('y dice qué hay que hacer', /esquema\.sql/.test(JSON.stringify(despues)), JSON.stringify(despues.cola));

  console.log('   y un comentario en ese estado sigue avisando (cae al correo de siempre)');
  correos.length = 0;
  await comentar('la tabla no está y esto tiene que llegar igual');
  await esperar(1500);
  comprobar('el aviso llega igual', correos.length === 1, `${correos.length} correos`);
  await parar();
}

async function caso10() {
  console.log('\n10) un adjunto que NO es imagen no se abre en el navegador, se descarga');
  await arrancar({ VENTANA_MINUTOS: '0.05', CORTE_COMENTARIOS: '10' });
  correos.length = 0;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const form = new FormData();
  form.set('site', 'prueba');
  form.set('autor_id', 'a');
  form.set('mensaje', 'te subo un svg con script dentro');
  form.set('contexto', JSON.stringify({ url: 'http://x/', ruta: '/', titulo: 'P' }));
  form.set('adjunto1', new Blob([svg], { type: 'image/svg+xml' }), 'malo.svg');
  await fetch(`http://127.0.0.1:${PUERTO_WORKER}/api/feedback`, { method: 'POST', headers: { Origin: ORIGEN }, body: form });
  await esperar(4000);
  const enlace = (correos[0]?.html || '').match(/href="(http[^"]*\/adjuntos\/[^"]*)"/)?.[1];
  if (!enlace) return comprobar('el svg tiene enlace que probar', false, 'no había enlace'), parar();
  const r = await fetch(enlace);
  comprobar('se sirve como descarga, no inline', /^attachment/.test(r.headers.get('content-disposition') || ''), r.headers.get('content-disposition'));
  comprobar('con nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  comprobar('y con sandbox', /sandbox/.test(r.headers.get('content-security-policy') || ''), r.headers.get('content-security-policy'));
  console.log('   control positivo: un PNG sí se abre inline');
  correos.length = 0;
  await comentar('y este es un png normal', { adjunto: { nombre: 'buena.png', datos: Buffer.alloc(64, 1) } });
  await esperar(4000);
  const enlacePng = (correos[0]?.html || '').match(/href="(http[^"]*\/adjuntos\/[^"]*)"/)?.[1];
  const rp = await fetch(enlacePng);
  comprobar('el PNG sí va inline', /^inline/.test(rp.headers.get('content-disposition') || ''), rp.headers.get('content-disposition'));
  await parar();
}

async function caso11() {
  console.log('\n11) si Resend dice que no, el aviso NO se pierde: se reintenta y llega');
  await arrancar({ VENTANA_MINUTOS: '0.05', CORTE_COMENTARIOS: '10' });
  correos.length = 0;
  fallaResend = 1;                       // el primer envío se rechaza
  await comentar('esto tiene que llegar aunque el primer intento falle');
  await esperar(5000);
  comprobar('el primer intento no ha llegado (rechazado)', correos.length === 0, `${correos.length} correos`);
  console.log('   esperando el reintento (2 min + margen), esto tarda');
  await esperar(140000);
  comprobar('el reintento sí llega', correos.length === 1, `${correos.length} correos`);
  comprobar('y llega UNA sola vez', (correos[0]?.html || '').includes('aunque el primer intento falle') && correos.length === 1);
  await parar();
}

// ─────────────────────────────────────────────── ejecución

async function main() {
  await new Promise(r => capturador.listen(PUERTO_RESEND, '127.0.0.1', r));
  console.log('QA de tandas de Feedtack (nada sale a internet)');
  try {
    await caso1y3();
    await caso2();
    await caso4();
    await caso5();
    await caso6();
    await caso7();
    await caso8();
    await caso9();
    await caso10();
    if (!process.argv.includes('--rapido')) await caso11();
    else console.log('\n11) reintento tras rechazo de Resend: SALTADO (--rapido)');
  } finally {
    await parar();
    capturador.close();
  }
  console.log(`\n${fallos ? '❌' : '✅'} ${fallos} fallos`);
  process.exit(fallos ? 1 : 0);
}

process.on('SIGINT', async () => { await parar(); process.exit(130); });
main();
