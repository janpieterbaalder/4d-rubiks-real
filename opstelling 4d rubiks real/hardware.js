/* ============================================================================
   hardware.js — interactive 3D "hardware bench" + PLAYABLE game in one scene.
   ----------------------------------------------------------------------------
   TWO functions cooperate in the same 3D world, so this is a true simulation of
   the installation:
     1. HARDWARE — the real electronics: Arduino Mega, 5V supply, a USB Host Shield
        carrying a Bluetooth dongle + wireless PS3 controller, resistor + capacitor,
        on/off switch and the 189-WS2812B led rig.
        Click any part for an info panel + exact wiring (one CONNECTIONS table is
        the single source of truth and matches BEDRADING.md).
     2. SOFTWARE — the actual 4D-Rubiks game runs on those same led meshes. Drive
        it with the on-screen PS3 controller (or click a cell / use the keyboard); the
        ledjes inside the translucent white cells RECOLOUR correctly on every turn
        via the verified engine + the permutation-wave animation (1:1 with WS2812).

   The cells sit far apart (like the Blender model) so you can follow the wiring,
   and each cell is a white, slightly transparent housing with the ledjes visible
   inside. Nothing moves mechanically — a "turn" only changes led COLOURS.
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tesseract, COLORS, CELL_LABEL, AXN, ORIENT } from './engine.js?v=4';

// ---- wire categories (colour + human label) ---------------------------------
const WIRE = {
  pwr: { color: 0xff5a4d, label: '+5V (stroom +)' },
  gnd: { color: 0x9aa6bf, label: 'GND (massa / −)' },
  data:{ color: 0xffd23d, label: 'Data → leds' },
  spi: { color: 0x36c7ff, label: 'SPI / INT / SS (shield ↔ Mega)' },
  usb: { color: 0x57e08a, label: 'USB (dongle in de shield)' },
  bt:  { color: 0xc77bff, label: 'Bluetooth (draadloos)' },
};

/* ============================================================================
   THE WIRING TABLE — single source of truth.
   Each row: [ fromPart, fromTerminal, toPart, toTerminal, category, note ]
   ========================================================================== */
const CONNECTIONS = [
  // --- power backbone: PSU -> switch -> (Mega logic + led rig) ---
  ['psu','+5V', 'sw','in',     'pwr', 'voeding naar aan/uit-schakelaar'],
  ['sw','out',  'mega','5Vin', 'pwr', '5V naar de Arduino (logica)'],
  ['sw','out',  'rig','5V',    'pwr', '5V naar de leds — dikke draad!'],
  ['psu','GND', 'mega','GNDin','gnd', 'gemeenschappelijke massa'],
  ['psu','GND', 'rig','GND',   'gnd', 'massa naar de leds — dikke draad!'],

  // --- data line: Mega D6 -> 330Ω -> first led ---
  ['mega','D6', 'res','in',  'data', 'datapin'],
  ['res','out', 'rig','DIN', 'data', '330Ω vlak vóór de eerste led'],

  // --- decoupling capacitor across the led rail near DIN ---
  ['cap','+',   'rig','5V',  'pwr', '1000µF buffer (+ op 5V)'],
  ['cap','-',   'rig','GND', 'gnd', '1000µF buffer (− op GND)'],

  // --- USB Host Shield: stacks on the Mega (SPI via ICSP + INT/SS + power) ---
  ['mega','5Vout','ush','5V', 'pwr','shield klikt op de Mega (stapelheaders)'],
  ['mega','GND',  'ush','GND','gnd',''],
  ['mega','SPI',  'ush','SPI','spi','SPI via ICSP-header: MISO 50 · MOSI 51 · SCK 52'],
  ['mega','D9',   'ush','INT','spi','INT — interrupt van de MAX3421E'],
  ['mega','D10',  'ush','SS', 'spi','SS — slave-select (SPI)'],

  // --- Bluetooth: dongle in the shield's USB port, controller over the air ---
  ['ush','USB',    'dongle','USB','usb','USB-Bluetooth-dongle in de USB-A-poort'],
  ['dongle','BT',  'ps3','BT',    'bt', 'Bluetooth (HID) — draadloos, koppelen via PS3BT'],

  // --- power injection: feed 5V/GND straight from the PSU into far cubes ---
  ['sw','out',  'rig','INJ_R','pwr','power-injectie rechter arm'],
  ['psu','GND', 'rig','INJ_R','gnd',''],
  ['sw','out',  'rig','INJ_U','pwr','power-injectie bovenste arm'],
  ['psu','GND', 'rig','INJ_U','gnd',''],
  ['sw','out',  'rig','INJ_B','pwr','power-injectie achterste arm'],
  ['psu','GND', 'rig','INJ_B','gnd',''],
];

/* ============================================================================
   INFO — what each part is + why. The "Aansluiting" table is generated from
   CONNECTIONS, so it can never drift from the wires you see in 3D.
   ========================================================================== */
const INFO = {
  mega: {
    name: 'Arduino Mega 2560', tag: 'De microcontroller — het brein', color: '#11998e',
    html: `<p><b>Wat:</b> een microcontroller-bordje dat het hele spel uitrekent en alles
      aanstuurt. Het draait jouw firmware (de C++-versie van de engine), leest de 3 joysticks,
      schrijft naar het scherm en stuurt de 189 leds aan.</p>
      <p><b>Waarom de Mega</b> en niet een Uno? De Mega heeft genoeg geheugen (8 KB RAM — de
      puzzel kost ~2 KB) én <b>16 analoge pinnen</b> (je hebt er 6 nodig voor de joysticks) én
      werkt op <b>5V-logica</b>. Dat laatste is goud waard: de WS2812-leds willen een 5V-
      datasignaal, dus de Mega stuurt ze <b>rechtstreeks</b> aan — <u>geen levelshifter nodig</u>.</p>`,
    notes: [['','Alternatief: een ESP32 is sneller en compacter, maar werkt op 3,3V. Dan heb je wél een levelshifter op de datalijn nodig (zie BEDRADING.md).']],
  },
  psu: {
    name: '5V voeding (≈10A)', tag: 'Aparte stroombron voor de leds', color: '#ff5a4d',
    html: `<p><b>Wat:</b> een 5V-netvoeding (schakelende voeding / "brick"). Levert de stroom
      voor de 189 leds <i>en</i> voor de Arduino.</p>
      <p><b>Waarom apart, niet via USB?</b> 189 WS2812B op vol wit trekken theoretisch ~11A.
      In de praktijk (verzadigde kleuren, gedimd) eerder 3–6A, maar de USB-poort van je laptop
      levert maar ~0,5A. Daarom een eigen 5V/10A-voeding. <b>Reken op minimaal 5V/6A</b>, met
      marge 5V/10A.</p>
      <p><b>Cruciaal:</b> de massa (GND) van de voeding, de Arduino én de leds moet je
      <b>aan elkaar knopen</b> (gemeenschappelijke GND). Zonder die gedeelde massa "zweeft" het
      datasignaal en gaan de leds willekeurig knipperen.</p>`,
    notes: [['warn','Sluit nooit tegelijk USB én de 5V-pin van de Mega op deze voeding aan zonder na te denken — zie de uitleg bij de Aan/uit-schakelaar.']],
  },
  sw: {
    name: 'Aan/uit-schakelaar', tag: 'Onderbreekt de 5V-lijn', color: '#ffd23d',
    html: `<p><b>Wat:</b> een stevige schakelaar (of relais) in de <b>plus-draad (5V)</b>
      tussen de voeding en de rest. Hij moet de hele led-stroom kunnen dragen → kies er een
      voor <b>minstens 10A</b> (een rocker-switch of een MOSFET-module).</p>
      <p><b>Tip:</b> tijdens het ontwikkelen voed je de Mega via USB (programmeren) en laat je
      de 5V-pin los; de leds krijgen hun stroom van de voeding. Voor een zelfstandige opstelling
      voer je 5V naar de 5V-pin van de Mega — maar dan USB eraf.</p>`,
  },
  res: {
    name: '330Ω weerstand (data)', tag: 'Beschermt de eerste led', color: '#ffd23d',
    html: `<p><b>Wat:</b> één weerstandje van ±330Ω in serie in de <b>datadraad</b>, zo dicht
      mogelijk bij de <b>eerste</b> led (DIN). Hij dempt scherpe spanningspieken (reflecties)
      op de datalijn en beschermt zo de dataingang van led #1.</p>
      <p>Klein onderdeel, groot effect op betrouwbaarheid. Waarden van 220–470Ω zijn prima.</p>`,
  },
  cap: {
    name: '1000µF condensator', tag: 'Stroombuffer bij de leds', color: '#ff5a4d',
    html: `<p><b>Wat:</b> een grote elektrolytische condensator (≥1000µF, ≥6,3V) <b>parallel</b>
      over 5V en GND, vlak bij waar de stroom de led-keten binnenkomt. Hij vangt de plotselinge
      stroompieken op als veel leds tegelijk aanspringen, zodat de eerste leds niet "dippen".</p>
      <p><b>Let op de polariteit:</b> de gemarkeerde poot (−, streep op de behuizing) gaat naar
      GND, de andere naar +5V. Verkeerd om kan hij klappen.</p>`,
    notes: [['warn','Elco\'s zijn gepolariseerd: − (streep) naar massa, + naar 5V.']],
  },
  ush: {
    name: 'USB Host Shield 2.0', tag: 'MAX3421E — maakt de Mega een USB-host', color: '#36c7ff',
    html: `<p><b>Wat:</b> een shield dat boven op de Mega klikt en de <b>MAX3421E</b>-chip bevat.
      Daarmee wordt de Arduino zélf een <b>USB-host</b> (hij stuurt nu een USB-apparaat aan in
      plaats van alleen geprogrammeerd te worden). Hier draagt hij de <b>Bluetooth-dongle</b>
      waarmee de draadloze PS3-controller praat.</p>
      <p><b>Aansluiting:</b> de shield stapelt op de Mega en gebruikt <b>SPI</b> (via de
      ICSP-header: MISO&nbsp;50 · MOSI&nbsp;51 · SCK&nbsp;52), plus <b>INT op D9</b> en
      <b>SS op D10</b>. Hij deelt 5V en GND met de Mega. De led-datapin <b>D6</b> en de
      stroomlijnen blijven vrij — geen conflict.</p>`,
    notes: [['warn','Timing: FastLED zet bij elke frame ~6 ms de interrupts uit (189 leds). Roep in de firmware tussen frames Usb.Task() aan en houd de refresh-rate laag, anders mist Bluetooth HID-rapporten.'],
      ['','Kies een shield die SPI via de ICSP-header voert — alléén dan werkt hij op de Mega (de oude Uno-layout met 11/12/13 niet).']],
  },
  dongle: {
    name: 'USB-Bluetooth-dongle', tag: 'Draadloze brug naar de controller', color: '#57e08a',
    html: `<p><b>Wat:</b> een kleine USB-Bluetooth-stick in de USB-A-poort van de shield.
      Hierover verbindt de PS3-controller draadloos (HID). Een <b>CSR-gebaseerde</b> dongle werkt
      het betrouwbaarst met de USB-Host-Shield-bibliotheek (klasse <code>PS3BT</code>).</p>
      <p><b>Eénmalig koppelen:</b> sluit de controller eerst met een USB-kabel aan en draai het
      <code>SetBdaddr</code>-hulpsketch — dat schrijft het Bluetooth-adres van de dongle in de
      controller. Daarna verbindt hij draadloos zodra je op de PS-knop drukt.</p>`,
    notes: [['','Bedraad blijft je terugval: zonder dongle werkt dezelfde controller via de klasse PS3USB rechtstreeks in de shield.']],
  },
  ps3: {
    name: 'PS3-controller (DualShock 3)', tag: 'Draadloze game-controller', color: '#c77bff',
    html: `<p><b>Wat:</b> de controller waarmee je speelt — dezelfde knoppen als de widget onderin.
      <b>D-pad</b> = de selectie horizontaal bewegen (x,y), <b>rechter knoppen</b> = een draaivlak
      kiezen, <b>linkerstick ←/→</b> = draairichting, <b>● linkerstick</b> = 4D-rotatie,
      <b>● rechterstick</b> = zet terug (undo), <b>SELECT/START</b> = husselen/reset.</p>
      <p><b>Verbinding:</b> draadloos via Bluetooth naar de dongle in de USB Host Shield. Opladen
      en de allereerste koppeling gaan via de USB-kabel.</p>`,
    notes: [['','De controller-widget onderin het scherm is een 1-op-1 spiegel van deze fysieke knoppen.']],
  },
  rig: {
    name: 'De 189 WS2812B-leds', tag: '7 kubussen × 27 = 189 (NeoPixel)', color: '#ff9e2c',
    html: `<p><b>Wat:</b> dit is je fysieke kubus uit het 3D-model — 7 doorschijnend-witte
      kubussen (midden + 6 armen), elk met 3×3×3 = 27 led-cellen. <b>Totaal 189 individueel
      adresseerbare WS2812B-leds</b> (NeoPixels).</p>
      <p><b>Slim eraan:</b> ze hangen in <b>één lange ketting</b> aan <u>één</u> datadraad. Elke
      led heeft een chip die "de eerste kleur voor mij houdt en de rest doorgeeft". Daarom is er
      maar <b>1 datapin</b> (D6) nodig voor alle 189.</p>
      <p><b>Speel hier ook echt:</b> klik op een ledje om een cel te kiezen, of gebruik de
      joysticks onderin. Bij een draai verschuiven alléén de <b>kleuren</b> (de cellen permuteren
      wiskundig) en loopt er een heldere golf in de draairichting — precies wat de WS2812 doet.</p>
      <p><b>Power-injectie:</b> omdat 5V over zo'n lange keten wegzakt, voer je 5V + GND op
      meerdere plekken bij (de rode/grijze takken naar de armen). Anders worden verre leds dof en
      kleurzweemt het wit.</p>`,
    notes: [['','Bedrading-volgorde van de leds: zie ORIENT in engine.js en het schema in BEDRADING.md — led-nummer 0..26 per kubus op een vaste plek, zodat de firmware-kleuren kloppen.'],
      ['','Zet onderin “🧵 Led-draad” aan: dan zie je hoe één datadraad alle 189 leds in serie rijgt — geel binnen een kubus, cyaan de sprong naar de volgende (volgorde C→R→L→U→D→F→B).']],
  },
};

const MENU = [
  ['Besturing', ['mega','ush']],
  ['Voeding', ['psu','sw','cap','res']],
  ['Invoer', ['ps3','dongle']],
  ['Uitvoer', ['rig']],
];

/* ============================================================================
   THREE.JS SCENE
   ========================================================================== */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1320');

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
const CAM0 = new THREE.Vector3(17, 13, 23);
const TARGET0 = new THREE.Vector3(0, 5, -4);
camera.position.copy(CAM0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(TARGET0);
// free movement through the space: orbit (drag), pan/verschuiven (right-drag / two-finger),
// zoom (scroll). Screen-space panning makes the pan feel like flying around the rig.
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 1.2;
controls.rotateSpeed = 0.95;
controls.zoomSpeed = 1.15;
controls.minDistance = 1.5;
controls.maxDistance = 180;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;   // look from any angle, incl. below
// middle mouse button (scroll-wheel press) + drag = pan through the space (left/right, up/down)
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

scene.add(new THREE.AmbientLight(0x6677aa, 1.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1); keyLight.position.set(8, 14, 10); scene.add(keyLight);
scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x202838, 0.6));

// workbench table
const table = new THREE.Mesh(
  new THREE.BoxGeometry(34, 0.5, 26),
  new THREE.MeshStandardMaterial({ color: 0x141a28, roughness: 0.95 }));
table.position.y = -0.25; scene.add(table);
const grid = new THREE.GridHelper(34, 34, 0x2a3550, 0x1c2436);
grid.position.y = 0.02; scene.add(grid);

// --------------------------------------------------------------- helpers
const TERM = {};        // TERM[partId][name] = THREE.Vector3 (world)
const PART_GROUP = {};  // partId -> THREE.Group
const ANCHOR = {};      // partId -> THREE.Vector3 (label anchor, world)
const partMeshes = [];  // for raycasting; each mesh.userData.part = id

function mat(color, opt = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opt.r ?? 0.6, metalness: opt.m ?? 0.1,
    emissive: opt.e ?? 0x000000, emissiveIntensity: opt.ei ?? 1, transparent: opt.t ?? false, opacity: opt.o ?? 1 });
}
function box(w, h, d, color, opt) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opt)); }
function registerPart(id, group, anchorLocal) {
  PART_GROUP[id] = group; group.userData.part = id;
  group.traverse(o => { if (o.isMesh) { o.userData.part = id; partMeshes.push(o); } });
  scene.add(group);
  scene.updateMatrixWorld(true);
  ANCHOR[id] = group.localToWorld((anchorLocal || new THREE.Vector3(0, 1, 0)).clone());
}
function term(id, name, localVec) {
  scene.updateMatrixWorld(true);
  (TERM[id] ||= {})[name] = PART_GROUP[id].localToWorld(localVec.clone());
}

// a tiny labelled pin strip (visual cue of connector rows)
function pinRow(n, spacing, color = 0x2b2b2b) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const p = box(0.12, 0.12, 0.12, color, { m: 0.7, r: 0.4 });
    p.position.x = (i - (n - 1) / 2) * spacing; g.add(p);
  }
  return g;
}

/* --------------------------------------------------------- build each part --- */

// --- Arduino Mega 2560 (teal PCB) ---
(function buildMega() {
  const g = new THREE.Group(); g.position.set(0, 0.45, 0.5);
  const pcb = box(6.2, 0.35, 4.0, 0x0c8074, { r: 0.5 }); g.add(pcb);
  const usb = box(0.9, 0.5, 1.0, 0xb7bcc6, { m: 0.7, r: 0.35 }); usb.position.set(-3.0, 0.25, -0.9); g.add(usb);
  const jack = box(0.9, 0.6, 0.9, 0x111319, { r: 0.4 }); jack.position.set(-3.0, 0.3, 0.7); g.add(jack);
  const chip = box(1.4, 0.18, 0.7, 0x15171c, { r: 0.5 }); chip.position.set(0.6, 0.27, 0); g.add(chip);
  const top = pinRow(18, 0.26, 0x1a1a1a); top.position.set(0.4, 0.36, -1.85); g.add(top);
  const bot = pinRow(18, 0.26, 0x1a1a1a); bot.position.set(0.4, 0.36, 1.85); g.add(bot);
  const anaR = pinRow(8, 0.26, 0x223); anaR.position.set(2.0, 0.36, 1.85); g.add(anaR);
  registerPart('mega', g, new THREE.Vector3(0, 0.9, 0));
  const Y = 0.2;
  term('mega', 'D6',    new THREE.Vector3(-2.4, Y, -1.85));
  term('mega', '5Vin',  new THREE.Vector3(-3.0, Y,  1.85));
  term('mega', 'GNDin', new THREE.Vector3(-2.5, Y,  1.85));
  term('mega', '5Vout', new THREE.Vector3(-1.6, Y,  1.85));
  term('mega', 'GND',   new THREE.Vector3(-1.1, Y,  1.85));
  term('mega', 'SDA',   new THREE.Vector3( 1.2, Y, -1.85));
  term('mega', 'SCL',   new THREE.Vector3( 1.6, Y, -1.85));
  const ax = ['A0','A1','A2','A3','A4','A5'];
  ax.forEach((a, i) => term('mega', a, new THREE.Vector3(3.0, Y, -1.3 + i * 0.5)));
  ['D22','D23','D24'].forEach((d, i) => term('mega', d, new THREE.Vector3(0.6 + i * 0.5, Y, 1.85)));
  // USB Host Shield interface: INT on D9, SS on D10 (top digital row), SPI via ICSP (centre)
  term('mega', 'D9',  new THREE.Vector3(-1.6, Y, -1.85));
  term('mega', 'D10', new THREE.Vector3(-1.1, Y, -1.85));
  term('mega', 'SPI', new THREE.Vector3( 1.6, Y,  0));
})();

// --- 5V power supply (silver brick) ---
(function buildPSU() {
  const g = new THREE.Group(); g.position.set(-11, 0.9, -3);
  const body = box(3.4, 1.6, 5.0, 0xbfc6d2, { m: 0.6, r: 0.4 }); g.add(body);
  const vents = box(3.0, 1.2, 0.05, 0x6b7280, { m: 0.5 }); vents.position.set(0, 0, 2.5); g.add(vents);
  const tb = box(2.6, 0.5, 0.7, 0x14181f, { r: 0.5 }); tb.position.set(0, 0.95, 2.0); g.add(tb);
  const tpos = box(0.4, 0.25, 0.4, 0xff5a4d, { e: 0x551007, ei: 0.5 }); tpos.position.set(-0.7, 1.25, 2.0); g.add(tpos);
  const tgnd = box(0.4, 0.25, 0.4, 0x222831); tgnd.position.set(0.7, 1.25, 2.0); g.add(tgnd);
  registerPart('psu', g, new THREE.Vector3(0, 1.3, 0));
  term('psu', '+5V', new THREE.Vector3(-0.7, 1.45, 2.0));
  term('psu', 'GND', new THREE.Vector3( 0.7, 1.45, 2.0));
})();

// --- on/off switch (inline on the 5V line) ---
(function buildSwitch() {
  const g = new THREE.Group(); g.position.set(-7.5, 0.65, 3.2);
  const base = box(1.2, 0.5, 1.2, 0x14181f, { r: 0.5 }); g.add(base);
  const rocker = box(0.8, 0.35, 0.6, 0xd8413a, { e: 0x4a0d08, ei: 0.4 }); rocker.position.set(0, 0.38, 0); rocker.rotation.x = -0.4; g.add(rocker);
  registerPart('sw', g, new THREE.Vector3(0, 1.0, 0));
  term('sw', 'in',  new THREE.Vector3(-0.6, 0.1, 0));
  term('sw', 'out', new THREE.Vector3( 0.6, 0.1, 0));
})();

// --- 330Ω resistor ---
(function buildResistor() {
  const g = new THREE.Group(); g.position.set(3.4, 0.45, -3.4);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 16), mat(0xe6d3a3, { r: 0.6 }));
  body.rotation.z = Math.PI / 2; g.add(body);
  [-0.5, 0.5, -0.35, 0.35].forEach((x, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.1, 16),
      mat([0xb5651d, 0x111111, 0xb5651d, 0xffd700][i], { r: 0.5 }));
    b.rotation.z = Math.PI / 2; b.position.x = x; g.add(b);
  });
  registerPart('res', g, new THREE.Vector3(0, 0.7, 0));
  term('res', 'in',  new THREE.Vector3(-0.8, 0, 0));
  term('res', 'out', new THREE.Vector3( 0.8, 0, 0));
})();

// --- 1000µF capacitor ---
(function buildCap() {
  const g = new THREE.Group(); g.position.set(4.8, 0.45, -2.4);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 20), mat(0x14181f, { r: 0.4, m: 0.3 }));
  can.position.y = 0.65; g.add(can);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.51, 1.3, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x9aa6bf, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }));
  stripe.position.y = 0.65; stripe.scale.x = 0.3; g.add(stripe);
  registerPart('cap', g, new THREE.Vector3(0, 1.6, 0));
  term('cap', '+', new THREE.Vector3(-0.18, 0.05, 0));
  term('cap', '-', new THREE.Vector3( 0.18, 0.05, 0));
})();

// --- USB Host Shield 2.0 (stacks on the Mega; carries the BT dongle) ---
(function buildUSBShield() {
  const g = new THREE.Group(); g.position.set(0, 1.5, 0.5);
  const board = box(5.4, 0.26, 3.5, 0x1c3f8f, { r: 0.5 }); g.add(board);
  const chip = box(1.0, 0.18, 1.0, 0x15171c, { r: 0.5 }); chip.position.set(0.4, 0.2, 0); g.add(chip);
  const usbA = box(1.1, 0.85, 1.3, 0xb7bcc6, { m: 0.7, r: 0.35 }); usbA.position.set(0, 0.1, 1.9); g.add(usbA);
  const usbHole = box(0.8, 0.45, 0.2, 0x05070c); usbHole.position.set(0, 0.12, 2.46); g.add(usbHole);
  // stacking header strips + standoff posts that plug down onto the Mega
  const h1 = pinRow(16, 0.3, 0x1a1a1a); h1.position.set(0, -0.18, -1.55); g.add(h1);
  const h2 = pinRow(16, 0.3, 0x1a1a1a); h2.position.set(0, -0.18, 1.55); g.add(h2);
  for (const [px, pz] of [[-2.4, -1.4], [2.4, -1.4], [-2.4, 1.4], [2.4, 1.4]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 10),
      mat(0x8893a8, { m: 0.5, r: 0.5 })); post.position.set(px, -0.52, pz); g.add(post);
  }
  registerPart('ush', g, new THREE.Vector3(0, 1.0, 0));
  term('ush', '5V',  new THREE.Vector3(-1.9, -0.2,  1.5));
  term('ush', 'GND', new THREE.Vector3(-1.4, -0.2,  1.5));
  term('ush', 'SPI', new THREE.Vector3( 1.5, -0.2,  0.0));
  term('ush', 'INT', new THREE.Vector3(-1.6, -0.2, -1.5));
  term('ush', 'SS',  new THREE.Vector3(-1.1, -0.2, -1.5));
  term('ush', 'USB', new THREE.Vector3( 0.0,  0.1,  1.95));
})();

// --- USB Bluetooth dongle (plugged into the shield's USB-A port) ---
(function buildDongle() {
  const g = new THREE.Group(); g.position.set(0, 1.6, 2.9);
  const bodyD = box(0.42, 0.3, 1.0, 0x101319, { r: 0.45 }); g.add(bodyD);
  const conn = box(0.36, 0.22, 0.5, 0xc6ccd6, { m: 0.7, r: 0.35 }); conn.position.set(0, 0, -0.65); g.add(conn);
  const ledD = box(0.08, 0.08, 0.08, 0x36c7ff, { e: 0x1a6fb0, ei: 1.6 }); ledD.position.set(0, 0.18, 0.35); g.add(ledD);
  registerPart('dongle', g, new THREE.Vector3(0, 0.8, 0));
  term('dongle', 'USB', new THREE.Vector3(0, 0,    -0.7));
  term('dongle', 'BT',  new THREE.Vector3(0, 0.12,  0.5));
})();

// --- wireless PS3 controller (DualShock 3) — the thing you actually hold ---
(function buildPS3hw() {
  const g = new THREE.Group(); g.position.set(0, 0.85, 8.2); g.rotation.x = -0.34;
  const C_BODY = 0x202736;
  const body = box(4.0, 0.62, 1.9, C_BODY, { r: 0.5 }); g.add(body);
  // twin grips splayed out like a DualShock
  for (const s of [-1, 1]) {
    const grip = box(1.15, 0.62, 1.7, C_BODY, { r: 0.5 });
    grip.position.set(s * 1.85, -0.04, 0.78); grip.rotation.y = -s * 0.5; g.add(grip);
  }
  const TOP = 0.34;
  // D-pad (left) — cyan, echoing the movement keys
  const dV = box(0.22, 0.1, 0.7, 0x36c7ff, { e: 0x1a6fb0, ei: 0.7 }); dV.position.set(-1.25, TOP, -0.1); g.add(dV);
  const dH = box(0.7, 0.1, 0.22, 0x36c7ff, { e: 0x1a6fb0, ei: 0.7 }); dH.position.set(-1.25, TOP, -0.1); g.add(dH);
  // face buttons (right) — colours match the on-screen rotation-plane buttons
  for (const [dx, dz, col] of [[0, -0.34, 0xffe03d], [0, 0.34, 0x2fd07a], [-0.34, 0, 0xc45cff], [0.34, 0, 0xff9e2c]]) {
    const fb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), mat(col, { e: col, ei: 0.6 }));
    fb.position.set(1.25 + dx, TOP + 0.04, -0.1 + dz); fb.scale.y = 0.6; g.add(fb);
  }
  // two thumbsticks
  for (const s of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.16, 16), mat(0x14181f, { r: 0.5 }));
    base.position.set(s * 0.55, TOP - 0.04, 0.5); g.add(base);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), mat(0x2a3550, { r: 0.4 }));
    knob.scale.y = 0.7; knob.position.set(s * 0.55, TOP + 0.06, 0.5); g.add(knob);
  }
  // SELECT / START, PS button, and the 4 player-LEDs
  for (const s of [-1, 1]) { const sb = box(0.26, 0.08, 0.16, 0x8a96ad); sb.position.set(s * 0.22, TOP, -0.08); g.add(sb); }
  const psl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), mat(0xdfe6f5, { e: 0x9fb0d0, ei: 0.8 }));
  psl.scale.y = 0.6; psl.position.set(0, TOP, 0.42); g.add(psl);
  for (let i = 0; i < 4; i++) {
    const pl = box(0.1, 0.05, 0.1, 0x36c7ff, { e: 0x1a6fb0, ei: i === 0 ? 1.6 : 0.4 });
    pl.position.set(-0.3 + i * 0.2, TOP + 0.02, -0.55); g.add(pl);
  }
  registerPart('ps3', g, new THREE.Vector3(0, 1.5, 0));
  term('ps3', 'BT', new THREE.Vector3(0, 0.6, -1.05));   // faces the dongle/Mega
})();

/* ============================================================================
   THE PLAYABLE RIG — 7 white translucent cells, far apart, ledjes inside.
   Same verified engine, ORIENT layout and permutation-wave as the firmware, on these meshes.
   ========================================================================== */
const puzzle = new Tesseract();

// cells spaced wide (like the Blender model) so the wiring reads clearly.
const RIG = { D: 4.3, S: 0.62, LED: 0.16, OFFSET: new THREE.Vector3(0, 7.4, -5.5) };
// engine slot -> view direction, in-scene cube centre (scaled by D), nl, and the PHYSICAL
// global nav lattice: `centre` = the cube's pos direction at ±3, so gcoord/cellAt use the
// SAME orientation as the real led layout (ORIENT) — navigation lands on the cell you see.
const SLOTS = {
  C: { view: 'W-', nl: 'midden', pos: [ 0, 0, 0],         centre: [ 0, 0, 0] },
  R: { view: 'X+', nl: 'rechts', pos: [ RIG.D, 0, 0],     centre: [ 3, 0, 0] },
  L: { view: 'X-', nl: 'links',  pos: [-RIG.D, 0, 0],     centre: [-3, 0, 0] },
  U: { view: 'Y+', nl: 'boven',  pos: [ 0, RIG.D, 0],     centre: [ 0, 3, 0] },
  D: { view: 'Y-', nl: 'onder',  pos: [ 0,-RIG.D, 0],     centre: [ 0,-3, 0] },
  B: { view: 'Z-', nl: 'noord',  pos: [ 0, 0,-RIG.D],     centre: [ 0, 0,-3] },
  F: { view: 'Z+', nl: 'zuid',   pos: [ 0, 0, RIG.D],     centre: [ 0, 0, 3] },
};
const SLOT_ORDER = ['C', 'R', 'L', 'U', 'D', 'F', 'B'];

const decodeVi = idx => [ (idx % 3) - 1, (Math.floor(idx / 3) % 3) - 1, Math.floor(idx / 9) - 1 ];
const POS_LABEL = ['kern', 'vlak', 'rand', 'hoek'];
const posLabelOf = idx => POS_LABEL[decodeVi(idx).filter(v => v !== 0).length];
const isCentreCell = s => { const [a, b, c] = decodeVi(s.idx); return a === 0 && b === 0 && c === 0; };

// brightness levels (emissive feel)
// gedimde basis zodat de geselecteerde cel (SEL_I) er duidelijk uitspringt
const BASE_I = 0.3, SEL_CUBE_I = 0.55, SEL_I = 1.7, OFF_I = 0.03;
const TWIST_MS = 2000;

const meshes = {};        // slot -> [27] led meshes (engine idx)
const allLeds = [];       // flat list for raycasting
const rigLeds = [];       // led meshes in TRUE strip order (slot*27 + idx) for the data wire
const chainPts = [];      // each led's local position, in strip order
const shells = [];        // translucent white cell housings
let chainGroup = null, chainPulse = null;

(function buildRig() {
  const g = new THREE.Group(); g.position.copy(RIG.OFFSET);
  const ledGeo = new THREE.SphereGeometry(RIG.LED, 14, 12);

  // ---- the physical frame (as in the Blender model): 6 rods linking the cubes to the centre,
  //      and the bottom (D) arm continuing down a pole into a round foot the whole rig rests on.
  const FRAME = 0x8893a8;                                   // brushed-metal grey
  const frameMat = () => mat(FRAME, { m: 0.55, r: 0.45 });
  const UPv = new THREE.Vector3(0, 1, 0);
  const rod = (from, to, r, seg = 16) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), seg), frameMat());
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(UPv, dir.clone().normalize());
    m.userData.shell = true; m.raycast = () => {}; g.add(m); return m;
  };
  // 6 connecting rods: centre cube -> each arm cube (centre to centre, like the Blender connectors)
  for (const slot of ['R', 'L', 'U', 'D', 'F', 'B']) rod([0, 0, 0], SLOTS[slot].pos, 0.09);
  // the stand: a round foot (flared disc + a domed "log" top) the rig rests on, fed by a pole
  // continuing down from the bottom (D) cube — mirrors the Blender Pedestal.
  const FOOT_BOTTOM = -RIG.D - 3.05;                        // local y; ≈ the workbench top in world space
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 0.38, 56), frameMat());
  disc.position.set(0, FOOT_BOTTOM + 0.19, 0); disc.userData.shell = true; disc.raycast = () => {}; g.add(disc);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 44, 22), frameMat());
  dome.scale.set(1, 0.32, 1); dome.position.set(0, FOOT_BOTTOM + 0.38, 0);
  dome.userData.shell = true; dome.raycast = () => {}; g.add(dome);
  rod([0, -RIG.D, 0], [0, FOOT_BOTTOM + 0.85, 0], 0.13);    // the pole, down into the foot's rounded top

  for (const slot of SLOT_ORDER) {
    const [cx, cy, cz] = SLOTS[slot].pos;
    // white, slightly transparent cell housing — you can see the ledjes inside.
    const half = RIG.S + RIG.LED + 0.16;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(half * 2, half * 2, half * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.0,
        transparent: true, opacity: 0.1, depthWrite: false }));
    shell.position.set(cx, cy, cz); shell.userData.shell = true; shell.raycast = () => {};
    g.add(shell); shells.push(shell);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
    edges.position.set(cx, cy, cz); edges.userData.shell = true; edges.raycast = () => {}; g.add(edges);

    meshes[slot] = new Array(27);
    for (let idx = 0; idx < 27; idx++) {
      const [i, j, k] = decodeVi(idx);
      const [ox, oy, oz] = ORIENT[slot](i, j, k);     // real physical spot (= engine/firmware solder map)
      const m = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial(
        { color: 0x222222, emissive: 0x222222, emissiveIntensity: BASE_I, roughness: 0.3 }));
      m.position.set(cx + ox * RIG.S, cy + oy * RIG.S, cz + oz * RIG.S);
      m.userData.slot = slot; m.userData.idx = idx;
      g.add(m); meshes[slot][idx] = m; allLeds.push(m);
    }
  }
  // strip-order list + chain positions (C(0..26) R L U D F B(..188))
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    rigLeds.push(meshes[slot][idx]); chainPts.push(meshes[slot][idx].position.clone());
  }

  // the data "draad": one wire threading all 189 leds in strip order (hidden until toggled).
  chainGroup = new THREE.Group(); chainGroup.visible = false; g.add(chainGroup);
  const C_DATA = 0xffd23d, C_JUMP = 0x36c7ff, UP = new THREE.Vector3(0, 1, 0);
  for (let n = 0; n < chainPts.length - 1; n++) {
    const a = chainPts[n], b = chainPts[n + 1], jump = (n % 27) === 26;
    const dir = new THREE.Vector3().subVectors(b, a);
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(jump ? 0.06 : 0.03, jump ? 0.06 : 0.03, dir.length(), 8),
      new THREE.MeshStandardMaterial({ color: jump ? C_JUMP : C_DATA, emissive: jump ? C_JUMP : C_DATA,
        emissiveIntensity: 0.9, roughness: 0.35 }));
    seg.position.copy(a).lerp(b, 0.5);
    seg.quaternion.setFromUnitVectors(UP, dir.normalize());
    seg.userData.shell = true; seg.raycast = () => {};   // not a click target
    chainGroup.add(seg);
  }
  chainPulse = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.4 }));
  chainPulse.userData.shell = true; chainPulse.raycast = () => {}; chainGroup.add(chainPulse);

  registerPart('rig', g, new THREE.Vector3(0, RIG.D + 1.4, 0));
  // PRECISE contact points, each ON a real led of the string:
  //   the string INPUT is led #0 of cube C — there the data (DIN), main +5V/GND and the buffer
  //   cap all connect; power INJECTION taps the first strip-led of each far arm (R/U/B), where the
  //   chain enters that cube. Each contact gets a connector node ON the led + a short stub, so the
  //   harness wires visibly terminate on the exact led they belong to.
  const contacts = [
    { name: 'DIN',   led: meshes.C[0], off: new THREE.Vector3(-0.22, -0.10, -0.12), col: 0xffd23d },
    { name: '5V',    led: meshes.C[0], off: new THREE.Vector3(-0.10, -0.26, -0.10), col: 0xff5a4d },
    { name: 'GND',   led: meshes.C[0], off: new THREE.Vector3(-0.12, -0.10, -0.26), col: 0x9aa6bf },
    { name: 'INJ_R', led: meshes.R[0], off: new THREE.Vector3(0, -0.30, 0),         col: 0xff5a4d },
    { name: 'INJ_U', led: meshes.U[0], off: new THREE.Vector3(0, -0.30, 0),         col: 0xff5a4d },
    { name: 'INJ_B', led: meshes.B[0], off: new THREE.Vector3(0, -0.30, 0),         col: 0xff5a4d },
  ];
  const connGeo = new THREE.SphereGeometry(0.12, 14, 12), UPv = new THREE.Vector3(0, 1, 0);
  for (const c of contacts) {
    const ledPos = c.led.position, nodePos = ledPos.clone().add(c.off);
    term('rig', c.name, nodePos);                                  // the harness wire ends here, ON the led
    const node = new THREE.Mesh(connGeo, new THREE.MeshStandardMaterial(
      { color: c.col, emissive: c.col, emissiveIntensity: 1.4, roughness: 0.3 }));
    node.position.copy(nodePos); node.userData.shell = true; node.raycast = () => {}; g.add(node);
    const dir = new THREE.Vector3().subVectors(ledPos, nodePos);   // stub bridging the connector to the led
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, dir.length(), 8),
      new THREE.MeshStandardMaterial({ color: c.col, emissive: c.col, emissiveIntensity: 1.1, roughness: 0.35 }));
    stub.position.copy(nodePos).lerp(ledPos, 0.5);
    stub.quaternion.setFromUnitVectors(UPv, dir.clone().normalize());
    stub.userData.shell = true; stub.raycast = () => {}; g.add(stub);
  }
})();

/* --------------------------------------------------------- build the wires --- */
const wires = [];
function wireCurve(a, b, cat) {
  const lift = cat === 'data' ? 0.5 : 0.0;
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const horiz = Math.hypot(a.x - b.x, a.z - b.z);
  mid.y += Math.min(1.1, horiz * 0.11) + 0.25 + lift;
  return new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5), mid, b.clone().lerp(mid, 0.5), b]);
}
function buildWires() {
  for (const c of CONNECTIONS) {
    const [pa, ta, pb, tb, cat] = c;
    const A = TERM[pa]?.[ta], B = TERM[pb]?.[tb];
    if (!A || !B) { console.warn('missing terminal', pa, ta, pb, tb); continue; }
    const curve = wireCurve(A, B, cat);
    let m;
    if (cat === 'bt') {
      // the wireless Bluetooth link: a DASHED line (no solid wire) so it reads as "over the air"
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      m = new THREE.Line(geo, new THREE.LineDashedMaterial({
        color: WIRE[cat].color, transparent: true, opacity: 0.95, dashSize: 0.24, gapSize: 0.18 }));
      m.computeLineDistances();
    } else {
      const geo = new THREE.TubeGeometry(curve, 24, 0.05, 7, false);
      m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: WIRE[cat].color, emissive: WIRE[cat].color, emissiveIntensity: 0.25,
        roughness: 0.5, metalness: 0.1 }));
    }
    scene.add(m);
    const markers = [];
    const mk = (off) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: WIRE[cat].color, emissiveIntensity: 2.2 }));
      s.userData.off = off; scene.add(s); markers.push(s); return s;
    };
    mk(0); mk(0.5);
    wires.push({ mesh: m, conn: c, parts: [pa, pb], type: cat, curve, markers });
  }
}
buildWires();

/* ============================================================================
   GAME LOGIC — engine readout, permutation-wave animation, navigation, actions.
   (Drives the rig led meshes above via the verified engine — same as the firmware.)
   ========================================================================== */
const KP = (s, i) => s + '#' + i;
let sel = { slot: 'C', idx: 13 };       // selected cell (13 = vi [0,0,0] core of cube 0)
let powerOn = true, scrambledOnce = false, solved = true, moves = 0;
let j3idx = 0;                          // highlighted rotation-menu item
const pulse = {}; SLOT_ORDER.forEach(s => pulse[s] = 0);
let colorAnim = null;

// global lattice coord of a (slot,idx) = its PHYSICAL position: cube centre (pos direction
// at ±3) + ORIENT offset (-1/0/1). A ±1 step therefore lands on the physically adjacent led.
function gcoord(s) {
  const [cx, cy, cz] = SLOTS[s.slot].centre;
  const [i, j, k] = decodeVi(s.idx);
  const [ox, oy, oz] = ORIENT[s.slot](i, j, k);
  return [cx + ox, cy + oy, cz + oz];
}
// inverse of each ORIENT: physical offset (x,y,z) within a cube -> in-cube (i,j,k)
const ORIENT_INV = {
  C: (x, y, z) => [ x,  y,  z],
  R: (x, y, z) => [ y,  z,  x],   // ORIENT.R = [k,i,j]
  L: (x, y, z) => [ y,  z, -x],   // ORIENT.L = [-k,i,j]
  U: (x, y, z) => [ x,  z,  y],   // ORIENT.U = [i,k,j]
  D: (x, y, z) => [ x,  z, -y],   // ORIENT.D = [i,-k,j]
  F: (x, y, z) => [ x,  y,  z],   // ORIENT.F = [i,j,k]
  B: (x, y, z) => [ x,  y, -z],   // ORIENT.B = [i,j,-k]
};
// inverse: global (x,y,z) -> {slot,idx} or null. Arm axes match the physical pos: R/L on x,
// U/D on y, F/B on z (this was the bug — the old scheme swapped y/z and the in-cube spin).
function cellAt(gx, gy, gz) {
  const far = a => a >= 2 ? 1 : a <= -2 ? -1 : 0;
  const fx = far(gx), fy = far(gy), fz = far(gz);
  if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) > 1) return null;   // not inside two arms at once
  let slot = 'C';
  if (fx) slot = fx > 0 ? 'R' : 'L';
  else if (fy) slot = fy > 0 ? 'U' : 'D';
  else if (fz) slot = fz > 0 ? 'F' : 'B';
  const [cx, cy, cz] = SLOTS[slot].centre;
  const [i, j, k] = ORIENT_INV[slot](gx - cx, gy - cy, gz - cz);
  if ([i, j, k].some(v => v < -1 || v > 1)) return null;
  return { slot, idx: (i + 1) + 3 * (j + 1) + 9 * (k + 1) };
}

const ease = k => k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;

// read the engine's 189 colours into a {slot:[27 THREE.Color]} table
function readColors() {
  const leds = puzzle.ledState();
  const tbl = {};
  for (const slot of SLOT_ORDER) {
    tbl[slot] = [];
    for (let idx = 0; idx < 27; idx++) {
      const led = leds[slot][idx];
      tbl[slot][idx] = new THREE.Color(led ? led.rgb : 0x222222);
    }
  }
  return tbl;
}
function setColors() {
  const to = readColors();
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    const mat = meshes[slot][idx].material;
    mat.color.copy(to[slot][idx]); mat.emissive.copy(to[slot][idx]);
    meshes[slot][idx].userData.boost = 0;
  }
  colorAnim = null;
}

// permutation-following colour+brightness sweep. pre = placements() BEFORE the move.
function startMoveAnim(pre) {
  const from = {}, to = readColors();
  for (const slot of SLOT_ORDER) {
    from[slot] = [];
    for (let idx = 0; idx < 27; idx++) from[slot][idx] = meshes[slot][idx].material.color.clone();
  }
  const preById = {}; for (const x of pre) preById[x.id] = { slot: x.slot, idx: x.idx };
  const post = puzzle.placements();
  const edges = new Map(); const incoming = new Set();
  for (const pl of post) {
    const p = preById[pl.id];
    if (p && (p.slot !== pl.slot || p.idx !== pl.idx)) {
      edges.set(KP(p.slot, p.idx), KP(pl.slot, pl.idx));
      incoming.add(KP(pl.slot, pl.idx));
    }
  }
  const phase = {}; const visited = new Set();
  const starts = [...edges.keys()].filter(k => !incoming.has(k)).concat([...edges.keys()]);
  for (const start of starts) {
    if (visited.has(start)) continue;
    const path = []; let k = start;
    while (k !== undefined && !visited.has(k)) { visited.add(k); path.push(k); k = edges.get(k); }
    const L = Math.max(path.length, 1);
    for (let i = 0; i < path.length; i++) {
      const dest = edges.get(path[i]);
      if (dest !== undefined) phase[dest] = (i + 1) / L;
    }
  }
  colorAnim = { t: 0, dur: TWIST_MS, from, to, phase, moving: edges.size > 0 };
}

// the in-cell grip axis of the selected cubie (edge / corner direction)
function gripAxis() {
  const va = AXN.indexOf(SLOTS[sel.slot].view[0]);
  const A = [0, 1, 2, 3].filter(x => x !== va);
  const vi = decodeVi(sel.idx);
  const vview = [0, 0, 0, 0];
  for (let t = 0; t < 3; t++) vview[A[t]] = vi[t];
  const lg = puzzle.viewToLogical(SLOTS[sel.slot].view);
  const inAx = [0, 1, 2, 3].filter(a => a !== lg.d);
  const V = puzzle.view4;
  const lc = ax => { let s = 0; for (let k = 0; k < 4; k++) s += V[k][ax] * vview[k]; return Math.round(s); };
  return { d: lg.d, sd: lg.sd, u: [lc(inAx[0]), lc(inAx[1]), lc(inAx[2])] };
}

// rotations available at the selected cell — exactly the game's set
function j3Options() {
  if (isCentreCell(sel)) return [];
  const lg = puzzle.viewToLogical(SLOTS[sel.slot].view);
  const planes = puzzle.planesFor(lg.d);
  const opts = [];
  for (let p = 0; p < 3; p++) {
    const lab = AXN[planes[p][0]] + AXN[planes[p][1]];
    opts.push({ kind: 'plane', planeIdx: p, dir: 1, label: `vlak ${lab}  +90°` });
    opts.push({ kind: 'plane', planeIdx: p, dir: -1, label: `vlak ${lab}  −90°` });
  }
  const nz = decodeVi(sel.idx).filter(v => v !== 0).length;
  if (nz === 2) opts.push({ kind: 'grip', theta: Math.PI, label: 'ribbe-flip 180°' });
  if (nz === 3) {
    opts.push({ kind: 'grip', theta: 2 * Math.PI / 3, label: 'hoek-spin +120°' });
    opts.push({ kind: 'grip', theta: -2 * Math.PI / 3, label: 'hoek-spin −120°' });
  }
  return opts;
}

// --------------------------------------------------------------- controller HUD
const elG = id => document.getElementById(id);
let armDir = 0;          // rotation direction: -1 reverse, +1 forward, 0 none (active while ←/→ held)
let armPlane = null;     // '0' | '1' | '2' | 'grip' | null — a plane armed, awaiting a direction

// which plane/grip the selected cell offers right now (labels are cell-dependent: XY for the
// inner cell, but e.g. YW/ZW for an arm cell — so the face buttons show their live label).
function planeLabels() {
  const out = { '0': '—', '1': '—', '2': '—', 'grip': '—', has0: false, has1: false, has2: false, gripOn: false };
  if (isCentreCell(sel)) return out;
  const lg = puzzle.viewToLogical(SLOTS[sel.slot].view);
  const planes = puzzle.planesFor(lg.d);
  for (let p = 0; p < 3; p++) { out[String(p)] = AXN[planes[p][0]] + AXN[planes[p][1]]; out['has' + p] = true; }
  const nz = decodeVi(sel.idx).filter(v => v !== 0).length;
  if (nz === 2) { out.grip = '180°'; out.gripOn = true; }
  else if (nz === 3) { out.grip = '120°'; out.gripOn = true; }
  return out;
}
function updateController() {
  const g = gcoord(sel);
  if (elG('sel-label')) elG('sel-label').textContent = `(${g[0]}, ${g[1]}, ${g[2]}) · ${SLOTS[sel.slot].nl} · ${posLabelOf(sel.idx)}`;
  if (elG('moves-val')) elG('moves-val').textContent = moves;
  if (elG('solved-val')) elG('solved-val').textContent = !powerOn ? 'uit' : (solved ? 'opgelost ✔' : 'in beweging…');
  const ps = elG('power-state');
  if (ps) { ps.classList.toggle('off', !powerOn); ps.querySelector('b').textContent = powerOn ? 'AAN' : 'UIT'; }
  const pl = planeLabels();
  for (const key of ['0', '1', '2', 'grip']) {
    const btn = document.querySelector(`.face[data-plane="${key}"]`);
    if (!btn) continue;
    const span = btn.querySelector('span'); if (span) span.textContent = pl[key];
    btn.classList.toggle('dis', key === 'grip' ? !pl.gripOn : !pl['has' + key]);
    btn.classList.toggle('armed', armPlane === key);
  }
  document.querySelectorAll('#lstick .adir').forEach(b =>
    b.classList.toggle('on', armDir !== 0 && Number(b.dataset.dir) === armDir));
}
function refresh() { setColors(); updateController(); }

// --------------------------------------------------------------- actions
function selectCell(slot, idx) {
  if (!powerOn || colorAnim) return;
  sel = { slot, idx }; armPlane = null; updateController();
}
function moveCell(dx, dy, dz) {
  if (!powerOn || colorAnim) return;
  const [gx, gy, gz] = gcoord(sel);
  const n = cellAt(gx + dx, gy + dy, gz + dz);
  if (n) { sel = n; armPlane = null; updateController(); }
}
function afterMove(pre) {
  pulse[sel.slot] = 1.0;
  if (scrambledOnce) moves++;
  solved = puzzle.isSolved();
  startMoveAnim(pre);
  updateController();
}
function doTwist(planeIdx, dir) {
  if (!powerOn || colorAnim) return;
  const pre = puzzle.placements();
  const lg = puzzle.viewToLogical(SLOTS[sel.slot].view);
  puzzle.twist(lg.d, lg.sd, planeIdx, dir);
  afterMove(pre);
}
function doGrip(theta) {
  if (!powerOn || colorAnim) return;
  const pre = puzzle.placements();
  const g = gripAxis();
  puzzle.grip(g.d, g.sd, g.u, theta);
  afterMove(pre);
}
// 4D transform: an arm cube's centre cell becomes the central cube (red ● / Enter)
function pressA() {
  if (!powerOn || colorAnim) return;
  if (sel.slot !== 'C' && isCentreCell(sel)) {
    const pre = puzzle.placements();
    const lg = puzzle.viewToLogical(SLOTS[sel.slot].view);
    puzzle.centerCell(lg.d, lg.sd);
    sel = { slot: 'C', idx: 13 }; pulse['C'] = 1.0;
    startMoveAnim(pre); updateController();
  }
}
function doScramble() {
  if (!powerOn || colorAnim) return;
  puzzle.resetView(); puzzle.scramble(26);
  scrambledOnce = true; solved = false; moves = 0;
  sel = { slot: 'C', idx: 13 }; armPlane = null; refresh();
}
function doUndo() {
  if (!powerOn || colorAnim) return;
  const pre = puzzle.placements();
  if (puzzle.undo()) { solved = puzzle.isSolved(); startMoveAnim(pre); updateController(); }
}
function doReset() {
  if (!powerOn || colorAnim) return;
  puzzle.reset(); puzzle.resetView();
  scrambledOnce = false; solved = true; moves = 0;
  sel = { slot: 'C', idx: 13 }; armPlane = null; refresh();
}
function doViewReset() {
  if (!powerOn || colorAnim) return;
  const pre = puzzle.placements();
  puzzle.resetView(); pulse['C'] = 1.0; startMoveAnim(pre); updateController();
}

// rotation = a direction (left stick ◄/► or ←/→) combined with a plane (face button or Z/X/C/V)
function execRotation(plane, dir) {
  if (!powerOn || colorAnim || isCentreCell(sel)) return;
  if (plane === 'grip') {
    const nz = decodeVi(sel.idx).filter(v => v !== 0).length;
    if (nz === 2) doGrip(Math.PI);                    // edge: 180° (its own inverse)
    else if (nz === 3) doGrip(dir * 2 * Math.PI / 3); // corner: ±120°
  } else {
    doTwist(Number(plane), dir);                      // plane 0/1/2: always valid for a non-centre cell
  }
}
function setDir(d) {
  armDir = d;
  if (armPlane !== null) { execRotation(armPlane, d); armPlane = null; }
  updateController();
}
function clearDir(d) { if (armDir === d) { armDir = 0; updateController(); } }
function pressPlane(p) {
  if (armDir !== 0) execRotation(p, armDir);       // direction already active -> rotate now
  else armPlane = (armPlane === p ? null : p);     // else arm the plane, wait for a direction
  updateController();
}

// game action buttons (right panel) + power
// husselen / zet terug / reset / 4D zitten op de controller (+ toetsen) — geen losse knoppen meer
elG('btn-4dreset').onclick = doViewReset;
elG('btn-power').onclick = () => { powerOn = !powerOn; updateController(); };

// --------------------------------------------------------------- PS3 controller (clicks)
// world axes: x = links/rechts (L/R), y = onder/boven (D/U), z = achter/vóór (B/F)
const MOVE = { N: [0, 0, -1], S: [0, 0, 1], W: [-1, 0, 0], E: [1, 0, 0], U: [0, 1, 0], D: [0, -1, 0] };
document.querySelectorAll('#ps3 [data-mv]').forEach(b =>
  b.onclick = () => { const m = MOVE[b.dataset.mv]; if (m) moveCell(m[0], m[1], m[2]); });
document.querySelectorAll('#ps3 [data-dir]').forEach(b =>
  b.onclick = () => { const d = Number(b.dataset.dir); armDir === d ? clearDir(d) : setDir(d); });
document.querySelectorAll('#ps3 [data-plane]').forEach(b =>
  b.onclick = () => { if (!b.classList.contains('dis')) pressPlane(b.dataset.plane); });
document.querySelectorAll('#ps3 [data-act]').forEach(b =>
  b.onclick = () => { const a = b.dataset.act;
    if (a === '4d') pressA(); else if (a === 'undo') doUndo();
    else if (a === 'scramble') doScramble(); else if (a === 'reset') doReset(); });

// --------------------------------------------------------------- keyboard (matches the controller image)
const PLANEKEY = { z: '0', x: '1', c: '2', v: 'grip' };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (e.shiftKey && k === 's') { e.preventDefault(); doScramble(); return; }   // Shift+S = husselen
  if (e.shiftKey && k === 'r') { e.preventDefault(); doReset(); return; }       // Shift+R = reset
  if (e.repeat) return;
  if (k === 'w') moveCell(0, 0, -1);         // WASD = grondvlak: W achter, S vóór, A links, D rechts
  else if (k === 's') moveCell(0, 0, 1);
  else if (k === 'a') moveCell(-1, 0, 0);
  else if (k === 'd') moveCell(1, 0, 0);
  else if (k === 'i') moveCell(0, 1, 0);     // I/K = omhoog/omlaag (naar de boven-/onder-kubus)
  else if (k === 'k') moveCell(0, -1, 0);
  else if (k === 'arrowright') { e.preventDefault(); setDir(1); }    // → = vooruit (draairichting)
  else if (k === 'arrowleft') { e.preventDefault(); setDir(-1); }    // ← = achteruit
  else if (PLANEKEY[k] !== undefined) pressPlane(PLANEKEY[k]);       // Z=XY · X=YZ · C=XZ · V=extra
  else if (k === 'enter') pressA();                                  // Enter = 4D-transformatie
  else if (k === 'backspace') { e.preventDefault(); doUndo(); }      // Backspace = undo
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'arrowright') clearDir(1);
  else if (k === 'arrowleft') clearDir(-1);
});

/* ============================================================================
   UI — menu, info panel, labels, selection
   ========================================================================== */
const elMenu = document.getElementById('menu');
const elInfo = document.getElementById('info');
const elInfoBody = document.getElementById('info-body');
const elLabels = document.getElementById('labels');
let selected = null;
let focusTarget = null;

const menuBtns = {};
for (const [grp, ids] of MENU) {
  const h = document.createElement('div'); h.className = 'grp'; h.textContent = grp; elMenu.appendChild(h);
  for (const id of ids) {
    const b = document.createElement('button');
    b.innerHTML = `<span class="dot" style="background:${INFO[id].color}"></span>${INFO[id].name}`;
    b.onclick = () => select(id, true);
    elMenu.appendChild(b); menuBtns[id] = b;
  }
}

// collapsible left sections (click a header to open/close)
document.querySelectorAll('#left .acc-h').forEach(h =>
  h.onclick = () => h.parentElement.classList.toggle('open'));

const labelEls = {};
let labelNum = 0;
for (const id of Object.keys(INFO)) {
  const d = document.createElement('div'); d.className = 'lbl';
  d.innerHTML = `<span class="num">${++labelNum}</span>${INFO[id].name}`;
  d.onclick = () => select(id, false);
  elLabels.appendChild(d); labelEls[id] = d;
}

function wiringRowsFor(id) {
  const rows = [];
  for (const c of CONNECTIONS) {
    const [pa, ta, pb, tb, cat, note] = c;
    if (pa === id) rows.push({ self: ta, other: INFO[pb]?.name || pb, otherTerm: tb, cat, note });
    else if (pb === id) rows.push({ self: tb, other: INFO[pa]?.name || pa, otherTerm: ta, cat, note });
  }
  return rows;
}

function renderInfo(id) {
  const d = INFO[id];
  const rows = wiringRowsFor(id);
  let table = '';
  if (rows.length) {
    table = '<h3>Aansluiting</h3><table>' + rows.map(r =>
      `<tr><td class="pin"><span class="swatch" style="background:${'#' + WIRE[r.cat].color.toString(16).padStart(6,'0')}"></span>${r.self}</td>`
      + `<td class="arrow">→</td>`
      + `<td>${r.other} <span style="color:var(--dim)">${r.otherTerm}</span>${r.note ? `<br><span style="color:var(--dim);font-size:11px">${r.note}</span>` : ''}</td></tr>`
    ).join('') + '</table>';
  }
  const notes = (d.notes || []).map(([k, t]) =>
    `<div class="note ${k === 'warn' ? 'warn' : ''}">${k === 'warn' ? '⚠ ' : '💡 '}${t}</div>`).join('');
  elInfoBody.innerHTML =
    `<h2><span class="dot" style="background:${d.color}"></span>${d.name}</h2>`
    + `<div class="tag">${d.tag}</div>${d.html}${table}${notes}`;
  elInfo.classList.remove('hidden');
}

function select(id, fromMenu) {
  selected = id;
  renderInfo(id);
  for (const k in menuBtns) menuBtns[k].classList.toggle('sel', k === id);
  for (const k in labelEls) labelEls[k].classList.toggle('sel', k === id);
  highlightWires(id);
  if (ANCHOR[id]) focusTarget = ANCHOR[id].clone();
}
function clearSelect() {
  selected = null; elInfo.classList.add('hidden');
  for (const k in menuBtns) menuBtns[k].classList.remove('sel');
  for (const k in labelEls) labelEls[k].classList.remove('sel');
  highlightWires(null);
}
document.getElementById('info-close').onclick = clearSelect;

function highlightWires(id) {
  for (const w of wires) {
    if (chainOn) {
      // keep the wires that feed the cube BRIGHT so you can see the harness join the led
      // string (data into DIN, power into 5V/GND, injection into the arms); dim the rest.
      const toRig = w.parts.includes('rig');
      w.mesh.material.opacity = toRig ? 1 : 0.08; w.mesh.material.transparent = !toRig;
      w.mesh.material.emissiveIntensity = toRig ? 0.95 : 0.05;
      w.markers.forEach(s => s.visible = toRig && flowOn);
      continue;
    }
    const lit = !!id && w.parts.includes(id);
    const ei = !id ? 0.45 : (lit ? 1.1 : 0.07);
    const op = !id ? 1 : (lit ? 1 : 0.13);
    w.mesh.material.emissiveIntensity = ei;
    w.mesh.material.opacity = op; w.mesh.material.transparent = op < 1; w.mesh.material.depthWrite = true;
    w.markers.forEach(s => s.visible = (!id || lit) && flowOn);
  }
  // fade non-selected part bodies — but NEVER the game leds or the white cell shells.
  for (const pid in PART_GROUP) {
    const on = !id || pid === id;
    PART_GROUP[pid].traverse(o => { if (o.isMesh && o.material && !o.userData.slot && !o.userData.shell) {
      o.material.opacity = on ? 1 : 0.62; o.material.transparent = o.material.opacity < 1; o.material.depthWrite = true; } });
  }
}

/* --------------------------------------------------------- raycast clicking --- */
const ray = new THREE.Raycaster();
let downXY = null;
canvas.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
  if (moved > 6) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(partMeshes, false)[0];
  if (!hit) { clearSelect(); return; }
  const o = hit.object;
  if (o.userData.slot !== undefined) selectCell(o.userData.slot, o.userData.idx);  // a ledje -> play
  else if (o.userData.part) select(o.userData.part, false);                         // a part -> info
});

/* --------------------------------------------------------- bottom toggles --- */
let flowOn = true, labelsOn = true;
const tgFlow = document.getElementById('tg-flow');
const tgLabels = document.getElementById('tg-labels');
tgFlow.onclick = () => { flowOn = !flowOn; tgFlow.classList.toggle('on', flowOn);
  wires.forEach(w => w.markers.forEach(s => s.visible = flowOn && (!selected || w.parts.includes(selected)))); };
tgLabels.onclick = () => { labelsOn = !labelsOn; tgLabels.classList.toggle('on', labelsOn);
  elLabels.style.display = labelsOn ? 'block' : 'none'; };
document.getElementById('btn-reset-view').onclick = () => {
  camera.position.copy(CAM0); controls.target.copy(TARGET0);
};

let frameSweep = null;
document.getElementById('btn-frame').onclick = () => { frameSweep = { t: 0 }; };

// "Led-draad": show the one data wire weaving through all 189 leds + a running pulse.
let chainOn = false, chainHead = 0;
const tgChain = document.getElementById('tg-chain');
tgChain.onclick = () => {
  chainOn = !chainOn; tgChain.classList.toggle('on', chainOn);
  if (chainGroup) chainGroup.visible = chainOn;
  highlightWires(selected);
};

/* ============================================================================
   RENDER LOOP
   ========================================================================== */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// the rotation wave: a bright bump travels each permutation cycle while each led
// cross-fades to its new colour as the wave passes. Pure colour+brightness over time.
const WV = { W: 0.55, CF: 0.32, SIG: 0.07, WAVE_H: 1.25 };
function updateColorAnim() {
  if (!colorAnim) return;
  colorAnim.t += 16;
  const k = Math.min(1, colorAnim.t / colorAnim.dur);
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    const ph = colorAnim.phase[KP(slot, idx)];
    const center = (ph == null ? 0 : ph) * WV.W;
    const cf = Math.min(1, Math.max(0, (k - center) / WV.CF));
    const mat = meshes[slot][idx].material;
    mat.color.copy(colorAnim.from[slot][idx]).lerp(colorAnim.to[slot][idx], ease(cf));
    mat.emissive.copy(mat.color);
    let boost = 0;
    if (ph != null) { const d = k - (center + WV.CF * 0.4); boost = WV.WAVE_H * Math.exp(-(d * d) / (2 * WV.SIG * WV.SIG)); }
    meshes[slot][idx].userData.boost = boost;
  }
  if (k >= 1) { colorAnim = null; for (const s of SLOT_ORDER) for (let i = 0; i < 27; i++) meshes[s][i].userData.boost = 0; }
}

// led brightness: selected cell brightest (breathing), its cube mid, rest dim, plus the
// travelling wave boost and a spotlight that dims the non-moving leds during a turn.
function updateGameBrightness(now) {
  const breathe = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(now * 0.006));
  for (const slot of SLOT_ORDER) {
    if (pulse[slot] > 0) pulse[slot] = Math.max(0, pulse[slot] - 0.04);
    const isSelCube = slot === sel.slot;
    for (let idx = 0; idx < 27; idx++) {
      const isSel = isSelCube && idx === sel.idx;
      const baseI = isSelCube ? (isSel ? SEL_I * breathe : SEL_CUBE_I) : BASE_I;
      const mv = meshes[slot][idx].userData.boost || 0;
      let inten = baseI + pulse[slot] * 0.55 + mv;
      if (colorAnim && colorAnim.phase[KP(slot, idx)] == null) inten *= 0.45;
      meshes[slot][idx].material.emissiveIntensity = powerOn ? Math.min(2.6, inten) : OFF_I;
    }
  }
}

const v = new THREE.Vector3(), camFwd = new THREE.Vector3(), toLbl = new THREE.Vector3();
let t = 0;
function tick() {
  const now = performance.now();
  t += 0.016;
  if (focusTarget) {
    controls.target.lerp(focusTarget, 0.12);
    if (controls.target.distanceTo(focusTarget) < 0.04) focusTarget = null;
  }
  controls.update();

  // wire flow markers
  if (flowOn) {
    const speed = 0.18;
    for (const w of wires) {
      const visible = !selected || w.parts.includes(selected);
      for (const s of w.markers) {
        s.visible = visible;
        if (!visible) continue;
        const p = (t * speed + s.userData.off) % 1;
        s.position.copy(w.curve.getPoint(p));
      }
    }
  } else for (const w of wires) w.markers.forEach(s => s.visible = false);

  // GAME: colours follow the rotation wave (always when a turn is animating)
  updateColorAnim();

  // led brightness — hardware demos override the game look while active
  if (frameSweep) {
    frameSweep.t += 0.016;
    const head = frameSweep.t * 140;
    for (let i = 0; i < rigLeds.length; i++) {
      const d = head - i;
      rigLeds[i].material.emissiveIntensity = powerOn ? 0.5 + (d >= 0 && d < 14 ? 1.8 * (1 - d / 14) : 0) : OFF_I;
    }
    if (head > rigLeds.length + 16) { frameSweep = null; }
  } else if (chainOn) {
    chainHead += 0.85;
    if (chainHead > chainPts.length + 14) chainHead = 0;
    const hp = Math.max(0, Math.min(chainPts.length - 1, chainHead));
    const ci = Math.min(chainPts.length - 2, Math.floor(hp));
    chainPulse.position.copy(chainPts[ci]).lerp(chainPts[ci + 1], hp - ci);
    chainPulse.visible = chainHead <= chainPts.length - 1;
    for (let n = 0; n < rigLeds.length; n++) {
      const d = chainHead - n;
      rigLeds[n].material.emissiveIntensity = powerOn ? 0.5 + (d >= 0 && d < 12 ? 1.8 * (1 - d / 12) : 0) : OFF_I;
    }
  } else {
    updateGameBrightness(now);
  }

  // breathing on a selected PART (not the rig — its leds breathe via the game)
  if (selected && selected !== 'rig' && PART_GROUP[selected]) {
    const b = 0.5 + 0.5 * Math.sin(t * 3);
    PART_GROUP[selected].traverse(o => { if (o.isMesh && o.material && o.material.emissive && !o.userData.slot && !o.userData.shell)
      o.material.emissiveIntensity = 0.55 + 0.35 * b; });
  }

  // project labels to screen
  if (labelsOn) {
    camera.getWorldDirection(camFwd);
    for (const id in labelEls) {
      const el = labelEls[id];
      toLbl.copy(ANCHOR[id]).sub(camera.position);
      if (toLbl.dot(camFwd) <= 0) { el.style.display = 'none'; continue; }
      v.copy(ANCHOR[id]).project(camera);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
      el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

refresh();   // paint the solved puzzle onto the leds + vul de controller-HUD
tick();
