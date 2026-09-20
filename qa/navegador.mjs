/**
 * Where Chromium comes from, for every script in qa/.
 *
 * 🔴 Why this file exists: each of these scripts used to import Playwright through an
 * absolute path on the author's machine
 * (`/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js`) and launch a
 * Chromium from `~/.cache/ms-playwright/chromium-1228/`. On anybody else's computer that
 * is an immediate crash, so nobody outside could run a single browser test, and CI cannot
 * run them either.
 *
 * Resolution order, first one that works wins:
 *   1. FEEDTACK_PLAYWRIGHT — a path to playwright-core, if you keep it somewhere odd
 *   2. `playwright-core` or `playwright` resolved normally (npm i -D playwright-core)
 *   3. the author's path, so this machine keeps working without extra setup
 *
 * And for the browser binary:
 *   1. FEEDTACK_CHROME or CHROME_PATH
 *   2. nothing, which means Playwright launches the browser it downloaded itself
 *   3. the author's path, if it happens to exist
 *
 * If none of them resolve it exits 2 ("could not look"), never 0, and says what to do.
 */

import { existsSync } from 'node:fs';

const AUTOR_PW = '/home/alvaro/tools/qa-visual/node_modules/playwright-core/index.js';
const AUTOR_CHROME = '/home/alvaro/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

async function cargar() {
  const intentos = [
    process.env.FEEDTACK_PLAYWRIGHT,
    'playwright-core',
    'playwright',
    existsSync(AUTOR_PW) ? AUTOR_PW : null
  ].filter(Boolean);

  for (const donde of intentos) {
    try {
      const m = await import(donde.startsWith('/') ? `file://${donde}` : donde);
      const chromium = (m.default && m.default.chromium) || m.chromium;
      if (chromium) return chromium;
    } catch { /* el siguiente */ }
  }

  console.error(
    'No encuentro Playwright. Instálalo en el repo con:\n' +
    '  npm install --no-save playwright-core && npx playwright-core install chromium\n' +
    'o apunta FEEDTACK_PLAYWRIGHT a tu copia de playwright-core/index.js.'
  );
  process.exit(2);
}

export const chromium = await cargar();

/** undefined = que Playwright use el navegador que se bajó él. */
export const CHROME =
  process.env.FEEDTACK_CHROME ||
  process.env.CHROME_PATH ||
  (existsSync(AUTOR_CHROME) ? AUTOR_CHROME : undefined);

/** Lo que se le pasa a chromium.launch(): sin executablePath si no hay ninguno fijado. */
export const opcionesLanzar = (extra = {}) => ({
  ...(CHROME ? { executablePath: CHROME } : {}),
  ...extra
});
