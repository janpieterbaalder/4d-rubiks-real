/* ============================================================================
   bench/stage.js — the realistic "stage" for the 3D bench: renderer, camera, controls,
   physically based lighting, a studio reflection map, the workshop room (concrete floor,
   walls, pegboard, overhead shop light), the workbench + ESD mat, and post-processing
   (HDR bloom so the leds really glow, output tone mapping, a subtle lens vignette).

   Scale: 1 scene unit = 4 cm (estimate: an led-cubie pitch of ~25 mm, so one 3x3x3 cell is
   ~7.5 cm and the whole rig ~50 cm tall). The bench top is the plane y = 0.

   Two quality levels: 'hoog' (bloom, soft shadows, coloured light spill from the leds) and
   'laag' (direct render, no shadows/spill) for weak GPUs/phones. Auto-picked on first visit,
   the user's choice is remembered (localStorage, optional).
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js?v=11';   // same URL as hardware.js imports (one module instance)

// workbench + room dimensions (scene units, 1 u = 4 cm)
export const BENCH = { W: 44, D: 21, Z0: -0.5, THICK: 1.0, HEIGHT: 22.5 };
export const ROOM = { FLOOR: -BENCH.HEIGHT, BACK: -14.5, LEFT: -38, RIGHT: 46, FRONT: 60 };
export const MAT = { X: 0.5, Z: 4.0, W: 21, D: 9.5 };   // ESD mat on the bench (centre x/z, size)

const QUALITY_KEY = 'bench.quality';
function autoQuality() {
  try { const q = localStorage.getItem(QUALITY_KEY); if (q === 'hoog' || q === 'laag') return q; } catch (e) { /* storage off */ }
  const small = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return small || weak ? 'laag' : 'hoog';
}

// --- a dark product-photography "studio" for reflections: a few soft panels in a dim room.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(80, 40, 80),
    new THREE.MeshBasicMaterial({ color: 0x15181d, side: THREE.BackSide }));
  room.position.y = 12; env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x24211d }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -7.9; env.add(floor);
  const panel = (w, h, pos, look, hex, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.copy(pos); m.lookAt(look); env.add(m);
  };
  panel(26, 5, new THREE.Vector3(0, 30, -2), new THREE.Vector3(0, 0, -2), 0xfff0dc, 7.0);   // overhead shop light
  panel(5, 18, new THREE.Vector3(-36, 12, 6), new THREE.Vector3(0, 6, 6), 0xd9e6ff, 2.4);  // cool side window
  panel(14, 6, new THREE.Vector3(20, 10, 34), new THREE.Vector3(0, 4, 0), 0xffd1a0, 1.6);  // warm room bounce
  panel(30, 3, new THREE.Vector3(0, 4, -38), new THREE.Vector3(0, 4, 0), 0x8aa0c0, 0.7);   // back wall glow
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

// subtle lens vignette (applied after tone mapping, in display space)
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = length((vUv - 0.5) * vec2(1.15, 1.0));
      c.rgb *= 1.0 - strength * smoothstep(0.35, 0.85, d); gl_FragColor = c; }`,
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Khronos PBR Neutral keeps the 8 game colours saturated and true (AgX/ACES washed them out)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;              // nothing that casts shadows moves: update on demand
  TX.setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const BG = 0x0c0e12;
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 55, 150);
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 0.8;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.04, 320);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.1;
  controls.rotateSpeed = 0.9;
  controls.zoomSpeed = 1.15;
  controls.minDistance = 0.35;
  controls.maxDistance = 110;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

  // ---------------------------------------------------------------- lights
  RectAreaLightUniformsLib.init();
  const area = new THREE.RectAreaLight(0xfff0dc, 2.4, 24, 2.0);          // the overhead LED shop light
  area.position.set(0, 29.6, -1.5); area.lookAt(0, 0, -1.5); scene.add(area);
  const key = new THREE.DirectionalLight(0xfff3e4, 1.35);                 // same source, casting the shadows
  key.position.set(7, 38, 15); key.target.position.set(0, 0, -2);
  key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -27, right: 27, top: 24, bottom: -24, near: 8, far: 85 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025; key.shadow.radius = 4;
  scene.add(key, key.target);
  const fill = new THREE.HemisphereLight(0x9fb3d1, 0x2b2118, 0.32);
  scene.add(fill);
  const rim = new THREE.SpotLight(0xa9c4ff, 18, 70, 0.55, 0.8, 1.6);      // cool back light: separates rig from wall
  rim.position.set(-14, 22, -13); rim.target.position.set(0, 6, -4); scene.add(rim, rim.target);

  // ---------------------------------------------------------------- room
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220),
    std({ map: TX.concreteTexture(), color: 0x8a8a8c, roughness: 0.82, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = ROOM.FLOOR; floor.receiveShadow = true; scene.add(floor);
  const wallMat = std({ map: TX.wallTexture(), color: 0x9a9ea6, roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), wallMat);
  back.position.set(0, ROOM.FLOOR + 40, ROOM.BACK); back.receiveShadow = true; scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(160, 80), wallMat);
  left.rotation.y = Math.PI / 2; left.position.set(ROOM.LEFT, ROOM.FLOOR + 40, 20); left.receiveShadow = true; scene.add(left);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(200, 1.2, 0.3), std({ color: 0x2a2c31, roughness: 0.6 }));
  skirting.position.set(0, ROOM.FLOOR + 0.6, ROOM.BACK + 0.15); scene.add(skirting);

  // pegboard behind the bench (with a slim wooden frame)
  const peg = new THREE.Mesh(new THREE.BoxGeometry(34, 17, 0.25),
    [std({ color: 0x5a4430 }), std({ color: 0x5a4430 }), std({ color: 0x5a4430 }), std({ color: 0x5a4430 }),
     std({ map: TX.pegboardTexture(), roughness: 0.88 }), std({ color: 0x3a2c1f })]);
  peg.position.set(0, 10.5, ROOM.BACK + 0.35); peg.receiveShadow = true; scene.add(peg);
  const frameMat = std({ color: 0x7b5a3a, roughness: 0.7 });
  for (const [w, h, x, y] of [[34.8, 0.4, 0, 19.2], [34.8, 0.4, 0, 1.8], [0.4, 17.4, -17.2, 10.5], [0.4, 17.4, 17.2, 10.5]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), frameMat);
    f.position.set(x, y, ROOM.BACK + 0.45); f.castShadow = f.receiveShadow = true; scene.add(f);
  }

  // overhead shop-light fixture (what the area light "is")
  const fixture = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(25, 0.5, 2.4), std({ color: 0xd9dcdf, roughness: 0.45, metalness: 0.6 }));
  const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(24, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff0dc, emissiveIntensity: 3.2 }));
  diffuser.rotation.x = Math.PI / 2; diffuser.position.y = -0.26;
  fixture.add(housing, diffuser);
  for (const sx of [-10, 10]) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 12, 6), std({ color: 0x777b80, metalness: 0.8, roughness: 0.4 }));
    wire.position.set(sx, 6, 0); fixture.add(wire);
  }
  fixture.position.set(0, 29.9, -1.5); scene.add(fixture);

  // ---------------------------------------------------------------- workbench
  const bench = new THREE.Group();
  const woodTop = std({ map: TX.woodTexture(), roughness: 0.52, metalness: 0 });
  const woodSide = std({ color: 0x8c6440, roughness: 0.6 });
  const top = new THREE.Mesh(new RoundedBoxGeometry(BENCH.W, BENCH.THICK, BENCH.D, 3, 0.12),
    [woodSide, woodSide, woodTop, woodSide, woodSide, woodSide]);
  top.position.set(0, -BENCH.THICK / 2, BENCH.Z0); top.receiveShadow = true; top.castShadow = true; bench.add(top);
  const steel = std({ color: 0x2b2f35, roughness: 0.5, metalness: 0.65 });
  const legH = BENCH.HEIGHT - BENCH.THICK;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, legH, 1.4), steel);
    leg.position.set(sx * (BENCH.W / 2 - 1.3), -BENCH.THICK - legH / 2, BENCH.Z0 + sz * (BENCH.D / 2 - 1.3));
    leg.castShadow = leg.receiveShadow = true; bench.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.35, 16), std({ color: 0x111214, roughness: 0.9 }));
    foot.position.set(leg.position.x, ROOM.FLOOR + 0.17, leg.position.z); bench.add(foot);
  }
  const rail = (w, d, x, z) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), steel);
    r.position.set(x, -BENCH.THICK - 1.0, z); r.castShadow = true; bench.add(r);
  };
  rail(BENCH.W - 2.6, 1.0, 0, BENCH.Z0 + BENCH.D / 2 - 1.3); rail(BENCH.W - 2.6, 1.0, 0, BENCH.Z0 - BENCH.D / 2 + 1.3);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(BENCH.W - 2.8, 0.6, BENCH.D - 2.8), std({ color: 0x6d5236, roughness: 0.75 }));
  shelf.position.set(0, ROOM.FLOOR + 4.2, BENCH.Z0); shelf.castShadow = shelf.receiveShadow = true; bench.add(shelf);
  scene.add(bench);

  // ESD mat with its grounding stud
  const mat = new THREE.Mesh(new RoundedBoxGeometry(MAT.W, 0.06, MAT.D, 2, 0.025),
    std({ map: TX.matTexture(), roughness: 0.92, metalness: 0 }));
  mat.position.set(MAT.X, 0.03, MAT.Z); mat.receiveShadow = true; scene.add(mat);
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.09, 20), std({ color: 0xc9ccd1, metalness: 1, roughness: 0.3 }));
  stud.position.set(MAT.X - MAT.W / 2 + 0.6, 0.08, MAT.Z - MAT.D / 2 + 0.6); scene.add(stud);

  // ---------------------------------------------------------------- post-processing
  const size = new THREE.Vector2();
  const composerRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, composerRT);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.38, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const vignette = new ShaderPass(VignetteShader);
  composer.addPass(vignette);

  // ---------------------------------------------------------------- quality + sizing
  const stage = {
    renderer, scene, camera, controls, key, area, composer, bloom,
    quality: autoQuality(),
    shadowsDirty: true,
    requestShadowUpdate() { this.shadowsDirty = true; },
    setQuality(q, remember = true) {
      this.quality = q;
      if (remember) { try { localStorage.setItem(QUALITY_KEY, q); } catch (e) { /* storage off */ } }
      const high = q === 'hoog';
      if (renderer.shadowMap.enabled !== high) {
        renderer.shadowMap.enabled = high;
        scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
      }
      key.shadow.mapSize.set(2048, 2048);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      this.shadowsDirty = true;
      this.resize();
    },
    resize() {
      const w = innerWidth, h = innerHeight;
      const pr = this.quality === 'hoog' ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    },
    // keep the camera inside the room and above the floor
    clampCamera() {
      const p = camera.position;
      p.y = Math.max(p.y, ROOM.FLOOR + 1.0);
      p.z = Math.max(p.z, ROOM.BACK + 0.8);
      p.x = Math.max(p.x, ROOM.LEFT + 0.8);
    },
    render() {
      if (this.shadowsDirty && renderer.shadowMap.enabled) { renderer.shadowMap.needsUpdate = true; this.shadowsDirty = false; }
      if (this.quality === 'hoog') composer.render();
      else renderer.render(scene, camera);
    },
    getSize(v = size) { return renderer.getSize(v); },
  };
  stage.setQuality(stage.quality, false);
  addEventListener('resize', () => stage.resize());
  return stage;
}
