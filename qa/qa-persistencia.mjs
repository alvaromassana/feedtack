/**
 * Regresión del bug que encontró Álvaro (27-jul): al pulsar "Señalar" se
 * borraba el comentario ya escrito, porque el panel se reconstruye entero.
 * Cubre también combinar las cuatro entradas en un solo envío.
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const URL_DEMO = process.argv[2] || 'http://127.0.0.1:8791/';
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const TEXTO = 'Este texto NO se puede perder al señalar un elemento.';
const NOMBRE = 'Álvaro Massana';

const b = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', permissions: ['microphone'] });
const p = await ctx.newPage();
await p.route('**/api/feedback', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));

const fallos = [];
const dentro = (fn, arg) => p.evaluate(fn, arg);
const leer = () => dentro(() => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  return {
    mensaje: s.querySelector('textarea')?.value ?? null,
    autor: s.querySelector('input[type=text]')?.value ?? null,
    senalados: s.querySelectorAll('.senalado').length,
    adjuntos: s.querySelectorAll('.adj').length
  };
});
const pulsar = etiqueta => dentro(t => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  const b = [...s.querySelectorAll('.acc')].find(x => x.textContent.includes(t));
  if (!b) throw new Error('no existe el botón: ' + t);
  b.click();
}, etiqueta);

await p.goto(URL_DEMO, { waitUntil: 'networkidle' });
await p.waitForFunction(() => typeof window.Feedtack === 'object', null, { timeout: 15000 });
await p.evaluate(() => window.Feedtack.escribir());
await p.waitForTimeout(300);

// escribir como lo haría una persona (para disparar los eventos input)
await p.locator('#feedtack-host').evaluate(h => h.shadowRoot.querySelector('textarea').focus());
await p.keyboard.type(TEXTO, { delay: 4 });
await p.locator('#feedtack-host').evaluate(h => h.shadowRoot.querySelector('input[type=text]').focus());
await p.keyboard.type(NOMBRE, { delay: 4 });

console.log('[1] escrito el comentario');
let e = await leer();
if (e.mensaje !== TEXTO) fallos.push('el texto no se escribió bien');

// --- señalar un elemento y volver
await pulsar('Señalar');
await p.locator('.servicio').nth(0).scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
let caja = await p.locator('.servicio').nth(0).boundingBox();
await p.mouse.move(caja.x + caja.width / 2, caja.y + 50);
await p.waitForTimeout(250);
await p.mouse.click(caja.x + caja.width / 2, caja.y + 50);
await p.waitForTimeout(500);

e = await leer();
console.log('[2] tras señalar:', JSON.stringify(e));
if (e.mensaje !== TEXTO) fallos.push('EL BUG SIGUE: se perdió el comentario al señalar');
if (e.autor !== NOMBRE) fallos.push('se perdió el nombre al señalar');
if (e.senalados !== 1) fallos.push('no se registró el elemento señalado');

// --- señalar un SEGUNDO elemento
await pulsar('Señalar otro');
await p.locator('.cifra').nth(0).scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
caja = await p.locator('.cifra').nth(0).boundingBox();
await p.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
await p.waitForTimeout(250);
await p.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
await p.waitForTimeout(500);

e = await leer();
console.log('[3] tras señalar el segundo:', JSON.stringify(e));
if (e.mensaje !== TEXTO) fallos.push('se perdió el comentario al señalar el segundo');
if (e.senalados !== 2) fallos.push('no se acumulan varios elementos señalados (hay ' + e.senalados + ')');

// --- adjuntar imagen y grabar nota de voz, sin perder nada
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 120;
  c.getContext('2d').fillRect(0, 0, 200, 120);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'prueba.png', { type: 'image/png' }));
  const i = document.querySelector('#feedtack-host').shadowRoot.querySelector('input[type=file]');
  i.files = dt.files; i.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(300);
await pulsar('Nota de voz');
await p.waitForTimeout(1800);
await pulsar('Parar');
await p.waitForTimeout(900);

e = await leer();
console.log('[4] con las cuatro entradas:', JSON.stringify(e));
if (e.mensaje !== TEXTO) fallos.push('se perdió el comentario al adjuntar o grabar');
if (e.adjuntos !== 2) fallos.push('faltan adjuntos (imagen + voz), hay ' + e.adjuntos);
if (e.senalados !== 2) fallos.push('se perdieron elementos señalados al adjuntar');

// --- comprobar lo que se envía de verdad
const enviado = await p.evaluate(() => new Promise(res => {
  const orig = window.fetch;
  window.fetch = async (u, o) => {
    const fd = o.body;
    res({
      mensaje: fd.get('mensaje'),
      autor: fd.get('autor'),
      senalados: JSON.parse(fd.get('senalados') || '[]').length,
      adjuntos: [...fd.keys()].filter(k => k.startsWith('adjunto')).length
    });
    window.fetch = orig;
    return new Response('{"ok":true}', { status: 200 });
  };
  document.querySelector('#feedtack-host').shadowRoot.querySelector('.enviar').click();
}));
console.log('[5] lo que viaja al servidor:', JSON.stringify(enviado));
if (enviado.mensaje !== TEXTO) fallos.push('el comentario no llega al servidor');
if (enviado.senalados !== 2) fallos.push('no llegan los 2 elementos señalados');
if (enviado.adjuntos !== 2) fallos.push('no llegan los 2 adjuntos');

console.log('\n' + (fallos.length ? 'FALLOS:\n - ' + fallos.join('\n - ') : 'TODO CORRECTO'));
await b.close();
process.exit(fallos.length ? 1 : 0);
