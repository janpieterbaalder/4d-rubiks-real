/* ============================================================================
   hardware.js — interactive, REALISTIC 3D workbench + PLAYABLE game in one scene.
   ----------------------------------------------------------------------------
   TWO functions cooperate in the same 3D world, so this is a true simulation of
   the installation:
     1. HARDWARE — the real electronics at (estimated) real size on a workbench: an
        ESP32-DevKitC (built-in Bluetooth) on a breadboard with a 74AHCT125 level shifter,
        a 5V/10A supply with a GND star point, an on/off switch box, an inline 10A fuse
        with a 5V splice block, a wireless game controller, and the 189-WS2812B led rig
        with its input board (1000µF + 330Ω right at led #0).
        Click any part for an info panel + exact wiring (one CONNECTIONS table is
        the single source of truth and matches BEDRADING.md); the camera flies to it.
     2. SOFTWARE — the actual 4D-Rubiks game runs on those same leds. Drive it with the
        on-screen controller (or click a cell / use the keyboard); the leds inside the
        frosted cubies RECOLOUR correctly on every turn via the verified engine + the
        permutation-wave animation (1:1 with the WS2812 firmware).

   Rendering (bench/stage.js): physically based materials, a studio reflection map,
   soft shadows, HDR bloom on the leds, coloured light spill from the cells onto the
   frame and the bench, AgX tone mapping. Scale: 1 unit = 4 cm.
   Nothing moves mechanically — a "turn" only changes led COLOURS.
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Tesseract, AXN, ORIENT } from './engine.js?v=4';
// NOTE: bump ?v= on ALL bench imports together (also inside bench/*.js), else a module loads twice
import { createStage, MAT } from './bench/stage.js?v=11';
import * as P from './bench/parts.js?v=11';
import { hotspotTexture, DEVKIT } from './bench/textures.js?v=11';

// ---- wire categories: 3D insulation colour, legend colour, label, wire radius (scene units)
const WIRE = {
  pwr:  { color: 0xc8261e, label: '+5V (stroom +)', r: 0.04 },
  gnd:  { color: 0x1d1e22, label: 'GND (massa / −)', r: 0.04 },
  data: { color: 0xf2c418, label: 'Data 3,3V (ESP32 → levelshifter)', r: 0.022 },
  data5:{ color: 0xff7a1a, label: 'Data 5V (levelshifter → 330Ω → DIN)', r: 0.024 },
  bt:   { color: 0xa47bff, label: 'Bluetooth (draadloos, ingebouwd)', r: 0 },
};
const hex6 = c => '#' + c.toString(16).padStart(6, '0');

/* ============================================================================
   THE WIRING TABLE — single source of truth.
   Each row: [ fromPart, fromTerminal, toPart, toTerminal, category, note ]
   ========================================================================== */
const CONNECTIONS = [
  // --- power backbone: PSU -> switch -> fuse -> 5V splice -> (ESP32 + led rig) ---
  ['psu','+5V', 'sw','in',     'pwr', 'voeding naar aan/uit-schakelaar'],
  ['sw','out',  'fuse','in',   'pwr', 'schakelaar naar de inline zekering'],
  ['fuse','out','esp','5Vin',  'pwr', '5V naar de ESP32 (via de 5V/VIN-pin)'],
  ['fuse','out','rig','5V',    'pwr', '5V naar de leds — dikke draad!'],
  ['psu','GND', 'esp','GNDin', 'gnd', 'gemeenschappelijke massa'],
  ['psu','GND', 'rig','GND',   'gnd', 'massa naar de leds — dikke draad!'],

  // --- data line: ESP32 GPIO13 (3,3V) -> levelshifter -> 330Ω -> first led (5V) ---
  ['esp','D13', 'lvl','in',  'data',  '3,3V data van de ESP32 (GPIO13) — jumper op het breadboard'],
  ['lvl','out', 'res','in',  'data5', '5V data uit de levelshifter, langs het statief omhoog'],
  ['res','out', 'rig','DIN', 'data5', '330Ω vlak vóór de eerste led (op het ingangsprintje)'],

  // --- level shifter power (shared GND is essential) ---
  ['fuse','out','lvl','VCC', 'pwr', 'levelshifter op 5V (zet 1OE aan GND — zie info)'],
  ['psu','GND', 'lvl','GND', 'gnd', 'gedeelde massa — anders is de 5V-uitgang ongeldig'],

  // --- decoupling capacitor across the led rail near DIN ---
  ['cap','+',   'rig','5V',  'pwr', '1000µF buffer (+ op 5V)'],
  ['cap','-',   'rig','GND', 'gnd', '1000µF buffer (− op GND)'],

  // --- Bluetooth: the controller talks straight to the ESP32's built-in radio ---
  ['esp','BT',  'ps3','BT',  'bt', 'Bluetooth (HID) — ingebouwd in de ESP32 (Bluepad32), geen dongle'],

  // --- power injection every 54 leds (BEDRADING.md §4): strip #54 (L), #108 (D), #162 (B) ---
  ['fuse','out','rig','INJ_L','pwr','power-injectie linker arm (strip #54)'],
  ['psu','GND', 'rig','INJ_L','gnd',''],
  ['fuse','out','rig','INJ_D','pwr','power-injectie onderste arm (strip #108)'],
  ['psu','GND', 'rig','INJ_D','gnd',''],
  ['fuse','out','rig','INJ_B','pwr','power-injectie achterste arm (strip #162)'],
  ['psu','GND', 'rig','INJ_B','gnd',''],
];

/* ============================================================================
   INFO — what each part is + why. The "Aansluiting" table is generated from
   CONNECTIONS, so it can never drift from the wires you see in 3D.
   ========================================================================== */
const INFO = {
  esp: {
    name: 'ESP32 (met Bluepad32)', tag: 'De microcontroller — het brein (ESP32-DevKitC op het breadboard)', color: '#11998e',
    html: `<p><b>Wat:</b> een ESP32-DevKitC dat het hele spel uitrekent en alles aanstuurt. Het draait
      jouw firmware (de C++-versie van de engine), luistert via zijn <b>ingebouwde Bluetooth</b> naar
      een draadloze controller en stuurt de 189 leds aan.</p>
      <p><b>Waarom de ESP32?</b> Hij heeft <b>~320 KB vrij RAM</b> (zeeën van ruimte t.o.v. de 8 KB
      van een Arduino Mega), draait op <b>240 MHz</b> en heeft <b>Bluetooth ingebouwd</b> — dus géén
      USB Host Shield of dongle nodig (met de <b>Bluepad32</b>-bibliotheek). De WS2812-leds worden via
      de <b>RMT-hardware</b> aangestuurd, zodat het verversen van de leds de Bluetooth niet blokkeert.</p>
      <p><b>Let op:</b> de ESP32 werkt op <b>3,3V-logica</b>. De WS2812 willen een 5V-datasignaal, dus
      zit er een <b>levelshifter</b> tussen de datapin (<b>GPIO13</b>) en de eerste led.</p>
      <p><b>Op het breadboard:</b> de 5V-, GND- en GPIO13-pin zitten op dezelfde (achterste) pinrij;
      de jumpers gaan in de vrije rij erachter.</p>`,
    notes: [['','Voed de ESP32 via zijn 5V/VIN-pin (de onboard-regelaar maakt er 3,3V van) — nooit 5V rechtstreeks op de 3V3-pin.'],
      ['','De oudere Mega + USB-Host-Shield + PS3BT-variant is vervallen — bouw met de ESP32 (zie BEDRADING.md).']],
  },
  psu: {
    name: '5V voeding (10A)', tag: 'Aparte stroombron voor de leds — met GND-sterpunt', color: '#ff5a4d',
    html: `<p><b>Wat:</b> een ingebouwde 5V-netvoeding (schakelende voeding, ~99×82×30 mm). Levert de
      stroom voor de 189 leds <i>en</i> voor de ESP32.</p>
      <p><b>Waarom apart, niet via USB?</b> 189 WS2812B op vol wit trekken theoretisch ~11A.
      In de praktijk (verzadigde kleuren, gedimd) eerder 3–6A, maar de USB-poort van je laptop
      levert maar ~0,5A. Kies de voeding daarom op de <b>capped build: 5V/10A</b>; wil je álle
      leds op vol wit, dan <b>≥15A</b> — en verhoog dan óók zekering, schakelaar en draaddikte
      (zie BEDRADING.md §4).</p>
      <p><b>Cruciaal:</b> de massa (GND) van de voeding, de ESP32 én de leds moet je
      <b>aan elkaar knopen</b> (gemeenschappelijke GND). Alle GND-takken vertrekken uit <b>één
      sterpunt</b> (het verdeelblok naast de −V-klem), zodat alle led-segmenten dezelfde
      datareferentie delen.</p>`,
    notes: [['warn','Netspanning (L/N/⏚) alleen aansluiten met de kap dicht en een geaarde kabel. Niet USB én 5V/VIN tegelijk voeden zonder nadenken: tijdens het programmeren de ESP32 via USB en de 5V-draad naar het bord los (massa\'s wél verbonden).']],
  },
  sw: {
    name: 'Aan/uit-schakelaar', tag: 'Onderbreekt de 5V-lijn', color: '#ffd23d',
    html: `<p><b>Wat:</b> een stevige wipschakelaar in een kastje, in de <b>plus-draad (5V)</b>
      tussen de voeding en de rest. Hij moet de hele led-stroom kunnen dragen → kies er een
      voor <b>minstens 10A</b> (15A bij full-white) — een flinke rocker-switch of een
      MOSFET-module. Direct erna volgt de <b>inline zekering</b>.</p>
      <p><b>Tip:</b> tijdens het ontwikkelen voed je de ESP32 via USB (programmeren) en laat je
      de 5V/VIN-draad los; de leds krijgen hun stroom van de voeding (massa's wél verbonden).
      Voor een zelfstandige opstelling voer je 5V naar de 5V/VIN-pin — maar dan USB eraf.</p>
      <p>De knop <b>⏻ Aan / Uit</b> rechtsonder zet deze schakelaar om — kijk maar naar de wip.</p>`,
  },
  fuse: {
    name: 'Inline zekering (10A)', tag: 'Smeltzekering in de +5V-lijn, met het 5V-verdeelblok erachter', color: '#ff7a4d',
    html: `<p><b>Wat:</b> een steekzekering van <b>10A</b> (rood) in een inline houder, in serie in de
      <b>+5V-hoofdlijn</b>, direct na de aan/uit-schakelaar — vóór het punt waar de 5V zich
      vertakt naar de ESP32, de levelshifter, de leds en de power-injectie. Die vertakking zit in
      het <b>verdeelblok</b> (hendelklemmen) achter de zekering.</p>
      <p><b>Waarom:</b> bij kortsluiting kan de voeding véél stroom leveren en worden dunne
      draadjes gloeiend heet. <b>Regel:</b> de zekering beschermt de <b>dunste draad</b>
      eronder, niet de last — kies hem ≤ wat je dunste 5V-draad aankan (16 AWG bij 10A).</p>
      <p><b>Full-white build?</b> Verhoog dan voeding (≥15A), zekering (15A traag), schakelaar
      én draaddikte (14 AWG) altijd <b>samen</b> — zie BEDRADING.md §4.</p>`,
    notes: [['warn','De stroomlimiet in de firmware (FastLED) is software, géén zekering — een herprogrammering of vastgelopen sketch heft hem op. Dimensioneer op wat de voeding fysiek kán leveren.']],
  },
  res: {
    name: '330Ω weerstand (data)', tag: 'Beschermt de eerste led — oranje-oranje-bruin-goud', color: '#ffd23d',
    html: `<p><b>Wat:</b> één weerstandje van 330Ω (kleurcode <b>oranje-oranje-bruin</b>, goud = ±5%) in
      serie in de <b>datadraad</b>, op het ingangsprintje vlak bij de <b>eerste</b> led (DIN). Hij dempt
      scherpe spanningspieken (reflecties) op de datalijn en beschermt zo de dataingang van led #0.</p>
      <p>Klein onderdeel, groot effect op betrouwbaarheid. Waarden van 220–470Ω zijn prima.</p>`,
  },
  cap: {
    name: '1000µF condensator', tag: 'Stroombuffer bij de leds (op het ingangsprintje)', color: '#ff5a4d',
    html: `<p><b>Wat:</b> een grote elektrolytische condensator (1000µF, <b>10–16V</b> — niet de
      6,3V-ondergrens) <b>parallel</b> over 5V en GND, op het ingangsprintje waar de stroom de
      led-keten binnenkomt. Hij vangt de plotselinge stroompieken op als veel leds tegelijk
      aanspringen, zodat de eerste leds niet "dippen".</p>
      <p><b>Let op de polariteit:</b> de poot aan de kant van de streep met minnetjes (−) gaat naar
      GND, de andere naar +5V. Verkeerd om kan hij klappen.</p>`,
    notes: [['warn','Elco\'s zijn gepolariseerd: − (streep) naar massa, + naar 5V.'],
      ['','Tip: bij lange armen ook een kleinere elco (100–470µF) bij elk power-injectiepunt.']],
  },
  lvl: {
    name: 'Levelshifter (3,3V→5V)', tag: '74AHCT125 (DIP-14) op het breadboard', color: '#36c7ff',
    html: `<p><b>Wat:</b> een chipje dat het <b>3,3V-datasignaal</b> van de ESP32 omzet naar een
      nette <b>5V</b>, want dat willen de WS2812-leds zien als een "1". Een <b>74AHCT125</b> (of
      74HCT245) is ideaal: hij accepteert 3,3V aan de ingang en geeft 5V uit.</p>
      <p><b>Aansluiting:</b> voed hem met <b>5V</b> (pin 14) en deel zijn <b>GND</b> (pin 7) met de
      ESP32 — anders is zijn 5V-uitgang ongeldig. Eén kanaal volstaat: <b>ingang 1A</b> (pin 2) =
      GPIO13, <b>uitgang 1Y</b> (pin 3) → de 330Ω → de eerste led. De <b>1OE</b> (pin 1, actief-laag)
      gaat met het korte zwarte jumpertje naar <b>GND</b> (pin 7) — dan is de uitgang actief.</p>`,
    notes: [['','Op een 5V-microcontroller (Arduino Mega) is dit niet nodig; die stuurt de leds rechtstreeks aan.']],
  },
  ps3: {
    name: 'Draadloze controller', tag: 'PS4/PS5/Xbox/8BitDo/Switch Pro (of DS3)', color: '#c77bff',
    html: `<p><b>Wat:</b> de controller waarmee je speelt — dezelfde knoppen als de widget rechtsboven.
      <b>D-pad</b> = de selectie bewegen, <b>face-knoppen □✕○△</b> = een draaivlak / grip kiezen,
      <b>linkerstick ←/→</b> = draairichting, <b>● linkerstick (L3)</b> = 4D-rotatie,
      <b>● rechterstick (R3)</b> = zet terug (undo), <b>SELECT/START</b> = husselen/reset.</p>
      <p><b>Verbinding:</b> draadloos via Bluetooth, <b>rechtstreeks naar de ingebouwde radio van de
      ESP32</b> (met Bluepad32) — geen dongle. Een PS4/PS5/Xbox/8BitDo/Switch-Pro koppel je gewoon in
      pairing-modus; een oude DualShock 3 heeft een eenmalige koppelstap.</p>`,
    notes: [['','De controller-widget op het scherm is een 1-op-1 spiegel van deze knoppen.']],
  },
  rig: {
    name: 'De 189 WS2812B-leds', tag: '7 kubussen × 27 = 189 (NeoPixel)', color: '#ff9e2c',
    html: `<p><b>Wat:</b> dit is je fysieke kubus uit het 3D-model — 7 kubussen (midden + 6 armen) van
      elk 3×3×3 = 27 matwitte kubusjes (PETG), met in elk kubusje één led. <b>Totaal 189 individueel
      adresseerbare WS2812B-leds</b> (NeoPixels).</p>
      <p><b>Slim eraan:</b> ze hangen in <b>één lange ketting</b> aan <u>één</u> datadraad. Elke
      led heeft een chip die "de eerste kleur voor mij houdt en de rest doorgeeft". Daarom is er
      maar <b>1 datapin</b> (GPIO13, via de levelshifter) nodig voor alle 189.</p>
      <p><b>Ingang:</b> de kabelboom loopt langs de voet en het statief omhoog naar het
      <b>ingangsprintje</b> onder de middelste kubus: schroefklemmen 5V/GND/DATA, de 1000µF-elco en de
      330Ω-weerstand — vlak bij led #0.</p>
      <p><b>Speel hier ook echt:</b> klik op een kubusje om een cel te kiezen, of gebruik de
      controller. Bij een draai verschuiven alléén de <b>kleuren</b> en loopt er een heldere golf in de
      draairichting — precies wat de WS2812 doet.</p>
      <p><b>Power-injectie:</b> omdat 5V over zo'n lange keten wegzakt, voer je elke 54 leds 5V + GND
      opnieuw in (strip #54 linker arm, #108 onderste arm, #162 achterste arm) — de rode/zwarte
      draadparen langs de staven.</p>`,
    notes: [['','Bedrading-volgorde van de leds: zie ORIENT in engine.js en het schema in BEDRADING.md — led-nummer 0..26 per kubus op een vaste plek, zodat de firmware-kleuren kloppen.'],
      ['','Zet “🧵 Led-draad” aan (Weergave): de kubusjes worden doorzichtig en je ziet hoe één datadraad alle 189 leds in serie rijgt — geel binnen een kubus, cyaan de sprong naar de volgende (volgorde C→R→L→U→D→F→B).']],
  },
};

const MENU = [
  ['Besturing', ['esp','lvl']],
  ['Voeding', ['psu','sw','fuse','cap','res']],
  ['Invoer', ['ps3']],
  ['Uitvoer', ['rig']],
];

/* ============================================================================
   STAGE — renderer, room, bench, lights, post-processing (bench/stage.js)
   ========================================================================== */
const canvas = document.getElementById('scene');
const elLoading = document.getElementById('loading');
let stage;
try {
  stage = createStage(canvas);
} catch (err) {
  if (elLoading) elLoading.innerHTML = '⚠️ WebGL is niet beschikbaar in deze browser, dus de 3D-werkbank kan niet starten.<br>' +
    'Probeer een recente Edge/Chrome/Firefox met hardwareversnelling aan.';
  throw err;
}
const { scene, camera, controls } = stage;
const CAM0 = new THREE.Vector3(18.5, 15.5, 27.5);
const TARGET0 = new THREE.Vector3(0.4, 5.0, -1.0);
camera.position.copy(CAM0); controls.target.copy(TARGET0);

const MAT_TOP = 0.06;     // the parts stand on the ESD mat

// --------------------------------------------------------------- part registry
const TERM = {};        // TERM[partId][name] = { p, d } (world) — or an array of them (splice block)
const PART_GROUP = {};  // partId -> THREE.Group
const ANCHOR = {};      // partId -> THREE.Vector3 (label anchor, world)
const partMeshes = [];  // for raycasting; each mesh.userData.part = id
const hw = {};           // handles to animated hardware details (switch, leds, light bar)
const toWorld = (group, t) => {
  group.updateMatrixWorld(true);
  const q = new THREE.Quaternion(); group.getWorldQuaternion(q);
  return { ...t, p: group.localToWorld(t.p.clone()), d: t.d.clone().applyQuaternion(q).normalize() };
};
function setTerm(id, name, group, t) { (TERM[id] ||= {})[name] = Array.isArray(t) ? t.map(x => toWorld(group, x)) : toWorld(group, t); }
function registerPart(id, group, anchorWorld = null) {
  PART_GROUP[id] = group; group.userData.part = id;
  group.traverse(o => { if (o.isMesh) { o.userData.part = id; partMeshes.push(o); } });
  if (!group.parent) scene.add(group);
  scene.updateMatrixWorld(true);
  if (anchorWorld) ANCHOR[id] = anchorWorld;
  else {
    const b = new THREE.Box3().setFromObject(group);
    ANCHOR[id] = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.25, (b.min.z + b.max.z) / 2);
  }
}
const up = new THREE.Vector3(0, 1, 0);

/* --------------------------------------------------------- the electronics --- */
// breadboard (decor, not a part) with the ESP32 and the 74AHCT125 plugged in
const BBPOS = new THREE.Vector3(2.8, MAT_TOP, 3.0);
const bb = P.buildBreadboard();
bb.group.position.copy(BBPOS); scene.add(bb.group);
const hole = (col, row) => ({ p: bb.hole(col, row), d: up.clone(), hole: true });

(function placeESP32() {
  const e = P.buildESP32();
  // J2 pin k (0-based) sits in breadboard column 37−k, row i (row j behind it stays free)
  const pin1 = bb.hole(37, 'i');
  e.group.position.set(BBPOS.x + pin1.x - P.mm(DEVKIT.pinX(0)), BBPOS.y + bb.top, BBPOS.z + pin1.z + P.mm(DEVKIT.ROWSEP / 2));
  scene.add(e.group);
  registerPart('esp', e.group);
  setTerm('esp', '5Vin', bb.group, hole(19, 'j'));    // J2 pin 19 = 5V
  setTerm('esp', 'GNDin', bb.group, hole(24, 'j'));   // J2 pin 14 = GND
  setTerm('esp', 'D13', bb.group, hole(23, 'j'));     // J2 pin 15 = GPIO13
  setTerm('esp', 'BT', e.group, { p: e.antenna, d: up.clone() });
  e.group.traverse(o => { if (o.userData.role === 'powerLed') hw.espLed = o; });
})();

(function placeLevelShifter() {
  const c = P.buildDIP14('74AHCT125N');
  const mid = bb.hole(46, 'f').add(bb.hole(46, 'e')).multiplyScalar(0.5);   // straddles the channel
  c.group.position.set(BBPOS.x + mid.x, BBPOS.y + bb.top, BBPOS.z + mid.z);
  scene.add(c.group);
  registerPart('lvl', c.group);
  setTerm('lvl', 'in', bb.group, hole(48, 'h'));      // pin 2 = 1A
  setTerm('lvl', 'out', bb.group, hole(47, 'j'));     // pin 3 = 1Y
  setTerm('lvl', 'GND', bb.group, hole(43, 'j'));     // pin 7 = GND
  setTerm('lvl', 'VCC', bb.group, hole(49, 'c'));     // pin 14 = VCC
})();

(function placePSU() {
  const p = P.buildPSU();
  p.group.position.set(-7.4, MAT_TOP, 2.2);
  scene.add(p.group);
  registerPart('psu', p.group);
  setTerm('psu', '+5V', p.group, p.screws.VP1);
  setTerm('psu', 'GND', p.group, p.starOut);          // the GND star point: 6 wire entries
  hw.psu = p;
})();

(function placeSwitch() {
  const s = P.buildSwitchBox();
  s.group.position.set(-4.5, MAT_TOP, 5.6);
  scene.add(s.group);
  registerPart('sw', s.group);
  setTerm('sw', 'in', s.group, s.in);
  setTerm('sw', 'out', s.group, s.out);
  hw.switchBox = s;
})();

(function placeFuse() {
  const f = P.buildFuse();
  f.group.position.set(-2.25, MAT_TOP, 6.1);
  scene.add(f.group);
  registerPart('fuse', f.group);
  setTerm('fuse', 'in', f.group, f.in);
  setTerm('fuse', 'out', f.group, f.out);             // the 5V splice block: 6 wire entries
  hw.fuse = f;
})();

(function placeGamepad() {
  const gp = P.buildGamepad();
  gp.group.position.set(2.6, MAT_TOP, 6.95); gp.group.rotation.y = -0.14;
  scene.add(gp.group);
  registerPart('ps3', gp.group);
  setTerm('ps3', 'BT', gp.group, { p: gp.antenna, d: up.clone() });
  hw.gamepad = gp;
})();

(function placeProps() {
  const spool = P.buildSolderSpool(); spool.position.set(-14.5, 0, 6.2); scene.add(spool);
  const dmm = P.buildMultimeter(); dmm.group.position.set(11.6, 0, -0.4); dmm.group.rotation.y = -0.55; scene.add(dmm.group);
  for (const o of [spool, dmm.group]) o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
})();

/* ============================================================================
   THE PLAYABLE RIG — 7 cells of 27 frosted PETG cubies, an led in each.
   Same verified engine, ORIENT layout and permutation-wave as the firmware.
   ========================================================================== */
const puzzle = new Tesseract();

// D = cube-centre distance, S = led/cubie pitch, CUB = cubie edge (≈ 25 mm pitch, 20 mm cubie)
const RIG = { D: 4.3, S: 0.62, CUB: 0.5, OFFSET: new THREE.Vector3(0, 7.4, -4.2) };
const HALF = RIG.S + RIG.CUB / 2;                // half the outer size of one 3x3x3 cell
// engine slot -> view direction, in-scene cube centre (scaled by D), nl, and the PHYSICAL
// global nav lattice: `centre` = the cube's pos direction at ±3, so gcoord/cellAt use the
// SAME orientation as the real led layout (ORIENT) — navigation lands on the cell you see.
const SLOTS = {
  C: { view: 'W-', nl: 'midden', pos: [ 0, 0, 0],         centre: [ 0, 0, 0] },
  R: { view: 'X+', nl: 'rechts', pos: [ RIG.D, 0, 0],     centre: [ 3, 0, 0] },
  L: { view: 'X-', nl: 'links',  pos: [-RIG.D, 0, 0],     centre: [-3, 0, 0] },
  U: { view: 'Y+', nl: 'boven',  pos: [ 0, RIG.D, 0],     centre: [ 0, 3, 0] },
  D: { view: 'Y-', nl: 'onder',  pos: [ 0,-RIG.D, 0],     centre: [ 0,-3, 0] },
  B: { view: 'Z-', nl: 'achter', pos: [ 0, 0,-RIG.D],     centre: [ 0, 0,-3] },
  F: { view: 'Z+', nl: 'voor',   pos: [ 0, 0, RIG.D],     centre: [ 0, 0, 3] },
};
const SLOT_ORDER = ['C', 'R', 'L', 'U', 'D', 'F', 'B'];

const decodeVi = idx => [ (idx % 3) - 1, (Math.floor(idx / 3) % 3) - 1, Math.floor(idx / 9) - 1 ];
const POS_LABEL = ['kern', 'vlak', 'rand', 'hoek'];
const posLabelOf = idx => POS_LABEL[decodeVi(idx).filter(v => v !== 0).length];
const isCentreCell = s => { const [a, b, c] = decodeVi(s.idx); return a === 0 && b === 0 && c === 0; };

// led brightness levels (relative, like the firmware's I_BASE / I_SELCUBE / I_SEL)
const BASE_I = 0.3, SEL_CUBE_I = 0.45, SEL_I = 1.7, OFF_I = 0;
const LED_GAIN = 2.8;                            // brightness -> emissive radiance of a lit cubie
const BLEED = 0.07;                              // share of a neighbour's light that glows through the PETG
const TWIST_MS = 1500;                           // = TWIST_MS in the firmware

const meshes = {};        // slot -> [27] cubie records { position, userData } (engine idx)
const rigLeds = [];       // the same records in TRUE strip order (slot*27 + idx) = instance index
let cubies = null;        // ONE InstancedMesh draws all 189 cubies (per-instance emitted colour)
const chainPts = [];      // each led's local position, in strip order
const glowLights = {};    // slot -> PointLight (coloured spill of that cell)
let chainGroup = null, chainPulse = null;
const P_LOCAL = (x, y, z) => new THREE.Vector3(x, y, z).add(RIG.OFFSET);   // rig-local -> world

(function buildRig() {
  const g = new THREE.Group(); g.position.copy(RIG.OFFSET);

  // ---- the frame (as in the Blender model): rods between the cube FACES, a pole from the
  //      bottom (D) cube down into a round, weighted foot. Brushed aluminium, flanged ends.
  const alu = () => new THREE.MeshPhysicalMaterial({ color: 0xc3c8cf, metalness: 1, roughness: 0.32,
    anisotropy: 0.65, anisotropyRotation: Math.PI / 2 });
  const UPaxis = new THREE.Vector3(0, 1, 0);
  const deco = (m) => { m.userData.shell = true; m.raycast = () => {}; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const rod = (a, b, r, mat = alu()) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 20, 1, true), mat);
    m.position.copy(a).lerp(b, 0.5); m.quaternion.setFromUnitVectors(UPaxis, dir.normalize());
    return deco(m);
  };
  const flange = (p, n) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.035, 24), alu());
    m.position.copy(p); m.quaternion.setFromUnitVectors(UPaxis, n); return deco(m);
  };
  for (const slot of ['R', 'L', 'U', 'D', 'F', 'B']) {
    const n = new THREE.Vector3(...SLOTS[slot].pos).normalize();
    const a = n.clone().multiplyScalar(HALF), b = n.clone().multiplyScalar(RIG.D - HALF);
    rod(a, b, 0.045);
    flange(a.clone().addScaledVector(n, 0.017), n); flange(b.clone().addScaledVector(n, -0.017), n.clone().negate());
  }
  // the stand: weighted round foot (disc + domed top + rubber ring) and the pole up to cube D
  const FOOT_BOTTOM = -RIG.OFFSET.y;                      // local y of the bench top
  const footMat = new THREE.MeshStandardMaterial({ color: 0x41464e, metalness: 0.85, roughness: 0.38 });
  const disc = deco(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 0.38, 72), footMat));
  disc.position.set(0, FOOT_BOTTOM + 0.21, 0);
  const dome = deco(new THREE.Mesh(new THREE.SphereGeometry(1.7, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), footMat));
  dome.scale.set(1, 0.32, 1); dome.position.set(0, FOOT_BOTTOM + 0.4, 0);
  const rubber = deco(new THREE.Mesh(new THREE.CylinderGeometry(2.28, 2.28, 0.04, 72), new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.95 })));
  rubber.position.set(0, FOOT_BOTTOM + 0.02, 0);
  const poleTop = new THREE.Vector3(0, -RIG.D - HALF, 0);
  rod(new THREE.Vector3(0, FOOT_BOTTOM + 0.9, 0), poleTop, 0.065);
  flange(poleTop.clone().add(new THREE.Vector3(0, -0.017, 0)), new THREE.Vector3(0, -1, 0));
  flange(new THREE.Vector3(0, FOOT_BOTTOM + 0.93, 0), UPaxis);

  // ---- 7 cells of 27 frosted cubies: white PETG that glows in the colour of the led inside.
  //      One InstancedMesh (1 draw call instead of 189); the per-instance colour is used as the
  //      EMITTED light (shader hook), so the plastic itself stays white.
  const cubieGeo = new RoundedBoxGeometry(RIG.CUB, RIG.CUB, RIG.CUB, 2, 0.04);
  const cubieMat = new THREE.MeshStandardMaterial({ color: 0x9ea3aa, roughness: 0.55, metalness: 0,
    envMapIntensity: 0.3, emissive: 0xffffff, emissiveMap: hotspotTexture() });
  cubieMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>',
        'totalEmissiveRadiance = vColor * texture2D( emissiveMap, vEmissiveMapUv ).rgb;');
  };
  cubies = new THREE.InstancedMesh(cubieGeo, cubieMat, SLOT_ORDER.length * 27);
  cubies.castShadow = true; cubies.receiveShadow = true; cubies.frustumCulled = false;
  cubies.userData.keepEmissive = true; cubies.userData.cubies = true;
  const mtx = new THREE.Matrix4();
  for (const slot of SLOT_ORDER) {
    const [cx, cy, cz] = SLOTS[slot].pos;
    meshes[slot] = new Array(27);
    for (let idx = 0; idx < 27; idx++) {
      const [i, j, k] = decodeVi(idx);
      const [ox, oy, oz] = ORIENT[slot](i, j, k);     // real physical spot (= engine/firmware solder map)
      const n = SLOT_ORDER.indexOf(slot) * 27 + idx;  // instance index = strip index
      const rec = { n, position: new THREE.Vector3(cx + ox * RIG.S, cy + oy * RIG.S, cz + oz * RIG.S),
        userData: { slot, idx, led: new THREE.Color(0, 0, 0), inten: 0, boost: 0, nb: [] } };
      cubies.setMatrixAt(n, mtx.makeTranslation(rec.position));
      cubies.setColorAt(n, rec.userData.led);
      meshes[slot][idx] = rec;
    }
    // the coloured light a lit cell throws onto the frame, the rig and the bench
    const pl = new THREE.PointLight(0xffffff, 0, 9, 2);
    pl.position.set(cx, cy, cz); g.add(pl); glowLights[slot] = pl;
  }
  // face neighbours inside the same cell: a bright led glows faintly through the PETG next to it
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    const [i, j, k] = decodeVi(idx), nb = [];
    for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const a = i + di, b = j + dj, c = k + dk;
      if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) <= 1) nb.push(meshes[slot][(a + 1) + 3 * (b + 1) + 9 * (c + 1)]);
    }
    meshes[slot][idx].userData.nb = nb; meshes[slot][idx].userData.inten = 0;
  }
  // strip-order list + chain positions (C(0..26) R L U D F B(..188))
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    rigLeds.push(meshes[slot][idx]); chainPts.push(meshes[slot][idx].position.clone());
  }
  cubies.computeBoundingSphere(); g.add(cubies);

  // the data "draad": one wire threading all 189 leds in strip order (hidden until toggled).
  chainGroup = new THREE.Group(); chainGroup.visible = false; g.add(chainGroup);
  const C_DATA = 0xffd23d, C_JUMP = 0x36c7ff;
  for (let n = 0; n < chainPts.length - 1; n++) {
    const a = chainPts[n], b = chainPts[n + 1], jump = (n % 27) === 26;
    const dir = new THREE.Vector3().subVectors(b, a);
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(jump ? 0.03 : 0.018, jump ? 0.03 : 0.018, dir.length(), 8),
      new THREE.MeshStandardMaterial({ color: jump ? C_JUMP : C_DATA, emissive: jump ? C_JUMP : C_DATA, emissiveIntensity: 1.2, roughness: 0.35 }));
    seg.position.copy(a).lerp(b, 0.5);
    seg.quaternion.setFromUnitVectors(UPaxis, dir.normalize());
    seg.userData.shell = true; seg.raycast = () => {};
    chainGroup.add(seg);
  }
  chainPulse = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 4 }));
  chainPulse.userData.shell = true; chainPulse.raycast = () => {}; chainGroup.add(chainPulse);

  // ---- the input board (5V / GND / DATA screw terminal, 1000µF, 330Ω) clamped on the rod
  //      between cube D and cube C, right below led #0.
  const ib = P.buildInputBoard();
  ib.group.position.set(0, -HALF - 0.83, 0.545);
  ib.group.traverse(o => { if (o.isMesh) { o.userData.shell = true; } });
  g.add(ib.group);
  scene.add(g);
  registerPart('rig', g, P_LOCAL(0, RIG.D + HALF + 0.45, 0));

  // the 1000µF and the 330Ω are their own clickable parts, mounted ON the input board
  const cap = P.buildCapacitor();
  cap.group.position.copy(ib.pad(-4, -1)); ib.group.add(cap.group);
  scene.updateMatrixWorld(true);
  registerPart('cap', cap.group, cap.group.localToWorld(new THREE.Vector3(-0.9, 0.1, 0.25)));
  const res = P.buildResistor();
  res.group.position.copy(ib.pad(4, -1)); ib.group.add(res.group);
  scene.updateMatrixWorld(true);
  registerPart('res', res.group, res.group.localToWorld(new THREE.Vector3(0.95, -0.25, 0.3)));

  // terminals: the harness lands in the screw terminal (front entries); the on-board links
  // (cap, resistor) use the solder pads behind it.
  const [e5, eG, eD] = ib.entries;
  const padOf = (e) => ({ p: new THREE.Vector3(e.p.x, ib.size.y, e.p.z - P.mm(10)), d: up.clone() });
  setTerm('rig', '5V', ib.group, e5);
  setTerm('rig', 'GND', ib.group, eG);
  TERM.rig['5V'].padP = toWorld(ib.group, padOf(e5)); TERM.rig.GND.padP = toWorld(ib.group, padOf(eG));
  setTerm('res', 'in', ib.group, eD);                             // DATA screw (trace to the resistor)
  setTerm('res', 'out', ib.group, { p: ib.pad(6, -1), d: up.clone() });
  setTerm('rig', 'DIN', ib.group, { p: ib.pad(6, 1), d: up.clone() });
  setTerm('cap', '+', ib.group, { p: ib.pad(-4, -1).add(cap.plus).setY(ib.size.y), d: up.clone() });
  setTerm('cap', '-', ib.group, { p: ib.pad(-4, -1).add(cap.minus).setY(ib.size.y), d: up.clone() });

  // the short 3-core lead from the board up into cube C, to led #0 (DIN / 5V / GND)
  const led0 = meshes.C[0].position;                              // (-1,-1,-1) corner of cube C
  const entry = new THREE.Vector3(led0.x, -HALF - 0.005, led0.z);
  const pads = [TERM.rig.DIN.p, TERM.rig['5V'].padP.p, TERM.rig.GND.padP.p].map(v => g.worldToLocal(v.clone()));
  [WIRE.data5.color, WIRE.pwr.color, WIRE.gnd.color].forEach((col, n) => {
    const s = pads[n], off = (n - 1) * 0.03;
    const curve = new THREE.CatmullRomCurve3([s, s.clone().add(new THREE.Vector3(0, 0.12, 0)),
      new THREE.Vector3(-0.25 + off, -HALF - 0.28, 0.1), new THREE.Vector3(entry.x + 0.1 + off, -HALF - 0.08, entry.z + 0.25),
      entry.clone().add(new THREE.Vector3(off, 0, 0))], false, 'centripetal');
    const lead = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.014, 6, false),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }));
    lead.userData.shell = true; lead.castShadow = true; g.add(lead);
  });

  // power-injection contacts ON the first led of each injected arm (strip #54 L, #108 D, #162 B),
  // on the face of that cubie that points to the centre (where the chain enters the arm)
  const contact = (slot, axis) => {
    const c = meshes[slot][0].position.clone(); c[axis] += (RIG.CUB / 2 + 0.012) * Math.sign(-SLOTS[slot].pos[['x', 'y', 'z'].indexOf(axis)]);
    return c;
  };
  const injL = contact('L', 'x'), injB = contact('B', 'z'), injD = contact('D', 'y');
  setTerm('rig', 'INJ_L', g, { p: injL, d: new THREE.Vector3(1, 0, 0) });
  setTerm('rig', 'INJ_B', g, { p: injB, d: new THREE.Vector3(0, 0, 1) });
  setTerm('rig', 'INJ_D', g, { p: injD, d: new THREE.Vector3(0, 1, 0) });
})();

/* --------------------------------------------------------- the wires --- */
// Bench wires lie on the bench; the harness (all wires to the rig) is bundled, runs over the
// foot, climbs the pole and cube D and ends on the input board; the injection pairs branch
// off along the rods to their arm. Every wire is a smooth tube through hand-placed waypoints.
const wires = [];
const benchY = (x, z) => (x > MAT.X - MAT.W / 2 && x < MAT.X + MAT.W / 2 && z > MAT.Z - MAT.D / 2 && z < MAT.Z + MAT.D / 2) ? MAT_TOP : 0;
const onBench = (v, r) => new THREE.Vector3(v.x, benchY(v.x, v.z) + r, v.z);
const W3 = (x, y, z) => new THREE.Vector3(x, y, z);

// harness spine (world): bench -> over the foot -> up the pole -> around cube D -> rod -> board
const SPINE = [
  W3(0.35, 0, 1.15), W3(0.28, 0, -1.25), W3(0.24, 0.5, -2.05), W3(0.2, 0.98, -3.2), W3(0.18, 1.12, -3.92),
  W3(0.18, 2.03, -3.99), W3(1.02, 2.1, -3.2), W3(1.02, 3.98, -3.2), W3(0.3, 4.12, -3.97), W3(0.58, 5.18, -3.85),
];
const SPINE_EXIT = { D: 7, LB: 8, MAIN: 9 };        // index of the spine point where a branch leaves
const BUNDLE = 0.085;                               // slot spacing in the bundle
// the order in which harness wires take their slot in the bundle (n, b in the spine frame)
const HARNESS_SLOT = {
  'lvl.out>res.in': [0, 0],
  'fuse.out>rig.5V': [-1, -1], 'psu.GND>rig.GND': [-1, 1],
  'fuse.out>rig.INJ_D': [0, -1], 'psu.GND>rig.INJ_D': [0, 1],
  'fuse.out>rig.INJ_L': [1, -1], 'psu.GND>rig.INJ_L': [-1, 0],
  'fuse.out>rig.INJ_B': [1, 1], 'psu.GND>rig.INJ_B': [1, 0],
};
function spineFor(lastIdx) {
  const pts = SPINE.slice(0, lastIdx + 1).map((v, i) => (i < 2 ? onBench(v, 0.135) : v.clone()));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}
function offsetCurvePoints(curve, n, b, segs) {
  const fr = curve.computeFrenetFrames(segs, false), out = [];
  for (let i = 0; i <= segs; i++) {
    out.push(curve.getPointAt(i / segs).addScaledVector(fr.normals[i], n * BUNDLE).addScaledVector(fr.binormals[i], b * BUNDLE));
  }
  return out;
}
// branch paths (world) from the spine exit to the rig terminal, per injection / main wire
function branchFor(key, pair) {
  const o = pair * 0.036;                                       // the two wires of a pair side by side
  if (key.endsWith('INJ_D')) return { off: W3(o, 0, 0), pts: [W3(0.75 + o, 4.1, -3.45), W3(0.1 + o, 4.12, -4.3), W3(-0.5 + o, 4.14, -4.7)] };
  if (key.endsWith('INJ_L')) return { off: W3(0, 0, o), pts: [W3(-0.2, 4.15, -4.42 + o), W3(-0.1, 6.36, -4.43 + o), W3(-0.55, 6.43, -4.42 + o),
    W3(-0.97, 6.46, -4.4 + o), W3(-0.98, 7.3, -4.3 + o), W3(-1.6, 7.31, -4.26 + o), W3(-3.15, 7.31, -4.26 + o),
    W3(-3.18, 7.02, -4.6 + o), W3(-3.2, 6.82, -4.8 + o)] };
  if (key.endsWith('INJ_B')) return { off: W3(o, 0, 0), pts: [W3(-0.05 + o, 4.15, -4.45), W3(0.08 + o, 6.36, -4.45), W3(0.1 + o, 6.43, -4.8),
    W3(0.1 + o, 6.46, -5.16), W3(0.1 + o, 7.3, -5.16), W3(0.13 + o, 7.31, -5.6), W3(0.13 + o, 7.31, -7.3),
    W3(-0.15 + o, 7.05, -7.4), W3(-0.5 + o, 6.84, -7.44)] };
  return { off: W3(0, 0, 0), pts: [W3(0.52, 5.55, -3.12)] };    // main: in front of the board
}
// a seeded "hand laid" sideways offset so parallel bench wires do not look ruler-straight
const wobble = (seed) => { const s = Math.sin(seed * 12.9898) * 43758.5453; return (s - Math.floor(s)) - 0.5; };

// the generic bench router: out of terminal A, down onto the bench, across, up into terminal B
function terminalRun(t, r, outward) {
  const pts = [t.p.clone()];
  if (t.hole) {                                                  // a dupont jumper plugged in a breadboard hole
    const side = outward.clone().setY(0).normalize();
    pts.push(t.p.clone().addScaledVector(up, 0.36));
    pts.push(t.p.clone().addScaledVector(up, 0.4).addScaledVector(side, 0.25));
    pts.push(onBench(t.p.clone().addScaledVector(side, 0.75), r));
  } else {
    const d = t.d.clone();
    pts.push(t.p.clone().addScaledVector(d, 0.14));
    const flat = d.clone().setY(0); if (flat.lengthSq() < 0.01) flat.copy(outward).setY(0);
    flat.normalize();
    pts.push(onBench(t.p.clone().addScaledVector(flat, 0.45), r));
  }
  return pts;
}
function benchRoute(A, B, r, via, seed) {
  const AB = new THREE.Vector3().subVectors(B.p, A.p).setY(0);
  const a = terminalRun(A, r, AB.clone().normalize());
  const b = terminalRun(B, r, AB.clone().negate().normalize()).reverse();
  const mid = [];
  if (via) via.forEach(v => mid.push(onBench(v, r)));
  else {
    const s = a[a.length - 1], e = b[0], m = s.clone().lerp(e, 0.5);
    const side = new THREE.Vector3(-(e.z - s.z), 0, e.x - s.x).normalize();
    m.addScaledVector(side, wobble(seed) * Math.min(0.9, s.distanceTo(e) * 0.12));
    mid.push(onBench(m, r));
  }
  return [...a, ...mid, ...b];
}
// a wire bridge between two nearby solder pads on the input board
function bridgeRoute(A, B) {
  const lift = Math.min(0.08, A.p.distanceTo(B.p) * 0.35);
  return [A.p.clone(), A.p.clone().addScaledVector(up, lift), B.p.clone().addScaledVector(up, lift), B.p.clone()];
}
// a dupont jumper between two breadboard holes: a short arc over the board
function jumperRoute(A, B) {
  const m = A.p.clone().lerp(B.p, 0.5); m.y += 0.42;
  return [A.p.clone(), A.p.clone().addScaledVector(up, 0.3), m, B.p.clone().addScaledVector(up, 0.3), B.p.clone()];
}
// optional hand-placed waypoints (on the bench) for runs that would cut through a part
const VIA = {
  'psu.+5V>sw.in': [W3(-5.75, 0, 3.6)],
  'fuse.out>esp.5Vin': [W3(-0.6, 0, 3.9), W3(0.2, 0, 2.05)],
  'psu.GND>esp.GNDin': [W3(-3.6, 0, 1.6), W3(0.4, 0, 1.85)],
  'psu.GND>lvl.GND': [W3(-3.4, 0, 1.45), W3(2.0, 0, 1.75)],
  'fuse.out>lvl.VCC': [W3(0.3, 0, 4.55), W3(3.4, 0, 4.15)],
};
const fanUsed = {};
function pickTerm(id, name, otherId) {
  const t = TERM[id]?.[name];
  if (!t) return null;
  if (Array.isArray(t)) { const k = id + '.' + name; fanUsed[k] = (fanUsed[k] || 0); return t[fanUsed[k]++ % t.length]; }
  if (t.padP && (otherId === 'cap' || otherId === 'res')) return t.padP;   // on-board link -> solder pad
  return t;
}

const markerGeo = new THREE.SphereGeometry(0.026, 10, 8);
function buildWires() {
  const decorBlack = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.5 });
  const pinMetal = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.3 });
  CONNECTIONS.forEach((c, n) => {
    const [pa, ta, pb, tb, cat] = c;
    const key = `${pa}.${ta}>${pb}.${tb}`;
    const A = pickTerm(pa, ta, pb), B = pickTerm(pb, tb, pa);
    if (!A || !B) { console.warn('missing terminal', pa, ta, pb, tb); return; }
    const W = WIRE[cat];
    let pts, m, r = W.r;
    if (cat === 'bt') {
      // the wireless Bluetooth link: a dashed arc (no wire) so it reads as "over the air"
      const mid = A.p.clone().lerp(B.p, 0.5); mid.y += 1.6;
      const curve = new THREE.QuadraticBezierCurve3(A.p.clone(), mid, B.p.clone());
      m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),
        new THREE.LineDashedMaterial({ color: W.color, transparent: true, opacity: 0.85, dashSize: 0.12, gapSize: 0.1 }));
      m.computeLineDistances();
      scene.add(m);
      wires.push(mkWire(m, c, curve, cat));
      return;
    }
    const ab = A.hole && B.hole;
    if (A.hole !== B.hole && (A.hole || B.hole)) r = Math.min(r, 0.026);   // 22 AWG into the breadboard
    if (HARNESS_SLOT[key]) {
      const [sn, sb] = HARNESS_SLOT[key];
      const exit = key.endsWith('INJ_D') ? SPINE_EXIT.D : (key.includes('INJ_') ? SPINE_EXIT.LB : SPINE_EXIT.MAIN);
      const spine = spineFor(exit);
      const segs = Math.max(24, Math.round(spine.getLength() * 6));
      const sp = offsetCurvePoints(spine, sn, sb, segs);
      const lead = terminalRun(A, r, new THREE.Vector3().subVectors(sp[0], A.p).setY(0).normalize());
      const back = sp[0].clone().add(new THREE.Vector3().subVectors(sp[0], sp[1]).setY(0).normalize().multiplyScalar(0.55));
      const br = branchFor(key, cat === 'pwr' ? -1 : 1);
      const end = [B.p.clone().addScaledVector(B.d, 0.16).add(br.off), B.p.clone().add(br.off)];
      pts = [...lead, onBench(back, sp[0].y - benchY(back.x, back.z)), ...sp, ...br.pts, ...end];
    } else if (ab) {
      pts = jumperRoute(A, B);
    } else if (A.p.distanceTo(B.p) < 0.8) {
      pts = bridgeRoute(A, B); r = Math.min(r, 0.012);
    } else {
      pts = benchRoute(A, B, r, VIA[key], n + 1);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, Math.max(24, Math.round(curve.getLength() * 14)), r, 8, false);
    m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: W.color, roughness: 0.42, metalness: 0,
      emissive: W.color, emissiveIntensity: 0 }));
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    // dupont housings where a wire plugs into the breadboard
    for (const t of [A, B]) if (t.hole) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.3, 0.065), decorBlack);
      h.position.copy(t.p).addScaledVector(up, 0.17); h.castShadow = true; scene.add(h);
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.04, 0.018), pinMetal);
      pin.position.copy(t.p).addScaledVector(up, 0.01); scene.add(pin);
    }
    wires.push(mkWire(m, c, curve, cat));
  });
  // decorative links that are not in CONNECTIONS: 1OE -> GND jumper, fuse lead -> splice
  // block, PSU −V -> GND star, the mains cable off the back of the bench
  const deco = (pts, col, r) => {
    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 48, r, 8, false),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }));
    t.castShadow = true; scene.add(t); return t;
  };
  const oe = bb.group.localToWorld(bb.hole(49, 'g')), g7 = bb.group.localToWorld(bb.hole(43, 'g'));
  deco([oe, oe.clone().add(W3(0, 0.08, 0)), oe.clone().lerp(g7, 0.5).add(W3(0, 0.12, 0)), g7.clone().add(W3(0, 0.08, 0)), g7], 0x1d1e22, 0.016);
  const fl = toWorld(hw.fuse.group, hw.fuse.leadOut), fb = toWorld(hw.fuse.group, hw.fuse.blockIn);
  deco([fl.p, fl.p.clone().addScaledVector(fl.d, 0.2), onBench(fl.p.clone().add(W3(0.5, 0, -0.2)), 0.04),
    onBench(fb.p.clone().add(W3(-0.25, 0, -0.45)), 0.04), fb.p.clone().addScaledVector(fb.d, 0.18), fb.p], WIRE.pwr.color, 0.04);
  const vm = toWorld(hw.psu.group, hw.psu.screws.VM1), si = toWorld(hw.psu.group, hw.psu.starIn);
  deco([vm.p, vm.p.clone().addScaledVector(vm.d, 0.2), onBench(vm.p.clone().add(W3(0.35, 0, -0.3)), 0.04),
    onBench(si.p.clone().add(W3(0.5, 0, -0.35)), 0.04), si.p.clone().addScaledVector(si.d, 0.2), si.p], WIRE.gnd.color, 0.04);
  const sheath = [];
  const cores = [['L', 0x7a4a26], ['N', 0x2a5bd7], ['PE', 0x7fbf3a]];
  const join = toWorld(hw.psu.group, { p: new THREE.Vector3(P.mm(70), P.mm(10), P.mm(-60)), d: up });
  cores.forEach(([k, col], i) => {
    const s = toWorld(hw.psu.group, hw.psu.screws[k]);
    deco([s.p, s.p.clone().addScaledVector(s.d, 0.18), onBench(s.p.clone().add(W3(0.4, 0, -0.25 - i * 0.05)), 0.03), join.p.clone().add(W3(0, 0.03, 0))], col, 0.028);
  });
  sheath.push(join.p, onBench(W3(-5.4, 0, -0.6), 0.09), onBench(W3(-6.2, 0, -6.5), 0.09), W3(-6.4, 0.09, -10.9),
    W3(-6.5, -0.6, -11.25), W3(-6.6, -6, -11.3), W3(-6.7, -16, -11.2), W3(-6.6, -22.4, -10.4), W3(-5.0, -22.42, -8.6));
  deco(sheath, 0x2b2d31, 0.085);
  // cable ties around the pole + harness, and around the rod + harness
  const tie = (y, cx, cz, rr) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.014, 6, 40), new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.6 }));
    t.rotation.x = Math.PI / 2; t.position.set(cx, y, cz); t.scale.set(1, 0.72, 1); scene.add(t);
  };
  tie(1.45, 0.09, -4.08, 0.25); tie(1.85, 0.09, -4.08, 0.25); tie(4.7, 0.2, -4.06, 0.22);
}
function mkWire(mesh, conn, curve, type) {
  const markers = [];
  if (type !== 'bt') for (const off of [0, 0.5]) {
    const glowCol = type === 'gnd' ? 0x8fa3c2 : WIRE[type].color;          // black wire -> a cool-white pulse
    const s = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: glowCol, emissive: glowCol, emissiveIntensity: 2.2 }));
    s.userData.off = off; s.castShadow = false; scene.add(s); markers.push(s);
  } else for (const off of [0, 0.33, 0.66]) {
    const s = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: WIRE.bt.color, emissive: WIRE.bt.color, emissiveIntensity: 2.4 }));
    s.userData.off = off; scene.add(s); markers.push(s);
  }
  return { mesh, conn, parts: [conn[0], conn[2]], type, curve, markers };
}
buildWires();

/* ============================================================================
   GAME LOGIC — engine readout, permutation-wave animation, navigation, actions.
   (Drives the rig cubies above via the verified engine — same as the firmware.)
   ========================================================================== */
const KP = (s, i) => s + '#' + i;
let sel = { slot: 'C', idx: 13 };       // selected cell (13 = vi [0,0,0] core of cube 0)
let powerOn = true, scrambledOnce = false, solved = true, moves = 0;
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
// U/D on y, F/B on z.
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
      tbl[slot][idx] = new THREE.Color(led ? led.rgb : 0x000000);
    }
  }
  return tbl;
}
// a cubie shows its led colour as emitted light; the PETG itself stays white. The colour is
// stored here; applyLeds() turns colour × brightness (+ bleed) into the emitted radiance.
function setLed(m, col) { m.userData.led.copy(col); }
function setColors() {
  const to = readColors();
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    setLed(meshes[slot][idx], to[slot][idx]);
    meshes[slot][idx].userData.boost = 0;
  }
  colorAnim = null;
}

// permutation-following colour+brightness sweep. pre = placements() BEFORE the move.
function startMoveAnim(pre) {
  const from = {}, to = readColors();
  for (const slot of SLOT_ORDER) {
    from[slot] = [];
    for (let idx = 0; idx < 27; idx++) from[slot][idx] = meshes[slot][idx].userData.led.clone();
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
    sel = { slot: 'C', idx: 13 }; pulse['C'] = 1.0; armPlane = null;
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
function setPower(on) {
  powerOn = on;
  hw.switchBox.setOn(on);
  hw.gamepad.setOn(on);
  if (hw.espLed) hw.espLed.material.emissiveIntensity = on ? 3 : 0;
  if (!on) { armDir = 0; armPlane = null; }
  stage.requestShadowUpdate();
  updateController();
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
elG('btn-4dreset').onclick = doViewReset;
elG('btn-power').onclick = () => setPower(!powerOn);

// --------------------------------------------------------------- on-screen controller (clicks)
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
  if (e.ctrlKey || e.metaKey || e.altKey) return;                               // leave browser shortcuts alone
  if (e.repeat) return;                                                         // held keys never repeat an action
  const k = e.key.toLowerCase();
  if (e.shiftKey && k === 's') { e.preventDefault(); doScramble(); return; }   // Shift+S = husselen
  if (e.shiftKey && k === 'r') { e.preventDefault(); doReset(); return; }       // Shift+R = reset
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
// a held arrow key whose keyup is lost (window switch) must not leave a direction armed
addEventListener('blur', () => { if (armDir !== 0) { armDir = 0; updateController(); } });

/* ============================================================================
   UI — menu, info panel, labels, selection, camera fly-to
   ========================================================================== */
const elMenu = document.getElementById('menu');
const elInfo = document.getElementById('info');
const elInfoBody = document.getElementById('info-body');
const elLabels = document.getElementById('labels');
let selected = null;

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

// wire legend (generated, so it always matches WIRE)
const elLegend = document.getElementById('wire-legend');
if (elLegend) elLegend.innerHTML = Object.values(WIRE).map(w =>
  `<span class="leg"><i style="background:${hex6(w.color)}"></i> ${w.label}</span>`).join('');

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
      `<tr><td class="pin"><span class="swatch" style="background:${hex6(WIRE[r.cat].color)}"></span>${r.self}</td>`
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

// ---- camera fly-to: frame the selected part (keeps the current viewing direction)
let flight = null;
controls.addEventListener('start', () => { flight = null; });
function flyTo(pos, target, ms = 900) {
  flight = { t: 0, ms, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone() };
}
function focusPart(id) {
  const box = new THREE.Box3().setFromObject(PART_GROUP[id]);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = THREE.MathUtils.clamp(sph.radius / Math.sin(fov / 2) * 1.35, 0.9, 40);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.3) { dir.y = 0.3; dir.normalize(); }
  flyTo(sph.center.clone().addScaledVector(dir, dist), sph.center);
}

// ---- highlight: the selected part glows softly, its wires light up, other wires fade
function tintPart(id, k) {
  PART_GROUP[id]?.traverse(o => {
    if (!o.isMesh || o.userData.keepEmissive || o.userData.slot !== undefined) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m.emissive) return;
      if (k > 0) { m.emissive.setHex(0xffc23d); m.emissiveIntensity = k; }
      else { m.emissive.setHex(0x000000); m.emissiveIntensity = 1; }
    });
  });
}
function select(id) {
  if (selected && selected !== id) tintPart(selected, 0);
  selected = id;
  renderInfo(id);
  for (const k in menuBtns) menuBtns[k].classList.toggle('sel', k === id);
  for (const k in labelEls) labelEls[k].classList.toggle('sel', k === id);
  highlightWires(id);
  focusPart(id);
}
function clearSelect() {
  if (selected) tintPart(selected, 0);
  selected = null; elInfo.classList.add('hidden');
  for (const k in menuBtns) menuBtns[k].classList.remove('sel');
  for (const k in labelEls) labelEls[k].classList.remove('sel');
  highlightWires(null);
}
document.getElementById('info-close').onclick = clearSelect;

function styleWire(w, mode) {            // mode: 'normal' | 'lit' | 'dim'
  const m = w.mesh.material;
  if (w.type === 'bt') { m.opacity = mode === 'dim' ? 0.15 : (mode === 'lit' ? 1 : 0.85); return; }
  m.emissiveIntensity = mode === 'lit' ? 0.55 : 0;
  m.opacity = mode === 'dim' ? 0.22 : 1;
  m.transparent = mode === 'dim'; m.depthWrite = mode !== 'dim';
}
function highlightWires(id) {
  for (const w of wires) {
    if (chainOn) { styleWire(w, w.parts.includes('rig') ? 'lit' : 'dim'); continue; }
    styleWire(w, !id ? 'normal' : (w.parts.includes(id) ? 'lit' : 'dim'));
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
  if (o.userData.cubies) { const c = rigLeds[hit.instanceId].userData; selectCell(c.slot, c.idx); }  // a cubie -> play
  else if (o.userData.part) select(o.userData.part);                                                // a part -> info
});

/* --------------------------------------------------------- view toggles --- */
let flowOn = true, labelsOn = true;
const tgFlow = document.getElementById('tg-flow');
const tgLabels = document.getElementById('tg-labels');
tgFlow.onclick = () => { flowOn = !flowOn; tgFlow.classList.toggle('on', flowOn); };
tgLabels.onclick = () => { labelsOn = !labelsOn; tgLabels.classList.toggle('on', labelsOn);
  elLabels.style.display = labelsOn ? 'block' : 'none'; };
document.getElementById('btn-reset-view').onclick = () => flyTo(CAM0, TARGET0);

let frameSweep = null;
document.getElementById('btn-frame').onclick = () => { frameSweep = { t: 0 }; };

// "Led-draad": the cubies turn see-through and the one data wire through all 189 leds shows.
let chainOn = false, chainHead = 0;
const tgChain = document.getElementById('tg-chain');
tgChain.onclick = () => {
  chainOn = !chainOn; tgChain.classList.toggle('on', chainOn);
  if (chainGroup) chainGroup.visible = chainOn;
  const cm = cubies.material;
  cm.transparent = chainOn; cm.opacity = chainOn ? 0.2 : 1; cm.depthWrite = !chainOn; cm.needsUpdate = true;
  highlightWires(selected);
};

// render quality (Hoog = bloom + soft shadows + led light spill; Laag = fast)
const btnQ = document.getElementById('btn-quality');
const syncQ = () => { if (btnQ) btnQ.textContent = `🎚 Kwaliteit: ${stage.quality === 'hoog' ? 'hoog' : 'laag'}`; };
if (btnQ) btnQ.onclick = () => { stage.setQuality(stage.quality === 'hoog' ? 'laag' : 'hoog'); syncQ(); };
syncQ();

/* ============================================================================
   RENDER LOOP
   ========================================================================== */
// the rotation wave: a bright bump travels each permutation cycle while each led
// cross-fades to its new colour as the wave passes. Pure colour+brightness over time.
const WV = { W: 0.55, CF: 0.32, SIG: 0.07, WAVE_H: 1.25 };
const tmpC = new THREE.Color();
function updateColorAnim(dtMs) {
  if (!colorAnim) return;
  colorAnim.t += dtMs;
  const k = Math.min(1, colorAnim.t / colorAnim.dur);
  for (const slot of SLOT_ORDER) for (let idx = 0; idx < 27; idx++) {
    const ph = colorAnim.phase[KP(slot, idx)];
    const center = (ph == null ? 0 : ph) * WV.W;
    const cf = Math.min(1, Math.max(0, (k - center) / WV.CF));
    tmpC.copy(colorAnim.from[slot][idx]).lerp(colorAnim.to[slot][idx], ease(cf));
    setLed(meshes[slot][idx], tmpC);
    let boost = 0;
    if (ph != null) { const d = k - (center + WV.CF * 0.4); boost = WV.WAVE_H * Math.exp(-(d * d) / (2 * WV.SIG * WV.SIG)); }
    meshes[slot][idx].userData.boost = boost;
  }
  if (k >= 1) { colorAnim = null; for (const s of SLOT_ORDER) for (let i = 0; i < 27; i++) meshes[s][i].userData.boost = 0; }
}

// led brightness: selected cell brightest (breathing), its cube mid, rest dim, plus the
// travelling wave boost and a spotlight that dims the non-moving leds during a turn.
function updateGameBrightness(now, dt) {
  const breathe = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(now * 0.006));
  for (const slot of SLOT_ORDER) {
    if (pulse[slot] > 0) pulse[slot] = Math.max(0, pulse[slot] - 2.4 * dt);
    const isSelCube = slot === sel.slot;
    for (let idx = 0; idx < 27; idx++) {
      const isSel = isSelCube && idx === sel.idx;
      const baseI = isSelCube ? (isSel ? SEL_I * breathe : SEL_CUBE_I) : BASE_I;
      const mv = meshes[slot][idx].userData.boost || 0;
      let inten = baseI + pulse[slot] * 0.55 + mv;
      if (colorAnim && colorAnim.phase[KP(slot, idx)] == null) inten *= 0.45;
      meshes[slot][idx].userData.inten = powerOn ? Math.min(2.6, inten) : OFF_I;
    }
  }
}
// emitted radiance of every cubie = its own led + a little light bleeding in from its neighbours
// (the selected led inside the hidden core of a cell thus lights up the face centres around it)
const radTmp = new THREE.Color();
function applyLeds() {
  for (const m of rigLeds) {
    radTmp.copy(m.userData.led).multiplyScalar(m.userData.inten * LED_GAIN);
    for (const n of m.userData.nb) radTmp.r += n.userData.led.r * n.userData.inten * LED_GAIN * BLEED,
      radTmp.g += n.userData.led.g * n.userData.inten * LED_GAIN * BLEED, radTmp.b += n.userData.led.b * n.userData.inten * LED_GAIN * BLEED;
    cubies.setColorAt(m.n, radTmp);
  }
  cubies.instanceColor.needsUpdate = true;
}
// each cell throws its average colour as light onto its surroundings (quality 'hoog')
function updateGlowLights() {
  const on = stage.quality === 'hoog';
  for (const slot of SLOT_ORDER) {
    const pl = glowLights[slot];
    if (!on) { pl.visible = false; continue; }
    pl.visible = true;
    let r = 0, g = 0, b = 0;
    for (const m of meshes[slot]) { const k = m.userData.inten * LED_GAIN; r += m.userData.led.r * k; g += m.userData.led.g * k; b += m.userData.led.b * k; }
    const lum = (r + g + b) / 27;
    pl.intensity = lum * 0.45;
    if (lum > 1e-4) pl.color.setRGB(r / (r + g + b) * 3, g / (r + g + b) * 3, b / (r + g + b) * 3);
  }
}

// labels: project to the screen and push overlapping ones apart (top-down, greedy)
const v = new THREE.Vector3(), camFwd = new THREE.Vector3(), toLbl = new THREE.Vector3();
function updateLabels() {
  if (!labelsOn) return;
  camera.getWorldDirection(camFwd);
  const placed = [];
  const list = [];
  for (const id in labelEls) {
    const el = labelEls[id];
    toLbl.copy(ANCHOR[id]).sub(camera.position);
    v.copy(ANCHOR[id]).project(camera);
    if (toLbl.dot(camFwd) <= 0 || v.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    list.push({ el, x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight,
      w: el.offsetWidth || 120, h: el.offsetHeight || 20 });
  }
  list.sort((a, b) => a.y - b.y);
  for (const L of list) {
    for (let guard = 0; guard < 12; guard++) {
      const hitL = placed.find(p => Math.abs(p.x - L.x) < (p.w + L.w) / 2 + 4 && Math.abs(p.y - L.y) < (p.h + L.h) / 2 + 2);
      if (!hitL) break;
      L.y = hitL.y + (hitL.h + L.h) / 2 + 3;
    }
    placed.push(L);
    L.el.style.left = L.x + 'px'; L.el.style.top = L.y + 'px';
  }
}

const clock = new THREE.Clock();
let t = 0, firstFrame = true;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);           // seconds; clamped so a hidden tab does not jump
  const now = performance.now();
  t += dt;
  if (flight) {
    flight.t += dt * 1000;
    const k = Math.min(1, flight.t / flight.ms), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    if (k >= 1) flight = null;
  }
  controls.update();
  stage.clampCamera();

  // wire flow markers
  for (const w of wires) {
    const visible = flowOn && powerOn && (!selected || w.parts.includes(selected)) && (!chainOn || w.parts.includes('rig'));
    for (const s of w.markers) {
      s.visible = visible;
      if (!visible) continue;
      const p = (t * (w.type === 'bt' ? 0.5 : 0.16) + s.userData.off) % 1;
      s.position.copy(w.curve.getPointAt ? w.curve.getPointAt(p) : w.curve.getPoint(p));
    }
  }

  // GAME: colours follow the rotation wave (always when a turn is animating)
  updateColorAnim(dt * 1000);

  // led brightness — hardware demos override the game look while active
  if (frameSweep) {
    frameSweep.t += dt;
    const head = frameSweep.t * 140;
    for (let i = 0; i < rigLeds.length; i++) {
      const d = head - i;
      rigLeds[i].userData.inten = powerOn ? 0.5 + (d >= 0 && d < 14 ? 1.8 * (1 - d / 14) : 0) : OFF_I;
    }
    if (head > rigLeds.length + 16) { frameSweep = null; }
  } else if (chainOn) {
    chainHead += 51 * dt;
    if (chainHead > chainPts.length + 14) chainHead = 0;
    const hp = Math.max(0, Math.min(chainPts.length - 1, chainHead));
    const ci = Math.min(chainPts.length - 2, Math.floor(hp));
    chainPulse.position.copy(chainPts[ci]).lerp(chainPts[ci + 1], hp - ci);
    chainPulse.visible = chainHead <= chainPts.length - 1;
    for (let n = 0; n < rigLeds.length; n++) {
      const d = chainHead - n;
      rigLeds[n].userData.inten = powerOn ? 0.5 + (d >= 0 && d < 12 ? 1.8 * (1 - d / 12) : 0) : OFF_I;
    }
  } else {
    updateGameBrightness(now, dt);
  }
  applyLeds();
  updateGlowLights();

  // a selected PART breathes softly (the rig's leds breathe via the game)
  if (selected && PART_GROUP[selected]) tintPart(selected, 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(t * 3)));

  updateLabels();
  stage.render();
  if (firstFrame) { firstFrame = false; elLoading?.classList.add('done'); }
  requestAnimationFrame(tick);
}

// debug/automation hook (screenshots, smoke test) — only with ?debug in the URL
if (new URLSearchParams(location.search).has('debug')) {
  window.__bench = { stage, camera, controls, select, clearSelect, setPower, doScramble, doTwist, doUndo, doReset,
    pressPlane, setDir, clearDir, moveCell, flyTo, focusPart, puzzle, wires, TERM,
    get sel() { return sel; }, get colorAnim() { return colorAnim; }, get moves() { return moves; },
    get selected() { return selected; }, get chainOn() { return chainOn; },
    finishAnimations() { if (flight) flight.t = flight.ms; if (colorAnim) colorAnim.t = colorAnim.dur; } };
}

refresh();   // paint the solved puzzle onto the leds + fill the controller HUD
tick();
