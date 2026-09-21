/**
 * ¿El panel NOMBRA los ficheros de un comentario ya enviado, y se abren al pulsarlos?
 *
 * Y su otra mitad, que es la que se rompe sola: un comentario del que solo se guardó el
 * NÚMERO (cualquiera anterior al 21 de septiembre de 2026, o un servidor sin dirección
 * pública configurada) tiene que seguir enseñando "1 adjunto", no una lista vacía.
 *
 * La API la sirve esta misma prueba, así que no sale a la red ni toca ningún backend.
 *
 * Salidas: 0 bien · 1 no lista, no enlaza, o pierde el contador de los viejos · 2 no se
 * ha podido mirar.
 */
import { chromium, CHROME } from './navegador.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WIDGET = join(AQUI, '..', 'widget', 'feedtack.js');
const BASE = { respuestas: [], url: 'http://prueba.local/', ruta: '/', titulo: 'prueba',
  senalados: [], autor: 'Otra persona', autorId: 'a-otro', estado: 'pendiente',
  creado: new Date().toISOString() };

/* Con nombres: los dos tienen que salir, y cada uno con su enlace. */
const CON_LISTA = { ...BASE, id: 'c-con-lista', mensaje: 'Comentario CON lista', nAdjuntos: 2,
  adjuntos: [
    { nombre: 'plano-planta-baja.pdf', tipo: 'application/pdf', bytes: 120, enlace: 'https://ficheros.prueba/uno' },
    { nombre: 'fachada.png', tipo: 'image/png', bytes: 90, enlace: 'https://ficheros.prueba/dos' }
  ] };

/* Sin nombres: es lo único que se sabe de él, así que se queda el contador. */
const SIN_LISTA = { ...BASE, id: 'c-sin-lista', mensaje: 'Comentario SIN lista', nAdjuntos: 1, adjuntos: [] };

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>prueba</title></head>
<body><h1>Prueba del widget</h1>
<script src="/feedtack.js" data-site="prueba" data-endpoint="https://api.prueba.local" data-label="Comentar"></script>
</body></html>`;

const fallos = [];
const navegador = await chromium.launch({ executablePath: CHROME });
const pagina = await (await navegador.newContext()).newPage();

await pagina.route('**/*', ruta => {
  const url = ruta.request().url();
  if (url.includes('/api/')) {
    const lista = [CON_LISTA, SIN_LISTA];
    return ruta.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, comments: lista, comentarios: lista }) });
  }
  if (url.endsWith('/feedtack.js')) {
    return ruta.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(WIDGET, 'utf8') });
  }
  return ruta.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
});

const dentro = (fn, arg) => pagina.evaluate(fn, arg);
const clic = texto => pagina.evaluate(t => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  const e = [...s.querySelectorAll('button, .pest, .filtro, .cerrar')].find(x => x.textContent.includes(t));
  if (!e) return false;
  e.click();
  return true;
}, texto);

async function noSePudo(motivo) {
  console.error('NO SE HA PODIDO MIRAR:', motivo);
  await navegador.close();
  process.exit(2);
}

/* Cada caso arranca de cero en vez de buscar el botón de volver: una ficha abierta a
   medias haría que el segundo caso midiera la pantalla del primero. */
async function abrirFicha(mensaje) {
  await pagina.goto('http://prueba.local/', { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1000);
  await dentro(() => {
    const s = document.querySelector('#feedtack-host').shadowRoot;
    (s.querySelector('.lanzador') || s.querySelector('button')).click();
  });
  await pagina.waitForTimeout(700);
  await clic('Historial'); await pagina.waitForTimeout(900);
  await clic('Todos'); await pagina.waitForTimeout(900);
  const abierto = await clic(mensaje);
  await pagina.waitForTimeout(1200);
  return abierto;
}

const leer = () => dentro(() => {
  const s = document.querySelector('#feedtack-host').shadowRoot;
  const d = s.querySelector('.datos');
  return {
    /* innerText de la ficha, no textContent del shadow root entero: ahí los nodos se
       pegan sin separador ("1 adjuntoEste comentario...") y cualquier medida del final
       de la frase miente. */
    texto: d ? d.innerText : '',
    enlaces: [...s.querySelectorAll('a.adj-env')].map(a => ({ nombre: a.textContent, href: a.getAttribute('href'), nuevaPestana: a.getAttribute('target') === '_blank' }))
  };
});

await pagina.goto('http://prueba.local/', { waitUntil: 'networkidle' });
await pagina.waitForTimeout(1200);
if (!await dentro(() => !!document.querySelector('#feedtack-host'))) await noSePudo('el widget no se ha montado');

/* 1) El que trae nombres */
if (!await abrirFicha('Comentario CON lista')) await noSePudo('no se ha podido abrir la ficha del comentario con lista');
const con = await leer();
if (con.enlaces.length !== 2) fallos.push('esperaba 2 ficheros nombrados y hay ' + con.enlaces.length);
const nombres = con.enlaces.map(e => e.nombre);
if (!nombres.includes('plano-planta-baja.pdf')) fallos.push('falta el nombre plano-planta-baja.pdf (' + nombres.join(', ') + ')');
if (!nombres.includes('fachada.png')) fallos.push('falta el nombre fachada.png (' + nombres.join(', ') + ')');
const uno = con.enlaces.find(e => e.nombre === 'plano-planta-baja.pdf');
if (uno && uno.href !== 'https://ficheros.prueba/uno') fallos.push('el enlace no apunta al fichero (' + (uno && uno.href) + ')');
if (uno && !uno.nuevaPestana) fallos.push('el fichero no se abre en una pestaña nueva');

/* 2) El viejo, del que solo se guardó el número */
if (!await abrirFicha('Comentario SIN lista')) await noSePudo('no se ha podido abrir la ficha del comentario sin lista');
const sin = await leer();
if (sin.enlaces.length !== 0) fallos.push('un comentario sin nombres guardados no puede enseñar enlaces (' + sin.enlaces.length + ')');
if (!/1 adjunto$/m.test(sin.texto)) fallos.push('se ha perdido el contador "1 adjunto" de los comentarios antiguos');

await navegador.close();
console.log(fallos.length ? 'FALLA:\n  - ' + fallos.join('\n  - ') : 'OK: los ficheros enviados se nombran y se abren, y los antiguos conservan su contador');
process.exit(fallos.length ? 1 : 0);
