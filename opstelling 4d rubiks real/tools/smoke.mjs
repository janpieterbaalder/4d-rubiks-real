/* ============================================================================
   tools/smoke.mjs — headless browser smoke test for the 3D workbench (hardware.html).
   Starts a tiny static server, opens the page in headless Chromium (Playwright) and checks:
     • the scene starts without a single console error / page error,
     • the canvas really renders (not one flat colour),
     • keyboard play works: scramble, move, twist, undo (via the real key bindings),
     • clicking a part opens its info + wiring table, the led-chain view and the quality and
       power toggles run without errors,
     • phone (iPhone 15 Pro, portrait + landscape, touch): no sideways overflow on the three pages,
       the dock opens the menu / controller sheets, everything stays on screen and a twist can be
       played with taps alone.
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

let chromium, devices;
try { ({ chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); }
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
  await page.close();

  // ---- phone: iPhone 15 Pro (touch) ---------------------------------------------------
  // m = required margin to the screen edge (a flush fit breaks with other font metrics)
  const inView = (p, sel, m = -1) => p.evaluate(([s, m]) => [...document.querySelectorAll(s)].every(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.left >= m && r.top >= m && r.right <= innerWidth - m && r.bottom <= innerHeight - m;
  }), [sel, m]);
  const noOverflow = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const shown = (p, sel) => p.evaluate(s => getComputedStyle(document.querySelector(s)).display !== 'none', sel);
  for (const [name, dev] of [['portret', devices['iPhone 15 Pro']], ['landschap', devices['iPhone 15 Pro landscape']]]) {
    const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1 });
    const mp = await ctx.newPage();
    const merr = [];
    mp.on('console', m => { if (m.type() === 'error') merr.push(m.text()); });
    mp.on('pageerror', e => merr.push(e.message));
    await mp.addInitScript(() => { try { localStorage.setItem('bench.quality', 'laag'); } catch (e) { /* ignore */ } });
    await mp.goto(base + '/hardware.html?debug', { waitUntil: 'load' });
    await mp.waitForFunction(() => window.__bench && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
    const MB = fn => mp.evaluate(fn);
    const msettle = async () => {
      await MB(() => window.__bench.finishAnimations());
      await mp.waitForFunction(() => !window.__bench.colorAnim, null, { timeout: 60000 });
      await mp.waitForTimeout(150);
    };
    const tag = `iPhone ${name}:`;
    ok(`${tag} geen horizontale overloop (werkbank)`, await noOverflow(mp));
    ok(`${tag} dock zichtbaar, panelen + controller dicht`, await shown(mp, '#mdock') && await inView(mp, '#mdock button')
      && !(await shown(mp, '#left')) && !(await shown(mp, '#ps3')) && !(await shown(mp, '#right-controls')));
    ok(`${tag} topbalk past in beeld`, await inView(mp, '#top > :not(#power-state)'));
    await mp.tap('#md-menu');
    ok(`${tag} Menu opent het onderdelenpaneel binnen beeld`, await shown(mp, '#left') && await inView(mp, '#left'));
    await mp.tap('#menu button:has-text("Levelshifter")'); await msettle();
    ok(`${tag} onderdeel kiezen sluit het menu en toont info binnen beeld`,
      !(await shown(mp, '#left')) && !(await mp.getAttribute('#info', 'class')).includes('hidden') && await inView(mp, '#info'));
    await mp.tap('#info-close');
    await mp.tap('#md-pad');
    ok(`${tag} Besturing toont de controller volledig binnen beeld`, await shown(mp, '#ps3') && await inView(mp, '#ps3 button'));
    await mp.tap('#ps3 [data-mv="E"]'); await msettle();
    const mBefore = await MB(() => JSON.stringify(window.__bench.puzzle.pieces.map(p => p.cur)));
    await mp.tap('#ps3 [data-dir="1"]'); await mp.tap('#ps3 [data-plane="0"]'); await msettle();
    ok(`${tag} draaien met alleen tikken (▶ + Z)`, await MB(() => JSON.stringify(window.__bench.puzzle.pieces.map(p => p.cur))) !== mBefore);
    await mp.tap('#ps3 [data-act="undo"]'); await msettle();
    ok(`${tag} undo via tik`, await MB(() => JSON.stringify(window.__bench.puzzle.pieces.map(p => p.cur))) === mBefore);
    await mp.tap('#md-power');
    ok(`${tag} Aan/uit in het dock`, (await mp.textContent('#power-state b')) === 'UIT');
    await mp.tap('#md-power');
    await mp.tap('#about-tab');
    ok(`${tag} Over-paneel binnen beeld`, await inView(mp, '#about'));
    await mp.tap('#about-close');

    await mp.goto(base + '/bedrading.html', { waitUntil: 'load' });
    await mp.waitForFunction(() => !document.getElementById('status'), null, { timeout: 30000 }).catch(() => {});
    ok(`${tag} bedrading.html zonder horizontale overloop`, await noOverflow(mp));
    await mp.goto(base + '/game/index.html', { waitUntil: 'load' });
    await mp.waitForTimeout(1500);
    ok(`${tag} game: topbalk en knoppen binnen beeld (≥8px marge)`, await noOverflow(mp)
      && await inView(mp, '.hud-top .brand, .hud-top .top-right > *, .hud-actions', 8));
    if (name === 'portret') {   // also the narrowest common phones (iPhone SE/mini 375, Android 360)
      for (const w of [375, 360]) {
        await mp.setViewportSize({ width: w, height: 659 }); await mp.waitForTimeout(300);
        ok(`${tag} game-topbalk past ook op ${w}px`, await noOverflow(mp)
          && await inView(mp, '.hud-top .brand, .hud-top .top-right > *', 8));
      }
    }
    ok(`${tag} geen console- of paginafouten`, merr.length === 0, merr.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) {
  failed = true; console.log('FAIL  ' + e.message);
} finally {
  await browser.close(); server.close();
}
console.log(failed ? '\nsmoke test FAILED.' : `\n${pass} smoke checks passed.`);
process.exit(failed ? 1 : 0);
