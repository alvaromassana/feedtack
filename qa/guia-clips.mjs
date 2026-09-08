/**
 * Graba los clips de la guía para clientes, contra la demo publicada y SIN enviar
 * nada: todas las llamadas al worker se interceptan y se contestan desde un estado
 * simulado que vive aquí dentro (mutable, para que responder / resolver / borrar se
 * vean de verdad). Ni un solo comentario real entra en la base.
 *
 *   node qa/guia-clips.mjs                 # todos los clips
 *   node qa/guia-clips.mjs --solo 07-responder
 *   node qa/guia-clips.mjs --solo 01-entrar,02-senalar --url http://localhost:8788
 *
 * Salida: guia/clips/<id>.webm  (de ahí salen el mp4 y el gif con ffmpeg, ver abajo)
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const flag = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def; };
const BASE = flag('--url', 'https://feedtack.pages.dev');
const SOLO = (flag('--solo', '') || '').split(',').filter(Boolean);

const OUT = new URL('../guia/clips/', import.meta.url).pathname;
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const YO = 'a-nuria';                       // autorId fijo, para que "lo escribiste tú" salga
const NOMBRE = 'Núria Vallmar';
const ADJUNTO = '/tmp/tack-guia-adjunto.png';
mkdirSync(OUT, { recursive: true });

// ── estado simulado ─────────────────────────────────────────────────────────
// Cada clip arranca con su escenario. Las escrituras del widget lo MUTAN, así que
// lo que se ve en el vídeo después de pulsar es el resultado de verdad del widget
// releyendo la lista, no un pantallazo pintado a mano.
const ahora = Date.now();
const hace = (min) => new Date(ahora - min * 60000).toISOString();
const cmt = (o) => ({
  id: o.id, url: BASE + '/', ruta: '/', titulo: 'Vallmar Arquitectura',
  mensaje: o.mensaje, senalados: o.selector ? [{ selector: o.selector, texto: o.texto || '', etiqueta: o.etiqueta || o.selector, rect: { x: 0, y: 0, w: 0, h: 0 } }] : [],
  nAdjuntos: o.nAdjuntos || 0, autor: o.autor || NOMBRE, autorId: o.autorId || YO,
  estado: o.estado || 'abierto', creado: hace(o.min || 20), actualizado: hace(o.min || 20),
  editado: false, respuestas: o.respuestas || []
});

const ESCENARIO = () => [
  cmt({ id: 'c1', mensaje: 'El titular tendría que hablar de rehabilitación, que es lo que más nos piden.', selector: '.hero h1', texto: 'Arquitectura que envejece bien.', etiqueta: 'h1', min: 35 }),
  cmt({ id: 'c2', mensaje: 'Esta foto se ve rara en el móvil, os adjunto captura.', selector: '.hero p', texto: 'Estudio en Girona especializado', etiqueta: 'p', nAdjuntos: 1, min: 22 }),
  cmt({ id: 'c3', mensaje: 'El botón de contacto tendría que ir en el color de la marca.', selector: '.hero .cta, .hero a', texto: 'Ver proyectos', etiqueta: 'a', estado: 'resuelto', min: 180 })
];

// ── interceptor: el worker entero, sin red ──────────────────────────────────
async function simular(page, estado) {
  await page.route('**/feedtack-api.odd-glade-c171.workers.dev/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const ok = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const idDe = (sufijo) => {
      const p = url.pathname.replace(/\/$/, '').split('/');
      return sufijo ? p[p.length - 2] : p[p.length - 1];
    };
    const buscar = (id) => estado.find((c) => c.id === id);

    if (m === 'GET' && url.pathname.startsWith('/api/comentarios')) return ok({ comentarios: estado });

    if (m === 'POST' && url.pathname === '/api/feedback') {
      // el widget manda FormData; solo necesitamos que aparezca en la lista
      const datos = req.postData() || '';
      const campo = (n) => {
        const r = new RegExp('name="' + n + '"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n------', 'm').exec(datos);
        return r ? r[1].trim() : '';
      };
      let senalados = [];
      try { senalados = JSON.parse(campo('senalados') || '[]'); } catch (e) {}
      estado.unshift(cmt({
        id: 'nuevo-' + estado.length, mensaje: campo('mensaje'), autor: campo('autor') || NOMBRE,
        selector: senalados[0] && senalados[0].selector, texto: senalados[0] && senalados[0].texto,
        etiqueta: senalados[0] && senalados[0].etiqueta, min: 0,
        nAdjuntos: (datos.match(/name="adjunto\d+"/g) || []).length
      }));
      return ok({ ok: true, id: 'nuevo' });
    }

    if (m === 'POST' && url.pathname.endsWith('/respuestas')) {
      const c = buscar(idDe(true));
      const datos = req.postData() || '';
      const campo = (n) => {
        const r = new RegExp('name="' + n + '"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n------', 'm').exec(datos);
        return r ? r[1].trim() : '';
      };
      let senalados = [];
      try { senalados = JSON.parse(campo('senalados') || '[]'); } catch (e) {}
      if (c) {
        c.respuestas = (c.respuestas || []).concat([{
          id: 'r' + ((c.respuestas || []).length + 1), autor: campo('autor') || NOMBRE, autorId: YO,
          mensaje: campo('mensaje'), senalados,
          nAdjuntos: (datos.match(/name="adjunto\d+"/g) || []).length,
          creado: new Date().toISOString()
        }]);
      }
      return ok({ ok: true });
    }

    if (m === 'POST' && url.pathname.endsWith('/estado')) {
      const c = buscar(idDe(true));
      let cuerpo = {};
      try { cuerpo = JSON.parse(req.postData() || '{}'); } catch (e) {}
      if (c) { c.estado = cuerpo.estado; c.actualizado = new Date().toISOString(); }
      return ok({ ok: true });
    }

    if (m === 'PATCH') {
      const c = buscar(idDe(false));
      let cuerpo = {};
      try { cuerpo = JSON.parse(req.postData() || '{}'); } catch (e) {}
      if (c) { c.mensaje = cuerpo.mensaje; c.editado = true; c.actualizado = new Date().toISOString(); }
      return ok({ ok: true });
    }

    if (m === 'DELETE') {
      const i = estado.findIndex((c) => c.id === idDe(false));
      if (i >= 0) estado.splice(i, 1);
      return ok({ ok: true });
    }

    return ok({ ok: true });
  });
}

// ── utilidades de guion ─────────────────────────────────────────────────────
const raiz = (p) => p.locator('#feedtack-host');
const dentro = (p, sel) => p.locator('#feedtack-host').locator(sel);
const esperar = (p, ms) => p.waitForTimeout(ms);

const listo = async (p) => {
  await p.waitForFunction(() => !!document.querySelector('#feedtack-host') && !!window.Feedtack, null, { timeout: 20000 });
  await p.waitForTimeout(700);
};
const mover = (p, x, y, pasos = 28) => p.mouse.move(x, y, { steps: pasos });

/* Un botón del panel por su texto visible. El shadow es abierto, así que los
   locators de Playwright entran solos; buscamos por texto porque las clases
   cambian y el texto es lo que el cliente ve (y lo que manda TEXTOS.es). */
async function pulsar(p, texto, { exacto = false } = {}) {
  const b = dentro(p, 'button, .pest, label').filter({ hasText: texto }).first();
  await b.waitFor({ state: 'visible', timeout: 8000 });
  await b.click();
  await esperar(p, 500);
}

async function teclear(p, selector, texto, delay = 26) {
  const t = dentro(p, selector).first();
  await t.click();
  await p.evaluate(() => {
    const r = document.querySelector('#feedtack-host').shadowRoot;
    r.querySelectorAll('textarea').forEach((x) => x.setAttribute('spellcheck', 'false'));
  });
  await p.keyboard.type(texto, { delay });
}

// ── los clips ───────────────────────────────────────────────────────────────
// Cada uno: empieza quieto, hace UNA cosa, acaba quieto. 5-10 s.
const CLIPS = [
  {
    id: '01-entrar',
    // Entra por su enlace personal: el nombre ya está puesto, no se lo pedimos.
    escenario: () => [],
    url: (b) => b + '/?feedtack_yo=' + encodeURIComponent(NOMBRE),
    async guion(p) {
      await esperar(p, 1400);
      const pest = dentro(p, '.pestana').first();
      const caja = await pest.boundingBox();
      await mover(p, caja.x - 260, caja.y + caja.height / 2, 30);
      await esperar(p, 700);
      await mover(p, caja.x + caja.width / 2, caja.y + caja.height / 2, 20);
      await esperar(p, 900);          // la pestaña se despliega al pasar por encima
      await pest.click();
      await esperar(p, 2200);
    }
  },
  {
    id: '02-senalar',
    escenario: () => [],
    async guion(p) {
      await p.evaluate(() => window.Feedtack.escribir());
      await esperar(p, 900);
      await pulsar(p, 'Señalar');
      await esperar(p, 700);
      const h1 = await p.locator('.hero h1').boundingBox();
      await mover(p, 520, 320, 25);
      await esperar(p, 600);
      await mover(p, h1.x + 200, h1.y + 34, 30);
      await esperar(p, 1100);
      await p.keyboard.press('ArrowUp');      // sube al bloque entero
      await esperar(p, 1500);
      // down/up sin mover: un click() de Playwright mueve el ratón y el mousemove
      // volvería a elegir lo que hay debajo, deshaciendo la flecha
      await p.mouse.down(); await p.mouse.up();
      await esperar(p, 1600);
    }
  },
  {
    id: '03-contar',
    escenario: () => [],
    /* Sin nota de voz: está retirada de la interfaz desde el 7-sep-2026 (feedtack.js, la
       línea de refs.btnVoz está comentada). El código de grabación sigue ahí, así que
       si vuelve, este clip se rehace añadiéndola. */
    async guion(p) {
      await p.evaluate(() => window.Feedtack.escribir());
      await esperar(p, 900);
      await teclear(p, 'textarea', 'El titular tendría que hablar de rehabilitación, que es lo que más nos piden.');
      await esperar(p, 1100);
      await dentro(p, 'input[type=file]').first().setInputFiles(ADJUNTO);
      await esperar(p, 2400);                 // el adjunto aparece listado bajo el texto
    }
  },
  {
    id: '04-enviar',
    escenario: () => [],
    async guion(p) {
      await p.evaluate(() => window.Feedtack.escribir());
      await esperar(p, 700);
      await teclear(p, 'textarea', 'El titular tendría que hablar de rehabilitación.', 22);
      await esperar(p, 900);
      await pulsar(p, 'Enviar comentario');
      await esperar(p, 1000);
      // si no ha señalado nada, el widget invita a señalar una vez: se envía igual
      const sin = dentro(p, 'button').filter({ hasText: 'Enviar sin señalar' }).first();
      if (await sin.count()) { await sin.click(); }
      await esperar(p, 2600);                 // "Recibido, gracias"
    }
  },
  {
    id: '05-marcado',
    escenario: ESCENARIO,
    async guion(p) {
      await p.evaluate(() => window.Feedtack.abrir());
      await esperar(p, 1600);                 // chinchetas numeradas + regleta
      await pulsar(p, 'Ocultar marcadores');
      await esperar(p, 1800);
      await pulsar(p, 'Ocultar marcadores');
      await esperar(p, 1600);
    }
  },
  {
    id: '06-historial',
    escenario: ESCENARIO,
    async guion(p) {
      await p.evaluate(() => window.Feedtack.abrir());
      await esperar(p, 900);
      await pulsar(p, 'Historial');
      await esperar(p, 1200);
      await pulsar(p, 'Resueltos');
      await esperar(p, 1300);
      await pulsar(p, 'Pendientes');
      await esperar(p, 1200);
      await dentro(p, '.tarjeta, .item, li, .fila').filter({ hasText: 'titular' }).first().click();
      await esperar(p, 1800);                 // al abrirlo, la zona queda resaltada
      await pulsar(p, 'Editar');
      await esperar(p, 700);
      await teclear(p, 'textarea', ' Y que se lea bien en móvil.', 30);
      await esperar(p, 600);
      await pulsar(p, 'Guardar cambios');
      await esperar(p, 1800);
    }
  },
  {
    id: '07-responder',
    escenario: ESCENARIO,
    async guion(p) {
      await p.evaluate(() => window.Feedtack.verComentario('c2'));
      await esperar(p, 1600);
      await teclear(p, 'textarea.resp-ta, .hilo textarea', 'Me refiero a esta zona, que en el móvil se corta.', 24);
      await esperar(p, 700);
      await dentro(p, '.resp-barra .chico').first().click();   // señalar una zona
      await esperar(p, 900);
      const foto = await p.locator('.hero p').boundingBox();
      await mover(p, foto.x + 140, foto.y + 18, 26);
      await esperar(p, 900);
      await p.mouse.click(foto.x + 140, foto.y + 18);
      await esperar(p, 1200);
      await pulsar(p, 'Enviar respuesta');
      await esperar(p, 2200);
    }
  },
  {
    id: '08-cerrar-eliminar',
    escenario: ESCENARIO,
    async guion(p) {
      await p.evaluate(() => window.Feedtack.verComentario('c1'));
      await esperar(p, 1400);
      await pulsar(p, 'Resuelto');
      await esperar(p, 2000);
      await p.evaluate(() => window.Feedtack.verComentario('c2'));
      await esperar(p, 1200);
      await pulsar(p, 'Eliminar comentario');
      await esperar(p, 1800);                 // el aviso de que no se puede deshacer
      await pulsar(p, 'Sí, eliminar');
      await esperar(p, 2200);
    }
  },
  {
    id: '09-confirmar',
    escenario: () => [
      cmt({ id: 'c3', mensaje: 'El botón de contacto tendría que ir en el color de la marca.', selector: '.hero .cta, .hero a', texto: 'Ver proyectos', etiqueta: 'a', estado: 'resuelto', min: 180 }),
      cmt({ id: 'c4', mensaje: 'En el pie sigue apareciendo el teléfono antiguo.', selector: '.hero p', texto: 'Estudio en Girona', etiqueta: 'p', estado: 'resuelto', min: 90 })
    ],
    async guion(p) {
      await p.evaluate(() => window.Feedtack.verComentario('c3'));
      await esperar(p, 1800);                 // "Lo hemos dado por arreglado"
      await pulsar(p, 'Está bien así');
      await esperar(p, 2000);
      await p.evaluate(() => window.Feedtack.verComentario('c4'));
      await esperar(p, 1400);
      await pulsar(p, 'No, sigue mal');
      await esperar(p, 2200);
    }
  },
  // ── los dos ejemplos largos, de principio a fin ──────────────────────────
  {
    id: 'ejemplo-1-titular',
    escenario: () => [],
    url: (b) => b + '/?feedtack_yo=' + encodeURIComponent(NOMBRE),
    async guion(p) {
      await esperar(p, 1200);
      await dentro(p, '.pestana').first().click();
      await esperar(p, 1400);
      await pulsar(p, 'Señalar');
      await esperar(p, 600);
      const h1 = await p.locator('.hero h1').boundingBox();
      await mover(p, h1.x + 200, h1.y + 34, 30);
      await esperar(p, 900);
      await p.mouse.click(h1.x + 200, h1.y + 34);
      await esperar(p, 1000);
      await teclear(p, 'textarea', 'El titular no me convence: tendría que hablar de rehabilitación, que es lo que más nos piden.');
      await esperar(p, 900);
      await pulsar(p, 'Enviar comentario');
      await esperar(p, 3000);
    }
  },
  {
    id: 'ejemplo-2-foto',
    escenario: () => [],
    url: (b) => b + '/?feedtack_yo=' + encodeURIComponent(NOMBRE),
    async guion(p, estado) {
      await esperar(p, 1000);
      await dentro(p, '.pestana').first().click();
      await esperar(p, 1200);
      await pulsar(p, 'Señalar');
      await esperar(p, 600);
      const foto = await p.locator('.hero p').boundingBox();
      await mover(p, foto.x + 140, foto.y + 18, 28);
      await esperar(p, 800);
      await p.mouse.click(foto.x + 140, foto.y + 18);
      await esperar(p, 900);
      await teclear(p, 'textarea', 'Esta foto se ve rara en el móvil, os adjunto captura.');
      await esperar(p, 700);
      await dentro(p, 'input[type=file]').first().setInputFiles(ADJUNTO);
      await esperar(p, 1100);
      await pulsar(p, 'Enviar comentario');
      await esperar(p, 2400);
      // y días después: nosotros lo damos por resuelto y ella lo confirma
      estado.forEach((c) => { c.estado = 'resuelto'; });
      await p.evaluate(() => window.Feedtack.recargar());
      await esperar(p, 900);
      await p.evaluate(() => { const e = window.Feedtack.estado(); window.Feedtack.verComentario(e.comentarios[0].id); });
      await esperar(p, 2000);
      await pulsar(p, 'Está bien así');
      await esperar(p, 2400);
    }
  }
];

// ── adjunto de ejemplo (una imagen de verdad, pequeña) ──────────────────────
function prepararAdjunto() {
  if (existsSync(ADJUNTO)) return;
  // PNG mínimo válido de 8x8 gris: lo único que importa es que el navegador lo acepte
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHUlEQVQoU2NkYGD4z0AEYBxVSFdASoq' +
    'RJAOgFAMAB2sCAQZ0kR8AAAAASUVORK5CYII=';
  writeFileSync(ADJUNTO, Buffer.from(b64, 'base64'));
}

// ── grabación ───────────────────────────────────────────────────────────────
async function grabar(clip) {
  const dir = '/tmp/tack-guia/' + clip.id + '/';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const flags = ['--no-sandbox', '--hide-scrollbars'];
  if (clip.audio) flags.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');

  const b = await chromium.launch({ headless: true, executablePath: CHROME, args: flags });
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 800 }, locale: 'es-ES',
    permissions: clip.audio ? ['microphone'] : [],
    recordVideo: { dir, size: { width: 1280, height: 800 } }
  });
  const p = await ctx.newPage();

  const estado = clip.escenario();
  await simular(p, estado);
  // identidad fija: así "lo escribiste tú" y los botones de autor salen siempre
  await p.addInitScript(([id, nombre]) => {
    localStorage.setItem('feedtack_autor_id', id);
    localStorage.setItem('feedtack_autor', nombre);
  }, [YO, NOMBRE]);

  await p.goto(clip.url ? clip.url(BASE) : BASE + '/', { waitUntil: 'networkidle' });
  await listo(p);
  await clip.guion(p, estado);

  await ctx.close();
  await b.close();
  const f = readdirSync(dir).find((x) => x.endsWith('.webm'));
  renameSync(dir + f, OUT + clip.id + '.webm');
  console.log('  clip ' + clip.id + '.webm');
}

prepararAdjunto();
const lista = SOLO.length ? CLIPS.filter((c) => SOLO.includes(c.id)) : CLIPS;
if (!lista.length) { console.error('ningún clip coincide con --solo'); process.exit(2); }
console.log('grabando ' + lista.length + ' clip(s) contra ' + BASE);
for (const clip of lista) {
  try { await grabar(clip); }
  catch (e) { console.error('  FALLO en ' + clip.id + ': ' + (e.message || e)); process.exitCode = 1; }
}
console.log('\nlisto. Ahora, para cada clip:');
console.log('  ffmpeg -i guia/clips/X.webm -vf "fps=8,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 guia/clips/X.gif');
console.log('  ffmpeg -i guia/clips/X.webm -an -movflags +faststart -pix_fmt yuv420p -vf scale=960:-2 -crf 30 guia/clips/X.mp4');
