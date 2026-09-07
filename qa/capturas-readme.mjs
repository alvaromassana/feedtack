/**
 * Regenera las capturas del README contra la demo publicada, SIN enviar nada
 * (el POST de /api/feedback se intercepta). También graba el clip de cabecera.
 *
 *   node qa/capturas-readme.mjs [url-base]
 *
 * Salida: docs/img/senalar.png, docs/img/panel.png, docs/img/lista.png, docs/img/demo.webm
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { mkdirSync, readdirSync, renameSync, rmSync } from 'fs';

const BASE = process.argv[2] || 'https://tack-comment.pages.dev';
const OUT = new URL('../docs/img/', import.meta.url).pathname;
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
mkdirSync(OUT, { recursive: true });

const sh = (p, fn, arg) => p.evaluate(fn, arg);
const acc = (p, texto) => sh(p, (t) => {
  const r = document.querySelector('#tack-host').shadowRoot;
  const b = [...r.querySelectorAll('button, .acc, .pest')].find(x => x.textContent.trim().startsWith(t));
  if (!b) throw new Error('no hay boton ' + t);
  b.click();
}, texto);
const listo = async (p) => {
  await p.waitForFunction(() => !!document.querySelector('#tack-host') && !!window.Tack, null, { timeout: 20000 });
  await p.waitForTimeout(600);
};
const mover = async (p, x, y, pasos = 25) => { await p.mouse.move(x, y, { steps: pasos }); };

async function flujo(p, capturas) {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await listo(p);
  await p.route('**/api/feedback', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"demo"}' }));
  await sh(p, () => localStorage.setItem('tack_autor', 'Núria Vallmar'));
  await p.waitForTimeout(400);
  await sh(p, () => window.Tack.escribir());
  await p.waitForTimeout(900);
  await acc(p, 'Señalar');
  await p.waitForTimeout(600);
  // recorre la portada con el ratón: se ve el resaltado siguiendo al cursor
  await mover(p, 520, 300, 30); await p.waitForTimeout(500);
  const h1 = await p.locator('.hero h1').boundingBox();
  await mover(p, h1.x + 220, h1.y + 40, 35);
  await p.waitForTimeout(900);
  if (capturas) await p.screenshot({ path: OUT + 'senalar.png' });
  // sube un nivel con la flecha, para que se vea que el teclado recorre la jerarquía
  await p.keyboard.press('ArrowUp'); await p.waitForTimeout(700);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500);
  await p.mouse.click(h1.x + 220, h1.y + 40);
  await p.waitForTimeout(900);
  await sh(p, () => {
    const r = document.querySelector('#tack-host').shadowRoot;
    const t = r.querySelector('textarea'); t.setAttribute('spellcheck', 'false'); t.focus();
  });
  await p.keyboard.type('El titular tendría que hablar de rehabilitación, que es lo que más nos piden.', { delay: 28 });
  await p.waitForTimeout(700);
  if (capturas) await p.screenshot({ path: OUT + 'panel.png' });
  return p;
}

// ── capturas fijas (2x) ─────────────────────────────────────────────────────
{
  const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-ES' });
  const p = await ctx.newPage();
  await flujo(p, true);
  // la lista: se simula la respuesta de la API con tres comentarios sobre la portada,
  // para que se vean las chinchetas numeradas y los tres estados sin tocar la base real
  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60000).toISOString();
  const mk = (id, mensaje, selector, texto, estado, autor, min) => ({
    id, url: BASE + '/', ruta: '/', titulo: 'Vallmar Arquitectura', mensaje,
    senalados: [{ selector, texto, rect: { x: 0, y: 0, w: 0, h: 0 } }], nAdjuntos: id === 'c2' ? 1 : 0,
    autor, autorId: 'a-otro', estado, creado: hace(min), actualizado: hace(min), editado: false
  });
  const falsos = {
    comentarios: [
      mk('c1', 'El titular tendría que hablar de rehabilitación, que es lo que más nos piden.', '.hero h1', 'Arquitectura que envejece bien.', 'abierto', 'Núria Vallmar', 35),
      mk('c2', 'Esta foto se ve rara en el móvil, os adjunto captura.', '.hero p', 'Estudio en Girona especializado', 'abierto', 'Marc Vallmar', 22),
      mk('c3', 'El botón de contacto tendría que ir en el color de la marca.', '.hero .cta, .hero a', 'Ver proyectos', 'resuelto', 'Núria Vallmar', 180)
    ]
  };
  await p.route('**/api/comentarios?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(falsos) }));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await listo(p);
  await sh(p, () => window.Tack.escribir());
  await p.waitForTimeout(700);
  await acc(p, 'Historial');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + 'lista.png' });
  console.log('capturas: senalar.png, panel.png, lista.png');
  await b.close();
}

// ── clip de cabecera (vídeo → gif con ffmpeg fuera de aquí) ─────────────────
{
  const dir = '/tmp/tack-clip/';
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES', recordVideo: { dir, size: { width: 1280, height: 800 } } });
  const p = await ctx.newPage();
  await flujo(p, false);
  await p.waitForTimeout(1200);
  await ctx.close(); await b.close();
  const f = readdirSync(dir).find(x => x.endsWith('.webm'));
  renameSync(dir + f, OUT + 'demo.webm');
  console.log('clip: demo.webm');
}
