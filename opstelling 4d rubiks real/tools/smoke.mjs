/* ============================================================================
   tools/smoke.mjs — headless browser smoke test for the 3D workbench (hardware.html).
   Starts a tiny static server, opens the page in headless Chromium (Playwright) and checks:
     • the scene starts without a single console error / page error,
     • the canvas really renders (not one flat colour),
     • keyboard play works: scramble, move, twist, undo (via the real key bindings),
     • clicking a part opens its info + wiring table, the led-chain view and the quality and
       power toggles run without errors.
   Run (from "opstelling 4d rubiks real"):  node tools/smoke.mjs   [--shot out.png]
   Needs Playwright (`npm i playwright` + `npx playwright install chromium`) and internet
   access for three.js from the CDN. PLAYWRIGHT_MODULE may point to a playwright index.mjs.
   ========================================================================== */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotIdx = process.argv.indexOf('--shot');
const SHOT = shotIdx > 0 ? process.argv[shotIdx + 1] : null;

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); }
catch (e) { console.error('FAIL  Playwright niet gevonden (npm i playwright) — ' + e.message); process.exit(1); }

// ---- static server (no caching, like serve.py) ---------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.md': 'text/markdown',
  '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(ROOT, url === '/' ? 'hardware.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, failed = false;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { failed = true; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('bench.quality', 'laag'); } catch (e) { /* ignore */ } });
  await page.goto(base + '/hardware.html?debug', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bench && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  ok('3D-werkbank start (eerste frame gerenderd)', true);

  const B = (fn, arg) => page.evaluate(fn, arg);
  // finish the running turn / camera flight, then wait for the frame that completes it (input is
  // ignored while a turn animates — exactly like the firmware — so never press on too early)
  const settle = async () => {
    await B(() => window.__bench.finishAnimations());
    await page.waitForFunction(() => !window.__bench.colorAnim, null, { timeout: 60000 });
    await page.waitForTimeout(150);
  };
  ok('alle 20 verbindingen getekend', await B(() => window.__bench.wires.length) === 20);
  ok('power-injectie op strip #54/#108/#162 (L/D/B)', await B(() => ['INJ_L', 'INJ_D', 'INJ_B'].every(k => window.__bench.TERM.rig[k])));

  // the canvas must show a real picture, not a flat clear colour
  const png = await page.locator('#scene').screenshot();
  ok('canvas rendert beeld (niet één egale kleur)', new Set(png.subarray(200, 20000)).size > 40);

  // keyboard play
  await page.keyboard.press('Shift+S'); await settle();
  ok('Shift+S husselt (niet meer opgelost)', await B(() => !window.__bench.puzzle.isSolved()));
  const sel0 = await B(() => JSON.stringify(window.__bench.sel));
  await page.keyboard.press('d'); await settle();
  ok('D verplaatst de selectie', await B(() => JSON.stringify(window.__bench.sel)) !== sel0);
  const before = await B(() => JSON.stringify(window.__bench.puzzle.pieces.map(p => p.cur)));
  await page.keyboard.down('ArrowRight'); await page.keyboard.press('z'); await page.keyboard.up('ArrowRight'); await settle();
  const after = await B(() => JSON.stringify(window.__bench.puzzle.pieces.map(p => p.cur)));
  ok('→ + Z draait een vlak', after !== before);
  ok('zettenteller loopt op', await B(() => window.__bench.moves) === 1 && (await page.textContent('#moves-val')) === '1');
  await page.keyboard.press('Backspace'); await settle();
  ok('Backspace = undo (vorige toestand terug)', await B(() => JSON.stringify(window.__bench.puzzle.pieces.map(p => p.cur))) === before);
  await page.keyboard.press('Shift+R'); await settle();
  ok('Shift+R reset naar opgelost', await B(() => window.__bench.puzzle.isSolved()));

  // a part from the menu: info panel + wiring table
  await page.click('#acc-parts .acc-b button:has-text("Levelshifter")'); await settle();
  ok('onderdeel kiezen opent het infopaneel', !(await page.getAttribute('#info', 'class')).includes('hidden'));
  ok('infopaneel toont de aansluitingen', (await page.textContent('#info-body')).includes('Aansluiting'));
  await page.click('#info-close');

  // view toggles + quality + power
  await page.click('#acc-view .acc-h');
  await page.click('#tg-chain'); await page.waitForTimeout(300);
  ok('led-draad-weergave aan', await B(() => window.__bench.chainOn));
  await page.click('#tg-chain');
  await page.click('#btn-quality'); await page.waitForTimeout(600);
  await page.click('#btn-quality'); await page.waitForTimeout(300);
  await page.click('#btn-power'); await page.waitForTimeout(300);
  ok('aan/uit zet de status op UIT', (await page.textContent('#power-state b')) === 'UIT');
  await page.click('#btn-power');
  if (SHOT) await page.screenshot({ path: SHOT });
  await page.waitForTimeout(500);
  ok('geen console- of paginafouten', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed = true; console.log('FAIL  ' + e.message);
} finally {
  await browser.close(); server.close();
}
console.log(failed ? '\nsmoke test FAILED.' : `\n${pass} smoke checks passed.`);
process.exit(failed ? 1 : 0);
