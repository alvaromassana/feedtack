/**
 * Prueba de extremo a extremo contra la demo PUBLICADA:
 * señala un elemento, adjunta una imagen y envía de verdad.
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const URL_DEMO = process.argv[2] || 'https://tack-comment.pages.dev/';
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
const p = await ctx.newPage();

let respuesta = null;
p.on('response', async r => {
  if (r.url().includes('/api/feedback') && r.request().method() === 'POST') {
    respuesta = { estado: r.status(), cuerpo: await r.text().catch(() => '') };
  }
});

console.log('abriendo', URL_DEMO);
await p.goto(URL_DEMO, { waitUntil: 'networkidle' });
// esperar a que el widget esté listo de verdad, no a un timeout a ojo
await p.waitForFunction(() => typeof window.Tack === 'object', null, { timeout: 15000 });
await p.waitForTimeout(300);

// abrir y señalar un elemento real
await p.evaluate(() => window.Tack.abrir());
await p.waitForTimeout(300);
await p.evaluate(() => {
  const s = document.querySelector('#tack-host').shadowRoot;
  [...s.querySelectorAll('.acc')].find(b => b.textContent.includes('Señalar')).click();
});
await p.locator('.cifra').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
const caja = await p.locator('.cifra').first().boundingBox();
await p.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
await p.waitForTimeout(300);
await p.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
await p.waitForTimeout(400);

// rellenar y adjuntar
await p.evaluate(async () => {
  const s = document.querySelector('#tack-host').shadowRoot;
  s.querySelector('textarea').value =
    'PRUEBA DEL SISTEMA. Este numero de proyectos entregados esta desactualizado, ya son 71. ' +
    'Adjunto la captura de la hoja que os pasamos en la reunion.';
  s.querySelector('input[type=text]').value = 'Prueba automatica de Claudito';

  const c = document.createElement('canvas');
  c.width = 420; c.height = 260;
  const g = c.getContext('2d');
  g.fillStyle = '#f0ece5'; g.fillRect(0, 0, 420, 260);
  g.fillStyle = '#9a6b45'; g.fillRect(0, 0, 420, 8);
  g.fillStyle = '#14181d'; g.font = '600 20px sans-serif';
  g.fillText('Adjunto de prueba', 28, 70);
  g.font = '400 15px sans-serif';
  g.fillText('Widget Tack Comment, prueba de extremo a extremo', 28, 105);
  g.fillText('Si ves esto en el correo, los adjuntos van bien.', 28, 132);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'adjunto-de-prueba.png', { type: 'image/png' }));
  const input = s.querySelector('input[type=file]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(500);

console.log('enviando de verdad...');
await p.evaluate(() => document.querySelector('#tack-host').shadowRoot.querySelector('.enviar').click());
// el panel de éxito se autocierra a los 4,2 s, así que hay que mirarlo antes
await p.waitForFunction(
  () => !!document.querySelector('#tack-host').shadowRoot.querySelector('.hecho, .error'),
  null, { timeout: 20000 }
);

const estadoFinal = await p.evaluate(() => {
  const s = document.querySelector('#tack-host').shadowRoot;
  return {
    pantallaExito: !!s.querySelector('.hecho'),
    error: s.querySelector('.error')?.textContent || null
  };
});

console.log('\nrespuesta del worker:', respuesta);
console.log('estado del widget:', estadoFinal);

const ok = respuesta?.estado === 200 && estadoFinal.pantallaExito && !estadoFinal.error;
console.log('\nRESULTADO:', ok ? 'ENVIADO CORRECTAMENTE' : 'FALLO');
await b.close();
process.exit(ok ? 0 : 1);
