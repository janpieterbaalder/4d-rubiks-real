/* Faithfulness checks for engine.js. Run: node engine.test.js */
import { Tesseract, COLORS, PHYS, ORIENT, AXN } from './engine.js';
import assert from 'node:assert';

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ok  ' + name); pass++; };

const t = new Tesseract();

// 1. piece census matches the true 3^4 structure
ok('80 movable pieces', t.pieces.length === 80);
const byStickers = [0,0,0,0,0];
let stickerTotal = 0;
for (const p of t.pieces) { byStickers[p.stickers.length]++; stickerTotal += p.stickers.length; }
ok('8 one-colour pieces',   byStickers[1] === 8);
ok('24 two-colour pieces',  byStickers[2] === 24);
ok('32 three-colour pieces',byStickers[3] === 32);
ok('16 four-colour pieces', byStickers[4] === 16);
ok('216 stickers total',    stickerTotal === 216);

// 2. fresh build is solved; a single twist is not; twist^4 returns to solved
ok('fresh build is solved', t.isSolved());
t.twist(3, -1, 0, 1);                  // one 90-degree twist of the W- (inner) cell
ok('one twist breaks solve', !t.isSolved());
t.twist(3, -1, 0, 1); t.twist(3, -1, 0, 1); t.twist(3, -1, 0, 1);
ok('twist^4 = identity', t.isSolved());

// 3. deterministic scramble, then play history in reverse -> solved again
let seed = 12345;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
t.reset();
// record a real move sequence we can invert
const seq = [];
for (let s = 0; s < 200; s++) {
  const d = (rng()*4)|0, sd = rng() < 0.5 ? 1 : -1, pi = (rng()*3)|0, dir = rng() < 0.5 ? 1 : -1;
  t.twist(d, sd, pi, dir, false); seq.push([d, sd, pi, dir]);
}
ok('200-move sequence scrambles', !t.isSolved());
for (let s = seq.length - 1; s >= 0; s--) { const [d, sd, pi, dir] = seq[s]; t.twist(d, sd, pi, -dir, false); }
ok('reverse sequence re-solves', t.isSolved());

// 4. undo() inverts the last recorded move
t.reset();
t.twist(0, 1, 1, 1); t.twist(1, -1, 2, -1);
t.undo(); t.undo();
ok('undo unwinds history', t.isSolved() && t.history.length === 0);

// 5. physical LED readout: exactly 189 leds, 27 per visible cube
t.reset();
let leds = t.ledState();
const slots = Object.values(PHYS);
ok('7 visible cubes', slots.length === 7);
let total = 0, allFull = true;
for (const slot of slots) {
  const filled = leds[slot].filter(Boolean).length;
  if (filled !== 27) allFull = false;
  total += filled;
}
ok('27 leds per cube', allFull);
ok('189 leds total', total === 189);

// 6. solved state: every visible cube is a single colour (its cell colour)
let uniform = true;
const want = { C: COLORS['W-'], R: COLORS['X+'], L: COLORS['X-'],
               U: COLORS['Y+'], D: COLORS['Y-'], F: COLORS['Z+'], B: COLORS['Z-'] };
for (const slot of slots) {
  const cols = new Set(leds[slot].map(c => c && c.rgb));
  if (cols.size !== 1 || !cols.has(want[slot])) uniform = false;
}
ok('solved: each cube one matching colour', uniform);

// 7. centring (JP's idea): bring the X+ (Right) cell to the centre; pure view move
t.reset();
const before = JSON.stringify(t.pieces.map(p => p.cur));
t.centerCell(0, 1);                         // X+ -> centre
ok('centring does not touch puzzle state', JSON.stringify(t.pieces.map(p => p.cur)) === before);
leds = t.ledState();
const centreColours = new Set(leds.C.map(c => c && c.rgb));
ok('after centring, centre shows the X+ colour',
   centreColours.size === 1 && centreColours.has(COLORS['X+']));

// 8. grips (edge 180 / corner 120) about the inner cell (d=W, sd=-1), in-cell axes X,Y,Z
const PI = Math.PI;
t.reset();
t.grip(3, -1, [1, 1, 0], PI);
ok('edge flip 180 breaks solve', !t.isSolved());
t.grip(3, -1, [1, 1, 0], PI);
ok('edge flip 180 is its own inverse', t.isSolved());

t.reset();
t.grip(3, -1, [1, 1, 1], 2 * PI / 3);
ok('corner spin 120 breaks solve', !t.isSolved());
t.grip(3, -1, [1, 1, 1], 2 * PI / 3);
t.grip(3, -1, [1, 1, 1], 2 * PI / 3);
ok('corner spin 120 has order 3', t.isSolved());

t.reset();
t.grip(3, -1, [1, 1, 1], -2 * PI / 3);
t.undo();
ok('undo restores a grip', t.isSolved() && t.history.length === 0);

// a corner spin equals a composition of the 3 plane twists (it must stay in the group)
t.reset();
t.grip(3, -1, [1, 1, 1], 2 * PI / 3);
const after = t.pieces.map(p => p.cur.join(',')).join(';');
ok('corner spin keeps every piece on the lattice',
   t.pieces.every(p => p.cur.every(c => c >= -1 && c <= 1)) && after.length > 0);

// 9. placements(): the led->led permutation the animation rides on.
//    One placement per visible led (189), with a stable id that lets us diff a move.
t.reset();
ok('placements: 189 visible stickers', t.placements().length === 189);
ok('placements ids are unique', new Set(t.placements().map(p => p.id)).size === 189);

// a single 90-degree twist must move its leds in clean 4-cycles (this is what makes the
// rotation wave readable); build the source->dest map and check every cycle has length 4.
function moveCycles(fn) {
  const pre = {}; for (const x of t.placements()) pre[x.id] = x.slot + '#' + x.idx;
  fn();
  const edges = new Map(), incoming = new Set();
  for (const pl of t.placements()) {
    const from = pre[pl.id], to = pl.slot + '#' + pl.idx;
    if (from && from !== to) { edges.set(from, to); incoming.add(to); }
  }
  const lens = [], seen = new Set();
  for (const start of [...edges.keys()].filter(k => !incoming.has(k)).concat([...edges.keys()])) {
    if (seen.has(start)) continue;
    let k = start, n = 0;
    while (k !== undefined && !seen.has(k)) { seen.add(k); n++; k = edges.get(k); }
    lens.push(n);
  }
  return lens;
}
t.reset();
let cyc = moveCycles(() => t.twist(0, 1, 0, 1));   // Right cell, plane (Y,Z)
ok('a twist moves leds in pure 4-cycles', cyc.length > 0 && cyc.every(n => n === 4));

// 10. ORIENT matches the game's 4D->3D projection for every cube. This is what makes a turn
//     look the same on the rig as in the game (it was the real bug: the old layout hid the
//     inner layer on the camera-depth axis, so an inner-cell turn changed only hidden faces).
//     Replicate the game's projection (app.js constants, view4 = I) and compare directions.
{
  const V4D = 3.1, B = 1.65, SPREAD = 0.45;
  const proj3 = c4 => { const s = V4D / Math.max(V4D - c4[3], 0.34); return [c4[0]*s, c4[1]*s, c4[2]*s]; };
  const dirOf = (fa, fs, ax) => {                       // 3D direction of a +step along in-cell axis ax
    const c0 = [0,0,0,0]; c0[fa] = fs*B; const c1 = c0.slice(); c1[ax] += 0.001*(ax===3?1:SPREAD);
    const p0 = proj3(c0), p1 = proj3(c1), d = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
    let b = 0; for (let i=1;i<3;i++) if (Math.abs(d[i])>Math.abs(d[b])) b=i;
    return { axis: b, sign: d[b] > 0 ? 1 : -1 };
  };
  const cells = [['C',3,-1],['R',0,1],['L',0,-1],['U',1,1],['D',1,-1],['F',2,1],['B',2,-1]];
  let allMatch = true;
  for (const [slot, fa, fs] of cells) {
    const inAx = [0,1,2,3].filter(a => a !== fa);        // i,j,k axes
    for (let t = 0; t < 3; t++) {                         // unit step along in-cube axis t
      const v = [0,0,0]; v[t] = 1; const o = ORIENT[slot](v[0], v[1], v[2]); // physical offset
      let b = 0; for (let q=1;q<3;q++) if (Math.abs(o[q])>Math.abs(o[b])) b=q;
      const game = dirOf(fa, fs, inAx[t]);
      if (b !== game.axis || Math.sign(o[b]) !== game.sign) allMatch = false;
    }
  }
  ok('ORIENT matches the game projection for all 7 cubes', allMatch);
}

console.log(`\n${pass} checks passed.`);
