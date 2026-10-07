/* ============================================================================
   bench/textures.js — procedural canvas textures for the realistic 3D bench.
   Everything is generated at load time (no image files, works offline from the
   repo), deterministic (seeded) and tileable where a texture repeats.
   ========================================================================== */
import * as THREE from 'three';

let MAX_ANISO = 4;
export function setMaxAnisotropy(a) { MAX_ANISO = Math.max(1, a | 0); }

const cache = new Map();
const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTexture(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
// tileable 2D value noise. (px,py) = integer lattice period: a texture spanning a whole
// number of lattice cells repeats seamlessly with RepeatWrapping.
function valueNoise(seed) {
  const hash = (x, y) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144269)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y, px = 4096, py = 4096) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
    const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
}
function fbm(n, x, y, px, py, oct = 4) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f, px * f, py * f); norm += a; a *= 0.5; f *= 2; }
  return s / norm;
}
const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------- workbench top (butcher block)
export const woodTexture = () => memo('wood', () => {
  const W = 1024, H = 1024, [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H), d = img.data;
  const n = valueNoise(7), n2 = valueNoise(19), R = rng(3);
  const PL = 8, ph = H / PL;
  const tone = [], joint = [];
  for (let p = 0; p < PL; p++) { tone.push(0.86 + R() * 0.22); joint.push((R() * W) | 0); }
  for (let y = 0; y < H; y++) {
    const p = Math.floor(y / ph), v = y - p * ph;
    for (let x = 0; x < W; x++) {
      const gn = fbm(n, x / 128, y / 9 + p * 37, 8, 1024, 3);
      const ring = 0.5 + 0.5 * Math.sin(y * 0.42 + gn * 16 + p * 2.1);
      const mott = fbm(n2, x / 64, y / 64, 16, 16, 3);
      let k = tone[p] * (0.80 + 0.13 * ring * ring + 0.14 * mott);
      if (v < 1.5 || v > ph - 1.5) k *= 0.55;                          // glue line between strips
      if (Math.abs(x - joint[p]) < 1.2) k *= 0.62;                      // staggered end joint
      const i = (y * W + x) * 4;
      d[i] = clamp255(178 * k); d[i + 1] = clamp255(130 * k); d[i + 2] = clamp255(84 * k); d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: [2, 1] });
});

// ---------------------------------------------------------------- ESD mat (blue-grey, speckled, faint grid)
export const matTexture = () => memo('mat', () => {
  const W = 512, [c, g] = makeCanvas(W, W);
  const img = g.createImageData(W, W), d = img.data, n = valueNoise(11), R = rng(5);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const m = fbm(n, x / 64, y / 64, 8, 8, 3);
    const s = (R() - 0.5) * 14;
    const grid = (x % 128 < 1.5 || y % 128 < 1.5) ? 9 : 0;
    const i = (y * W + x) * 4;
    d[i] = clamp255(58 + m * 14 + s + grid); d[i + 1] = clamp255(76 + m * 15 + s + grid);
    d[i + 2] = clamp255(92 + m * 16 + s + grid); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: [5, 2.25] });
});

// ---------------------------------------------------------------- concrete floor
export const concreteTexture = () => memo('concrete', () => {
  const W = 512, [c, g] = makeCanvas(W, W);
  const img = g.createImageData(W, W), d = img.data, n = valueNoise(23), n2 = valueNoise(29), R = rng(9);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const m = fbm(n, x / 64, y / 64, 8, 8, 4);
    const blot = fbm(n2, x / 128, y / 128, 4, 4, 3);
    const s = (R() - 0.5) * 18;
    let k = 92 + m * 30 + s - (blot > 0.62 ? (blot - 0.62) * 90 : 0);
    const i = (y * W + x) * 4;
    d[i] = clamp255(k); d[i + 1] = clamp255(k * 0.99); d[i + 2] = clamp255(k * 0.97); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: [7, 7] });
});

// ---------------------------------------------------------------- painted wall
export const wallTexture = () => memo('wall', () => {
  const W = 512, [c, g] = makeCanvas(W, W);
  const img = g.createImageData(W, W), d = img.data, n = valueNoise(31), R = rng(13);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const m = fbm(n, x / 64, y / 64, 8, 8, 4);
    const k = 52 + m * 12 + (R() - 0.5) * 5;
    const i = (y * W + x) * 4;
    d[i] = clamp255(k); d[i + 1] = clamp255(k + 2); d[i + 2] = clamp255(k + 7); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: [6, 4] });
});

// ---------------------------------------------------------------- pegboard (hardboard, 1" holes)
export const pegboardTexture = () => memo('peg', () => {
  const W = 512, [c, g] = makeCanvas(W, W);
  const img = g.createImageData(W, W), d = img.data, n = valueNoise(37), R = rng(17);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const m = fbm(n, x / 32, y / 32, 16, 16, 3);
    const k = 0.9 + m * 0.18 + (R() - 0.5) * 0.06;
    const i = (y * W + x) * 4;
    d[i] = clamp255(124 * k); d[i + 1] = clamp255(94 * k); d[i + 2] = clamp255(64 * k); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const cx = 64 + i * 128, cy = 64 + j * 128;
    const grd = g.createRadialGradient(cx, cy, 6, cx, cy, 15);
    grd.addColorStop(0, '#0d0b09'); grd.addColorStop(0.8, '#1c1610'); grd.addColorStop(1, 'rgba(60,45,30,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.fill();
  }
  return toTexture(c, { repeat: [12, 7] });
});

// ---------------------------------------------------------------- frosted-diffuser hotspot (LED behind PETG)
export const hotspotTexture = () => memo('hotspot', () => {
  const W = 128, [c, g] = makeCanvas(W, W);
  const img = g.createImageData(W, W), d = img.data;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / W * 2 - 1, r2 = u * u + v * v;
    const edge = Math.max(Math.abs(u), Math.abs(v));
    const k = 0.5 + 0.5 * Math.exp(-r2 * 1.5) - (edge > 0.92 ? (edge - 0.92) * 1.6 : 0);
    const i = (y * W + x) * 4, val = clamp255(255 * k);
    d[i] = d[i + 1] = d[i + 2] = val; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });            // a mask, not a colour: keep it linear
});

// ---------------------------------------------------------------- breadboard (830 points, 165.1 x 54.6 mm)
export const BB = { W: 165.1, H: 54.6, PITCH: 2.54, COLS: 63, X0: 4.0,
  // row centres in mm from the back edge: rails (2+2), j..f, channel, e..a
  ROW: { tp1: 2.9, tp2: 5.44, j: 10.6, i: 13.14, h: 15.68, g: 18.22, f: 20.76,
         e: 28.38, d: 30.92, c: 33.46, b: 36.0, a: 38.54, bp1: 46.0, bp2: 48.54 } };
BB.colX = col => BB.X0 + col * BB.PITCH;          // column 0..62 -> mm from the left edge
export const breadboardTexture = () => memo('bb', () => {
  const S = 12, [c, g] = makeCanvas(Math.round(BB.W * S), Math.round(BB.H * S));
  g.fillStyle = '#efeade'; g.fillRect(0, 0, c.width, c.height);
  // centre channel
  const chY = (BB.ROW.f + BB.ROW.e) / 2 * S;
  g.fillStyle = '#d9d3c4'; g.fillRect(0, chY - 1.6 * S, c.width, 3.2 * S);
  g.fillStyle = '#cfc8b8'; g.fillRect(0, chY - 0.5 * S, c.width, 1.0 * S);
  // rail stripes
  const stripe = (y, col) => { g.fillStyle = col; g.fillRect(3 * S, y * S, c.width - 6 * S, 0.45 * S); };
  stripe(1.0, '#d23a3a'); stripe(7.2, '#2f62c9'); stripe(43.6, '#d23a3a'); stripe(50.2, '#2f62c9');
  const hole = (x, y) => {
    g.fillStyle = '#c9c2b2'; g.fillRect((x - 0.85) * S, (y - 0.85) * S, 1.7 * S, 1.7 * S);
    g.fillStyle = '#26231f'; g.fillRect((x - 0.55) * S, (y - 0.55) * S, 1.1 * S, 1.1 * S);
  };
  for (const r of ['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])
    for (let col = 0; col < BB.COLS; col++) hole(BB.colX(col), BB.ROW[r]);
  for (const r of ['tp1', 'tp2', 'bp1', 'bp2'])
    for (let col = 1; col < BB.COLS - 1; col++) if ((col - 1) % 6 !== 5) hole(BB.colX(col), BB.ROW[r]);
  g.fillStyle = '#8f887a'; g.font = `${1.5 * S}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let col = 0; col < BB.COLS; col += 5) {
    g.fillText(String(col + 1), BB.colX(col) * S, (BB.ROW.j - 2.3) * S);
    g.fillText(String(col + 1), BB.colX(col) * S, (BB.ROW.a + 2.3) * S);
  }
  for (const r of ['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']) g.fillText(r, 1.8 * S, BB.ROW[r] * S);
  return toTexture(c);
});

// ---------------------------------------------------------------- ESP32-DevKitC silkscreen (54.4 x 27.9 mm)
// Board lies with the antenna end at +x and header J2 (3V3 … 13, 5V) at the BACK (−z):
// canvas left = USB end (−x), canvas top = back edge. Pin 1 of both headers sits at the
// antenna end; pin k is k−1 pitches further towards the USB end. (Row spacing 25.4 mm is
// an estimate for the 38-pin DevKitC.)
export const DEVKIT = { W: 54.4, H: 27.9, PITCH: 2.54, ROWSEP: 25.4,
  J2: ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', 'GND', '13', 'D2', 'D3', 'CMD', '5V'],
  J3: ['GND', '23', '22', 'TX', 'RX', '21', 'GND', '19', '18', '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'] };
DEVKIT.PIN0 = (DEVKIT.W - 18 * DEVKIT.PITCH) / 2 + 1.6;         // mm from the antenna end to pin 1
DEVKIT.pinX = k => DEVKIT.W / 2 - DEVKIT.PIN0 - k * DEVKIT.PITCH;  // pin k (0-based) -> local x in mm
export const devkitTexture = () => memo('devkit', () => {
  const S = 20, [c, g] = makeCanvas(Math.round(DEVKIT.W * S), Math.round(DEVKIT.H * S));
  g.fillStyle = '#16191d'; g.fillRect(0, 0, c.width, c.height);
  // a few faint copper traces under the solder mask (USB/regulator half of the board)
  const R = rng(41); g.strokeStyle = 'rgba(70,82,92,.55)'; g.lineWidth = 0.35 * S;
  for (let t = 0; t < 22; t++) {
    let x = (3 + R() * 24) * S, y = (5 + R() * 18) * S; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) { if (R() < 0.5) x += (R() - 0.5) * 12 * S; else y += (R() - 0.5) * 8 * S; g.lineTo(x, y); }
    g.stroke();
  }
  const cx = k => (DEVKIT.W / 2 + DEVKIT.pinX(k)) * S;
  const yTop = (DEVKIT.H - DEVKIT.ROWSEP) / 2, yBot = yTop + DEVKIT.ROWSEP;
  g.fillStyle = '#f2f2f2'; g.strokeStyle = '#f2f2f2'; g.lineWidth = 0.12 * S;
  g.font = `bold ${1.05 * S}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  DEVKIT.J2.forEach((lab, k) => {
    g.fillText(lab, cx(k), (yTop + 2.5) * S);
    g.strokeRect(cx(k) - 1.1 * S, (yTop - 1.1) * S, 2.2 * S, 2.2 * S);
  });
  DEVKIT.J3.forEach((lab, k) => {
    g.fillText(lab, cx(k), (yBot - 2.5) * S);
    g.strokeRect(cx(k) - 1.1 * S, (yBot - 1.1) * S, 2.2 * S, 2.2 * S);
  });
  g.font = `bold ${1.45 * S}px system-ui, sans-serif`;
  g.fillText('ESP32-DevKitC V4', 18 * S, 14.2 * S);
  g.font = `${1.1 * S}px system-ui, sans-serif`;
  g.fillText('EN', 7.7 * S, 5.6 * S); g.fillText('BOOT', 7.7 * S, 22.4 * S);
  return toTexture(c);
});

// ---------------------------------------------------------------- small printed labels (chips, PSU, sleeve)
function labelCanvas(w, h, bg, draw) {
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h); draw(g, w, h);
  return toTexture(c);
}
export const wroomTexture = () => memo('wroom', () => labelCanvas(512, 512, '#b9bec6', (g, w, h) => {
  const n = valueNoise(43), img = g.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (fbm(n, x / 4, y / 64, 128, 8, 2) - 0.5) * 22, i = (y * w + x) * 4;
    d[i] += k; d[i + 1] += k; d[i + 2] += k;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#4c5159'; g.textAlign = 'center'; g.font = 'bold 54px system-ui, sans-serif';
  g.fillText('ESP32-WROOM-32', w / 2, h * 0.42);
  g.font = '38px system-ui, sans-serif'; g.fillText('Wi-Fi + Bluetooth', w / 2, h * 0.58);
  g.fillText('CE', w * 0.3, h * 0.78); g.strokeStyle = '#4c5159'; g.lineWidth = 4;
  g.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
}));
// DIP top: notch at the right (+x) edge, pin-1 dimple at the back-right (canvas top-right)
export const chipTexture = (text, sub = '') => memo('chip:' + text, () => labelCanvas(512, 160, '#17181b', (g, w, h) => {
  g.fillStyle = '#9da3ad'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 46px system-ui, sans-serif';
  g.fillText(text, w * 0.47, h * 0.44); if (sub) { g.font = '28px system-ui, sans-serif'; g.fillText(sub, w * 0.47, h * 0.76); }
  g.fillStyle = '#0c0d0f';
  g.beginPath(); g.arc(w, h / 2, 20, 0, Math.PI * 2); g.fill();          // notch
  g.beginPath(); g.arc(w - 40, 30, 11, 0, Math.PI * 2); g.fill();        // pin-1 dimple
}));
export const psuLabelTexture = () => memo('psulabel', () => labelCanvas(1024, 320, '#d8dce2', (g, w, h) => {
  g.fillStyle = '#1d2128'; g.textAlign = 'left';
  g.font = 'bold 64px system-ui, sans-serif'; g.fillText('SWITCHING POWER SUPPLY', 40, 92);
  g.font = '44px system-ui, sans-serif';
  g.fillText('INPUT 100–240 V~  50/60 Hz  1.4 A', 40, 170);
  g.font = 'bold 56px system-ui, sans-serif'; g.fillText('OUTPUT +5 V ⎓ 10 A   50 W', 40, 250);
  g.strokeStyle = '#1d2128'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
}));
export const perforatedTexture = () => memo('perf', () => {
  const W = 256, [c, g] = makeCanvas(W, W);
  g.fillStyle = '#c3c8cf'; g.fillRect(0, 0, W, W);
  const n = valueNoise(47), img = g.getImageData(0, 0, W, W), d = img.data;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const k = (fbm(n, x / 2, y / 64, 128, 4, 2) - 0.5) * 18, i = (y * W + x) * 4;
    d[i] += k; d[i + 1] += k; d[i + 2] += k;
  }
  g.putImageData(img, 0, 0);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 9; i++) {
    const x = i * 32 + (j % 2 ? 16 : 0), y = j * 32 + 16;
    g.fillStyle = '#16181b'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
  }
  return toTexture(c, { repeat: [6, 5] });
});
export const sleeveTexture = () => memo('sleeve', () => labelCanvas(512, 256, '#1a2a4a', (g, w, h) => {
  g.fillStyle = '#9fb0c8'; g.fillRect(w * 0.06, 0, w * 0.13, h);                 // the minus stripe
  g.fillStyle = '#1a2a4a'; g.font = 'bold 48px system-ui, sans-serif'; g.textAlign = 'center';
  for (let y = 40; y < h; y += 70) g.fillText('−', w * 0.125, y);
  g.fillStyle = '#e7ecf4'; g.font = 'bold 40px system-ui, sans-serif';
  g.save(); g.translate(w * 0.55, h * 0.5); g.rotate(-Math.PI / 2);
  g.fillText('1000µF', 0, -18); g.font = '30px system-ui, sans-serif'; g.fillText('16V 105°C', 0, 26);
  g.restore();
}));
export const capTopTexture = () => memo('captop', () => labelCanvas(128, 128, '#b8bdc4', (g) => {
  g.strokeStyle = '#6d727a'; g.lineWidth = 7; g.beginPath();
  g.moveTo(64, 18); g.lineTo(64, 110); g.moveTo(64, 64); g.lineTo(26, 30); g.moveTo(64, 64); g.lineTo(102, 30);
  g.stroke();
}));
export const perfboardTexture = () => memo('perfboard', () => {
  const W = 256, [c, g] = makeCanvas(W, W);
  g.fillStyle = '#2d5e36'; g.fillRect(0, 0, W, W);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = 16 + i * 32, y = 16 + j * 32;
    g.fillStyle = '#c98a3e'; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d2a20'; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
  }
  return toTexture(c, { repeat: [2, 1.4] });
});
// gamepad face-button symbol (PlayStation-style colours)
export const symbolTexture = (sym) => memo('sym:' + sym, () => labelCanvas(128, 128, '#1b1d22', (g) => {
  const col = { tri: '#3fe0b2', cir: '#ff5b5b', crs: '#7aa9ff', sqr: '#ff8ad6' }[sym];
  g.strokeStyle = col; g.lineWidth = 9; g.lineJoin = 'round'; g.beginPath();
  if (sym === 'tri') { g.moveTo(64, 30); g.lineTo(98, 90); g.lineTo(30, 90); g.closePath(); }
  else if (sym === 'cir') g.arc(64, 64, 32, 0, Math.PI * 2);
  else if (sym === 'crs') { g.moveTo(34, 34); g.lineTo(94, 94); g.moveTo(94, 34); g.lineTo(34, 94); }
  else g.rect(34, 34, 60, 60);
  g.stroke();
}));

// multimeter LCD: reads the 5V rail
export const lcdTexture = () => memo('lcd', () => labelCanvas(256, 144, '#a9b8a2', (g, w, h) => {
  g.fillStyle = '#1f2a1d'; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.font = 'bold 86px "Courier New", monospace'; g.fillText('5.02', w - 44, h * 0.56);
  g.font = 'bold 30px system-ui, sans-serif'; g.fillText('V', w - 12, h * 0.68);
  g.textAlign = 'left'; g.font = '22px system-ui, sans-serif'; g.fillText('DC', 12, 22);
}));
