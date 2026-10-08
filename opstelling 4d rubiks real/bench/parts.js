/* ============================================================================
   bench/parts.js — realistic models of the electronics, at (estimated) real size.
   1 scene unit = 4 cm, so mm(x) = x / 40. Every builder returns plain THREE groups in
   their own local frame (y = 0 is the surface the part stands on); hardware.js places
   them, registers them as clickable parts and derives the wire terminals.
   Materials are created per part, so highlighting one part never tints another.
   Meshes that light up by themselves are tagged userData.keepEmissive.
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js?v=12';   // same URL as hardware.js imports (one module instance)

export const mm = v => v / 40;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.5, metalness = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const metal = (color = 0xc9ccd2, roughness = 0.3) => std(color, roughness, 1);
function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const box = (w, h, d, mat, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
const rbox = (w, h, d, r, mat, x, y, z, parent) => mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat, x, y, z, parent);
const cyl = (rt, rb, h, mat, x, y, z, parent, seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent);
const glow = (m) => { m.userData.keepEmissive = true; m.castShadow = false; return m; };

/* ------------------------------------------------------------------ breadboard (830)
   Local frame: centre of the board footprint, y = 0 on the surface it stands on.
   hole(col, row) -> local point ON the top surface for column 0..62 and row 'a'..'j'. */
export function buildBreadboard() {
  const g = new THREE.Group();
  const H = mm(8.5), W = mm(TX.BB.W), D = mm(TX.BB.H);
  const side = std(0xe8e2d4, 0.55);
  const body = rbox(W, H, D, mm(0.8), [side, side, std(0xffffff, 0.5, 0, { map: TX.breadboardTexture() }), side, side, side], 0, H / 2, 0, g);
  body.castShadow = true;
  const hole = (col, row) => V(mm(TX.BB.colX(col)) - W / 2, H, mm(TX.BB.ROW[row]) - D / 2);
  return { group: g, hole, top: H };
}

/* ------------------------------------------------------------------ ESP32-DevKitC V4
   Local frame: centre of the PCB footprint on the breadboard surface. Antenna end = +x,
   header J2 (3V3 … GND, 13 … 5V) at the back (−z), J3 at the front (+z). */
export function buildESP32() {
  const g = new THREE.Group();
  const K = TX.DEVKIT, W = mm(K.W), D = mm(K.H), T = mm(1.6), y0 = mm(2.5);
  // header plastic (spacers) + the PCB
  const plastic = std(0x111214, 0.6);
  for (const z of [-mm(K.ROWSEP / 2), mm(K.ROWSEP / 2)]) box(mm(48.3), y0, mm(2.5), plastic, mm(-1.6), y0 / 2, z, g);
  const pcbSide = std(0x1a1d22, 0.45);
  mesh(new THREE.BoxGeometry(W, T, D), [pcbSide, pcbSide, std(0xffffff, 0.38, 0, { map: TX.devkitTexture() }), pcbSide, pcbSide, pcbSide],
    0, y0 + T / 2, 0, g);
  const top = y0 + T;
  // solder joints on top of every header pin
  const solder = metal(0xd9dde2, 0.25);
  const jointGeo = new THREE.ConeGeometry(mm(0.75), mm(0.9), 10);
  for (const z of [-mm(K.ROWSEP / 2), mm(K.ROWSEP / 2)])
    for (let k = 0; k < 19; k++) { const j = mesh(jointGeo, solder, mm(K.pinX(k)), top + mm(0.45), z, g); j.castShadow = false; }
  // ESP32-WROOM-32 module: shield can + PCB antenna (the Bluetooth radio)
  const modX = mm(K.W / 2 - 25.5 / 2), modT = mm(0.8);
  box(mm(25.5), modT, mm(18), std(0x1d2733, 0.4), modX, top + modT / 2, 0, g);
  const can = mesh(new THREE.BoxGeometry(mm(17.6), mm(2.3), mm(16)),
    [metal(0xb9bec6, 0.32), metal(0xb9bec6, 0.32), std(0xffffff, 0.34, 1, { map: TX.wroomTexture() }), metal(0xb9bec6), metal(0xb9bec6, 0.32), metal(0xb9bec6, 0.32)],
    modX - mm(25.5 / 2 - 17.6 / 2) + mm(0.4), top + modT + mm(1.15), 0, g);
  can.userData.role = 'shield';
  // the gold meander of the PCB antenna
  const gold = metal(0xd2a640, 0.3);
  const antX0 = mm(K.W / 2 - 6.8);
  for (let i = 0; i < 6; i++) box(mm(0.5), mm(0.06), mm(12), gold, antX0 + mm(i * 1.1), top + modT + mm(0.03), 0, g);
  // micro-USB (overhangs the USB end), CP2102, AMS1117, EN/BOOT buttons, power led, passives
  const usb = metal(0xc4c8ce, 0.25);
  box(mm(5.6), mm(2.8), mm(7.6), usb, -W / 2 + mm(1.8), top + mm(1.4), 0, g);
  box(mm(0.6), mm(1.6), mm(5.6), std(0x0b0c0e, 0.6), -W / 2 - mm(1.0), top + mm(1.4), 0, g);
  box(mm(5), mm(0.9), mm(5), std(0x16171a, 0.45), mm(-12), top + mm(0.45), mm(1), g);
  box(mm(6.5), mm(1.6), mm(3.5), std(0x16171a, 0.45), mm(-6.5), top + mm(0.8), mm(-6.2), g);
  box(mm(3.0), mm(0.3), mm(6.5), metal(0xc4c8ce), mm(-6.5), top + mm(0.15), mm(-3.6), g);
  for (const z of [-4.9, 4.9]) {
    box(mm(4.4), mm(1.4), mm(4.4), metal(0xc9ccd1, 0.35), mm(-19.5), top + mm(0.7), mm(z), g);
    cyl(mm(1.2), mm(1.2), mm(1.1), std(0x1b1c1f, 0.5), mm(-19.5), top + mm(1.95), mm(z), g, 16);
  }
  const pled = glow(box(mm(1.6), mm(0.6), mm(0.9), new THREE.MeshStandardMaterial({ color: 0x5a0a08, emissive: 0xff2a1a, emissiveIntensity: 3 }), mm(-22.5), top + mm(0.3), mm(8.5), g));
  pled.userData.role = 'powerLed';
  const R = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 16; i++) {
    const c = R() < 0.6 ? 0xb9a27c : 0x1a1a1c;
    box(mm(1.0), mm(0.45), mm(0.5), std(c, 0.5), mm(-24 + R() * 26), top + mm(0.22), mm(-7 + R() * 14), g);
  }
  return { group: g, top, antenna: V(W / 2 - mm(3.5), top + mm(1.2), 0) };
}

/* ------------------------------------------------------------------ 74AHCT125N (DIP-14)
   Local frame: chip centre on the breadboard surface (straddling the channel), notch at +x.
   Pins 1..7 along the back (−z) from +x to −x; pins 8..14 along the front from −x to +x. */
export function buildDIP14(text = '74AHCT125N') {
  const g = new THREE.Group();
  const bodyH = mm(3.3), lift = mm(0.6);
  const epoxy = std(0x17181b, 0.42);
  mesh(new THREE.BoxGeometry(mm(19.3), bodyH, mm(6.35)),
    [epoxy, epoxy, std(0xffffff, 0.45, 0, { map: TX.chipTexture(text) }), epoxy, epoxy, epoxy], 0, lift + bodyH / 2, 0, g);
  const leg = metal(0xc9ccd2, 0.28);
  for (let k = 0; k < 7; k++) {
    const x = mm((3 - k) * 2.54);
    for (const s of [-1, 1]) {
      const px = s < 0 ? x : -x;                             // back row runs +x→−x, front row −x→+x
      // shoulder from the body edge (3.175 mm) out to the leg, which stands on the 7.62 mm row spacing
      box(mm(0.5), mm(0.25), mm(0.76), leg, px, lift + mm(1.2), s * mm(3.555), g).castShadow = false;
      box(mm(0.5), lift + mm(1.2), mm(0.25), leg, px, (lift + mm(1.2)) / 2, s * mm(3.81), g).castShadow = false;
    }
  }
  return { group: g, top: lift + bodyH };
}

/* ------------------------------------------------------------------ lever splice block
   A generic 8-way lever connector (clear housing, copper bus, coloured levers); two of them
   form the 5V / GND distribution (buildDistribution).
   Local frame: centre on its base, entries along x, wire openings facing −z. */
export function buildLeverBlock(n = 8, lever = 0xe58a2c) {
  const g = new THREE.Group();
  const pitch = mm(6.4), L = n * pitch + mm(3), H = mm(8.5), D = mm(18.5);
  const clear = new THREE.MeshPhysicalMaterial({ color: 0xdfe5ea, roughness: 0.18, metalness: 0, transparent: true,
    opacity: 0.55, clearcoat: 0.6, depthWrite: false });
  const housing = rbox(L, H, D, mm(1.2), clear, 0, H / 2, 0, g); housing.castShadow = false;
  box(L - mm(2), mm(1.2), mm(4), metal(0xc87d4a, 0.35), 0, mm(2.2), mm(-2), g);   // copper bus bar
  const lv = std(lever, 0.45);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + mm(1.5) + pitch * (i + 0.5);
    const l = rbox(pitch * 0.72, mm(2.2), mm(13), mm(0.6), lv, x, H + mm(0.6), mm(2.5), g);
    l.rotation.x = -0.08;
    entries.push({ p: V(x, mm(3.6), -D / 2 - mm(0.2)), d: V(0, 0, -1) });
  }
  return { group: g, entries, size: V(L, H, D) };
}

/* ------------------------------------------------------------------ 5V / 10A enclosed supply
   ~99 x 82 x 30 mm. Local frame: bottom centre; terminal block at +x.
   Screw order along z (−z → +z): L, N, ⏚, −V, −V, +V, +V. */
export function buildPSU() {
  const g = new THREE.Group();
  const L = mm(99), W = mm(82), H = mm(30);
  const alu = std(0xc6cad0, 0.36, 1);
  const top = std(0xffffff, 0.4, 1, { map: TX.perforatedTexture() });
  const label = std(0xffffff, 0.6, 0, { map: TX.psuLabelTexture() });
  mesh(new THREE.BoxGeometry(L - mm(6), H, W), [alu, alu, top, alu, label, alu], -mm(3), H / 2, 0, g);
  box(L, mm(1.5), W, std(0x9aa0a8, 0.4, 1), 0, mm(0.75), 0, g);                                 // base plate
  // terminal block (recessed at +x) with 7 screws
  const tb = std(0x121315, 0.55);
  const tbX = L / 2 - mm(6);
  box(mm(12), mm(15), mm(70), tb, tbX, mm(9), 0, g);
  const screwZ = [];
  const head = metal(0xb8bdc4, 0.3), slot = std(0x2a2c30, 0.5);
  for (let i = 0; i < 7; i++) {
    const z = mm((i - 3) * 9.5); screwZ.push(z);
    cyl(mm(2.6), mm(2.6), mm(1.4), head, tbX + mm(1), mm(16.8), z, g, 18);
    box(mm(3.6), mm(0.5), mm(0.7), slot, tbX + mm(1), mm(17.5), z, g).castShadow = false;
    if (i < 6) box(mm(9), mm(4), mm(0.9), tb, tbX + mm(1), mm(17.8), z + mm(4.75), g);       // barrier fins
  }
  // DC-OK led + V.ADJ trimmer
  glow(cyl(mm(1.4), mm(1.4), mm(1.2), new THREE.MeshStandardMaterial({ color: 0x0a3a14, emissive: 0x29ff6a, emissiveIntensity: 2.6 }),
    tbX - mm(2), H + mm(0.4), mm(38), g, 12));
  cyl(mm(2.2), mm(2.2), mm(1.6), std(0x2f5fd0, 0.4), tbX - mm(8), H + mm(0.6), mm(37), g, 16);
  const screw = i => ({ p: V(tbX + mm(6.4), mm(10), screwZ[i]), d: V(1, 0.1, 0).normalize() });
  return {
    group: g,
    screws: { L: screw(0), N: screw(1), PE: screw(2), VM1: screw(3), VM2: screw(4), VP1: screw(5), VP2: screw(6) },
  };
}

/* ------------------------------------------------------------------ on/off switch box
   Small ABS enclosure with an illuminated rocker. Local: bottom centre, glands at ±x. */
export function buildSwitchBox() {
  const g = new THREE.Group();
  const L = mm(64), H = mm(28), D = mm(38);
  const abs = std(0x1b1d21, 0.62);
  rbox(L, H, D, mm(2.5), abs, 0, H / 2, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    cyl(mm(1.6), mm(1.6), mm(0.4), metal(0xb0b5bc), sx * mm(26), H + mm(0.1), sz * mm(14), g, 12);
  box(mm(30), mm(1.4), mm(22), std(0x0d0e10, 0.5), 0, H + mm(0.7), 0, g);                 // rocker bezel
  const rockerMat = new THREE.MeshStandardMaterial({ color: 0xa3140f, roughness: 0.35, emissive: 0xff2a10, emissiveIntensity: 0 });
  const rocker = rbox(mm(25), mm(5), mm(17), mm(1.2), rockerMat, 0, H + mm(2.6), 0, g);
  rocker.userData.keepEmissive = true;
  for (const sx of [-1, 1]) {
    cyl(mm(5.2), mm(5.2), mm(7), std(0x101114, 0.55), sx * (L / 2 + mm(3)), H / 2, 0, g, 6).rotation.z = Math.PI / 2;
    cyl(mm(3.6), mm(4.4), mm(5), std(0x101114, 0.55), sx * (L / 2 + mm(8)), H / 2, 0, g, 18).rotation.z = Math.PI / 2;
  }
  const setOn = on => {
    rocker.rotation.x = on ? -0.16 : 0.16;
    rockerMat.emissiveIntensity = on ? 1.6 : 0;
  };
  setOn(true);
  return {
    group: g, setOn,
    in:  { p: V(-(L / 2 + mm(10.5)), H / 2, 0), d: V(-1, 0, 0) },
    out: { p: V(L / 2 + mm(10.5), H / 2, 0), d: V(1, 0, 0) },
  };
}

/* ------------------------------------------------------------------ inline blade-fuse holder
   Local: holder centre on the bench, leads along x (in at −x, out at +x). */
export function buildFuse() {
  const g = new THREE.Group();
  const L = mm(42), H = mm(12), D = mm(19);
  const body = std(0x16171a, 0.5);
  rbox(L, H, D, mm(3), body, 0, H / 2, 0, g);
  const lid = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.35,
    clearcoat: 1, depthWrite: false });
  const lidMesh = rbox(mm(22), mm(4), mm(15), mm(1.5), lid, 0, H + mm(1.6), 0, g); lidMesh.castShadow = false;
  // the red ATC 10A blade fuse inside (visible through the clear lid)
  const fuseMat = new THREE.MeshPhysicalMaterial({ color: 0xd8261f, roughness: 0.25, transmission: 0, transparent: true, opacity: 0.92 });
  box(mm(19), mm(3.6), mm(5), fuseMat, 0, H + mm(1.0), 0, g);
  for (const sx of [-1, 1]) box(mm(3), mm(3), mm(0.8), metal(0xd9dde2), sx * mm(5.5), H - mm(1.2), 0, g);
  for (const sx of [-1, 1]) cyl(mm(2.6), mm(3.2), mm(6), body, sx * (L / 2 + mm(2)), H / 2, 0, g, 16).rotation.z = Math.PI / 2;
  return {
    group: g,
    in:  { p: V(-(L / 2 + mm(5)), H / 2, 0), d: V(-1, 0, 0) },
    out: { p: V(L / 2 + mm(5), H / 2, 0), d: V(1, 0, 0) },
  };
}

/* ------------------------------------------------------------------ 5V / GND distribution
   Two 8-way lever blocks side by side, openings facing −z: GND (grey levers) at −x — the GND
   star point — and 5V (orange levers) at +x. Local frame: the centre of the pair on the bench.
   gnd[i] / v5[i]: entry i from left (−x) to right (+x); gnd[7] and v5[0] are the inner ends. */
export function buildDistribution() {
  const g = new THREE.Group();
  const side = (lever, sx) => {
    const b = buildLeverBlock(8, lever);
    b.group.position.x = sx * (b.size.x / 2 + mm(0.3)); g.add(b.group);
    return b.entries.map(e => ({ p: e.p.clone().add(b.group.position), d: e.d.clone() }));
  };
  return { group: g, gnd: side(0x3a3d44, -1), v5: side(0xe58a2c, 1) };
}

/* ------------------------------------------------------------------ 1000 µF / 16 V electrolytic (radial)
   Local: bottom centre, axis +y. Legs: − (stripe side) at −x, + at +x. */
export function buildCapacitor() {
  const g = new THREE.Group();
  const r = mm(5), h = mm(20);
  const sleeve = std(0xffffff, 0.38, 0, { map: TX.sleeveTexture() });
  const can = mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true), sleeve, 0, mm(1.5) + h / 2, 0, g);
  can.rotation.y = Math.PI * 1.25;             // stripe (−) faces the − leg at −x
  const top = mesh(new THREE.CircleGeometry(r * 0.96, 32), std(0xffffff, 0.3, 1, { map: TX.capTopTexture() }), 0, mm(1.5) + h, 0, g);
  top.rotation.x = -Math.PI / 2;
  const rim = mesh(new THREE.TorusGeometry(r * 0.97, mm(0.45), 8, 32), std(0x18243f, 0.4), 0, mm(1.5) + h - mm(0.2), 0, g);
  rim.rotation.x = Math.PI / 2;
  cyl(r * 0.98, r * 0.98, mm(1.2), std(0x111111, 0.6), 0, mm(1.0) + mm(0.6), 0, g, 24);       // rubber bung
  const leg = metal(0xd9dde2, 0.3);
  for (const sx of [-1, 1]) cyl(mm(0.3), mm(0.3), mm(2.2), leg, sx * mm(2.5), mm(0.6), 0, g, 6);
  return { group: g, minus: V(-mm(2.5), 0, 0), plus: V(mm(2.5), 0, 0) };
}

/* ------------------------------------------------------------------ 330 Ω resistor (orange-orange-brown-gold)
   Local: lies along x on the breadboard; legs bent down into the holes at ±mm(5.08) (4 columns apart). */
export function buildResistor() {
  const g = new THREE.Group();
  const r = mm(1.2), y = mm(2.0);
  const body = cyl(r, r, mm(6.3), std(0xd8c39a, 0.55), 0, y, 0, g, 18); body.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(r * 1.08, 16, 10), std(0xd8c39a, 0.55), sx * mm(3.0), y, 0, g);
    cap.scale.set(0.55, 1, 1);
  }
  // 330 Ω ±5 %: orange, orange, brown — gap — gold
  [[-2.0, 0xe8730c], [-1.0, 0xe8730c], [0.0, 0x6b3a1e], [2.1, 0xc9a23a]].forEach(([x, c]) => {
    const b = cyl(r * 1.05, r * 1.05, mm(0.55), std(c, 0.45, c === 0xc9a23a ? 0.8 : 0), mm(x), y, 0, g, 18);
    b.rotation.z = Math.PI / 2; b.castShadow = false;
  });
  const leg = metal(0xd9dde2, 0.3);
  for (const sx of [-1, 1]) {
    const h = cyl(mm(0.3), mm(0.3), mm(1.6), leg, sx * mm(4.3), y, 0, g, 6); h.rotation.z = Math.PI / 2;
    cyl(mm(0.3), mm(0.3), y, leg, sx * mm(5.08), y / 2, 0, g, 6);
  }
  return { group: g, a: V(-mm(5.08), 0, 0), b: V(mm(5.08), 0, 0) };
}

/* ------------------------------------------------------------------ wireless gamepad (DualShock-4 style)
   ~162 x 98 mm. Local: bottom centre, light bar facing −z (towards the rig), sticks towards +z. */
export function buildGamepad() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  // top-view outline in shape coords (x right, y = away from the player = world −z)
  s.moveTo(-1.30, 1.00); s.lineTo(1.30, 1.00);
  s.bezierCurveTo(1.80, 1.00, 1.98, 0.75, 1.97, 0.35);
  s.bezierCurveTo(1.96, -0.20, 1.98, -0.95, 1.74, -1.28);
  s.bezierCurveTo(1.55, -1.52, 1.07, -1.48, 0.97, -1.14);
  s.bezierCurveTo(0.87, -0.80, 0.60, -0.58, 0.00, -0.58);
  s.bezierCurveTo(-0.60, -0.58, -0.87, -0.80, -0.97, -1.14);
  s.bezierCurveTo(-1.07, -1.48, -1.55, -1.52, -1.74, -1.28);
  s.bezierCurveTo(-1.98, -0.95, -1.96, -0.20, -1.97, 0.35);
  s.bezierCurveTo(-1.98, 0.75, -1.80, 1.00, -1.30, 1.00);
  const depth = 0.36, bev = 0.17;
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: 0.15,
    bevelSegments: 6, curveSegments: 40 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bev, 0);
  const shell = std(0x2a2d34, 0.55);
  mesh(geo, shell, 0, 0, 0, g);
  const topY = depth + 2 * bev;
  // grips bulge downward a little (so it rests on them)
  for (const sx of [-1, 1]) {
    const grip = mesh(new THREE.SphereGeometry(0.42, 24, 16), shell, sx * 1.36, 0.28, 1.0, g);
    grip.scale.set(0.95, 0.62, 1.15);
  }
  // touchpad + light bar
  rbox(1.30, 0.06, 0.66, 0.08, std(0x0f1013, 0.35), 0, topY + 0.01, -0.42, g);
  const lightBar = glow(rbox(1.2, 0.1, 0.06, 0.03, new THREE.MeshStandardMaterial({ color: 0x0c1a3a, emissive: 0x3d7dff, emissiveIntensity: 2.2 }),
    0, topY - 0.12, -1.16, g));
  // D-pad (left) and face buttons (right)
  const btn = std(0x30333a, 0.4);
  for (const [dx, dz, rot] of [[0, -0.24, 0], [0, 0.24, 0], [-0.24, 0, Math.PI / 2], [0.24, 0, Math.PI / 2]]) {
    const b = rbox(0.17, 0.07, 0.24, 0.03, btn, -1.22 + dx, topY + 0.02, -0.22 + dz, g); b.rotation.y = rot;
  }
  for (const [dx, dz, sym] of [[0, -0.3, 'tri'], [0, 0.3, 'crs'], [-0.3, 0, 'sqr'], [0.3, 0, 'cir']]) {
    const cap = cyl(0.12, 0.125, 0.07, [btn, std(0xffffff, 0.4, 0, { map: TX.symbolTexture(sym) }), btn], 1.22 + dx, topY + 0.03, -0.22 + dz, g, 24);
    cap.rotation.y = Math.PI / 2;                 // symbol upright as seen by the player
  }
  // analog sticks
  for (const sx of [-1, 1]) {
    cyl(0.2, 0.22, 0.05, std(0x101114, 0.5), sx * 0.6, topY + 0.01, 0.38, g, 24);
    cyl(0.07, 0.07, 0.18, std(0x101114, 0.5), sx * 0.6, topY + 0.1, 0.38, g, 12);
    cyl(0.23, 0.21, 0.08, std(0x1c1e23, 0.7), sx * 0.6, topY + 0.21, 0.38, g, 28);
    const rim = mesh(new THREE.TorusGeometry(0.205, 0.028, 8, 28), std(0x24272d, 0.6), sx * 0.6, topY + 0.25, 0.38, g);
    rim.rotation.x = Math.PI / 2;
  }
  // share / options / PS button
  for (const sx of [-1, 1]) { const b = rbox(0.08, 0.05, 0.2, 0.03, btn, sx * 0.86, topY + 0.01, -0.68, g); b.rotation.y = sx * 0.15; }
  cyl(0.1, 0.1, 0.05, std(0x2a2d33, 0.35), 0, topY + 0.02, 0.18, g, 20);
  const setOn = on => { lightBar.material.emissiveIntensity = on ? 2.2 : 0; };
  return { group: g, setOn, antenna: V(0, topY - 0.05, -1.05) };
}

/* ------------------------------------------------------------------ bench props (decor, not clickable) */
export function buildSolderSpool() {
  const g = new THREE.Group();
  const flange = std(0x1d4f9a, 0.5);
  for (const y of [mm(1), mm(29)]) cyl(mm(27), mm(27), mm(2), flange, 0, y, 0, g, 36);
  cyl(mm(22), mm(22), mm(26), metal(0xc3c7cd, 0.42), 0, mm(15), 0, g, 40);
  cyl(mm(8), mm(8), mm(30.2), std(0x101215, 0.5), 0, mm(15), 0, g, 20);
  return g;
}
export function buildMultimeter() {
  const g = new THREE.Group();
  rbox(mm(92), mm(32), mm(182), mm(8), std(0xe0b81f, 0.62), 0, mm(16), 0, g);                 // rubber holster
  rbox(mm(80), mm(6), mm(165), mm(4), std(0x2a2c31, 0.5), 0, mm(31), 0, g);                   // face
  const lcdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: TX.lcdTexture(), roughness: 0.25 });
  const lcd = glow(mesh(new THREE.BoxGeometry(mm(60), mm(1), mm(34)), [lcdMat, lcdMat, lcdMat, lcdMat, lcdMat, lcdMat], 0, mm(34.3), mm(-50), g));
  cyl(mm(22), mm(22), mm(5), std(0x16171a, 0.5), 0, mm(35.5), mm(8), g, 32);                 // rotary dial
  box(mm(6), mm(2), mm(30), std(0xdedede, 0.5), 0, mm(38.6), mm(8), g);
  for (const [x, c] of [[-24, 0x1a1a1a], [0, 0x1a1a1a], [24, 0xc0201a]])
    cyl(mm(4.5), mm(4.5), mm(3), std(c, 0.45), mm(x), mm(35), mm(66), g, 16);
  return { group: g, lcd };
}
