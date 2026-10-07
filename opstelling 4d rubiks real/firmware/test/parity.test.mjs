/* ============================================================================
   parity.test.mjs — proves the FIRMWARE engine (tesseract_engine.h) is a 1:1 port of
   engine.js. Compiles the C++ engine natively (g++/clang++ + a tiny Arduino shim), feeds
   both engines the same random operation stream (twists, grips, centring, view reset,
   undo, reset) and compares, after EVERY operation, the full 189-led readout:
   colour key + stable sticker id per strip position, isSolved(), undo depth and the
   view->logical cell mapping.

   Run (from "opstelling 4d rubiks real"):  node firmware/test/parity.test.mjs
   Without a C++ compiler the test is skipped (exit 0) unless PARITY_REQUIRE_CXX=1 (CI).
   ========================================================================== */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tesseract, AXN } from '../../engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const HIST = 16;                 // compile the host engine with the Mega-sized ring buffer
const OPS = 4000;
const SLOT_ORDER = ['C', 'R', 'L', 'U', 'D', 'F', 'B'];   // = strip order in the firmware

// ---- 1. compile ---------------------------------------------------------------------
const cxx = [process.env.CXX, 'g++', 'clang++'].filter(Boolean)
  .find(c => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
if (!cxx) {
  const msg = 'parity test: geen C++-compiler gevonden (g++/clang++)';
  if (process.env.PARITY_REQUIRE_CXX === '1') { console.error('FAIL  ' + msg); process.exit(1); }
  console.log('SKIP  ' + msg); process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), 'tesseract-parity-'));
const bin = join(work, 'engine_host');
const cc = spawnSync(cxx, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Wno-unused-function',
  `-DHIST_MAX=${HIST}`, '-I', join(here, 'shim'), '-I', join(here, '..'),
  join(here, 'engine_host.cpp'), '-o', bin], { encoding: 'utf8' });
if (cc.status !== 0) { console.error(cc.stdout + cc.stderr); console.error('FAIL  compile'); process.exit(1); }
if (cc.stderr.trim()) console.log(cc.stderr.trim());

// ---- 2. a reproducible operation stream ---------------------------------------------
let seed = 20261007;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = n => Math.floor(rnd() * n);
const sgn = () => (rnd() < 0.5 ? 1 : -1);
const ops = [];
let depth = 0;                    // undo depth the firmware can still honour (ring buffer)
const push = op => {
  ops.push(op);
  if (op[0] === 'T' || op[0] === 'G') depth = Math.min(HIST, depth + 1);
  else if (op[0] === 'U') depth = Math.max(0, depth - 1);
  else if (op[0] === 'R') depth = 0;
};
// a deliberate long run first: 24 twists then 16 undos (exercises the ring buffer wrap)
for (let i = 0; i < 24; i++) push(['T', ri(4), sgn(), ri(3), sgn()]);
for (let i = 0; i < 16; i++) push(['U']);
for (let n = 0; n < OPS; n++) {
  const r = rnd();
  if (r < 0.55) push(['T', ri(4), sgn(), ri(3), sgn()]);
  else if (r < 0.72) {
    const corner = rnd() < 0.5;
    let u;
    do { u = [ri(3) - 1, ri(3) - 1, ri(3) - 1]; }
    while (u.filter(v => v !== 0).length !== (corner ? 3 : 2));
    push(['G', ri(4), sgn(), ...u, corner ? (rnd() < 0.5 ? 1 : 2) : 0]);
  } else if (r < 0.82) push(['C', ri(4), sgn()]);
  else if (r < 0.85) push(['V']);
  else if (r < 0.995) { if (depth > 0) push(['U']); }
  else push(['R']);
}

// ---- 3. run the firmware engine -----------------------------------------------------
const run = spawnSync(bin, [], { input: ops.map(o => o.join(' ')).join('\n') + '\n',
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
rmSync(work, { recursive: true, force: true });
if (run.status !== 0) { console.error(run.stderr); console.error('FAIL  engine_host exited ' + run.status); process.exit(1); }
const lines = run.stdout.trim().split('\n');
if (lines.length !== ops.length) { console.error(`FAIL  ${lines.length} output lines for ${ops.length} ops`); process.exit(1); }

// ---- 4. replay in engine.js and compare --------------------------------------------
const t = new Tesseract();
const pieceIdx = new Map(t.pieces.map((p, i) => [p.solved.join(','), i]));
const THETA = [Math.PI, 2 * Math.PI / 3, -2 * Math.PI / 3];
function jsLine() {
  const keys = new Array(189).fill(8), ids = new Array(189).fill(-1);
  for (const pl of t.placements()) {
    const pos = SLOT_ORDER.indexOf(pl.slot) * 27 + pl.idx;
    const [solvedStr, axis] = pl.id.split(':');
    keys[pos] = AXN.indexOf(pl.key[0]) * 2 + (pl.key[1] === '+' ? 0 : 1);
    ids[pos] = pieceIdx.get(solvedStr) * 4 + Number(axis);
  }
  const view = [];
  for (let va = 0; va < 4; va++) for (const vs of ['+', '-']) {
    const lg = t.viewToLogical(AXN[va] + vs); view.push(lg.d, lg.sd);
  }
  return { solved: t.isSolved() ? 1 : 0, keys, ids, view };
}
let jsDepth = 0, checked = 0;
for (let n = 0; n < ops.length; n++) {
  const [op, ...a] = ops[n];
  if (op === 'T') { t.twist(a[0], a[1], a[2], a[3]); jsDepth = Math.min(HIST, jsDepth + 1); }
  else if (op === 'G') { t.grip(a[0], a[1], [a[2], a[3], a[4]], THETA[a[5]]); jsDepth = Math.min(HIST, jsDepth + 1); }
  else if (op === 'C') t.centerCell(a[0], a[1]);
  else if (op === 'V') t.resetView();
  else if (op === 'U') { t.undo(); jsDepth = Math.max(0, jsDepth - 1); }
  else if (op === 'R') { t.reset(); jsDepth = 0; }

  const [head, idPart, viewPart] = lines[n].split('|');
  const h = head.trim().split(/\s+/).map(Number);
  const c = { solved: h[0], hist: h[1], keys: h.slice(2), ids: idPart.trim().split(/\s+/).map(Number),
    view: viewPart.trim().split(/\s+/).map(Number) };
  const j = jsLine();
  const bad = c.solved !== j.solved ? 'isSolved'
    : c.hist !== jsDepth ? `undo-diepte (C++ ${c.hist}, verwacht ${jsDepth})`
    : c.keys.some((k, i) => k !== j.keys[i]) ? 'led-kleuren'
    : c.ids.some((k, i) => k !== j.ids[i]) ? 'sticker-ids'
    : c.view.some((k, i) => k !== j.view[i]) ? 'viewToLogical' : null;
  if (bad) {
    console.error(`FAIL  verschil in ${bad} na operatie #${n}: ${ops[n].join(' ')}`);
    process.exit(1);
  }
  checked++;
}
console.log(`  ok  ${checked} operaties: C++-engine == engine.js (189 leds, ids, isSolved, undo, 4D-zicht)`);
console.log('\nparity test passed.');
