/**
 * La invitación a señalar (petición de Álvaro, 27-jul):
 * si envías sin señalar, se propone señalar UNA vez, sin bloquear.
 *
 * Casos: 1) invita y no envía  2) si insistes, envía  3) si señalas, no invita
 *        4) el segundo comentario vuelve a recibir la invitación
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';

const URL_DEMO = process.argv[2] || 'http://127.0.0.1:8791/';
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const SALIDA = '/home/alvaro/projects/feedtack/qa/capturas';
mkdirSync(SALIDA, { recursive: true });

const fallos = [];
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-ES' });
const p = await ctx.newPage();

let envios = 0;
await p.route('**/api/feedback', r => { envios++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"x"}' }); });
await p.route('**/api/comentarios*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"comentarios":[]}' }));

const sh = fn => p.evaluate(fn);
const mirar = () => sh(() => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  const btn = [...s.querySelectorAll('.acc')].find(x => x.textContent.includes('Señalar'));
  return {
    sugerencia: !!s.querySelector('.sugerencia'),
    titulo: s.querySelector('.sugerencia h4')?.textContent || null,
    llamando: btn ? btn.classList.contains('llamando') : null,
    hecho: !!s.querySelector('.hecho')
  };
});
const escribir = async texto => {
  await p.locator('#feedtack-host').evaluate(h => h.shadowRoot.querySelector('textarea').focus());
  await p.keyboard.type(texto, { delay: 2 });
};
const pulsarEnviar = () => sh(() => document.querySelector('#feedtack-host').shadowRoot.querySelector('.enviar').click());

await p.goto(URL_DEMO, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.Feedtack === 'object', null, { timeout: 20000 });
await sh(() => window.Feedtack.escribir());
await p.waitForTimeout(300);

// ── 1. enviar sin señalar: invita y NO envía
console.log('[1] enviar sin señalar');
await escribir('Este texto no dice a que parte de la pagina se refiere.');
await pulsarEnviar();
await p.waitForTimeout(600);
let e = await mirar();
console.log('   ', JSON.stringify(e), '| envios:', envios);
if (!e.sugerencia) fallos.push('no aparece la invitación a señalar');
if (!e.llamando) fallos.push('el botón de señalar no llama la atención');
if (envios !== 0) fallos.push('GRAVE: envió el comentario en vez de invitar primero');
await p.screenshot({ path: `${SALIDA}/14-invitacion-senalar.png`, clip: { x: 1000, y: 180, width: 440, height: 720 } });

// ── 2. insistir: la segunda vez sí envía
console.log('[2] insistir en enviar');
await pulsarEnviar();
await p.waitForFunction(() => !!document.querySelector('#feedtack-host').shadowRoot.querySelector('.hecho, .error'), null, { timeout: 20000 });
console.log('    envios:', envios);
if (envios !== 1) fallos.push('al insistir no envió (envíos: ' + envios + ')');

// ── 3. si señala, no debe invitar
console.log('[3] señalando antes de enviar');
await sh(() => window.Feedtack.escribir());
await p.waitForTimeout(400);
await escribir('Ahora si señalo el elemento antes de enviar.');
await sh(() => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('.acc')]
  .find(x => x.textContent.includes('Señalar')).click());
await p.locator('.servicio').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
const caja = await p.locator('.servicio').first().boundingBox();
await p.mouse.move(caja.x + caja.width / 2, caja.y + 45);
await p.waitForTimeout(250);
await p.mouse.click(caja.x + caja.width / 2, caja.y + 45);
await p.waitForTimeout(500);
await pulsarEnviar();
await p.waitForTimeout(900);
e = await mirar();
console.log('   ', JSON.stringify(e), '| envios:', envios);
if (e.sugerencia) fallos.push('invita a señalar cuando YA ha señalado');
if (envios !== 2) fallos.push('no envió aun habiendo señalado (envíos: ' + envios + ')');

// ── 4. el siguiente comentario vuelve a recibir la invitación
console.log('[4] siguiente comentario');
await p.waitForTimeout(600);
await sh(() => window.Feedtack.escribir());
await p.waitForTimeout(400);
await escribir('Tercer comentario, otra vez sin señalar nada.');
await pulsarEnviar();
await p.waitForTimeout(600);
e = await mirar();
console.log('   ', JSON.stringify(e), '| envios:', envios);
if (!e.sugerencia) fallos.push('el segundo comentario ya no recibe la invitación');
if (envios !== 2) fallos.push('envió sin invitar en el segundo comentario');

// ── 5. el botón "Señalar dónde" de la invitación entra en modo señalar
console.log('[5] pulsar "Señalar dónde" desde la invitación');
await sh(() => [...document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('.sugerencia button')]
  .find(x => x.textContent.includes('Señalar dónde')).click());
await p.waitForTimeout(500);
const enModo = await p.evaluate(() => document.documentElement.classList.contains('tk-senalando'));
console.log('    en modo señalar:', enModo);
if (!enModo) fallos.push('el botón de la invitación no activa el modo señalar');
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

console.log('\n' + (fallos.length ? 'FALLOS:\n - ' + fallos.join('\n - ') : 'TODO CORRECTO'));
await b.close();
process.exit(fallos.length ? 1 : 0);
