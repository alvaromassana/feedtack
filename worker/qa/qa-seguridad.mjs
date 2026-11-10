#!/usr/bin/env node
/**
 * qa-seguridad.mjs — lo que entra de fuera no sale ejecutable ni con la clave de equipo.
 *
 * Mismo banco que qa-tandas.mjs: worker en local (wrangler dev --local), D1/R2/DO
 * simulados y un Resend de mentira. Cero correos de verdad, cero escrituras reales.
 *
 * Por qué se mide en LECTURA y no solo al escribir: el worker viejo (tack-api) escribe
 * en la misma base sin estos filtros, y los widgets de los stagings van fijados a un
 * commit. Por eso se siembran filas "crudas" directamente en la D1 local, como las que
 * dejaría tack-api, y se exige que salgan limpias por listar y por el correo.
 *
 * Casos:
 *   1. url javascript: no sale en listar ni en el correo
 *   2. ?feedtack_admin= / ?tack_admin= no salen en listar ni en el correo; el resto sí
 *   3. senalados malformados ([null], cadena, rect con HTML) no rompen el aviso ni el panel
 *   4. una fila cruda sembrada en la base sale igual de limpia por listar
 *   5. un aviso crudo pendiente en la cola no bloquea la tanda ni mete HTML en el correo
 *
 * Uso:  node qa/qa-seguridad.mjs            (desde projects/feedtack/worker)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PUERTO_RESEND = 8796;
const ORIGEN = 'http://localhost:8791';
let PUERTO = 8850;
let fallos = 0;
const correos = [];

const ok = (nombre, bien, detalle = '') => {
  console.log(`${bien ? '  ✅' : '  ❌'} ${nombre}${!bien && detalle ? ` — ${detalle}` : ''}`);
  if (!bien) fallos++;
};
const esperar = ms => new Promise(r => setTimeout(r, ms));
const ejecutar = (args, opts = {}) => new Promise((res, rej) => {
  const p = spawn('npx', ['wrangler', ...args], { cwd: RAIZ, stdio: 'ignore', ...opts });
  p.on('exit', c => (c === 0 ? res() : rej(new Error(`wrangler ${args[0]} salió ${c}`))));
});

const capturador = http.createServer((req, res) => {
  let c = '';
  req.on('data', t => { c += t; });
  req.on('end', () => {
    try { correos.push(JSON.parse(c)); } catch { correos.push({ html: c }); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'falso-' + correos.length }));
  });
});

let proceso = null;
async function arrancar(vars, sembrar) {
  PUERTO += 1;
  const estado = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-seg-'));
  const base = ['--local', '-c', 'wrangler.local.toml', '--persist-to', estado, '-y'];
  await ejecutar(['d1', 'execute', 'tack', ...base, '--file', 'esquema.sql']);
  if (sembrar) {
    const f = path.join(estado, 'semilla.sql');
    fs.writeFileSync(f, sembrar);
    await ejecutar(['d1', 'execute', 'tack', ...base, '--file', f]);
  }
  proceso = spawn('npx', ['wrangler', 'dev', '-c', 'wrangler.local.toml', '--local',
    '--port', String(PUERTO), '--persist-to', estado, '--inspector-port', '0',
    '--var', `RESEND_URL:http://127.0.0.1:${PUERTO_RESEND}`, '--var', 'RESEND_API_KEY:falsa',
    '--var', 'CLAVE_ADMIN:clave-de-prueba', '--var', `BASE_PUBLICA:http://127.0.0.1:${PUERTO}`,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])],
  { cwd: RAIZ, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    await esperar(1000);
    try {
      const d = await (await fetch(`http://127.0.0.1:${PUERTO}/salud`)).json();
      if (d.servicio === 'feedtack' && d.ok === true) return;
    } catch {}
  }
  console.error('el worker no arrancó'); await parar(); process.exit(2);
}
async function parar() {
  if (!proceso) return;
  const p = proceso; proceso = null;
  const muerto = new Promise(r => p.once('exit', r));
  try { process.kill(-p.pid, 'SIGTERM'); } catch {}
  if (!await Promise.race([muerto.then(() => true), esperar(8000).then(() => false)])) {
    try { process.kill(-p.pid, 'SIGKILL'); } catch {}
  }
  await esperar(300);
}

async function comentar({ url, senalados, site = 'prueba', mensaje = 'hola' }) {
  const form = new FormData();
  form.set('site', site); form.set('autor_id', 'autor-prueba'); form.set('autor', 'Quien Prueba');
  form.set('mensaje', mensaje);
  form.set('contexto', JSON.stringify({ url, ruta: '/p', titulo: 'Pagina' }));
  if (senalados !== undefined) form.set('senalados', senalados);
  const r = await fetch(`http://127.0.0.1:${PUERTO}/api/feedback`, { method: 'POST', headers: { Origin: ORIGEN }, body: form });
  return { estado: r.status, j: await r.json().catch(() => ({})) };
}
async function listar(site = 'prueba') {
  const r = await fetch(`http://127.0.0.1:${PUERTO}/api/comentarios?site=${site}`, { headers: { Origin: ORIGEN } });
  return { estado: r.status, j: await r.json().catch(() => ({})) };
}
const html = () => correos.map(c => c.html || '').join('\n');
const soloObjetos = a => Array.isArray(a) && a.every(s => s && typeof s === 'object' && !Array.isArray(s));
const urlCruda = 'https://ej.test/p?feedtack_admin=SECRETO1&tack_admin=SECRETO2&a=1#h';
const RECT = '{"selector":"div","rect":{"w":"<b>INYECTADO</b>","h":2,"y":3}}';
const sql = s => `'${s.replace(/'/g, "''")}'`;

/* Filas como las que dejaría tack-api: una en comentarios, otra pendiente en la cola. */
const crudoComentario = `INSERT INTO comentarios (id, site, url, ruta, titulo, mensaje, senalados, autor, autor_id, contexto, creado, actualizado)
 VALUES ('crudo1','prueba',${sql('javascript:alert(1)//')},'/','T','m',${sql('[null,"x",' + RECT + ']')},'a','a','{}','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
        ('crudo2','prueba',${sql(urlCruda)},'/','T','m','[]','a','a','{}','2026-01-01T00:00:01Z','2026-01-01T00:00:01Z');`;
const crudoAviso = `INSERT INTO avisos_pendientes (id, site, tipo, comentario, payload, adjuntos, creado)
 VALUES ('aviso1','tanda','nuevo','crudo9',${sql(JSON.stringify({ tipo: 'nuevo', site: 'tanda', mensaje: '', autor: 'a',
   contexto: { url: 'javascript:alert(2)//', ruta: '/', titulo: 'T' }, mensaje: 'MARCA-CRUDA', senalados: [null, JSON.parse(RECT)], id: 'crudo9' }))},'[]',${sql(new Date().toISOString())}),
        ('aviso2','tanda','nuevo','crudo8','{"roto',${sql('[]')},${sql(new Date().toISOString())});`;

await new Promise(r => capturador.listen(PUERTO_RESEND, '127.0.0.1', r));
try {
  console.log('\nA. aviso inmediato (TANDAS=no) y listar');
  await arrancar({ TANDAS: 'no' }, crudoComentario);
  const c1 = await comentar({ url: 'javascript:alert(1)//' });
  const c2 = await comentar({ url: urlCruda });
  const c3 = await comentar({ url: 'https://ej.test/', senalados: '[null,"cadena",' + RECT + ']' });
  ok('los tres comentarios se guardan', [c1, c2, c3].every(c => c.estado === 200), JSON.stringify([c1, c2, c3]));
  await esperar(500);
  const l = (await listar()).j.comentarios || [];
  const por = id => l.find(c => c.id === id) || {};
  ok('están los cinco (tres nuevos y dos crudos)', [c1.j.id, c2.j.id, c3.j.id, 'crudo1', 'crudo2'].every(id => por(id).id === id), l.map(c => c.id).join(','));
  ok('1. listar no devuelve la url javascript:', !/javascript:/i.test(JSON.stringify(l)), JSON.stringify(por(c1.j.id).url));
  ok('2. listar quita la clave de la url', !/SECRETO/.test(JSON.stringify(l)), por(c2.j.id).url);
  ok('2. y conserva el resto de la url', /a=1/.test(por(c2.j.id).url || '') && /#h/.test(por(c2.j.id).url || ''), por(c2.j.id).url);
  ok('3. el pin bueno sobrevive', (por(c3.j.id).senalados || []).length === 1 && por(c3.j.id).senalados[0].selector === 'div' && (por('crudo1').senalados || []).length === 1, JSON.stringify([por(c3.j.id).senalados, por('crudo1').senalados]));
  ok('3. listar solo da objetos en senalados', l.every(c => soloObjetos(c.senalados)), JSON.stringify(l.map(c => c.senalados)));
  ok('4. la fila cruda sale limpia', !/SECRETO|javascript:/i.test(JSON.stringify([por('crudo1'), por('crudo2')])) && /a=1/.test(por('crudo2').url || ''));
  ok('3. salieron los tres correos', correos.length >= 3, `llegaron ${correos.length}`);
  ok('1. el correo no lleva javascript:', !/javascript:/i.test(html()));
  ok('2. el correo no lleva la clave', !/SECRETO/.test(html()));
  ok('3. el correo sí lleva el pin bueno, con el rect en números', />div<\/code>/.test(html()) && /0×2 px/.test(html()));
  ok('3. el correo no lleva HTML del rect', !/<b>INYECTADO/.test(html()));
  await parar();

  console.log('\nB. tanda con un aviso crudo en la cola');
  correos.length = 0;
  await arrancar({ CORTE_COMENTARIOS: '1' }, crudoAviso);
  const c4 = await comentar({ url: 'https://ej.test/', site: 'tanda' });
  ok('el comentario se guarda', c4.estado === 200, JSON.stringify(c4));
  for (let i = 0; i < 20 && !correos.length; i++) await esperar(500);
  ok('5. la tanda sale pese al aviso crudo', correos.length >= 1, `llegaron ${correos.length}`);
  ok('5. el aviso crudo está dentro del correo', /MARCA-CRUDA/.test(html()) && />div<\/code>/.test(html()));
  ok('5. sin javascript: ni HTML del rect', !/javascript:|<b>INYECTADO/i.test(html()));
} finally {
  await parar();
  capturador.close();
}
console.log(fallos ? `\n❌ ${fallos} fallos` : '\n✅ todo bien');
process.exit(fallos ? 1 : 0);
