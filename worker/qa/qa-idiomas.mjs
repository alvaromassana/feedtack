#!/usr/bin/env node
/**
 * qa-idiomas.mjs — do both email languages say the same things?
 *
 *   node qa/qa-idiomas.mjs        (from projects/feedtack/worker)
 *
 * 🔒 Why it exists: the notification email got a language table (IDIOMAS in src/index.js)
 * and the only test that covers the email, qa-tandas.mjs, asserts on the SPANISH strings.
 * So the English branch would ship with nothing exercising it, and its failure mode is
 * mute: a missing key does not throw, it renders the word "undefined" into an email that
 * still goes out and still looks fine to the code.
 *
 * What it checks, per language:
 *   1. the same set of keys as the reference language (no key missing, none left over)
 *   2. every key has the same TYPE (a string stays a string, a function stays a function)
 *   3. every function actually returns a non-empty string when called
 *   4. no leftover placeholder: no value renders as "undefined" or empty
 *   5. the nested maps (banda, mote, tarjeta, cuenta) cover the same event types
 *
 * It reads src/index.js as text and evaluates only the IDIOMAS literal, so it needs
 * neither wrangler nor a network nor a Cloudflare account.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuente = readFileSync(join(RAIZ, 'src/index.js'), 'utf8');

const desde = fuente.indexOf('const IDIOMAS = {');
if (desde === -1) {
  console.error('no encuentro IDIOMAS en src/index.js: o se ha renombrado o se ha ido');
  process.exit(2);                       // 2 = NO SE HA PODIDO MIRAR, nunca "está bien"
}
// Hasta el cierre del literal: la línea `};` a principio de línea que sigue.
const hasta = fuente.indexOf('\n};', desde);
if (hasta === -1) { console.error('no encuentro el final del literal IDIOMAS'); process.exit(2); }
const literal = fuente.slice(desde + 'const IDIOMAS = '.length, hasta + 2);

let IDIOMAS;
try { IDIOMAS = (0, eval)('(' + literal.replace(/;\s*$/, '') + ')'); }
catch (e) { console.error('el literal IDIOMAS no evalúa:', e.message); process.exit(2); }

const idiomas = Object.keys(IDIOMAS);
if (idiomas.length < 2) { console.error(`solo hay ${idiomas.length} idioma, no hay nada que comparar`); process.exit(2); }

const REF = idiomas[0];
const EVENTOS = ['nuevo', 'editado', 'reabierto', 'eliminado', 'respuesta'];
let fallos = 0;
const mal = (m) => { console.log(`  ❌ ${m}`); fallos++; };
const bien = (m) => console.log(`  ✅ ${m}`);

console.log(`QA de los idiomas del correo (referencia: ${REF}; ${idiomas.length} idiomas)\n`);

for (const lang of idiomas.slice(1)) {
  console.log(`${REF} vs ${lang}`);
  const a = IDIOMAS[REF], b = IDIOMAS[lang];

  const faltan = Object.keys(a).filter(k => !(k in b));
  const sobran = Object.keys(b).filter(k => !(k in a));
  faltan.length ? mal(`a ${lang} le faltan claves: ${faltan.join(', ')}`) : bien('mismas claves');
  if (sobran.length) mal(`${lang} tiene claves que ${REF} no tiene: ${sobran.join(', ')}`);

  const tipos = Object.keys(a).filter(k => k in b && typeof a[k] !== typeof b[k]);
  tipos.length ? mal(`cambian de tipo: ${tipos.join(', ')}`) : bien('mismos tipos');

  for (const mapa of ['banda', 'mote', 'tarjeta', 'cuenta']) {
    if (!a[mapa]) continue;
    const ka = Object.keys(a[mapa]), kb = Object.keys(b[mapa] || {});
    const dif = ka.filter(k => !kb.includes(k)).concat(kb.filter(k => !ka.includes(k)));
    dif.length ? mal(`${mapa}: no cubren los mismos eventos (${dif.join(', ')})`)
               : bien(`${mapa} cubre los mismos eventos`);
  }
}

console.log('\ncada valor produce texto de verdad');
for (const lang of idiomas) {
  const t = IDIOMAS[lang];
  for (const [k, v] of Object.entries(t)) {
    const valores = typeof v === 'object' && v !== null ? Object.entries(v) : [[k, v]];
    for (const [sub, val] of valores) {
      let salida;
      try {
        salida = typeof val === 'function' ? String(val(2, 'a', 'b')) : String(val);
      } catch (e) { mal(`${lang}.${k}.${sub} lanza: ${e.message}`); continue; }
      if (k === 'mote' && sub === 'nuevo') continue;        // vacío a propósito
      if (!salida || salida === 'undefined' || salida.includes('undefined')) {
        mal(`${lang}.${k}${sub !== k ? '.' + sub : ''} da "${salida}"`);
      }
    }
  }
}
if (!fallos) bien('ningún valor sale vacío ni con "undefined"');

// El correo tiene que poder decir en qué idioma está: sin esto un lector de pantalla
// y un cliente de correo leen el HTML como si fuera del idioma anterior.
for (const lang of idiomas) {
  if (!IDIOMAS[lang].html) mal(`${lang} no declara su atributo html lang`);
  if (!IDIOMAS[lang].locale) mal(`${lang} no declara locale para las fechas`);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : '\n✅ 0 fallos');
process.exit(fallos ? 1 : 0);
