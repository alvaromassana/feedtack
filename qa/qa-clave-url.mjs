#!/usr/bin/env node
/**
 * qa-clave-url.mjs — la clave de equipo (?feedtack_admin=) sale de la barra de direcciones
 * en cuanto el widget la guarda, y lo demás de la dirección se queda.
 *
 * Mide SOLO la barra (historial, Referer de lo que cargue después). Que la clave no
 * viaje en la url de un comentario lo mide el worker: worker/qa/qa-seguridad.mjs, caso 2.
 * Sirve su propia página en local con el endpoint VACÍO: no habla con ningún worker, así
 * que no escribe nada en ningún sitio.
 *
 * Uso:  node qa/qa-clave-url.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, opcionesLanzar } from './navegador.mjs';

const WIDGET = fs.readFileSync(path.resolve(import.meta.dirname, '../widget/feedtack.js'));
const servidor = http.createServer((req, res) => {
  if (req.url.startsWith('/feedtack.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(WIDGET);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>p</title><body><p>hola</p><script src="/feedtack.js" data-site="qa" data-endpoint=""></script>');
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;

let fallos = 0;
const ok = (n, b, d = '') => { console.log(`${b ? '  ✅' : '  ❌'} ${n}${!b ? ` — ${d}` : ''}`); if (!b) fallos++; };

const navegador = await chromium.launch(opcionesLanzar());
try {
  for (const [param, valor] of [['feedtack_admin', 'CLAVE1'], ['tack_admin', 'CLAVE2']]) {
    const pagina = await navegador.newPage();
    await pagina.goto(`${base}/p?a=1&${param}=${valor}&feedtack_yo=Sol#seccion`);
    await pagina.waitForTimeout(800);
    const url = pagina.url();
    const guardada = await pagina.evaluate(() => localStorage.getItem('feedtack_admin'));
    ok(`${param}: la clave se guarda`, guardada === valor, String(guardada));
    ok(`${param}: y sale de la barra`, !url.includes(valor), url);
    ok(`${param}: el resto de la dirección se queda`, /a=1/.test(url) && /feedtack_yo=Sol/.test(url) && url.endsWith('#seccion'), url);
    await pagina.close();
  }
  const limpia = await navegador.newPage();
  await limpia.goto(`${base}/p?a=1#x`);
  await limpia.waitForTimeout(500);
  ok('control: sin clave la dirección no se toca', limpia.url() === `${base}/p?a=1#x`, limpia.url());
} finally {
  await navegador.close();
  servidor.close();
}
console.log(fallos ? `\n❌ ${fallos} fallos` : '\n✅ todo bien');
process.exit(fallos ? 1 : 0);
