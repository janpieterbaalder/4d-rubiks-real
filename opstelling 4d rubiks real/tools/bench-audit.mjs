/* ============================================================================
   tools/bench-audit.mjs — exact checks of the 3D workbench wiring, run inside the page
   (hardware.html?debug) by tools/smoke.mjs. Each function is self-contained, because
   Playwright serialises it into the browser.

   geometryAudit()  every wire (a tube of radius r) against every solid: all bench parts, the
                    breadboard, every dupont housing, the ESD mat, the bench top and the rig frame
                    (pole, six rods, foot). Near its own ends a wire may enter the part it plugs
                    into; in a breadboard hole only the hole itself. Returns a list of collisions.
   breadboardNets() which breadboard strip every ESP32 pin, 74AHCT125 leg, 330Ω leg and wire end
                    sits in, read from the 3D geometry, with the pin names of the ESP32-DevKitC V4
                    (J2/J3) and the 74AHCT125 datasheet. Returns { strips, errors }.
   ========================================================================== */

export function geometryAudit() {
  const B = window.__bench, scene = B.stage.scene;
  const Box3 = B.bbBox.constructor, Vec3 = B.bbBox.min.constructor;
  const solids = [];
  const add = (mesh, owner, what) => {
    const b = new Box3().setFromObject(mesh, true);
    if (!b.isEmpty()) solids.push({ kind: 'box', b, owner, what: what || mesh.geometry.type });
  };
  for (const [id, g] of Object.entries(B.PART_GROUP)) { if (id !== 'rig') g.traverse(o => { if (o.isMesh) add(o, id); }); }
  B.bbGroup.traverse(o => { if (o.isMesh) add(o, 'bb', 'breadboard'); });
  scene.traverse(o => { if (o.isMesh && o.userData.dupont) add(o, 'dupont', o.userData.dupont); });
  const M = B.MAT, BE = B.BENCH;
  solids.push({ kind: 'box', owner: 'mat', what: 'ESD-mat', b: new Box3(new Vec3(M.X - M.W / 2, 0, M.Z - M.D / 2), new Vec3(M.X + M.W / 2, B.MAT_TOP, M.Z + M.D / 2)) });
  solids.push({ kind: 'box', owner: 'bench', what: 'werkbankblad', b: new Box3(new Vec3(-BE.W / 2, -BE.THICK, BE.Z0 - BE.D / 2), new Vec3(BE.W / 2, 0, BE.Z0 + BE.D / 2)) });
  // rig frame: pole + rods as exact cylinders, the foot (rubber ring, disc, dome) analytically
  const R = B.RIG, O = R.OFFSET;
  const cyl = (a, b, r, what) => solids.push({ kind: 'cyl', a, b, r, owner: 'rig', what });
  cyl(new Vec3(O.x, 0.9, O.z), new Vec3(O.x, O.y - R.D, O.z), 0.065, 'paal');
  for (const [n, d] of [['R', [1, 0, 0]], ['L', [-1, 0, 0]], ['U', [0, 1, 0]], ['D', [0, -1, 0]], ['F', [0, 0, 1]], ['B', [0, 0, -1]]])
    cyl(O.clone(), O.clone().add(new Vec3(...d).multiplyScalar(R.D)), 0.045, 'staaf ' + n);
  const sdf = (so, p) => {
    if (so.kind === 'box') return so.b.distanceToPoint(p);
    const ab = so.b.clone().sub(so.a), len = ab.length(), u = ab.divideScalar(len);
    const ap = p.clone().sub(so.a), t = ap.dot(u), rad = ap.sub(u.multiplyScalar(t)).length();
    const ax = t < 0 ? -t : (t > len ? t - len : 0), rr = Math.max(0, rad - so.r);
    return ax > 0 ? Math.hypot(ax, rr) : rr;
  };
  const foot = p => {                       // depth inside the foot (> 0) or nothing
    const rad = Math.hypot(p.x - O.x, p.z - O.z), out = [];
    if (p.y <= 0.04 && rad <= 2.28) out.push(['rubberrand', 0]);
    if (p.y >= 0.02 && p.y <= 0.4) { const rr = 2.3 - (p.y - 0.02) / 0.38 * 0.6; if (rad <= rr) out.push(['voetschijf', rr - rad]); }
    if (p.y >= 0.4) { const q = (rad / 1.7) ** 2 + ((p.y - 0.4) / 0.544) ** 2; if (q <= 1) out.push(['koepel', 1 - q]); }
    return out;
  };
  const isHole = (part, name) => { const t = B.TERM[part]?.[name]; return !!(t && !Array.isArray(t) && t.hole); };
  const tubes = [];
  for (const w of B.wires) {
    if (w.type === 'bt') continue;
    const [pa, ta, pb, tb] = w.conn;
    tubes.push({ key: `${pa}.${ta}>${pb}.${tb}`, curve: w.curve, r: w.mesh.geometry.parameters.radius,
      ends: [{ part: pa, hole: isHole(pa, ta) }, { part: pb, hole: isHole(pb, tb) }] });
  }
  let nd = 0;
  scene.traverse(o => { if (o.isMesh && o.userData.deco) tubes.push({ key: 'decoratief#' + (nd++), curve: o.geometry.parameters.path, r: o.geometry.parameters.radius, ends: [{ part: '*' }, { part: '*' }] }); });
  const TOL = 0.002, END = 0.12, bbTop = B.bbBox.max.y, out = [];
  for (const t of tubes) {
    const L = t.curve.getLength(), N = Math.max(300, Math.ceil(L / 0.006)), worst = new Map();
    const hit = (k, depth, p) => { const c = worst.get(k); if (!c || depth > c.depth) worst.set(k, { depth, p }); };
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * L, p = t.curve.getPointAt(i / N);
      const e = s < END ? t.ends[0] : (L - s < END ? t.ends[1] : null);
      for (const so of solids) {
        if (so.owner === 'dupont' && so.what === t.key && (s < 0.4 || L - s < 0.4)) continue;      // its own housing
        if (e && !e.hole && (e.part === '*' || so.owner === e.part)) continue;                       // plugged into it
        if (e && e.hole && so.owner === 'bb') {                                                     // in a breadboard hole
          if (p.y < bbTop - 1e-3 && s > 0.004 && L - s > 0.004) hit('breadboard (onder het oppervlak)', bbTop - p.y, p);
          continue;
        }
        const d = sdf(so, p);
        if (d < t.r - TOL) hit(`${so.owner} / ${so.what}`, t.r - d, p);
      }
      for (const [what, depth] of foot(p)) hit('rig / ' + what, t.r + depth, p);
    }
    for (const [k, v] of worst) out.push(`${t.key} door ${k}: ${(v.depth * 40).toFixed(2)} mm bij (${v.p.x.toFixed(2)}, ${v.p.y.toFixed(2)}, ${v.p.z.toFixed(2)})`);
  }
  return out;
}

export function breadboardNets() {
  const B = window.__bench, scene = B.stage.scene, bb = B.bbGroup;
  // Espressif ESP32-DevKitC V4 headers, pin 1 at the antenna end; 74AHCT125 (DIP-14) datasheet
  const J2 = ['3V3', 'EN', 'IO36', 'IO39', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'IO9', 'IO10', 'IO11', '5V'];
  const J3 = ['GND', 'IO23', 'IO22', 'IO1', 'IO3', 'IO21', 'GND', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'IO8', 'IO7', 'IO6'];
  const CHIP = ['1OE', '1A', '1Y', '2OE', '2A', '2Y', 'GND', '3Y', '3A', '3OE', '4Y', '4A', '4OE', 'VCC'];
  const ROW = { j: 10.6, i: 13.14, h: 15.68, g: 18.22, f: 20.76, e: 28.38, d: 30.92, c: 33.46, b: 36.0, a: 38.54 };
  const errors = [], strips = {};
  const put = (p, label) => {                   // world point -> hole; printed column numbers start at 1
    const l = bb.worldToLocal(p.clone()), xmm = l.x * 40 + 165.1 / 2, zmm = l.z * 40 + 54.6 / 2;
    const c = (xmm - 4.0) / 2.54, col = Math.round(c) + 1;
    let row = 'j'; for (const k in ROW) if (Math.abs(ROW[k] - zmm) < Math.abs(ROW[row] - zmm)) row = k;
    const off = Math.hypot((c - (col - 1)) * 2.54, ROW[row] - zmm);
    if (off > 0.05) errors.push(`${label}: ${off.toFixed(2)} mm naast gat ${col}${row}`);
    ((strips[('fghij'.includes(row) ? 'achter-' : 'voor-') + col]) ||= []).push(label);
  };
  const wp = o => o.getWorldPosition(o.position.clone());
  const meshes = (id, f) => { const a = []; B.PART_GROUP[id].traverse(o => { if (o.isMesh && f(o)) a.push(wp(o)); }); return a; };
  const split = (pts, byX) => { const m = pts.reduce((s, p) => s + p.z, 0) / pts.length; return [pts.filter(p => p.z < m), pts.filter(p => p.z > m)].map(a => a.sort(byX)); };
  const [j2, j3] = split(meshes('esp', o => o.geometry.type === 'ConeGeometry'), (a, b) => b.x - a.x);   // solder joints
  j2.forEach((p, k) => put(p, `ESP32 ${J2[k]}`)); j3.forEach((p, k) => put(p, `ESP32 J3 ${J3[k]}`));
  if (j2.length !== 19 || j3.length !== 19) errors.push(`ESP32: ${j2.length}+${j3.length} pinnen i.p.v. 19+19`);
  const legs = meshes('lvl', o => o.geometry.type === 'BoxGeometry' && Math.abs(o.geometry.parameters.depth - 0.25 / 40) < 1e-6);
  const [lb, lf] = split(legs, (a, b) => b.x - a.x);
  lb.forEach((p, k) => put(p, `74AHCT125 ${k + 1} ${CHIP[k]}`)); lf.reverse().forEach((p, k) => put(p, `74AHCT125 ${k + 8} ${CHIP[k + 7]}`));
  if (legs.length !== 14) errors.push(`74AHCT125: ${legs.length} poten i.p.v. 14`);
  meshes('res', o => o.geometry.type === 'CylinderGeometry' && o.rotation.z === 0).sort((a, b) => a.x - b.x).forEach((p, k) => put(p, `330Ω poot ${k + 1}`));
  for (const w of B.wires) {
    if (w.type === 'bt') continue;
    const [pa, ta, pb, tb] = w.conn, key = `${pa}.${ta}>${pb}.${tb}`;
    const tA = B.TERM[pa][ta], tB = B.TERM[pb][tb];
    if (tA && !Array.isArray(tA) && tA.hole) put(w.curve.getPoint(0), `draad ${key}`);
    if (tB && !Array.isArray(tB) && tB.hole) put(w.curve.getPoint(1), `draad ${key}`);
  }
  scene.traverse(o => { if (o.isMesh && o.userData.deco === 'jumper') { const c = o.geometry.parameters.path; put(c.getPoint(0), 'jumper 1OE-GND'); put(c.getPoint(1), 'jumper 1OE-GND'); } });
  return { strips, errors };
}
