/**
 * QA visual del widget Tack Comment: captura cada estado por separado.
 * node qa/qa-estados.mjs [url] [carpeta-salida]
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';

const URL_DEMO = process.argv[2] || 'http://127.0.0.1:8791/';
const SALIDA = process.argv[3] || '/home/alvaro/projects/tack-comment/qa/capturas';
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

mkdirSync(SALIDA, { recursive: true });

const errores = [];
const fallos = [];

const b = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'es-ES',
  permissions: ['microphone']
});
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
p.on('pageerror', e => errores.push('pageerror: ' + e.message));
p.on('requestfailed', r => {
  if (!r.url().includes('/api/feedback')) fallos.push(r.url() + ' :: ' + r.failure()?.errorText);
});

// Simula el backend para poder capturar el estado "enviado"
await p.route('**/api/feedback', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"demo"}' })
);

const shot = async (nombre, opts = {}) => {
  await p.screenshot({ path: `${SALIDA}/${nombre}.png`, ...opts });
  console.log('  capturado:', nombre);
};

console.log('QA Tack Comment —', URL_DEMO);
await p.goto(URL_DEMO, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);

// --- 1. la web con la burbuja cerrada
console.log('\n[1] burbuja cerrada');
await shot('01-burbuja-en-la-web');
const burbuja = p.locator('#tack-host').first();
await shot('01b-burbuja-detalle', {
  clip: { x: 1080, y: 720, width: 360, height: 180 }
});

// --- 2. panel abierto
console.log('[2] panel abierto');
await p.evaluate(() => window.Tack.escribir());
await p.waitForTimeout(400);
await shot('02-panel-abierto');
await shot('02b-panel-detalle', { clip: { x: 1010, y: 300, width: 430, height: 600 } });

// --- 3. modo señalar
console.log('[3] modo senalar');
await p.evaluate(() => {
  const s = document.querySelector('#tack-host').shadowRoot;
  [...s.querySelectorAll('.acc')].find(b => b.textContent.includes('Señalar')).click();
});
await p.waitForTimeout(300);
// la tarjeta tiene que estar VISIBLE antes de apuntarla, si no el ratón
// va a una zona vacía y el resaltado no se dispara (fallo del QA anterior)
await p.locator('.servicio').nth(1).scrollIntoViewIfNeeded();
await p.waitForTimeout(500);
const objetivo = await p.locator('.servicio').nth(1).boundingBox();
if (!objetivo) throw new Error('la tarjeta objetivo no es visible');
await p.mouse.move(objetivo.x + objetivo.width / 2, objetivo.y + 60);
await p.waitForTimeout(400);
// comprueba que el resaltado existe DE VERDAD, no solo que la captura salió
const resaltado = await p.evaluate(() => {
  const m = document.querySelector('.tk-marca');
  return m && m.style.display !== 'none' ? { w: m.style.width, h: m.style.height } : null;
});
if (!resaltado) fallos.push('modo senalar: no se dibujo el resaltado al pasar por encima');
else console.log('  resaltado activo:', resaltado.w, 'x', resaltado.h);
await shot('03-modo-senalar');

// --- 4. elemento señalado, con adjunto simulado
console.log('[4] elemento senalado + adjunto');
await p.mouse.click(objetivo.x + objetivo.width / 2, objetivo.y + 60);
await p.waitForTimeout(400);
await p.evaluate(() => {
  const s = document.querySelector('#tack-host').shadowRoot;
  s.querySelector('textarea').value =
    'El titulo de esta tarjeta deberia decir "Rehabilitacion de masias", que es lo que mas nos piden. Y la foto de cabecera es de un proyecto antiguo, os paso otra.';
  s.querySelector('input[type=text]').value = 'Núria Vallmar';
});
// adjunto real: un png pequeño generado al vuelo
await p.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#c3b8a9'; g.fillRect(0, 0, 320, 200);
  g.fillStyle = '#14181d'; g.font = '600 17px sans-serif';
  g.fillText('foto-fachada-nueva.jpg', 24, 105);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'foto-fachada-nueva.png', { type: 'image/png' }));
  const input = document.querySelector('#tack-host').shadowRoot.querySelector('input[type=file]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(400);
await shot('04-relleno-completo');
await shot('04b-relleno-detalle', { clip: { x: 1010, y: 200, width: 430, height: 700 } });

// --- 5. grabando nota de voz
// La nota de voz se retiró de la interfaz el 7-sep-2026 y el código de grabación sigue ahí.
// Este paso se salta si el botón no está, en vez de tumbar la batería entera; el día que
// vuelva, vuelve solo. Se DICE que se ha saltado: un caso silenciado no es un caso que pasa.
console.log('[5] grabando voz');
const hayVoz = await p.evaluate(() => {
  const s = document.querySelector('#tack-host').shadowRoot;
  return [...s.querySelectorAll('.acc')].some(b => b.textContent.includes('Nota de voz'));
});
if (!hayVoz) {
  console.log('  SALTADO: la nota de voz no está en la interfaz');
} else {
  await p.evaluate(() => {
    const s = document.querySelector('#tack-host').shadowRoot;
    [...s.querySelectorAll('.acc')].find(b => b.textContent.includes('Nota de voz')).click();
  });
  await p.waitForTimeout(2200);
  await shot('05-grabando-voz', { clip: { x: 1010, y: 200, width: 430, height: 700 } });
  await p.evaluate(() => {
    const s = document.querySelector('#tack-host').shadowRoot;
    [...s.querySelectorAll('.acc')].find(b => b.textContent.includes('Parar')).click();
  });
  await p.waitForTimeout(900);
  await shot('05b-voz-adjuntada', { clip: { x: 1010, y: 200, width: 430, height: 700 } });
}

// --- 6. enviado
console.log('[6] enviado');
await p.evaluate(() => {
  document.querySelector('#tack-host').shadowRoot.querySelector('.enviar').click();
});
await p.waitForTimeout(1200);
await shot('06-enviado');
await shot('06b-enviado-detalle', { clip: { x: 1010, y: 560, width: 430, height: 340 } });

// --- 7. móvil
console.log('[7] movil 390x844');
const movil = await ctx.newPage();
await movil.route('**/api/feedback', r => r.fulfill({ status: 200, body: '{"ok":true}' }));
await movil.setViewportSize({ width: 390, height: 844 });
await movil.goto(URL_DEMO, { waitUntil: 'networkidle' });
await movil.waitForTimeout(500);
await movil.screenshot({ path: `${SALIDA}/07-movil-burbuja.png` });
await movil.evaluate(() => window.Tack.escribir());
await movil.waitForTimeout(400);
await movil.screenshot({ path: `${SALIDA}/07b-movil-panel.png` });
console.log('  capturado: movil');

// --- 8. comprobaciones duras
console.log('\n[8] comprobaciones');
const comp = await p.evaluate(() => {
  const host = document.querySelector('#tack-host');
  return {
    hostExiste: !!host,
    usaShadow: !!(host && host.shadowRoot),
    // el widget no debe filtrar estilos ni nodos al documento del cliente
    nodosFuera: document.querySelectorAll('body > *:not(script):not(#tack-host)').length,
    claseSenalarLimpia: !document.documentElement.classList.contains('tk-senalando'),
    restosSenalar: document.querySelectorAll('.tk-marca, .tk-etiqueta, .tk-aviso').length,
    apiPublica: typeof window.Tack === 'object',
    // El renombrado de clases dejó una vez el CSS apuntando a la clase vieja y el
    // widget perdió el position:fixed sin que ninguna prueba se enterase.
    posicionado: (() => {
      const r = document.querySelector('#tack-host').shadowRoot.querySelector('.tk');
      if (!r) return 'no existe la raiz';
      const e = getComputedStyle(r);
      const caja = r.getBoundingClientRect();
      const pegadoAbajo = Math.abs(window.innerHeight - caja.bottom) < 40;
      const pegadoDcha = Math.abs(window.innerWidth - caja.right) < 40;
      return e.position === 'fixed' && pegadoAbajo && pegadoDcha
        ? 'ok'
        : `position:${e.position} abajo:${pegadoAbajo} derecha:${pegadoDcha}`;
    })()
  };
});
console.log(JSON.stringify(comp, null, 2));

console.log('\nerrores de consola:', errores.length ? errores : 'ninguno');
console.log('peticiones fallidas:', fallos.length ? fallos : 'ninguna');

const ok = comp.hostExiste && comp.usaShadow && comp.claseSenalarLimpia && comp.posicionado === 'ok' &&
           comp.restosSenalar === 0 && errores.length === 0 && fallos.length === 0;
console.log('\nRESULTADO:', ok ? 'OK' : 'HAY FALLOS');

await b.close();
process.exit(ok ? 0 : 1);
