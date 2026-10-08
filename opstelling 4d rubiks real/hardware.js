/* ============================================================================
   hardware.js — interactive, REALISTIC 3D workbench + PLAYABLE game in one scene.
   ----------------------------------------------------------------------------
   TWO functions cooperate in the same 3D world, so this is a true simulation of
   the installation:
     1. HARDWARE — the real electronics at (estimated) real size on a workbench, set up as a
        prototype: an ESP32-DevKitC (built-in Bluetooth) on a breadboard with a 74AHCT125 level
        shifter and the 330Ω data resistor, a 5V/10A supply, an on/off switch box, an inline 10A
        fuse, the 5V / GND distribution blocks (GND star point) with the 1000µF across them, a
        wireless game controller, and the 189-WS2812B led rig (the harness runs to led #0).
        Click any part for an info panel + exact wiring (one CONNECTIONS table is
        the single source of truth and matches BEDRADING.md); the camera flies to it.
     2. SOFTWARE — the actual 4D-Rubiks game runs on those same leds. Drive it with the
        on-screen controller (or click a cell / use the keyboard); the leds inside the
        frosted cubies RECOLOUR correctly on every turn via the verified engine + the
        permutation-wave animation (1:1 with the WS2812 firmware).

   Rendering (bench/stage.js): physically based materials, a studio reflection map,
   soft shadows, HDR bloom on the leds, coloured light spill from the cells onto the
   frame and the bench, neutral tone mapping. Scale: 1 unit = 4 cm.
   Nothing moves mechanically — a "turn" only changes led COLOURS.
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Tesseract, AXN, ORIENT } from './engine.js?v=4';
// NOTE: bump ?v= on ALL bench imports together (also inside bench/*.js), else a module loads twice
import { createStage, MAT, BENCH } from './bench/stage.js?v=13';
import * as P from './bench/parts.js?v=13';
import { hotspotTexture, DEVKIT } from './bench/textures.js?v=13';

// ---- wire categories: 3D insulation colour, legend colour, label, wire radius (scene units)
const WIRE = {
  pwr:  { color: 0xc8261e, label: '+5V (stroom +)', r: 0.034 },
  gnd:  { color: 0x1d1e22, label: 'GND (massa / −)', r: 0.034 },
  data: { color: 0xf2c418, label: 'Data 3,3V (ESP32 → levelshifter)', r: 0.022 },
  data5:{ color: 0xff7a1a, label: 'Data 5V (levelshifter → 330Ω → DIN)', r: 0.024 },
  bt:   { color: 0xa47bff, label: 'Bluetooth (draadloos, ingebouwd)', r: 0 },
};
const hex6 = c => '#' + c.toString(16).padStart(6, '0');

/* ============================================================================
   THE WIRING TABLE — single source of truth.
   Each row: [ fromPart, fromTerminal, toPart, toTerminal, category, note, 'bb'? ]
   'bb' = both ends in the same breadboard strip: a real connection, but no wire to draw.
   ========================================================================== */
const CONNECTIONS = [
  // --- power backbone: PSU +V -> switch -> fuse -> 5V block; PSU −V -> GND block (the star point) ---
  ['psu','+5V', 'sw','in',      'pwr', 'voeding naar aan/uit-schakelaar'],
  ['sw','out',  'fuse','in',    'pwr', 'schakelaar naar de inline zekering'],
  ['fuse','out','dist','5Vin',  'pwr', 'gezekerde 5V naar het 5V-verdeelblok'],
  ['psu','GND', 'dist','GNDin', 'gnd', 'één dikke massadraad naar het GND-verdeelblok (sterpunt)'],
  ['dist','5V', 'esp','5Vin',   'pwr', '5V naar de ESP32 (via de 5V/VIN-pin)'],
  ['dist','GND','esp','GNDin',  'gnd', 'gemeenschappelijke massa'],
  ['dist','5V', 'rig','5V',     'pwr', '5V naar led #0 — dikke draad!'],
  ['dist','GND','rig','GND',    'gnd', 'massa naar led #0 — dikke draad!'],

  // --- data line: ESP32 GPIO13 (3,3V) -> levelshifter -> 330Ω -> first led (5V) ---
  ['esp','D13', 'lvl','in',  'data',  '3,3V data van de ESP32 (GPIO13) — jumper op het breadboard'],
  ['lvl','out', 'res','in',  'data5', 'geen draad: de weerstand steekt in dezelfde breadboard-kolom als pin 3', 'bb'],
  ['res','out', 'rig','DIN', 'data5', '5V data via de kabelboom naar led #0'],

  // --- level shifter power (shared GND is essential) ---
  ['dist','5V', 'lvl','VCC', 'pwr', 'levelshifter op 5V (zet 1OE aan GND — zie info)'],
  ['dist','GND','lvl','GND', 'gnd', 'gedeelde massa — anders is de 5V-uitgang ongeldig'],

  // --- Bluetooth: the controller talks straight to the ESP32's built-in radio ---
  ['esp','BT',  'ps3','BT',  'bt', 'Bluetooth (HID) — ingebouwd in de ESP32 (Bluepad32), geen dongle'],

  // --- power injection every 54 leds (BEDRADING.md §4): strip #54 (L), #108 (D), #162 (B) ---
  ['dist','5V', 'rig','INJ_L','pwr','power-injectie linker arm (strip #54)'],
  ['dist','GND','rig','INJ_L','gnd',''],
  ['dist','5V', 'rig','INJ_D','pwr','power-injectie onderste arm (strip #108)'],
  ['dist','GND','rig','INJ_D','gnd',''],
  ['dist','5V', 'rig','INJ_B','pwr','power-injectie achterste arm (strip #162)'],
  ['dist','GND','rig','INJ_B','gnd',''],

  // --- 1000µF buffer across the distribution blocks, where the led current leaves (prototype) ---
  ['dist','5V', 'cap','+',   'pwr', '+ poot in het 5V-blok'],
  ['dist','GND','cap','-',   'gnd', '− poot (streep) in het GND-blok'],
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
      <p><b>Op het breadboard:</b> de 5V-, GND- en GPIO13-pin zitten op de achterste pinrij (rij i). In elke
      kolom zijn de gaatjes f–j één strook, dus de draden steken in de vrije rij j erachter: <b>20j</b> = 5V,
      <b>25j</b> = GND, <b>24j</b> = GPIO13 (kolomnummers zoals op het bord gedrukt).</p>`,
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
      <b>aan elkaar knopen</b> (gemeenschappelijke GND). Eén dikke draad loopt van de −V-klem naar
      het <b>GND-verdeelblok</b>; alle GND-takken vertrekken uit dat ene <b>sterpunt</b>, zodat alle
      led-segmenten dezelfde datareferentie delen.</p>`,
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
    name: 'Inline zekering (10A)', tag: 'Smeltzekering in de +5V-lijn, vóór het 5V-verdeelblok', color: '#ff7a4d',
    html: `<p><b>Wat:</b> een steekzekering van <b>10A</b> (rood) in een inline houder, in serie in de
      <b>+5V-hoofdlijn</b>, direct na de aan/uit-schakelaar — vóór het punt waar de 5V zich
      vertakt naar de ESP32, de levelshifter, de leds en de power-injectie. Die vertakking zit in
      het <b>5V-verdeelblok</b> achter de zekering (zie <i>Verdeelblokken</i>).</p>
      <p><b>Waarom:</b> bij kortsluiting kan de voeding véél stroom leveren en worden dunne
      draadjes gloeiend heet. <b>Regel:</b> de zekering beschermt de <b>dunste draad</b>
      eronder, niet de last — kies hem ≤ wat je dunste 5V-draad aankan (16 AWG bij 10A).</p>
      <p><b>Full-white build?</b> Verhoog dan voeding (≥15A), zekering (15A traag), schakelaar
      én draaddikte (14 AWG) altijd <b>samen</b> — zie BEDRADING.md §4.</p>`,
    notes: [['warn','De stroomlimiet in de firmware (FastLED) is software, géén zekering — een herprogrammering of vastgelopen sketch heft hem op. Dimensioneer op wat de voeding fysiek kán leveren.']],
  },
  res: {
    name: '330Ω weerstand (data)', tag: 'Op het breadboard, direct na de levelshifter — oranje-oranje-bruin-goud', color: '#ffd23d',
    html: `<p><b>Wat:</b> één weerstandje van 330Ω (kleurcode <b>oranje-oranje-bruin</b>, goud = ±5%) in
      serie in de <b>datadraad</b>. Hij dempt scherpe spanningspieken (reflecties) op de datalijn en
      begrenst de stroom in de data-ingang van led #0.</p>
      <p><b>Op het breadboard:</b> één poot steekt in dezelfde kolom als uitgang <b>1Y</b> (pin 3) van de
      levelshifter — daar is dus geen draadje voor nodig — de andere in een vrije kolom, waar de oranje
      datadraad naar led #0 begint.</p>
      <p>Klein onderdeel, groot effect op betrouwbaarheid. Waarden van 220–470Ω zijn prima.</p>`,
    notes: [['','Prototype vs. eindbouw: Adafruit adviseert de weerstand aan de led-kant van de datadraad. Bij deze korte draad (≈ 0,5 m, inschatting) werkt hij ook hier; zet hem in de eindbouw bij led #0.']],
  },
  cap: {
    name: '1000µF condensator', tag: 'Stroombuffer over 5V/GND — in de verdeelblokken', color: '#ff5a4d',
    html: `<p><b>Wat:</b> een grote elektrolytische condensator (1000µF, <b>10–16V</b> — niet de
      6,3V-ondergrens) <b>parallel</b> over 5V en GND. Hij vangt de plotselinge stroompieken op als
      veel leds tegelijk aanspringen, zodat de spanning niet "dipt".</p>
      <p><b>Waar:</b> met zijn poten in de verdeelblokken — + in het 5V-blok, − in het GND-blok — precies
      waar de dikke draden naar de leds vertrekken.</p>
      <p><b>Waarom niet op het breadboard?</b> De led-stroom (tot ~10A) loopt niet over het breadboard en
      mag dat ook niet: gangbare breadboards zijn gespecificeerd op ca. 1A per contact. Op de
      breadboard-rail zou de elco dus op een zijtak zitten, buiten het stroompad van de leds.</p>
      <p><b>Let op de polariteit:</b> de poot aan de kant van de streep met minnetjes (−) gaat naar
      GND, de andere naar +5V. Verkeerd om kan hij klappen.</p>`,
    notes: [['warn','Elco\'s zijn gepolariseerd: − (streep) naar massa, + naar 5V.'],
      ['','Eindbouw: zet de 1000µF bij led #0, waar de stroom de led-keten binnenkomt (BEDRADING.md §2).'],
      ['','Tip: bij lange armen ook een kleinere elco (100–470µF) bij elk power-injectiepunt.']],
  },
  dist: {
    name: 'Verdeelblokken 5V/GND', tag: 'Hier vertakt de stroom — met het GND-sterpunt en de 1000µF', color: '#f0a03c',
    html: `<p><b>Wat:</b> twee 8-voudige hendelklemmen naast elkaar: links <b>GND</b> (grijze hendels), rechts
      <b>+5V</b> (oranje). De gezekerde 5V komt rechts binnen, de massa met één dikke draad van de −V-klem
      van de voeding.</p>
      <p><b>Waarom:</b> vanaf hier vertrekken álle stroomtakken — naar led #0, de drie power-injectiepunten,
      de ESP32 en de levelshifter. Het GND-blok is het <b>sterpunt</b>: alle massa's komen op één punt
      samen (BEDRADING.md §6).</p>
      <p><b>De 1000µF</b> zit over de twee binnenste klemmen: + in het 5V-blok, − in het GND-blok.</p>`,
    notes: [['','Hendelklemmen voor installatiedraad (bijv. Wago 221) kunnen 10A ruim aan; een breadboard niet — daarom lopen de stroomdraden niet over het breadboard.']],
  },
  lvl: {
    name: 'Levelshifter (3,3V→5V)', tag: '74AHCT125 (DIP-14) op het breadboard', color: '#36c7ff',
    html: `<p><b>Wat:</b> een chipje dat het <b>3,3V-datasignaal</b> van de ESP32 omzet naar een
      nette <b>5V</b>, want dat willen de WS2812-leds zien als een "1". Een <b>74AHCT125</b> (of
      74HCT245) is ideaal: hij accepteert 3,3V aan de ingang en geeft 5V uit.</p>
      <p><b>Aansluiting:</b> voed hem met <b>5V</b> (pin 14) en deel zijn <b>GND</b> (pin 7) met de
      ESP32 — anders is zijn 5V-uitgang ongeldig. Eén kanaal volstaat: <b>ingang 1A</b> (pin 2) =
      GPIO13, <b>uitgang 1Y</b> (pin 3) → de 330Ω (steekt in dezelfde kolom) → de eerste led. De <b>1OE</b> (pin 1, actief-laag)
      gaat met het korte zwarte jumpertje naar <b>GND</b> (pin 7) — dan is de uitgang actief.</p>`,
    notes: [['','Ongebruikte ingangen niet laten zweven (datasheet): zes draadbruggen — 2OE + 2A aan GND (achter, kolom 44), 3OE, 3A, 4OE en 4A aan 5V (voor, kolom 50).'],
      ['','Plaats de chip op de inkeping en het stipje (naar kolom 50), niet op de leesrichting van de opdruk: 180° gedraaid komt 5V op pin 7 (GND) en GND op pin 14 (VCC).'],
      ['','Op een 5V-microcontroller (Arduino Mega) is dit niet nodig; die stuurt de leds rechtstreeks aan.']],
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
      <p><b>Ingang:</b> de kabelboom loopt over de voet, langs de paal, <b>dóór</b> de onderste kubus (via
      de geboorde middenkolom, net als de paal) en langs de staaf de middelste kubus in: 5V, GND en DATA
      komen rechtstreeks aan op <b>led #0</b>. De 330Ω en de 1000µF staan in deze prototype-opstelling op
      de werkbank (breadboard en verdeelblokken).</p>
      <p><b>Speel hier ook echt:</b> klik op een kubusje om een cel te kiezen, of gebruik de
      controller. Bij een draai verschuiven alléén de <b>kleuren</b> en loopt er een heldere golf in de
      draairichting — precies wat de WS2812 doet.</p>
      <p><b>Power-injectie:</b> omdat 5V over zo'n lange keten wegzakt, voer je elke 54 leds 5V + GND
      opnieuw in (strip #54 linker arm, #108 onderste arm, #162 achterste arm). Die draadparen lopen
      binnendoor: door de kubussen en langs de staven, tussen de lagen kubusjes naar hun led.</p>`,
    notes: [['','Bedrading-volgorde van de leds: zie ORIENT in engine.js en het schema in BEDRADING.md — led-nummer 0..26 per kubus op een vaste plek, zodat de firmware-kleuren kloppen.'],
      ['','Zet “🧵 Led-draad” aan (Weergave): de kubusjes worden doorzichtig en je ziet hoe één datadraad alle 189 leds in serie rijgt — geel binnen een kubus, cyaan de sprong naar de volgende (volgorde C→R→L→U→D→F→B).']],
  },
};

const MENU = [
  ['Besturing', ['esp','lvl','res']],
  ['Voeding', ['psu','sw','fuse','dist','cap']],
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
// a narrow (portrait phone) screen sees less sideways, so the home view steps back to keep the bench in frame
const PHONE_MQ = matchMedia('(max-width: 760px), (max-height: 500px)');
const PHONE = PHONE_MQ.matches;
const camHome = () => {
  const k = THREE.MathUtils.clamp((1.4 / (innerWidth / innerHeight)) ** 0.6, 1, 1.9);
  return TARGET0.clone().addScaledVector(CAM0.clone().sub(TARGET0), k);
};
camera.position.copy(camHome()); controls.target.copy(TARGET0);

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
// a breadboard hole as a wire terminal; `exit` = the board edge its jumper leaves over (x−/x+/z−/z+),
// `run` = how far beyond that edge it lands on the bench
const hole = (col, row, exit = null, run = 0.4) => ({ p: bb.hole(col, row), d: up.clone(), hole: true, exit, run });

(function placeESP32() {
  const e = P.buildESP32();
  // J2 pin k (0-based) sits in breadboard column 37−k, row i (row j behind it stays free)
  const pin1 = bb.hole(37, 'i');
  e.group.position.set(BBPOS.x + pin1.x - P.mm(DEVKIT.pinX(0)), BBPOS.y + bb.top, BBPOS.z + pin1.z + P.mm(DEVKIT.ROWSEP / 2));
  scene.add(e.group);
  registerPart('esp', e.group);
  setTerm('esp', '5Vin', bb.group, hole(19, 'j', 'x-'));        // J2 pin 19 = 5V
  setTerm('esp', 'GNDin', bb.group, hole(24, 'j', 'z-', 0.2));  // J2 pin 14 = GND
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
  setTerm('lvl', 'out', bb.group, hole(47, 'j'));     // pin 3 = 1Y (the 330Ω leg sits in this strip)
  setTerm('lvl', 'GND', bb.group, hole(43, 'j', 'z-', 0.34));  // pin 7 = GND
  setTerm('lvl', 'VCC', bb.group, hole(49, 'c', 'z+'));  // pin 14 = VCC
})();

// the 330Ω in the back row behind the level shifter: one leg in the 1Y strip (col 47), the other in
// the free col 51, where the data wire to led #0 plugs in (Arduino-style: no jumper for 1Y -> 330Ω)
(function placeResistor() {
  const r = P.buildResistor();
  r.group.position.copy(bb.hole(49, 'j')).add(BBPOS);
  scene.add(r.group);
  registerPart('res', r.group);
  setTerm('res', 'in', bb.group, hole(47, 'j'));
  setTerm('res', 'out', bb.group, hole(51, 'h', 'z-', 0.55));   // lands behind the GND wires
})();

(function placePSU() {
  const p = P.buildPSU();
  p.group.position.set(-7.4, MAT_TOP, 2.2);
  scene.add(p.group);
  registerPart('psu', p.group);
  setTerm('psu', '+5V', p.group, p.screws.VP1);
  setTerm('psu', 'GND', p.group, p.screws.VM1);
  hw.psu = p;
})();

(function placeSwitch() {
  const s = P.buildSwitchBox();
  s.group.position.set(-4.8, MAT_TOP, 5.6);
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
  setTerm('fuse', 'out', f.group, f.out);
})();

// the 5V / GND distribution: two lever blocks behind the fuse, GND (the star point) left, 5V right.
// Each wire gets a fixed entry (FAN) so the bundle leaves untangled; the wires first run 0.95 straight
// back, the fused 5V comes round the right end into the last 5V entry.
const DIST_POS = new THREE.Vector3(-1.735, MAT_TOP, 5.45);
(function placeDistribution() {
  const d = P.buildDistribution();
  d.group.position.copy(DIST_POS);
  scene.add(d.group);
  registerPart('dist', d.group);
  const run = (e, len = 0.95) => ({ ...e, run: len });
  setTerm('dist', 'GNDin', d.group, run(d.gnd[0]));
  setTerm('dist', 'GND', d.group, d.gnd.map(e => run(e)));
  setTerm('dist', '5Vin', d.group, run(d.v5[7], 0.25));
  setTerm('dist', '5V', d.group, d.v5.map(e => run(e)));
})();

// the 1000µF lies on the mat behind the blocks, its legs clamped in the two inner entries
// (+ in 5V, − with the stripe in GND) — on the led current path, not on the breadboard
(function placeCapacitor() {
  const c = P.buildCapacitor();
  c.group.rotation.x = -Math.PI / 2;                  // axis towards the back, legs (bottom) towards the blocks
  c.group.position.set(DIST_POS.x, MAT_TOP + P.mm(5), TERM.dist.GND[7].p.z - 0.16);
  scene.add(c.group);
  registerPart('cap', c.group);
  const leg = v => ({ p: v.clone().setY(-P.mm(0.5)), d: new THREE.Vector3(0, -1, 0), leg: true });
  setTerm('cap', '+', c.group, leg(c.plus));
  setTerm('cap', '-', c.group, leg(c.minus));
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

  // ---- the frame (as in the Blender model): rods run centre-to-centre THROUGH the cubes (the
  //      cubies on the rod axes are bored), and the pole runs from the round, weighted foot up
  //      through the bottom (D) cube. Brushed aluminium. The wiring follows the same bores.
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
  for (const slot of ['R', 'L', 'U', 'D', 'F', 'B']) rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...SLOTS[slot].pos), 0.045);
  // the stand: weighted round foot (disc + domed top + rubber ring) and the pole up to cube D
  const FOOT_BOTTOM = -RIG.OFFSET.y;                      // local y of the bench top
  const footMat = new THREE.MeshStandardMaterial({ color: 0x41464e, metalness: 0.85, roughness: 0.38 });
  const disc = deco(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 0.38, 72), footMat));
  disc.position.set(0, FOOT_BOTTOM + 0.21, 0);
  const dome = deco(new THREE.Mesh(new THREE.SphereGeometry(1.7, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), footMat));
  dome.scale.set(1, 0.32, 1); dome.position.set(0, FOOT_BOTTOM + 0.4, 0);
  const rubber = deco(new THREE.Mesh(new THREE.CylinderGeometry(2.28, 2.28, 0.04, 72), new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.95 })));
  rubber.position.set(0, FOOT_BOTTOM + 0.02, 0);
  rod(new THREE.Vector3(0, FOOT_BOTTOM + 0.9, 0), new THREE.Vector3(0, -RIG.D, 0), 0.065);   // up into the core of D
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

  scene.add(g);
  registerPart('rig', g, P_LOCAL(0, RIG.D + HALF + 0.45, 0));

  // the input: the harness comes up the D-C rod into cube C (through the bore of its bottom
  // face-centre cubie) and runs in the gap between its bottom and middle layer to led #0, the
  // (-1,-1,-1) corner: DIN, 5V and GND land side by side on the top face of that cubie.
  const led0 = meshes.C[0].position;
  const top0 = (dx) => ({ p: new THREE.Vector3(led0.x + dx, led0.y + RIG.CUB / 2 + 0.005, led0.z), d: UPaxis.clone(), lead: 0.05 });
  setTerm('rig', 'DIN', g, top0(0.075));                          // a wire thickness + play apart
  setTerm('rig', '5V', g, top0(0));
  setTerm('rig', 'GND', g, top0(-0.075));

  // power-injection contacts INSIDE the first led of each injected arm (strip #54 L, #108 D,
  // #162 B): that led sits in the arm's inner layer; the wires come in through the bore along
  // the rod and reach it through the gap between the inner and the middle layer of cubies.
  const contact = (slot, axis) => {
    const k = ['x', 'y', 'z'].indexOf(axis), s = Math.sign(SLOTS[slot].pos[k]);   // towards the middle layer
    const p = meshes[slot][0].position.clone(); p[axis] += (RIG.CUB / 2 + 0.005) * s;
    const d = new THREE.Vector3(); d[axis] = s;
    return { p, d, lead: 0.05 };
  };
  setTerm('rig', 'INJ_L', g, contact('L', 'x'));
  setTerm('rig', 'INJ_B', g, contact('B', 'z'));
  setTerm('rig', 'INJ_D', g, contact('D', 'y'));
})();

/* --------------------------------------------------------- the wires --- */
// Bench wires lie on the bench; the harness (all wires to the rig) is bundled, runs over the
// foot, climbs the pole, cube D and the D-C rod and ends on led #0; the injection pairs branch
// off along the rods to their arm. Every wire is a smooth tube through hand-placed waypoints.
const wires = [];
const benchY = (x, z) => (x > MAT.X - MAT.W / 2 && x < MAT.X + MAT.W / 2 && z > MAT.Z - MAT.D / 2 && z < MAT.Z + MAT.D / 2) ? MAT_TOP : 0;
const onBench = (v, r, lift = 0) => new THREE.Vector3(v.x, benchY(v.x, v.z) + r + lift, v.z);
const W3 = (x, y, z) => new THREE.Vector3(x, y, z);
const flatDir = (from, to) => new THREE.Vector3().subVectors(to, from).setY(0).normalize();
const BB_BOX = new THREE.Box3().setFromObject(bb.group);    // jumpers leave the breadboard over its edge
// the lowest the centre of a wire of radius r may be at (x, z): on the ESD mat, rolling over its edge
// the way a real cable does, on the bench top around it — and free beyond the bench (hanging down)
function floorAt(x, z, r) {
  if (Math.abs(x) > BENCH.W / 2 || Math.abs(z - BENCH.Z0) > BENCH.D / 2) return -Infinity;
  const dx = Math.max(MAT.X - MAT.W / 2 - x, 0, x - (MAT.X + MAT.W / 2));
  const dz = Math.max(MAT.Z - MAT.D / 2 - z, 0, z - (MAT.Z + MAT.D / 2));
  const d = Math.hypot(dx, dz);                                   // horizontal distance to the mat (0 = on it)
  return d < r ? MAT_TOP + Math.sqrt(r * r - d * d) : r;
}
// a smooth spline through the waypoints overshoots before a steep rise (e.g. up to a breadboard edge)
// and would dive into the mat; this wrapper keeps every point of the wire on top of the bench
class OnBench extends THREE.Curve {
  constructor(curve, r) { super(); this.curve = curve; this.r = r; this.arcLengthDivisions = Math.max(200, (curve.points?.length ?? 0) * 4); }
  getPoint(t, out = new THREE.Vector3()) {
    this.curve.getPoint(t, out);
    const floor = floorAt(out.x, out.z, this.r);
    if (out.y < floor) out.y = floor;
    return out;
  }
}

// harness spine (world, bundle centre): along the mat -> over its back edge (clear of it) -> down to the
// bench -> over the foot -> up beside the pole -> THROUGH the bored centre column of cube D (like the
// pole) -> up in front of the D-C rod towards cube C
const HB = 0.135;                                   // bundle centre height above the surface it lies on
const SPINE = [
  W3(0.35, MAT_TOP + HB, 1.15), W3(0.31, MAT_TOP + HB, -0.88), W3(0.28, HB, -1.3), W3(0.24, 0.5, -2.05),
  W3(0.2, 0.98, -3.2), W3(0.166, 1.12, -4.0), W3(0.166, 1.95, -4.034), W3(0.166, 3.3, -4.034),
  W3(0.166, 4.15, -4.034), W3(0.22, 4.5, -3.99), W3(0.0, 6.0, -4.03),
];
const SPINE_EXIT = { D: 7, LB: 9, MAIN: 10 };       // index of the spine point where a branch leaves
const BUNDLE = 0.075;                               // slot spacing in the bundle (wires 0.068 thick + play)
// the slot of every harness wire in the 3x3 bundle: [n, b] in the spine frame. b = column: +1 left (−x),
// 0 middle, −1 right. n = row: −1 top on the bench / front (+z) up the pole, 0 middle, +1 bottom / back.
// The front row holds the main three (GND, 5V, DIN — left to right, as they land on led #0); every
// injection pair has a column of its own, GND in front of 5V: D on the left, where it leaves to the left,
// L and B behind the main three, where they leave to the back. On the mat each wire comes in on the side
// of its column, so no two wires of one row cross.
const HARNESS_SLOT = {
  'dist.GND>rig.GND': [-1, 1], 'dist.5V>rig.5V': [-1, 0], 'res.out>rig.DIN': [-1, -1],
  'dist.GND>rig.INJ_D': [0, 1], 'dist.GND>rig.INJ_L': [0, 0], 'dist.GND>rig.INJ_B': [0, -1],
  'dist.5V>rig.INJ_D': [1, 1], 'dist.5V>rig.INJ_L': [1, 0], 'dist.5V>rig.INJ_B': [1, -1],
};
// the entry of the distribution blocks each wire uses (0..7, left to right). Left: the breadboard GND
// wires (straight back, then along the breadboard), middle: the harness wires by the bundle column they
// go to, right: the breadboard 5V wires; the 1000µF bridges the two inner entries (GND 7, 5V 0).
const FAN = {
  'dist.GND>lvl.GND': 1, 'dist.GND>esp.GNDin': 2, 'dist.GND>rig.GND': 3, 'dist.GND>rig.INJ_D': 4,
  'dist.GND>rig.INJ_L': 5, 'dist.GND>rig.INJ_B': 6, 'dist.GND>cap.-': 7,
  'dist.5V>cap.+': 0, 'dist.5V>rig.INJ_D': 1, 'dist.5V>rig.5V': 2, 'dist.5V>rig.INJ_L': 3,
  'dist.5V>rig.INJ_B': 4, 'dist.5V>esp.5Vin': 5, 'dist.5V>lvl.VCC': 6,
};
function spineFor(lastIdx) {
  return new THREE.CatmullRomCurve3(SPINE.slice(0, lastIdx + 1).map(v => v.clone()), false, 'centripetal');
}
function offsetCurvePoints(curve, n, b, segs) {
  const fr = curve.computeFrenetFrames(segs, false), out = [];
  for (let i = 0; i <= segs; i++) {
    out.push(curve.getPointAt(i / segs).addScaledVector(fr.normals[i], n * BUNDLE).addScaledVector(fr.binormals[i], b * BUNDLE));
  }
  return out;
}
// Every branch leaves the bundle as a flat group: lanes BUNDLE apart across a shared centre line (`lead`
// straight on along the bundle, `pts`, then into its terminal). The lanes lie along `pref`, turned square to the wire at every point, so two
// wires of a branch never run one behind the other: side by side across the gap between two layers of
// leds, side by side under a rod. They start the way the wires sit in the bundle and turn to `pref` over
// `twist` (arc length after the exit); the B pair turns a quarter turn on its way up behind the rod. A
// `pref` that changes along the way (a function of the point) turns the group square to its last run,
// so it lands on its led without a twist at the very end.
const LANES = {
  // D: out of the bore of cube D into the gap between its middle and top layer, past the rod, to led #108
  D: { exit: SPINE_EXIT.D, term: 'INJ_D', pref: W3(-0.8, 0, 0.6), lead: 0.05, keys: ['dist.5V>rig.INJ_D', 'dist.GND>rig.INJ_D'],
    pts: [W3(0.03, 3.405, -4.07), W3(-0.12, 3.41, -4.06), W3(-0.45, 3.41, -4.55), W3(-0.56, 3.41, -4.74)] },
  // L / B: up behind the D-C rod, into cube C through its bottom bore, up to the height of the arm rods,
  // out through the bore of the face-centre cubie, along (under) the rod and into the arm
  L: { exit: SPINE_EXIT.LB, term: 'INJ_L', pref: p => W3(0, 0, 1).lerp(W3(0, -0.76, 0.65), smooth01((-3.6 - p.x) / 0.3)), keys: ['dist.5V>rig.INJ_L', 'dist.GND>rig.INJ_L'],
    pts: [W3(0.17, 4.7, -4.17), W3(0.06, 4.8, -4.31), W3(-0.06, 4.92, -4.33), W3(-0.09, 6.35, -4.33),
      W3(-0.09, 7.12, -4.33), W3(-0.14, 7.26, -4.29), W3(-0.3, 7.3, -4.22), W3(-0.6, 7.3, -4.2), W3(-0.95, 7.3, -4.2),
      W3(-3.35, 7.3, -4.2), W3(-3.7, 7.3, -4.2), W3(-3.99, 7.25, -4.25), W3(-3.99, 6.9, -4.7)] },
  B: { exit: SPINE_EXIT.LB, term: 'INJ_B', pref: p => W3(1, 0, 0).lerp(W3(0.61, -0.79, 0), smooth01((-7.8 - p.z) / 0.3)), twist: [0.6, 1.6], keys: ['dist.5V>rig.INJ_B', 'dist.GND>rig.INJ_B'],
    pts: [W3(0.27, 4.7, -4.2), W3(0.2, 4.88, -4.33), W3(0.09, 6.35, -4.32), W3(0.09, 7.12, -4.32), W3(0.08, 7.26, -4.38), W3(0.07, 7.3, -4.5),
      W3(0.07, 7.3, -4.8), W3(0.07, 7.3, -5.12), W3(0.07, 7.3, -7.55), W3(0.07, 7.3, -7.85), W3(0.0, 7.25, -8.19),
      W3(-0.45, 6.9, -8.19)] },
  // main (GND / 5V / DIN): into cube C through its bottom bore, then in the gap between its bottom and
  // middle layer to led #0, the last bit straight back (square to the three) onto its top face, where
  // they land side by side (top0 in the rig)
  MAIN: { exit: SPINE_EXIT.MAIN, term: '5V', pref: W3(1, 0, 0), keys: ['dist.GND>rig.GND', 'dist.5V>rig.5V', 'res.out>rig.DIN'],
    pts: [W3(-0.12, 6.35, -4.08), W3(-0.12, 6.8, -4.08), W3(-0.2, 7.09, -4.18), W3(-0.5, 7.09, -4.42), W3(-0.62, 7.09, -4.64)] },
};
const LANE_OF = {};
for (const [g, L] of Object.entries(LANES)) for (const k of L.keys) LANE_OF[k] = g;
const smooth01 = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// the run of harness wire `key` inside the bundle: the spine offset to its slot, up to its branch exit
const bundleRuns = {};
function bundleRun(key) {
  if (!bundleRuns[key]) {
    const [sn, sb] = HARNESS_SLOT[key], spine = spineFor(LANES[LANE_OF[key]].exit);
    bundleRuns[key] = { pts: offsetCurvePoints(spine, sn, sb, Math.max(24, Math.round(spine.getLength() * 6))), tan: spine.getTangentAt(1) };
  }
  return bundleRuns[key];
}
// a branch's centre line from the exit into its terminal (~1 mm samples) and the lane direction at each
const laneCentres = {};
function laneCentre(g) {
  if (laneCentres[g]) return laneCentres[g];
  const G = LANES[g], T = TERM.rig[G.term], ex = G.keys.map(k => bundleRun(k).pts.at(-1));
  const M = ex.reduce((s, v) => s.add(v), W3(0, 0, 0)).divideScalar(ex.length);
  const e0 = ex.at(-1).clone().sub(ex[0]).normalize();                 // across the group as it leaves the bundle
  const prefAt = typeof G.pref === 'function' ? G.pref : () => G.pref;
  const sign = prefAt(M).dot(e0) < 0 ? -1 : 1;                       // the way round closest to e0
  const tan = bundleRun(G.keys[0]).tan;                              // leaves the bundle along it (no kink)
  const ctrl = [M.clone().addScaledVector(tan, -0.3), M, M.clone().addScaledVector(tan, G.lead ?? 0.1), ...G.pts,
    T.p.clone().addScaledVector(T.d, T.lead), T.p.clone()];
  const cr = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal'), n = ctrl.length - 1, c = [];
  for (let j = 1; j < n; j++) {
    const k = Math.max(2, Math.ceil(ctrl[j].distanceTo(ctrl[j + 1]) / 0.025));
    for (let i = 0; i < k; i++) c.push(cr.getPoint((j + i / k) / n));
  }
  c.push(T.p.clone());
  const [w0, w1] = G.twist || [0, 0.25], e = [];
  for (let i = 0, s = 0; i < c.length; i++) {
    if (i) s += c[i].distanceTo(c[i - 1]);
    const t = c[Math.min(i + 1, c.length - 1)].clone().sub(c[Math.max(i - 1, 0)]).normalize();
    const v = e0.clone().lerp(prefAt(c[i]).clone().multiplyScalar(sign), smooth01((s - w0) / (w1 - w0)));
    v.addScaledVector(t, -v.dot(t));
    e.push(v.lengthSq() > 1e-12 ? v.normalize() : e[i - 1].clone());
  }
  return (laneCentres[g] = { c, e, M, e0 });
}
// harness wire `key` after the bundle: its lane of the branch, offset as it sits across the group
function laneRun(key) {
  const { c, e, M, e0 } = laneCentre(LANE_OF[key]);
  const off = bundleRun(key).pts.at(-1).clone().sub(M).dot(e0);
  return c.slice(1).map((p, i) => p.clone().addScaledVector(e[i + 1], off));
}
// a seeded "hand laid" sideways offset so parallel bench wires do not look ruler-straight
const wobble = (seed) => { const s = Math.sin(seed * 12.9898) * 43758.5453; return (s - Math.floor(s)) - 0.5; };

// out of a terminal and down onto the bench, towards `outward`. A dupont jumper in a breadboard hole
// leaves its housing straight up, crosses its board edge square (t.exit, else the one `outward` points
// to most) and lands t.run beyond it; any other terminal leaves along its own direction for `run`
// (default 0.45) before the wire turns.
const EDGE = { 'x-': W3(-1, 0, 0), 'x+': W3(1, 0, 0), 'z-': W3(0, 0, -1), 'z+': W3(0, 0, 1) };
const DUPONT = { H: 0.32, W: P.mm(2.5), CRIMP: 0.12 };   // housing height / width, wire end above the hole
const housed = (t, dy) => t.p.clone().addScaledVector(up, dy);
function terminalRun(t, r, outward) {
  const side = outward.clone().setY(0).normalize();
  if (t.hole) {
    const ex = EDGE[t.exit] || (Math.abs(side.x) > Math.abs(side.z) ? W3(Math.sign(side.x), 0, 0) : W3(0, 0, Math.sign(side.z) || 1));
    const k = ex.x ? (ex.x > 0 ? BB_BOX.max.x - t.p.x : t.p.x - BB_BOX.min.x) : (ex.z > 0 ? BB_BOX.max.z - t.p.z : t.p.z - BB_BOX.min.z);
    const h = t.p.y + 0.5;
    return [housed(t, DUPONT.CRIMP), housed(t, DUPONT.H), housed(t, DUPONT.H + 0.1),   // straight through the housing
      t.p.clone().addScaledVector(ex, k).setY(h),                                       // over the board edge
      t.p.clone().addScaledVector(ex, k + 0.12).setY(h - 0.16),
      onBench(t.p.clone().addScaledVector(ex, k + t.run), r)];
  }
  const flat = t.d.clone().setY(0); if (flat.lengthSq() < 0.01) flat.copy(side);
  return [t.p.clone(), t.p.clone().addScaledVector(t.d, 0.14), onBench(t.p.clone().addScaledVector(flat.normalize(), t.run ?? 0.45), r)];
}
function benchRoute(A, B, r, via, seed) {
  const mid = (via || []).map(v => onBench(v, r, v.y));        // a via with y > 0 lies on top of other wires
  const a = terminalRun(A, r, flatDir(A.p, mid[0] ?? B.p));
  const b = terminalRun(B, r, flatDir(B.p, mid[mid.length - 1] ?? A.p)).reverse();
  if (!via) {
    const s = a[a.length - 1], e = b[0], m = s.clone().lerp(e, 0.5);
    const side = new THREE.Vector3(-(e.z - s.z), 0, e.x - s.x).normalize();
    m.addScaledVector(side, wobble(seed) * Math.min(0.9, s.distanceTo(e) * 0.12));
    mid.push(onBench(m, r));
  }
  return [...a, ...mid, ...b];
}
// a dupont jumper between two breadboard holes: straight out of both housings, then an arc high enough
// to clear the wires that leave the holes in between over the back edge
function jumperRoute(A, B) {
  const m = A.p.clone().lerp(B.p, 0.5); m.y += 0.7;
  return [housed(A, DUPONT.CRIMP), housed(A, DUPONT.H), housed(A, 0.56), m, housed(B, 0.56), housed(B, DUPONT.H), housed(B, DUPONT.CRIMP)];
}
// the bare, bent leg of the capacitor from a lever-block entry to the capacitor body
function legRoute(A, B) {
  return [A.p.clone(), A.p.clone().addScaledVector(A.d, 0.05), B.p.clone().addScaledVector(B.d, 0.035), B.p.clone()];
}
// hand-placed waypoints on the bench (y = lift over other wires) for runs that would cut through a part
const VIA = {
  'psu.+5V>sw.in': [W3(-5.95, 0, 3.6)],
  'psu.GND>dist.GNDin': [W3(-4.5, 0, 3.45)],
  'fuse.out>dist.5Vin': [W3(-0.9, 0, 6.02), W3(-0.16, 0, 5.86), W3(-0.06, 0, 5.42), W3(-0.2, 0, 4.97)],
  'dist.5V>lvl.VCC': [W3(1.2, 0, 4.12)],
  // the breadboard GND wires go straight back, over the harness and along the back of the breadboard
  'dist.GND>lvl.GND': [W3(-2.82, 0, 1.98), W3(-0.8, 0, 1.98), W3(-0.45, 0.26, 1.98), W3(0.42, 0.26, 1.98), W3(0.78, 0, 1.98)],
  'dist.GND>esp.GNDin': [W3(-2.66, 0, 2.12), W3(-0.8, 0, 2.12), W3(-0.45, 0.26, 2.12), W3(0.42, 0.26, 2.12), W3(0.78, 0, 2.12)],
  // the data wire leaves the 330Ω strip over the back edge, runs behind the GND wires and comes in from
  // the right on top of the harness, where the bundle starts (SIDE_ENTRY: no run-in from the front)
  'res.out>rig.DIN': [W3(1.4, 0, 1.74), W3(0.85, 0, 1.45)],
};
const SIDE_ENTRY = new Set(['res.out>rig.DIN']);
function pickTerm(id, name, key) {
  const t = TERM[id]?.[name];
  if (!t || !Array.isArray(t)) return t || null;
  if (FAN[key] === undefined) console.warn('no FAN entry for', key);
  return t[FAN[key] ?? 0];
}

/* ------------------------------------------------------------ wire against wire --- */
// Two wires cannot pass through each other. Every wire is sampled ~1.2 mm apart; where two come closer
// than their radii plus PLAY, both give way, square to their own run and away from the other (two that
// cross right through each other: over / under, the later one on top), and the push is spread smoothly
// along each wire, the way a wire bends when you lay another one across it. The ends stay put (in a
// dupont housing, a lever block, on a led), a wire lying on the bench cannot go down, and the pole, the
// rods and the foot of the rig stay clear. A few rounds settle it; only what moved is looked at again.
const PLAY = 0.004;                                   // 0.16 mm between two wires that touch
const STEP = 0.03, CELL = 0.11;                       // sample spacing; grid cell > largest reach
// the rig frame as segments (a, unit direction u, length, radius): the pole and the six rods
const RIG_BARS = [[W3(RIG.OFFSET.x, 0.9, RIG.OFFSET.z), W3(RIG.OFFSET.x, RIG.OFFSET.y - RIG.D, RIG.OFFSET.z), 0.065],
  ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d =>
    [RIG.OFFSET.clone(), RIG.OFFSET.clone().add(W3(...d).multiplyScalar(RIG.D)), 0.045])]
  .map(([a, b, rb]) => ({ a, u: b.clone().sub(a).normalize(), len: a.distanceTo(b), rb }));
// height of the foot (rubber ring, conical disc, flattened dome) at distance `rad` from the pole
const footTop = rad => (rad < 1.7 ? 0.4 + 0.544 * Math.sqrt(1 - (rad / 1.7) ** 2) : rad < 2.3 ? 0.02 + (2.3 - rad) / 0.6 * 0.38 : -Infinity);
function clearRig(v, r) {
  for (const { a, u, len, rb } of RIG_BARS) {
    const wx = v.x - a.x, wy = v.y - a.y, wz = v.z - a.z, t = wx * u.x + wy * u.y + wz * u.z;
    if (t <= 0 || t >= len) continue;
    const ox = wx - t * u.x, oy = wy - t * u.y, oz = wz - t * u.z, d = Math.hypot(ox, oy, oz), min = rb + r + PLAY;
    if (d < min && d > 1e-9) { const k = min / d; v.set(a.x + t * u.x + ox * k, a.y + t * u.y + oy * k, a.z + t * u.z + oz * k); }
  }
  const top = footTop(Math.hypot(v.x - RIG.OFFSET.x, v.z - RIG.OFFSET.z)) + r + PLAY;
  if (v.y < top) v.y = top;
}
function separateWires(list) {
  const t0 = performance.now(), v = new THREE.Vector3(), trace = [];
  const ws = list.map(w => {
    const L = w.curve.getLength(), n = Math.max(4, Math.ceil(L / STEP)), N = n + 1;
    const p = new Float64Array(N * 3), mob = new Float64Array(N), act = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      w.curve.getPointAt(i / n, v); p[3 * i] = v.x; p[3 * i + 1] = v.y; p[3 * i + 2] = v.z;
      const s = (i / n) * L;                          // free from `lock` on, fully after another 0.25
      mob[i] = w.fixed ? 0 : smooth01((s - w.lock[0]) / 0.25) * smooth01((L - s - w.lock[1]) / 0.25);
      act[i] = mob[i] > 0 ? 1 : 0;                    // to (re)check this round: all at first, later only
    }                                                 // what moved or touched something
    return { w, N, p, mob, act, nxt: new Uint8Array(N), r: w.r, d: new Float64Array(N * 3), pushed: false, changed: false };
  });
  const cellOf = x => Math.floor(x / CELL) + 512;
  const grid = new Map(), near = [], tmp = new Float64Array(3 * Math.max(...ws.map(W => W.N)));
  const floored = (W, i) => W.p[3 * i + 1] - floorAt(W.p[3 * i], W.p[3 * i + 2], W.r) < 1e-4;
  const tangent = (W, i, out) => {
    const a = 3 * Math.max(i - 1, 0), b = 3 * Math.min(i + 1, W.N - 1), p = W.p;
    return out.set(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]).normalize();
  };
  const mark = (W, i) => W.nxt.fill(1, Math.max(i - 10, 0), Math.min(i + 11, W.N));
  const label = W => W.w.key || W.w.label || W.w.tag;
  const ta = new THREE.Vector3(), tb = new THREE.Vector3();
  let it = 0, worst = 0, worstAt = null;
  for (; it < 40; it++) {
    grid.clear();
    ws.forEach((W, a) => { for (let i = 0; i < W.N; i++) {
      const k = (cellOf(W.p[3 * i]) * 1024 + cellOf(W.p[3 * i + 1])) * 1024 + cellOf(W.p[3 * i + 2]);
      const c = grid.get(k); if (c) c.push(a, i); else grid.set(k, [a, i]);
    } });
    worst = 0; worstAt = null;
    ws.forEach((A, a) => {
      A.pushed = false; if (A.w.fixed || !A.act.includes(1)) return;
      A.d.fill(0);
      for (let i = 0; i < A.N; i++) {
        if (!A.act[i] || A.mob[i] === 0) continue;
        const px = A.p[3 * i], py = A.p[3 * i + 1], pz = A.p[3 * i + 2];
        const cx = cellOf(px), cy = cellOf(py), cz = cellOf(pz);
        near.length = 0;                                // nearest sample of every other wire in reach
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const c = grid.get(((cx + dx) * 1024 + cy + dy) * 1024 + cz + dz); if (!c) continue;
          for (let m = 0; m < c.length; m += 2) {
            const b = c[m]; if (b === a) continue;
            const B = ws[b], j = c[m + 1], qx = B.p[3 * j] - px, qy = B.p[3 * j + 1] - py, qz = B.p[3 * j + 2] - pz;
            const d2 = qx * qx + qy * qy + qz * qz, reach = A.r + B.r + PLAY + STEP;
            if (d2 > reach * reach || (A.w.group && A.w.group === B.w.group)) continue;
            let f = -1; for (let q = 0; q < near.length; q += 3) if (near[q] === b) { f = q; break; }
            if (f < 0) near.push(b, j, d2); else if (d2 < near[f + 2]) { near[f + 1] = j; near[f + 2] = d2; }
          }
        }
        if (!near.length) continue;
        tangent(A, i, ta);
        for (let q = 0; q < near.length; q += 3) {
          const b = near[q], B = ws[b], j = near[q + 1], P = B.p;
          // the closest point of B (its polyline on both sides of sample j) to this point
          let best = Infinity, qx = 0, qy = 0, qz = 0;
          for (let h = 0; h < 2; h++) {
            const u = h ? j : Math.max(j - 1, 0), w = h ? Math.min(j + 1, B.N - 1) : j;
            const sx = P[3 * w] - P[3 * u], sy = P[3 * w + 1] - P[3 * u + 1], sz = P[3 * w + 2] - P[3 * u + 2];
            const l2 = sx * sx + sy * sy + sz * sz;
            const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - P[3 * u]) * sx + (py - P[3 * u + 1]) * sy + (pz - P[3 * u + 2]) * sz) / l2)) : 0;
            const ex = P[3 * u] + t * sx, ey = P[3 * u + 1] + t * sy, ez = P[3 * u + 2] + t * sz;
            const d2 = (px - ex) ** 2 + (py - ey) ** 2 + (pz - ez) ** 2;
            if (d2 < best) { best = d2; qx = ex; qy = ey; qz = ez; }
          }
          const dist = Math.sqrt(best), pen = A.r + B.r + PLAY - dist; if (pen <= 0) continue;
          mark(A, i); mark(B, j);                       // both have to be looked at again next round
          // give way square to the own wire, away from B; where the two cross right through each other,
          // over / under along their common normal (the later wire on top)
          const dx = px - qx, dy = py - qy, dz = pz - qz, k = dx * ta.x + dy * ta.y + dz * ta.z;
          let nx = dx - k * ta.x, ny = dy - k * ta.y, nz = dz - k * ta.z;
          const l = Math.hypot(nx, ny, nz);
          if (l > 0.25 * dist && l > 1e-7) { nx /= l; ny /= l; nz /= l; } else {
            v.copy(ta).cross(tangent(B, j, tb));
            if (v.lengthSq() < 1e-4) v.copy(ta).cross(Math.abs(ta.y) < 0.9 ? up : W3(1, 0, 0));
            v.normalize();
            if (v.y < 0 || (v.y === 0 && (v.x < 0 || (v.x === 0 && v.z < 0)))) v.negate();
            if (a < b) v.negate();
            nx = v.x; ny = v.y; nz = v.z;
          }
          let ma = A.mob[i], mb = B.mob[j];             // who gives way; a wire on the bench cannot go down
          if (ny < -0.3 && floored(A, i)) ma = 0;
          if (ny > 0.3 && floored(B, j)) mb = 0;
          if (ma + mb === 0) continue;
          if (pen > worst) { worst = pen; worstAt = [label(A), label(B), +px.toFixed(3), +py.toFixed(3), +pz.toFixed(3)]; }
          const f = pen * ma / (ma + mb);
          A.d[3 * i] += nx * f; A.d[3 * i + 1] += ny * f; A.d[3 * i + 2] += nz * f; A.pushed = true;
        }
      }
    });
    trace.push(+(worst * 40).toFixed(2));
    if (worst < 0.002) break;                          // every gap at least 0.08 mm
    for (const A of ws) if (A.pushed) {
      const d = A.d, N = A.N;
      for (let pass = 0; pass < 8; pass++) {           // spread the push along the wire (binomial blur)
        for (let i = 0; i < N; i++) {
          const a = 3 * Math.max(i - 1, 0), b = 3 * Math.min(i + 1, N - 1);
          for (let c = 0; c < 3; c++) tmp[3 * i + c] = 0.25 * d[a + c] + 0.5 * d[3 * i + c] + 0.25 * d[b + c];
        }
        d.set(tmp.subarray(0, 3 * N));
      }
      for (let i = 0; i < N; i++) {
        const m = A.mob[i]; if (m === 0 || Math.abs(d[3 * i]) + Math.abs(d[3 * i + 1]) + Math.abs(d[3 * i + 2]) < 1e-9) continue;
        v.set(A.p[3 * i] + d[3 * i] * m, A.p[3 * i + 1] + d[3 * i + 1] * m, A.p[3 * i + 2] + d[3 * i + 2] * m);
        v.y = Math.max(v.y, floorAt(v.x, v.z, A.r));
        clearRig(v, A.r);
        A.p[3 * i] = v.x; A.p[3 * i + 1] = v.y; A.p[3 * i + 2] = v.z;
        A.nxt[i] = 1;
      }
      A.changed = true;
    }
    for (const W of ws) { W.act.set(W.nxt); W.nxt.fill(0); }
  }
  for (const W of ws) if (W.changed) {
    const pts = []; for (let i = 0; i < W.N; i++) pts.push(W3(W.p[3 * i], W.p[3 * i + 1], W.p[3 * i + 2]));
    W.w.curve = new OnBench(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), W.r);
  }
  return { rounds: it + 1, worst, worstAt, trace, ms: +(performance.now() - t0).toFixed(1), samples: ws.reduce((s, W) => s + W.N, 0),
    moved: ws.filter(W => W.changed).map(label) };
}

const markerGeo = new THREE.SphereGeometry(0.026, 10, 8);
let wireRelax = null;                                 // what separateWires did (for ?debug / the smoke test)
function buildWires() {
  const decorBlack = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.5 });
  const pinMetal = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.3 });
  // how far from each end a wire is held: through its dupont housing, out of a lever block / screw
  // terminal, onto a led — beyond that it may give way to other wires
  const lockLen = t => (t.hole ? 0.3 : (t.lead ?? 0.14) + 0.01);
  const runs = [];
  CONNECTIONS.forEach((c, n) => {
    const [pa, ta, pb, tb, cat, , flag] = c;
    if (flag === 'bb') return;                                    // same breadboard strip: nothing to draw
    const key = `${pa}.${ta}>${pb}.${tb}`;
    const A = pickTerm(pa, ta, key), B = pickTerm(pb, tb, key);
    if (!A || !B) { console.warn('missing terminal', pa, ta, pb, tb); return; }
    const W = WIRE[cat];
    let pts, r = W.r, mat = null;
    if (cat === 'bt') {
      // the wireless Bluetooth link: a dashed arc (no wire) so it reads as "over the air"
      const mid = A.p.clone().lerp(B.p, 0.5); mid.y += 1.6;
      const curve = new THREE.QuadraticBezierCurve3(A.p.clone(), mid, B.p.clone());
      const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),
        new THREE.LineDashedMaterial({ color: W.color, transparent: true, opacity: 0.85, dashSize: 0.12, gapSize: 0.1 }));
      m.computeLineDistances();
      scene.add(m);
      wires.push(mkWire(m, c, curve, cat));
      return;
    }
    const ab = A.hole && B.hole;
    if (A.hole !== B.hole && (A.hole || B.hole)) r = Math.min(r, 0.026);   // 22 AWG into the breadboard
    if (A.leg || B.leg) {                                          // a capacitor leg: bare tinned wire
      pts = legRoute(A, B); r = 0.009;
      mat = new THREE.MeshStandardMaterial({ color: 0xd4d8de, metalness: 1, roughness: 0.3, emissive: W.color, emissiveIntensity: 0 });
    } else if (HARNESS_SLOT[key]) {
      const sp = bundleRun(key).pts;
      const via = (VIA[key] || []).map(v => onBench(v, r, v.y));
      const lead = terminalRun(A, r, flatDir(A.p, via[0] ?? sp[0]));
      // run in from the front, square onto the bundle start (or, SIDE_ENTRY, straight onto it)
      const back = SIDE_ENTRY.has(key) ? []
        : [sp[0].clone().add(new THREE.Vector3().subVectors(sp[0], sp[1]).setY(0).normalize().multiplyScalar(0.55))];
      pts = [...lead, ...via, ...back, ...sp, ...laneRun(key)];
    } else if (ab) {
      pts = jumperRoute(A, B);
    } else {
      pts = benchRoute(A, B, r, VIA[key], n + 1);
    }
    runs.push({ c, key, cat, A, B, r, mat, curve: new OnBench(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), r),
      lock: [lockLen(A), lockLen(B)], fixed: !!mat });
  });
  // decorative links that are not in CONNECTIONS (fixed: the wires give way to them)
  const decos = [];
  const deco = (pts, col, r, tag, label) => decos.push({ curve: new OnBench(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), r),
    r, col, tag, label, fixed: true, group: tag === 'mains' ? 'mains' : null, lock: [0, 0] });
  // the 74AHCT125's inputs may not float (datasheet): 1OE to GND with a short jumper (buffer 1 always on);
  // the unused ones with pre-formed wire links flat on the board (printed column numbers): on the back
  // half 2OE + 2A to GND (col 44 — buffer 2 on, its output 2Y low and unused), on the front half 3OE,
  // 3A, 4OE, 4A to 5V (col 50 — buffers 3 and 4 off)
  const hw0 = (col, row) => bb.group.localToWorld(bb.hole(col - 1, row));
  const oe = hw0(50, 'g'), g7 = hw0(44, 'g');
  deco([oe, oe.clone().add(W3(0, 0.08, 0)), oe.clone().lerp(g7, 0.5).add(W3(0, 0.12, 0)), g7.clone().add(W3(0, 0.08, 0)), g7],
    0x1d1e22, 0.016, 'jumper', '1OE-GND');
  const link = (c1, r1, c2, r2, col, label) => {
    const a = hw0(c1, r1), b = hw0(c2, r2), h = W3(0, 0.045, 0);   // the bridge 1.8 mm above the board
    deco(Math.abs(c1 - c2) < 2 ? [a, a.clone().add(h), a.clone().lerp(b, 0.5).add(h).add(W3(0, 0.008, 0)), b.clone().add(h), b]
      : [a, a.clone().add(h), a.clone().lerp(b, 0.25).add(h), a.clone().lerp(b, 0.75).add(h), b.clone().add(h), b],
    col, 0.016, 'jumper', label);
  };
  link(46, 'h', 44, 'h', 0x1d1e22, '2A-GND'); link(47, 'i', 44, 'i', 0x1d1e22, '2OE-GND');
  link(46, 'a', 50, 'a', 0xc8261e, '3OE-5V'); link(45, 'c', 46, 'c', 0xc8261e, '3A-3OE');
  link(48, 'b', 50, 'b', 0xc8261e, '4A-5V'); link(49, 'd', 50, 'd', 0xc8261e, '4OE-5V');
  // the mains cable: three cores from the PSU screws into the sheath, off the back of the bench
  const cores = [['L', 0x7a4a26], ['N', 0x2a5bd7], ['PE', 0x7fbf3a]];
  const join = toWorld(hw.psu.group, { p: new THREE.Vector3(P.mm(70), P.mm(10), P.mm(-60)), d: up });
  cores.forEach(([k, col], i) => {
    const s = toWorld(hw.psu.group, hw.psu.screws[k]);
    deco([s.p, s.p.clone().addScaledVector(s.d, 0.18), onBench(s.p.clone().add(W3(0.4, 0, -0.25 - i * 0.05)), 0.03), join.p.clone().add(W3(0, 0.03, 0))], col, 0.028, 'mains');
  });
  deco([join.p, onBench(W3(-5.4, 0, -0.6), 0.09), onBench(W3(-6.2, 0, -6.5), 0.09), W3(-6.4, 0.095, -10.85),
    W3(-6.42, 0.095, -11.0), W3(-6.43, 0.088, -11.036), W3(-6.44, 0.067, -11.067), W3(-6.45, 0.036, -11.088),
    W3(-6.46, 0, -11.095), W3(-6.5, -0.6, -11.25), W3(-6.6, -6, -11.3), W3(-6.7, -16, -11.2),
    W3(-6.6, -22.4, -10.4), W3(-5.0, -22.42, -8.6)], 0x2b2d31, 0.085, 'mains');

  wireRelax = separateWires([...runs, ...decos]);

  for (const w of runs) {
    const { c, key, cat, A, B, r, mat, curve } = w, W = WIRE[cat];
    const geo = new THREE.TubeGeometry(curve, Math.max(24, Math.round(curve.getLength() * 28)), r, 8, false);   // ~1.4 mm segments
    const m = new THREE.Mesh(geo, mat || new THREE.MeshStandardMaterial({ color: W.color, roughness: 0.42, metalness: 0,
      emissive: W.color, emissiveIntensity: 0 }));
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    // dupont housings where a wire plugs into the breadboard
    for (const t of [A, B]) if (t.hole) {                         // housing on the board, pin in the hole
      const h = new THREE.Mesh(new THREE.BoxGeometry(DUPONT.W, DUPONT.H, DUPONT.W), decorBlack);
      h.position.copy(t.p).addScaledVector(up, DUPONT.H / 2 + 0.001); h.castShadow = true; scene.add(h);
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.06, 0.016), pinMetal);
      pin.position.copy(t.p).addScaledVector(up, -0.02); scene.add(pin);
      h.userData.dupont = pin.userData.dupont = key;
    }
    wires.push(mkWire(m, c, curve, cat, !mat));
  }
  for (const d of decos) {
    const t = new THREE.Mesh(new THREE.TubeGeometry(d.curve, Math.max(48, Math.round(d.curve.getLength() * 28)), d.r, 8, false),
      new THREE.MeshStandardMaterial({ color: d.col, roughness: 0.45 }));
    t.castShadow = true; t.userData.deco = d.tag; if (d.label) t.userData.label = d.label; scene.add(t);
  }
  // cable ties around the pole + harness (twice) and around the D-C rod + harness, pulled round
  // whatever runs past at that height: an ellipse just outside the bar and the outermost wires
  const tie = y => {
    const TT = 0.014, c = [[RIG.OFFSET.x, RIG.OFFSET.z, y < RIG.OFFSET.y - RIG.D ? 0.065 : 0.045]];   // the bar
    const q = new THREE.Vector3(), prev = new THREE.Vector3();
    for (const w of runs) if (HARNESS_SLOT[w.key]) {
      const N = Math.ceil(w.curve.getLength() / 0.01);
      w.curve.getPointAt(0, prev);
      for (let i = 1; i <= N; i++, prev.copy(q)) {
        w.curve.getPointAt(i / N, q);
        if ((prev.y - y) * (q.y - y) <= 0 && Math.hypot(q.x - RIG.OFFSET.x, q.z - RIG.OFFSET.z) < 0.6) { c.push([q.x, q.z, w.r]); break; }
      }
    }
    const x0 = Math.min(...c.map(([x, , r]) => x - r)), x1 = Math.max(...c.map(([x, , r]) => x + r));
    const z0 = Math.min(...c.map(([, z, r]) => z - r)), z1 = Math.max(...c.map(([, z, r]) => z + r));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = (x1 - x0) / 2 + TT, hd = (z1 - z0) / 2 + TT;
    const k = Math.max(...c.map(([x, z, r]) => Math.hypot((Math.abs(x - cx) + r + TT) / hw, (Math.abs(z - cz) + r + TT) / hd)));
    const rx = hw * k, rz = hd * k;
    const t = new THREE.Mesh(new THREE.TorusGeometry(rx, TT, 6, 48), new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.6 }));
    t.rotation.x = Math.PI / 2; t.position.set(cx, y, cz); t.scale.set(1, rz / rx, 1); scene.add(t);
    t.userData.tie = { y, cx, cz, rx, rz, r: TT };
  };
  tie(1.45); tie(1.85); tie(5.75);
}
function mkWire(mesh, conn, curve, type, flow = true) {
  const markers = [];                                  // (a bare capacitor leg is too short for flow markers)
  if (flow && type !== 'bt') for (const off of [0, 0.5]) {
    const glowCol = type === 'gnd' ? 0x8fa3c2 : WIRE[type].color;          // black wire -> a cool-white pulse
    const s = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color: glowCol, emissive: glowCol, emissiveIntensity: 2.2 }));
    s.userData.off = off; s.castShadow = false; scene.add(s); markers.push(s);
  } else if (type === 'bt') for (const off of [0, 0.33, 0.66]) {
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
  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fov = Math.min(fovV, 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect));   // portrait: width is the limit
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
let downXY = null, multiTouch = false;
const touching = new Set();              // a pinch / two-finger pan is never a tap
canvas.addEventListener('pointerdown', e => {
  touching.add(e.pointerId);
  if (touching.size > 1) multiTouch = true; else { multiTouch = false; downXY = [e.clientX, e.clientY]; }
});
canvas.addEventListener('pointercancel', e => { touching.delete(e.pointerId); downXY = null; });
canvas.addEventListener('pointerup', e => {
  touching.delete(e.pointerId);
  if (multiTouch) { downXY = null; return; }
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
let flowOn = true, labelsOn = !PHONE;     // phone: 13 labels would bury the scene -> off, one tap turns them on
const tgFlow = document.getElementById('tg-flow');
const tgLabels = document.getElementById('tg-labels');
tgLabels.classList.toggle('on', labelsOn); elLabels.style.display = labelsOn ? 'block' : 'none';
tgFlow.onclick = () => { flowOn = !flowOn; tgFlow.classList.toggle('on', flowOn); };
tgLabels.onclick = () => { labelsOn = !labelsOn; tgLabels.classList.toggle('on', labelsOn);
  elLabels.style.display = labelsOn ? 'block' : 'none'; };
document.getElementById('btn-reset-view').onclick = () => flyTo(camHome(), TARGET0);

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

// phone: a sheet (part info / controller) covers part of the screen, so the picture glides out from under
// it — the orbit centre stays the same, only the projection window shifts. Portrait: up; landscape: the
// info sheet sits on the right (picture moves left), the controller at the bottom (picture moves up).
const viewShift = { x: 0, y: 0 };
function updateViewShift(dt) {
  const phone = PHONE_MQ.matches, portrait = innerHeight > innerWidth;
  const info = !elInfo.classList.contains('hidden'), pad = document.body.classList.contains('m-pad');
  const want = { x: 0, y: 0 };
  if (phone && portrait) want.y = info ? 0.22 : pad ? 0.2 : 0;
  else if (phone) { want.x = info ? 0.2 : 0; want.y = pad && !info ? 0.16 : 0; }
  const k = Math.min(1, dt * 7);
  for (const a of ['x', 'y']) {
    viewShift[a] += (want[a] - viewShift[a]) * k;
    if (Math.abs(want[a] - viewShift[a]) < 1e-3) viewShift[a] = want[a];
  }
  if (viewShift.x || viewShift.y) camera.setViewOffset(innerWidth, innerHeight,
    viewShift.x * innerWidth, viewShift.y * innerHeight, innerWidth, innerHeight);
  else if (camera.view?.enabled) camera.clearViewOffset();
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

  updateViewShift(dt);
  updateLabels();
  stage.render();
  if (firstFrame) { firstFrame = false; elLoading?.classList.add('done'); }
  requestAnimationFrame(tick);
}

// debug/automation hook (screenshots, smoke test) — only with ?debug in the URL
if (new URLSearchParams(location.search).has('debug')) {
  window.__bench = { stage, camera, controls, select, clearSelect, setPower, doScramble, doTwist, doUndo, doReset,
    pressPlane, setDir, clearDir, moveCell, flyTo, focusPart, puzzle, wires, TERM, CONNECTIONS,
    bbBox: BB_BOX, bbGroup: bb.group, PART_GROUP, MAT, BENCH, MAT_TOP, RIG, get wireRelax() { return wireRelax; },   // for tools/bench-audit.mjs
    get sel() { return sel; }, get colorAnim() { return colorAnim; }, get moves() { return moves; },
    get selected() { return selected; }, get chainOn() { return chainOn; },
    finishAnimations() { if (flight) flight.t = flight.ms; if (colorAnim) colorAnim.t = colorAnim.dur; } };
}

refresh();   // paint the solved puzzle onto the leds + fill the controller HUD
tick();
