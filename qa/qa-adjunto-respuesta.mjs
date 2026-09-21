/**
 * ¿Se puede quitar un adjunto que todavía NO se ha enviado, desde la caja de RESPONDER?
 *
 * 🔴 Por qué existe: hasta el 21 de septiembre de 2026 la caja de respuesta solo pintaba
 * un contador de texto ("1 adjunto"), sin miniatura y sin "×", así que lo que subías ahí
 * ya no se podía quitar: o enviabas la respuesta con el fichero de más, o la escribías de
 * nuevo. En el comentario nuevo el "×" sí estaba, y por eso el hueco pasó desapercibido.
 *
 * No sale a la red ni levanta servidor: la página, el widget y la API las sirve esta
 * misma prueba interceptando las peticiones, así que no toca los datos de ningún sitio.
 *
 * Salidas: 0 bien · 1 el "×" no está o no quita nada · 2 no se ha podido mirar.
 */
import { chromium, opcionesLanzar } from './navegador.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WIDGET = join(AQUI, '..', 'widget', 'feedtack.js');
const FOTO = join(tmpdir(), 'adjunto-de-prueba.png');
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const COMENTARIO = {
  id: 'c-prueba', respuestas: [], url: 'http://prueba.local/', ruta: '/', titulo: 'prueba',
  mensaje: 'Comentario de prueba', senalados: [], nAdjuntos: 0, autor: 'Otra persona',
  autorId: 'a-otro', estado: 'pendiente', creado: new Date().toISOString()
};

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>prueba</title></head>
<body><h1>Prueba del widget</h1>
<script src="/feedtack.js" data-site="prueba" data-endpoint="https://api.prueba.local" data-label="Comentar"></script>
</body></html>`;

writeFileSync(FOTO, Buffer.from(PNG_1PX, 'base64'));

const fallos = [];
const navegador = await chromium.launch(opcionesLanzar());
const pagina = await (await navegador.newContext()).newPage();

await pagina.route('**/*', ruta => {
  const url = ruta.request().url();
  if (url.includes('/api/')) {
    return ruta.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, comments: [COMENTARIO], comentarios: [COMENTARIO] })
    });
  }
  if (url.endsWith('/feedtack.js')) {
    return ruta.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(WIDGET, 'utf8') });
  }
  return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
});

const dentro = fn => pagina.evaluate(fn);
const clic = texto => pagina.evaluate(t => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  const e = [...s.querySelectorAll('button, .pest, .filtro')].find(x => x.textContent.includes(t));
  if (!e) return false;
  e.click();
  return true;
}, texto);

function noSePudo(motivo) {
  console.error('NO SE HA PODIDO MIRAR:', motivo);
  navegador.close().then(() => process.exit(2));
}

await pagina.goto('http://prueba.local/', { waitUntil: 'networkidle' });
await pagina.waitForTimeout(1200);

const hayWidget = await dentro(() => !!document.querySelector('#feedtack-host'));
if (!hayWidget) noSePudo('el widget no se ha montado en la página');

await dentro(() => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  (s.querySelector('.lanzador') || s.querySelector('button')).click();
});
await pagina.waitForTimeout(900);
await clic('Historial'); await pagina.waitForTimeout(1200);
await clic('Todos'); await pagina.waitForTimeout(1200);
await clic('Comentario de prueba'); await pagina.waitForTimeout(1500);

/* Control: sin llegar a la caja de responder, lo que venga después no mide nada. */
const hayCaja = await dentro(() => !!document.querySelector('#feedtack-host').shadowRoot.querySelector('.resp-ta'));
if (!hayCaja) noSePudo('no se ha abierto la caja de responder del comentario');

const input = await pagina.evaluateHandle(() => {
  const l = document.querySelector('#feedtack-host').shadowRoot.querySelectorAll('input[type=file]');
  return l[l.length - 1];
});
await input.asElement().setInputFiles(FOTO);
await pagina.waitForTimeout(1200);

const leer = () => dentro(() => {
  const r = document.querySelector('#feedtack-host').shadowRoot.querySelector('.resp-ta').parentElement;
  return {
    filas: r.querySelectorAll('.adj').length,
    nombre: (r.querySelector('.adj .nom') || {}).textContent || null,
    equis: r.querySelectorAll('.adj .quitar').length,
    miniatura: !!r.querySelector('.adj .mini')
  };
});

const antes = await leer();
if (antes.filas !== 1) fallos.push('el adjunto no aparece listado (filas=' + antes.filas + ')');
if (antes.equis !== 1) fallos.push('la fila no trae su × para quitarlo');
if (antes.nombre !== 'adjunto-de-prueba.png') fallos.push('no se ve el nombre del fichero (' + antes.nombre + ')');
if (!antes.miniatura) fallos.push('no se ve la miniatura');

if (antes.equis === 1) {
  await dentro(() => document.querySelector('#feedtack-host').shadowRoot
    .querySelector('.resp-ta').parentElement.querySelector('.adj .quitar').click());
  await pagina.waitForTimeout(1000);
  const despues = await leer();
  if (despues.filas !== 0) fallos.push('la × no quita el adjunto (quedan ' + despues.filas + ')');
}

await navegador.close();
console.log(fallos.length ? 'FALLA:\n  - ' + fallos.join('\n  - ') : 'OK: el adjunto de una respuesta se lista y se puede quitar antes de enviarla');
process.exit(fallos.length ? 1 : 0);
