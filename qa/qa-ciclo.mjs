/**
 * Ciclo completo contra la demo PUBLICADA:
 * crear en dos páginas distintas → ver la lista → editar → resolver (admin) →
 * confirmar (cliente) → comprobar marcas y contador.
 *
 * node qa/qa-ciclo.mjs <clave-admin> [base]
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';

const CLAVE = process.argv[2];
const BASE = process.argv[3] || process.env.FEEDTACK_DEMO || 'http://127.0.0.1:8791';
const API = process.env.FEEDTACK_API || process.argv[4] || 'https://tu-worker.workers.dev';
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const SALIDA = '/home/alvaro/projects/feedtack/qa/capturas';
if (!CLAVE) { console.error('falta la clave de administración'); process.exit(2); }
mkdirSync(SALIDA, { recursive: true });

const fallos = [];
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });

// ── el cliente: navegador limpio, sin clave de administración
const cliente = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
const p = await cliente.newPage();
p.on('pageerror', e => fallos.push('JS: ' + e.message));

const listo = async pg => {
  await pg.waitForFunction(() => typeof window.Feedtack === 'object', null, { timeout: 20000 });
  await pg.waitForTimeout(700);
};
const sh = (pg, fn, arg) => pg.evaluate(fn, arg);
const enShadow = (pg, sel) => pg.evaluate(s => {
  const n = document.querySelector('#feedtack-host').shadowRoot.querySelector(s);
  return n ? n.textContent.trim() : null;
}, sel);

async function comentar(pg, texto, selObjetivo) {
  await sh(pg, () => window.Feedtack.escribir());
  await pg.waitForTimeout(300);
  await pg.locator('#feedtack-host').evaluate(h => h.shadowRoot.querySelector('textarea').focus());
  await pg.keyboard.type(texto, { delay: 2 });
  // señalar
  await sh(pg, () => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('.acc')]
    .find(x => x.textContent.includes('Señalar')).click());
  await pg.locator(selObjetivo).first().scrollIntoViewIfNeeded();
  await pg.waitForTimeout(400);
  const c = await pg.locator(selObjetivo).first().boundingBox();
  await pg.mouse.move(c.x + c.width / 2, c.y + Math.min(40, c.height / 2));
  await pg.waitForTimeout(250);
  await pg.mouse.click(c.x + c.width / 2, c.y + Math.min(40, c.height / 2));
  await pg.waitForTimeout(500);
  // nombre y enviar
  await pg.locator('#feedtack-host').evaluate(h => {
    const i = h.shadowRoot.querySelector('input[type=text]');
    i.value = 'Núria (prueba)'; i.dispatchEvent(new Event('input'));
  });
  await sh(pg, () => document.querySelector('#feedtack-host').shadowRoot.querySelector('.enviar').click());
  await pg.waitForFunction(
    () => !!document.querySelector('#feedtack-host').shadowRoot.querySelector('.hecho, .error'),
    null, { timeout: 25000 });
  const err = await enShadow(pg, '.error');
  if (err) fallos.push('al crear: ' + err);
  // devolvemos el id del recién creado: la prueba debe operar sobre SU comentario,
  // no sobre "la primera tarjeta" (la base puede tener comentarios de antes)
  return pg.evaluate(t => {
    const c = window.Feedtack.estado().comentarios.filter(x => x.mensaje === t);
    return c.length ? c[c.length - 1].id : null;
  }, texto);
}

console.log('[1] crear un comentario en la portada');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await listo(p);
const TXT1 = 'PRUEBA CICLO. El titular de la portada deberia hablar de rehabilitacion, que es lo que mas nos piden.';
const ID1 = await comentar(p, TXT1, '.hero h1');
if (!ID1) fallos.push('no se pudo identificar el comentario creado');

console.log('[2] crear otro en una pagina distinta (proyectos)');
await p.goto(BASE + '/proyectos', { waitUntil: 'networkidle' });
await listo(p);
await comentar(p, 'PRUEBA CICLO. Falta la ficha de Casa Sa Riera con las fotos nuevas.', '.rejilla article');

console.log('[3] la lista muestra los dos, agrupados por pagina');
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await listo(p);
await sh(p, () => window.Feedtack.abrir());
await p.waitForTimeout(600);
let estado = await sh(p, () => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  return {
    tarjetas: s.querySelectorAll('.tarjeta').length,
    grupos: [...s.querySelectorAll('.grupo')].map(g => g.textContent),
    pins: document.querySelectorAll('.tk-pin').length,
    ticks: document.querySelectorAll('.tk-tick').length,
    contador: s.querySelector('.pest .n')?.textContent,
    // Las marcas son un mapa de ESTA página, y solo de lo que TIENE posición:
    // un comentario sin elemento señalado no puede tener chincheta ni marca.
    marcables: window.Feedtack.estado().comentarios
      .filter(c => c.ruta === location.pathname
                && (c.estado === 'abierto' || c.estado === 'reabierto')
                && c.senalados && c.senalados.length).length
  };
});
console.log('   ', JSON.stringify(estado));
if (estado.tarjetas < 2) fallos.push('la lista no muestra los dos comentarios');
if (!estado.grupos.some(g => /esta página/i.test(g))) fallos.push('no agrupa por "En esta página"');
if (estado.pins !== estado.marcables) fallos.push('chinchetas: hay ' + estado.pins + ' y tocan ' + estado.marcables);
if (estado.ticks !== estado.marcables) fallos.push('regleta: hay ' + estado.ticks + ' marcas y tocan ' + estado.marcables);
await p.screenshot({ path: `${SALIDA}/10-lista-comentarios.png` });
await p.screenshot({ path: `${SALIDA}/10b-lista-detalle`.replace('10b','10b') + '.png', clip: { x: 1000, y: 200, width: 440, height: 700 } });

console.log('[4] editar el propio comentario');
await sh(p, id => window.Feedtack.verComentario(id), ID1);
await p.waitForTimeout(700);
const puedeEditar = await sh(p, () => !![...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
  .find(x => x.textContent.trim() === 'Editar'));
if (!puedeEditar) fallos.push('el autor no ve el boton de editar en su propio comentario');
else {
  await sh(p, () => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
    .find(x => x.textContent.trim() === 'Editar').click());
  await p.waitForTimeout(400);
  await p.locator('#feedtack-host').evaluate(h => {
    h.shadowRoot.querySelector('textarea').value =
      'PRUEBA CICLO (EDITADO). Mejor que el titular hable de obra nueva, lo hemos hablado en la reunion de hoy.';
  });
  await sh(p, () => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
    .find(x => x.textContent.includes('Guardar')).click());
  await p.waitForTimeout(4000);
  const texto = await enShadow(p, '.mensaje');
  console.log('    tras editar:', (texto || '').slice(0, 60));
  if (!texto || !texto.includes('EDITADO')) fallos.push('la edicion no se guardo');
}
await p.screenshot({ path: `${SALIDA}/11-detalle-editado.png`, clip: { x: 1000, y: 200, width: 440, height: 700 } });

console.log('[5] el cliente NO puede marcar como resuelto');
const veResolver = await sh(p, () => !![...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
  .find(x => x.textContent.includes('Marcar como resuelto')));
if (veResolver) fallos.push('GRAVE: el cliente ve el boton de marcar como resuelto');
else console.log('    correcto, no lo ve');

// intento directo contra la API sin clave
const sinClave = await p.evaluate(async ({ api, id }) => {
  const r = await fetch(api + '/api/comentarios/' + id + '/estado', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'resuelto' })
  });
  return r.status;
}, { api: API, id: ID1 });
console.log('    intento directo sin clave → HTTP', sinClave);
if (sinClave !== 403) fallos.push('la API deja resolver sin clave (HTTP ' + sinClave + ')');

console.log('[6] nosotros resolvemos, con la clave');
const admin = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
const pa = await admin.newPage();
await pa.goto(BASE + '/?feedtack_admin=' + encodeURIComponent(CLAVE), { waitUntil: 'networkidle' });
await listo(pa);
await sh(pa, id => window.Feedtack.verComentario(id), ID1);
await pa.waitForTimeout(800);
const veResolverAdmin = await sh(pa, () => !![...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
  .find(x => x.textContent.includes('Marcar como resuelto')));
if (!veResolverAdmin) fallos.push('con clave de administracion NO aparece el boton de resolver');
else {
  await sh(pa, () => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
    .find(x => x.textContent.includes('Marcar como resuelto')).click());
  await pa.waitForTimeout(3500);
  const chapa = await sh(pa, () => document.querySelector('#feedtack-host').shadowRoot.querySelector('.chapa')?.textContent);
  console.log('    estado ahora:', chapa);
  if (chapa !== 'Resuelto') fallos.push('no paso a Resuelto (esta en ' + chapa + ')');
}

console.log('[7] el cliente lo confirma');
await p.reload({ waitUntil: 'networkidle' });
await listo(p);
await sh(p, id => window.Feedtack.verComentario(id), ID1);
await p.waitForTimeout(800);
await p.screenshot({ path: `${SALIDA}/12-cliente-confirma.png`, clip: { x: 1000, y: 200, width: 440, height: 700 } });
const veConfirmar = await sh(p, () => !![...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
  .find(x => x.textContent.includes('Está bien así')));
if (!veConfirmar) fallos.push('el cliente no ve la opcion de confirmar en un comentario resuelto');
else {
  await sh(p, () => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('button')]
    .find(x => x.textContent.includes('Está bien así')).click());
  await p.waitForTimeout(3500);
  const chapa = await sh(p, () => document.querySelector('#feedtack-host').shadowRoot.querySelector('.chapa')?.textContent);
  console.log('    estado final:', chapa);
  if (chapa !== 'Cerrado') fallos.push('no paso a Cerrado (esta en ' + chapa + ')');
}

console.log('[8] el contador de la burbuja refleja lo pendiente');
await p.reload({ waitUntil: 'networkidle' });
await listo(p);
const cuenta = await sh(p, () => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  const est = window.Feedtack.estado().comentarios;
  return {
    burbuja: s.querySelector('.cuenta')?.textContent || '0',
    pendientesReales: est.filter(c => c.estado === 'abierto' || c.estado === 'reabierto').length
  };
});
console.log('   ', JSON.stringify(cuenta));
if (String(cuenta.burbuja) !== String(cuenta.pendientesReales)) {
  fallos.push('el contador dice ' + cuenta.burbuja + ' y hay ' + cuenta.pendientesReales + ' pendientes');
}
await p.screenshot({ path: `${SALIDA}/13-burbuja-contador.png` });

console.log('\n' + (fallos.length ? 'FALLOS:\n - ' + fallos.join('\n - ') : 'CICLO COMPLETO CORRECTO'));
await b.close();
process.exit(fallos.length ? 1 : 0);
