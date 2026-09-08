/**
 * Prueba de la capa de compatibilidad del renombrado Tack Comment → Feedtack.
 * Lo que tiene que salir bien:
 *   1. el widget arranca y su host se llama ahora feedtack-host
 *   2. un navegador que YA tenía identidad guardada como tack_autor_id la conserva
 *      (si se perdiera, quien ya estaba comentando pierde la autoría de lo suyo)
 *   3. un enlace personal viejo (?tack_yo=) sigue firmando
 *   4. un enlace nuevo (?feedtack_yo=) tiene prioridad
 *   5. window.Tack sigue respondiendo como alias
 * Control negativo incluido: un navegador limpio NO debe heredar identidad de nadie.
 */
import pkg from '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const BASE = process.env.FEEDTACK_DEMO || 'http://127.0.0.1:8791/';
const fallos = [];
const ok = (n, c, d = '') => { console.log(`  ${c ? 'ok  ' : 'MAL '} ${n}${c ? '' : '   ' + d}`); if (!c) fallos.push(n); };

const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });

async function abrir(query = '', sembrar = null) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  if (sembrar) await p.addInitScript(s => { for (const k in s) localStorage.setItem(k, s[k]); }, sembrar);
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  return { ctx, p };
}

// 1 y 2: identidad vieja conservada
{
  const { ctx, p } = await abrir('', { tack_autor_id: 'a-viejo123', tack_autor: 'Dominga' });
  ok('el host del widget se llama feedtack-host', await p.evaluate(() => !!document.getElementById('feedtack-host')));
  const est = await p.evaluate(() => window.Feedtack && window.Feedtack.estado());
  ok('conserva el id de autor guardado con el nombre viejo', est && est.autorId === 'a-viejo123', 'dio: ' + (est && est.autorId));
  const migrado = await p.evaluate(() => localStorage.getItem('feedtack_autor_id'));
  ok('lo migra a la clave nueva', migrado === 'a-viejo123', 'dio: ' + migrado);
  const autor = await p.evaluate(() => localStorage.getItem('feedtack_autor'));
  ok('migra tambien el nombre', autor === 'Dominga', 'dio: ' + autor);
  ok('window.Tack sigue respondiendo (alias)', await p.evaluate(() => !!(window.Tack && window.Tack.estado)));
  await ctx.close();
}

// 3: enlace personal viejo
{
  const { ctx, p } = await abrir('?tack_yo=Sol%20Delgado');
  const autor = await p.evaluate(() => localStorage.getItem('feedtack_autor'));
  ok('el enlace personal viejo ?tack_yo= sigue firmando', autor === 'Sol Delgado', 'dio: ' + autor);
  await ctx.close();
}

// 4: enlace nuevo
{
  const { ctx, p } = await abrir('?feedtack_yo=Nueva');
  const autor = await p.evaluate(() => localStorage.getItem('feedtack_autor'));
  ok('el enlace nuevo ?feedtack_yo= funciona', autor === 'Nueva', 'dio: ' + autor);
  await ctx.close();
}

// 5: CONTROL NEGATIVO. Un navegador limpio no puede heredar identidad de nadie:
// si esto sale igual que el caso 2, la prueba no estaba midiendo nada.
{
  const { ctx, p } = await abrir('');
  const est = await p.evaluate(() => window.Feedtack && window.Feedtack.estado());
  ok('control: un navegador limpio NO hereda el id viejo', est && est.autorId && est.autorId !== 'a-viejo123', 'dio: ' + (est && est.autorId));
  await ctx.close();
}

await b.close();
console.log(fallos.length ? '\nFALLOS: ' + fallos.join(' · ') : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
