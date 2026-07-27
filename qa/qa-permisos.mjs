/**
 * Permisos del equipo (petición de Álvaro, 27-jul):
 *  - el equipo puede cerrar sus propias notas sin esperar a que nadie confirme
 *  - el equipo puede eliminar; NADIE más puede
 *  - el cliente sigue sin poder resolver
 *
 * node qa/qa-permisos.mjs <clave-admin> [base]
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';

const CLAVE = process.argv[2];
const BASE = process.argv[3] || process.env.TACK_DEMO || 'http://127.0.0.1:8791';
const API = process.env.TACK_API || process.argv[4] || 'https://tu-worker.workers.dev';
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const SALIDA = '/home/alvaro/projects/tack-comment/qa/capturas';
if (!CLAVE) { console.error('falta la clave de administración'); process.exit(2); }
mkdirSync(SALIDA, { recursive: true });

const fallos = [];
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });

const nuevoCtx = () => b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
const listo = async pg => {
  await pg.waitForFunction(() => typeof window.Tack === 'object', null, { timeout: 20000 });
  await pg.waitForTimeout(700);
};
const sh = (pg, fn, arg) => pg.evaluate(fn, arg);
const botones = pg => sh(pg, () => [...document.querySelector('#tack-host').shadowRoot
  .querySelectorAll('.pie button, .borrar')].map(x => x.textContent.trim()));
const chapa = pg => sh(pg, () => document.querySelector('#tack-host').shadowRoot.querySelector('.chapa')?.textContent);
const error = pg => sh(pg, () => document.querySelector('#tack-host').shadowRoot.querySelector('.error')?.textContent || null);

/* Esperar por condición, no por reloj: el ciclo API + recarga tarda lo que tarda. */
async function esperarChapa(pg, esperado, ms = 20000) {
  try {
    await pg.waitForFunction(e => {
      const s = document.querySelector('#tack-host').shadowRoot;
      return s.querySelector('.chapa')?.textContent === e || !!s.querySelector('.error');
    }, esperado, { timeout: ms });
  } catch (e) { /* lo reporta quien llama */ }
  const err = await error(pg);
  if (err) fallos.push('al pasar a ' + esperado + ': ' + err);
  return chapa(pg);
}

async function crear(pg, texto, sel) {
  await sh(pg, () => window.Tack.escribir());
  await pg.waitForTimeout(300);
  await pg.locator('#tack-host').evaluate(h => h.shadowRoot.querySelector('textarea').focus());
  await pg.keyboard.type(texto, { delay: 2 });
  await sh(pg, () => [...document.querySelector('#tack-host').shadowRoot.querySelectorAll('.acc')]
    .find(x => x.textContent.includes('Señalar')).click());
  await pg.locator(sel).first().scrollIntoViewIfNeeded();
  await pg.waitForTimeout(400);
  const c = await pg.locator(sel).first().boundingBox();
  await pg.mouse.click(c.x + c.width / 2, c.y + Math.min(40, c.height / 2));
  await pg.waitForTimeout(500);
  await sh(pg, () => document.querySelector('#tack-host').shadowRoot.querySelector('.enviar').click());
  await pg.waitForFunction(() => !!document.querySelector('#tack-host').shadowRoot.querySelector('.hecho, .error'), null, { timeout: 25000 });
  return pg.evaluate(t => {
    const c = window.Tack.estado().comentarios.filter(x => x.mensaje === t);
    return c.length ? c[c.length - 1].id : null;
  }, texto);
}

// ── el equipo: entra con la clave
const equipo = await nuevoCtx();
const pe = await equipo.newPage();
pe.on('pageerror', e => fallos.push('JS equipo: ' + e.message));
await pe.goto(BASE + '/?tack_admin=' + encodeURIComponent(CLAVE), { waitUntil: 'networkidle' });
await listo(pe);
if (!await sh(pe, () => window.Tack.estado().admin)) fallos.push('la clave no activó el modo equipo');

console.log('[1] el equipo se deja una nota a sí mismo');
const TXT = 'NOTA INTERNA DE PRUEBA. Recordar pedir las fotos nuevas de la fachada.';
const ID = await crear(pe, TXT, '.hero h1');
if (!ID) { console.error('no se pudo crear'); process.exit(1); }
await sh(pe, id => window.Tack.verComentario(id), ID);
await pe.waitForTimeout(700);
let bs = await botones(pe);
console.log('    botones que ve:', JSON.stringify(bs));
if (!bs.some(x => x === 'Marcar como hecha')) fallos.push('en su propia nota el equipo NO ve "Marcar como hecha"');
if (bs.some(x => x === 'Marcar como resuelto')) fallos.push('en su propia nota sale "Marcar como resuelto" (no aplica)');
if (!bs.some(x => /Eliminar/.test(x))) fallos.push('el equipo no ve la opción de eliminar');
await pe.screenshot({ path: `${SALIDA}/15-equipo-nota-propia.png`, clip: { x: 1000, y: 180, width: 440, height: 720 } });

console.log('[2] cerrarla de un paso, sin pasar por "resuelto"');
await sh(pe, () => [...document.querySelector('#tack-host').shadowRoot.querySelectorAll('.pie button')]
  .find(x => x.textContent.includes('Marcar como hecha')).click());
let est = await esperarChapa(pe, 'Cerrado');
console.log('    estado:', est);
if (est !== 'Cerrado') fallos.push('la nota propia no quedó cerrada de un paso (está en ' + est + ')');

console.log('[3] el equipo puede reabrir lo cerrado');
bs = await botones(pe);
if (!bs.some(x => x === 'Reabrir')) fallos.push('el equipo no puede reabrir algo cerrado');
else console.log('    puede reabrir, correcto');

// ── el cliente: navegador limpio
console.log('[4] el cliente NO ve eliminar ni resolver');
const cliente = await nuevoCtx();
const pc = await cliente.newPage();
pc.on('pageerror', e => fallos.push('JS cliente: ' + e.message));
await pc.goto(BASE + '/', { waitUntil: 'networkidle' });
await listo(pc);
if (await sh(pc, () => window.Tack.estado().admin)) fallos.push('GRAVE: el cliente aparece como equipo');
await sh(pc, id => window.Tack.verComentario(id), ID);
await pc.waitForTimeout(700);
bs = await botones(pc);
console.log('    botones que ve:', JSON.stringify(bs));
if (bs.some(x => /Eliminar/.test(x))) fallos.push('GRAVE: el cliente ve la opción de eliminar');
if (bs.some(x => /resuelto|hecha/i.test(x))) fallos.push('GRAVE: el cliente puede resolver');

console.log('[5] el cliente no puede eliminar ni con la API a pelo');
const sinClave = await pc.evaluate(async ({ api, id }) => {
  const r = await fetch(api + '/api/comentarios/' + id, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}'
  });
  return r.status;
}, { api: API, id: ID });
console.log('    DELETE sin clave → HTTP', sinClave);
if (sinClave !== 403) fallos.push('la API deja eliminar sin clave (HTTP ' + sinClave + ')');

const claveMala = await pc.evaluate(async ({ api, id }) => {
  const r = await fetch(api + '/api/comentarios/' + id, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clave: 'clave-inventada-que-no-vale' })
  });
  return r.status;
}, { api: API, id: ID });
console.log('    DELETE con clave falsa → HTTP', claveMala);
if (claveMala !== 403) fallos.push('la API acepta una clave falsa (HTTP ' + claveMala + ')');

// sigue existiendo
const sigue = await pc.evaluate(async ({ api }) => {
  const r = await fetch(api + '/api/comentarios?site=vallmar-arquitectura');
  const d = await r.json();
  return d.comentarios.length;
}, { api: API });
console.log('    comentarios que siguen en la lista:', sigue);

console.log('[6] el equipo elimina de verdad, con doble confirmación');
await sh(pe, id => window.Tack.verComentario(id), ID);
await pe.waitForTimeout(600);
await sh(pe, () => document.querySelector('#tack-host').shadowRoot.querySelector('.borrar').click());
await pe.waitForTimeout(400);
const pideConfirmar = await sh(pe, () => !!document.querySelector('#tack-host').shadowRoot.querySelector('.confirmar'));
console.log('    pide confirmación:', pideConfirmar);
if (!pideConfirmar) fallos.push('elimina sin pedir confirmación');
await pe.screenshot({ path: `${SALIDA}/16-confirmar-eliminar.png`, clip: { x: 1000, y: 180, width: 440, height: 720 } });

await sh(pe, () => [...document.querySelector('#tack-host').shadowRoot.querySelectorAll('.confirmar button')]
  .find(x => x.textContent.includes('Sí, eliminar')).click());
await pe.waitForFunction(
  () => window.Tack.estado().comentarios.filter(c => c.mensaje.startsWith('NOTA INTERNA DE PRUEBA')).length === 0,
  null, { timeout: 25000 }).catch(() => {});
const quedan = await sh(pe, () => window.Tack.estado().comentarios.filter(c => c.mensaje.startsWith('NOTA INTERNA DE PRUEBA')).length);
console.log('    notas de prueba que quedan:', quedan);
if (quedan !== 0) fallos.push('no se eliminó de verdad');

console.log('\n' + (fallos.length ? 'FALLOS:\n - ' + fallos.join('\n - ') : 'PERMISOS CORRECTOS'));
await b.close();
process.exit(fallos.length ? 1 : 0);
