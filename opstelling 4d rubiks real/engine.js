/* ============================================================================
   engine.js — verified 4D (3^4) tesseract core, ported for the physical rig.
   ----------------------------------------------------------------------------
   This is a clean, standalone port of the proven puzzle engine from
   ../code 4d rubiks spel/app.js (whose mathematics is verified in its
   test/math.test.js). It is the "single source of truth" for the physical
   installation: the same logic drives the 3D simulator now and will be
   transpiled to Arduino C++ later.

   What it adds over the game engine: ledState(), which turns the puzzle state
   into the physical layout — 7 visible cubes (centre + 6 arms) of 3x3x3 = 189
   RGB leds — by reading which sticker currently faces each cube, in VIEW space
   (so the 4D "centring" view rotation just remaps which cube is which).

   Pure ES module: import in Node for tests, or in the browser via
   <script type="module">. No dependencies.
   ========================================================================== */

export const X = 0, Y = 1, Z = 2, W = 3;
export const AXN = ['X', 'Y', 'Z', 'W'];

// 8 colour-blind-friendly cell colours (Okabe-Ito derived) — identical to the game.
export const COLORS = {
  'X+': '#ff9e2c', // vivid orange
  'X-': '#5fc8ff', // bright sky blue
  'Y+': '#00c596', // bright teal-green
  'Y-': '#c77bff', // bright violet
  'Z+': '#ffe03d', // bright yellow
  'Z-': '#4f7dff', // royal blue
  'W+': '#ff5340', // vermillion red
  'W-': '#ffffff', // white — the nested centre cube
};
export const CELL_LABEL = {
  'W+': 'Outer', 'W-': 'Inner',
  'X+': 'Right', 'X-': 'Left',
  'Y+': 'Top',   'Y-': 'Bottom',
  'Z+': 'Front', 'Z-': 'Back',
};

// The 7 physical cubes, keyed by the VIEW-space direction they sit at. The centre
// cube is view -W (the small nested cube). View +W is the hidden 8th cell.
export const PHYS = {
  'W-': 'C',  // centre
  'X+': 'R', 'X-': 'L',
  'Y+': 'U', 'Y-': 'D',
  'Z+': 'F', 'Z-': 'B',
};
export const HIDDEN_VIEW = 'W+';

// How each physical cube is ORIENTED, so the rig is a faithful (non-tapered) copy of the
// game's 4D->3D projection — a turn looks the same here as in the game, and the Arduino must
// wire its leds this way. Given an led's in-cube coords (i,j,k) on the cell's 3 in-cube axes
// (ascending order = inAx), ORIENT returns its physical offset [x,y,z] (in lattice steps).
// Derivation (view4 = I): a spatial in-cell axis X/Y/Z keeps its own world direction; the
// in-cell W axis (the inner<->outer axis — always the `k` index for the 6 arm cells) projects
// RADIALLY = fs * e_(cell normal), so the w=-1 (inner) layer faces the centre and is VISIBLE.
// (Mapping the W axis to the camera-depth axis instead hid every inner-cell turn on the back.)
// Verified against the game's project() in engine.test.js.
export const ORIENT = {
  C: (i, j, k) => [ i,  j,  k],   // inner cell W- : X->x, Y->y, Z->z
  R: (i, j, k) => [ k,  i,  j],   // +x arm X+ : Y->y, Z->z, W->+x (inner layer faces centre)
  L: (i, j, k) => [-k,  i,  j],   // -x arm X- : Y->y, Z->z, W->-x
  U: (i, j, k) => [ i,  k,  j],   // +y arm Y+ : X->x, Z->z, W->+y
  D: (i, j, k) => [ i, -k,  j],   // -y arm Y- : X->x, Z->z, W->-y
  F: (i, j, k) => [ i,  j,  k],   // +z arm Z+ : X->x, Y->y, W->+z
  B: (i, j, k) => [ i,  j, -k],   // -z arm Z- : X->x, Y->y, W->-z
};

// ----------------------------------------------------------------- math (4x4)
const I4 = () => [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];

function matMul4(A, B) {
  const R = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[i][k] * B[k][j];
      R[i][j] = s;
    }
  return R;
}
function matVec4(M, v) {
  return [
    M[0][0]*v[0] + M[0][1]*v[1] + M[0][2]*v[2] + M[0][3]*v[3],
    M[1][0]*v[0] + M[1][1]*v[1] + M[1][2]*v[2] + M[1][3]*v[3],
    M[2][0]*v[0] + M[2][1]*v[1] + M[2][2]*v[2] + M[2][3]*v[3],
    M[3][0]*v[0] + M[3][1]*v[1] + M[3][2]*v[2] + M[3][3]*v[3],
  ];
}
const matVec4i = (M, v) => matVec4(M, v).map(Math.round);

// integer 90-degree rotation in plane (i,j); dir=+1 sends e_i -> e_j
function rotInt(i, j, dir) {
  const M = I4();
  M[i][i] = 0; M[j][j] = 0;
  M[i][j] = -dir; M[j][i] = dir;
  return M;
}

// integer rotation by angle `a` about axis u (in the 3 in-cell axes `inAx`); identity
// on the cell's normal axis. Grip angles (180 about an edge, +-120 about a body diagonal)
// land on signed-permutation matrices, so rounding gives the exact discrete move.
function rotAxisInt(inAx, u, a) {
  const n = Math.hypot(u[0], u[1], u[2]);
  const x = u[0] / n, y = u[1] / n, z = u[2] / n;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const R3 = [
    [c + x*x*t,   x*y*t - z*s, x*z*t + y*s],
    [y*x*t + z*s, c + y*y*t,   y*z*t - x*s],
    [z*x*t - y*s, z*y*t + x*s, c + z*z*t],
  ];
  const M = I4();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[inAx[i]][inAx[j]] = Math.round(R3[i][j]);
  return M;
}

// signed unit direction of a 4-vector that is known to lie on one axis
function axisOf(v) {
  for (let i = 0; i < 4; i++) if (v[i] !== 0) return { a: i, s: v[i] > 0 ? 1 : -1 };
  return { a: 0, s: 1 };
}
const keyOf = (a, s) => AXN[a] + (s > 0 ? '+' : '-');

// ----------------------------------------------------------------- the puzzle
export class Tesseract {
  constructor() {
    this.pieces = [];
    this.view4 = I4();        // 4D view orientation (centring); identity hides +W
    this.history = [];
    this.build();
  }

  build() {
    this.pieces.length = 0;
    for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
    for (let z = -1; z <= 1; z++)
    for (let w = -1; w <= 1; w++) {
      if (x === 0 && y === 0 && z === 0 && w === 0) continue; // hidden core
      const solved = [x, y, z, w];
      const stickers = [];
      for (let a = 0; a < 4; a++) {
        if (solved[a] !== 0) {
          const key = AXN[a] + (solved[a] > 0 ? '+' : '-');
          stickers.push({ axis: a, key, rgb: COLORS[key] });
        }
      }
      this.pieces.push({ solved, cur: solved.slice(), rot: I4(), stickers });
    }
  }

  reset() {
    for (const p of this.pieces) { p.cur = p.solved.slice(); p.rot = I4(); }
    this.history.length = 0;
  }

  // current facing axis/sign of a sticker given the piece orientation
  facingOf(piece, sticker) {
    const a = sticker.axis;
    const sign = piece.solved[a];
    const v = [0,0,0,0]; v[a] = sign;
    const r = matVec4i(piece.rot, v);
    const { a: fa, s: fs } = axisOf(r);
    return { fa, fs };
  }

  // the three twist planes available for a cell on axis d
  planesFor(d) {
    const p = [0,1,2,3].filter(a => a !== d);
    return [[p[0],p[1]], [p[1],p[2]], [p[0],p[2]]];
  }

  // rotate the 27-piece slab cur[d]===sd by integer matrix R
  applyToSlab(d, sd, R) {
    for (const p of this.pieces) {
      if (p.cur[d] === sd) {
        p.cur = matVec4i(R, p.cur);
        p.rot = matMul4(R, p.rot);
      }
    }
  }

  // a 90-degree plane twist of cell (d,sd): planeIdx in 0..2, dir +/-1
  twist(d, sd, planeIdx, dir, record = true) {
    const [i, j] = this.planesFor(d)[planeIdx];
    this.applyToSlab(d, sd, rotInt(i, j, dir));
    if (record) this.history.push({ d, sd, planeIdx, dir });
  }

  // a grip: rotate the cell's 27-piece slab about an in-cell axis u (a 3-vector over
  // the cell's in-cell axes). Edge flip = 180 about an edge dir; corner spin = +-120
  // about a body diagonal. Exactly the game's commitTwistAxis.
  grip(d, sd, u, theta, record = true) {
    const inAx = [0, 1, 2, 3].filter(a => a !== d);
    this.applyToSlab(d, sd, rotAxisInt(inAx, u, theta));
    if (record) this.history.push({ grip: true, d, sd, u: u.slice(), theta });
  }

  undo() {
    const m = this.history.pop();
    if (!m) return false;
    if (m.grip) {
      const inAx = [0, 1, 2, 3].filter(a => a !== m.d);
      const theta = Math.abs(Math.abs(m.theta) - Math.PI) < 1e-6 ? m.theta : -m.theta;
      this.applyToSlab(m.d, m.sd, rotAxisInt(inAx, m.u, theta));
    } else {
      const [i, j] = this.planesFor(m.d)[m.planeIdx];
      this.applyToSlab(m.d, m.sd, rotInt(i, j, -m.dir));
    }
    return true;
  }

  // visual solve (MagicCube4D criterion): every sticker on its home-coloured cell
  isSolved() {
    for (const p of this.pieces) {
      for (const st of p.stickers) {
        const { fa, fs } = this.facingOf(p, st);
        if (fa !== st.axis || fs !== (p.solved[st.axis] > 0 ? 1 : -1)) return false;
      }
    }
    return true;
  }

  // always-solvable scramble: only legal generators, no immediate cell repeat
  scramble(n = 26, rng = Math.random) {
    this.reset();
    let last = -1;
    for (let s = 0; s < n; s++) {
      let d, sd;
      do { d = (rng()*4)|0; sd = rng() < 0.5 ? 1 : -1; }
      while (d * 2 + (sd > 0 ? 0 : 1) === last);
      last = d * 2 + (sd > 0 ? 0 : 1);
      this.twist(d, sd, (rng()*3)|0, rng() < 0.5 ? 1 : -1, false);
    }
    this.history.length = 0;
  }

  // -------- centring (JP's 4D rotation): snap cell (d,sd) to the centre (-W) ----
  // Sets view4 to a signed-permutation matrix that rotates this cell's current
  // view direction onto -W. Pure view change: never touches the puzzle state.
  // Returns the move axis info, or null if already centred.
  centerCell(d, sd) {
    const n = [0,0,0,0]; n[d] = sd;
    const cur = matVec4i(this.view4, n);    // where this cell points in view space now
    const { a, s } = axisOf(cur);
    if (a === W && s === -1) return null;    // already centred
    // pick a 90-degree rotation in plane (a, W) sending (a,s) -> (W,-1)
    // e_a*s -> e_W*-1 ; rotInt(a,W,dir) sends e_a -> dir*e_W, so choose dir = -s
    const R = rotInt(a, W, -s);
    this.view4 = matMul4(R, this.view4);
    return { key: keyOf(d, sd), d, sd };
  }
  resetView() { this.view4 = I4(); }

  // which LOGICAL cell currently sits at a given physical/view direction (e.g. 'X+').
  // Needed so a twist of a selected physical cube acts on the right cell after centring.
  // n = view4^T · e  (view4 is an orthogonal integer matrix, so inverse = transpose).
  viewToLogical(viewKey) {
    const va = AXN.indexOf(viewKey[0]), vs = viewKey[1] === '+' ? 1 : -1;
    const n = [0,0,0,0];
    for (let i = 0; i < 4; i++) {
      let s = 0; for (let k = 0; k < 4; k++) s += this.view4[k][i] * (k === va ? vs : 0);
      n[i] = Math.round(s);
    }
    const { a, s } = axisOf(n);
    return { d: a, sd: s, key: keyOf(a, s) };
  }

  // -------- physical LED readout: 7 cubes x 27 leds = 189 -----------------------
  // placements() is the single source of truth: one entry per VISIBLE sticker, with a
  // STABLE identity `id` (which piece + which of its stickers). Because the id survives
  // a move, the simulator can diff placements before/after a twist to learn exactly
  // which led-position each colour travels FROM and TO — that permutation is what makes
  // a twist look like a rotation (a wave that sweeps in the turn direction) instead of a
  // formless cross-fade. The id is also stable across centring (a pure view change).
  //   slot = which of the 7 cubes; idx = (i+1)+3*(j+1)+9*(k+1) with (i,j,k) the in-cube
  //   VIEW coordinates on the 3 axes != the cube's normal axis.
  placements() {
    const out = [];
    for (const p of this.pieces) {
      const vcur = matVec4i(this.view4, p.cur);        // piece position in view space
      for (const st of p.stickers) {
        const { fa, fs } = this.facingOf(p, st);
        const e = [0,0,0,0]; e[fa] = fs;
        const vdir = matVec4i(this.view4, e);
        const { a: va, s: vs } = axisOf(vdir);          // which cube this sticker faces
        const slot = PHYS[keyOf(va, vs)];
        if (!slot) continue;                             // faces the hidden 8th cube
        const inAx = [0,1,2,3].filter(ax => ax !== va);  // the 3 in-cube view axes
        const i = vcur[inAx[0]], j = vcur[inAx[1]], k = vcur[inAx[2]];
        const idx = (i+1) + 3*(j+1) + 9*(k+1);
        out.push({ id: p.solved.join(',') + ':' + st.axis, slot, idx, rgb: st.rgb, key: st.key, vi: [i, j, k] });
      }
    }
    return out;
  }

  // { C:[27], R:[27], ... } where each entry is { rgb, key, vi:[i,j,k] } or null.
  ledState() {
    const out = {}; for (const slot of Object.values(PHYS)) out[slot] = new Array(27).fill(null);
    for (const pl of this.placements()) out[pl.slot][pl.idx] = { rgb: pl.rgb, key: pl.key, vi: pl.vi };
    return out;
  }
}
