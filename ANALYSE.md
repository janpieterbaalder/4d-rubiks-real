# Analyse & verbeterronde — 4D Rubiks LED-installatie

*Oktober 2026 · scope: de hele repo (3D-werkbank, engine, firmware, Wokwi-testbanken, documentatie,
meegeleverde game, repo-inrichting).* Waar iets een eigen inschatting is in plaats van een gemeten of
uit de code afgeleid feit, staat er **Inschatting** bij.

## Samenvatting

- **3D-werkbank volledig realistisch gemaakt**: fysiek gebaseerde materialen, studio-reflecties, zachte
  schaduwen, HDR-bloom op de leds, gekleurd licht van de cellen op frame en werkbank, een werkplaats
  (werkbank, ESD-mat, gaatjesbord, betonvloer, plafondlamp) en alle onderdelen op ware grootte. De led-rig
  bestaat nu — zoals het Blender-model en `PLAN.md` beschrijven — uit 7 × 27 matwitte PETG-kubusjes met
  elk een led erin, in plaats van bolletjes in een doorzichtige doos.
- **Echte bug in de firmware-engine gevonden en opgelost**: de undo-historie stopte met opnemen zodra hij
  vol was (16 zetten). Na 17+ zetten draaide "undo" een óude zet terug in plaats van de laatste. Bewezen
  met een nieuwe C++↔JS-pariteitstest (faalde vóór de fix bij operatie #24, slaagt erna op 4.033 operaties).
- **Ontwerpfout in de power-injectie** rechtgezet: R/U/B (#27/#81/#162) liet een gat van 81 leds, in strijd
  met de eigen vuistregel (elke ~50–60 leds). Nu L/D/B (#54/#108/#162): maximaal 54 leds per segment,
  zelfde aantal draden.
- **Werkbank-bugs** opgelost: animaties hingen af van de framerate (op een 144 Hz-scherm duurde een draai
  ~0,9 s, op 30 fps ~4 s), de 330Ω-weerstand had de kleurcode van 100Ω, en enkele toetsenbord-randgevallen.
- **Tests en CI toegevoegd**: firmware-pariteitstest, headless browsertest van de werkbank (15 checks),
  GitHub Actions voor alle tests (inclusief de bestaande game-tests, die jsdom nodig hebben).

## 1. Werkwijze

| Wat | Hoe |
|---|---|
| Code gelezen | `hardware.js/.html`, `engine.js`, alle firmware (`esp32_bluepad32`, `tesseract_rig`, beide Wokwi-sketches, `tesseract_engine.h`), `BEDRADING.md`, `PLAN.md`, READMEs |
| Bestaande tests | `engine.test.js` 28/28 groen; game-tests (`math`, `levels`) groen mits `jsdom` geïnstalleerd is (stond nergens als afhankelijkheid) |
| Firmware-engine | native gecompileerd (g++ + kleine Arduino-shim) en operatie-voor-operatie vergeleken met `engine.js` |
| 3D-werkbank | headless Chromium (zelfde engine als Edge): screenshots voor/na, console-fouten, draw-calls, toetsenbord-spel |
| Statische controle | ESLint (no-undef, no-unused-vars, …) over alle JS: 0 fouten, 4 waarschuwingen (2 opgeruimd, 2 onschadelijk in bestaande/meegeleverde code) |

## 2. Bevindingen en status

Ernst: **H** = verkeerd gedrag voor de gebruiker · **M** = inconsistentie/ontwerpfout · **L** = klein / cosmetisch.

| # | Gebied | Bevinding | Ernst | Status |
|---|---|---|---|---|
| 1 | Firmware-engine | `tesseract_engine.h`: undo-historie (16) stopte met opnemen als hij vol was → undo na 17+ zetten draaide de verkeerde zet terug (op álle rigs) | H | **Opgelost**: ringbuffer (oudste valt weg); 128 diep op ESP32, 16 op AVR |
| 2 | Testdekking | De claim "C++-engine = 1-op-1 port van engine.js" was niet geautomatiseerd getoetst | M | **Opgelost**: `firmware/test/parity.test.mjs` |
| 3 | Hardware-ontwerp | Power-injectie R/U/B laat 81 leds (#81→#162) tussen twee voedingspunten; eigen vuistregel zegt ~50–60 | M | **Opgelost**: L/D/B (#54/#108/#162) in werkbank, `BEDRADING.md`, ESP32-README |
| 4 | Werkbank | Animatietijd per frame opgeteld (`t += 16` ms, `+= 0.016` s, …) → snelheid hing af van de framerate | H | **Opgelost**: echte tijdsdelta (geklemd op 50 ms) |
| 5 | Werkbank | Draaiduur 2000 ms terwijl alle firmware 1500 ms gebruikt ("1-op-1") | L | **Opgelost**: 1500 ms |
| 6 | Werkbank | 3D-weerstand: bruin-zwart-bruin (= 100Ω) in plaats van oranje-oranje-bruin-goud (330Ω) | L | **Opgelost** |
| 7 | Werkbank | Ademend oplichten van een geselecteerd onderdeel overschreef de eigen gloei-intensiteit en herstelde die nooit | L | **Opgelost** (aparte tint, volledig teruggezet) |
| 8 | Werkbank | Pijltje vasthouden + van venster wisselen → richting bleef "vast"; volgende vlakknop draaide meteen | L | **Opgelost** (blur laat los) |
| 9 | Werkbank | `Shift+S` ingedrukt houden husselde herhaald; `Ctrl/Cmd`-sneltoetsen activeerden spelacties | L | **Opgelost** |
| 10 | Werkbank vs. docs | `BEDRADING.md` §2 zegt dat de kleuren gelijk zijn aan de werkbank (🟠 5V-data, ⚫ GND), maar de werkbank had één gele datakleur en grijze massa | M | **Opgelost**: aparte 3,3V- (geel) en 5V-data (oranje), zwarte GND; legenda gegenereerd uit dezelfde tabel |
| 11 | Werkbank vs. docs | 330Ω en 1000µF stonden op tafel naast de ESP32, terwijl `BEDRADING.md` "zo dicht mogelijk bij led #0" voorschrijft | M | **Herzien** (prototype-opstelling): 330Ω op het breadboard direct achter de levelshifter, 1000µF over de 5V/GND-verdeelblokken; eindbouw bij led #0 — beide in `BEDRADING.md` §2 |
| 12 | Werkbank | Geselecteerde kern-led (midden van een kubus) is bij matte kubusjes onzichtbaar | L | **Opgelost** met lichtlek naar de buurkubusjes (zoals echte PETG-diffusers doen) |
| 13 | Prestaties | 189 losse led-meshes + 189 materialen; schaduwkaart zou elk frame herberekend worden | M | **Opgelost**: één InstancedMesh (−188 draw-calls), schaduw alleen bij verandering, kwaliteitsschakelaar hoog/laag |
| 14 | Firmware ESP32 | Meerdere knoppen in één controller-frame konden een tweede zet starten terwijl de eerste animatie net begon (golf van zet 1 ging verloren) | L | **Opgelost** (`if (animating) return;`, ook in de Wokwi-ESP32-testbank) |
| 15 | Firmware ESP32 | Na een zet werd de status niet meer over Serial gemeld (alleen bij niet-animeren) | L | **Opgelost**: melding zodra de animatie klaar is |
| 16 | Code | Dode code in de werkbank (`j3idx`, `j3Options`, `allLeds`, `shells`, ongebruikte imports) | L | **Opgeruimd** |
| 17 | Docs | Persoonlijk Windows-pad (`C:\Users\rogst\…`) in de README; widget-locatie "onderin" klopte niet (zit rechtsboven) | L | **Opgelost** |
| 18 | Docs | Preview-afbeeldingen toonden de verwijderde oude simulator | L | **Vervangen** door de nieuwe werkbank |
| 19 | Repo | Geen CI; game-tests hebben `jsdom` nodig maar niets installeert het | M | **Opgelost**: `.github/workflows/tests.yml` |
| 20 | Wokwi | Het opgeslagen Wokwi-project gebruikt een **geüploade kopie** van `tesseract_engine.h` en `sketch.ino` | M | **Actie voor jou**: upload beide bestanden opnieuw naar het Wokwi-project (fix #1 en #14 zitten anders niet in de online testbank) |
| 21 | Hardware-ontwerp | Ledvolgorde binnen een kubus is een "raster" (i loopt het snelst): elke 3e led vraagt een diagonale terugdraad van ~2,2 pitch i.p.v. 1 (goed zichtbaar via *Weergave → Led-draad*) | M | **Aanbeveling** (zie §4) — niet doorgevoerd, ontwerpbeslissing |
| 22 | Firmware ESP32 | `FastLED.show()` draait elke loop, ook als er niets verandert (~5,7 ms per frame voor 189 leds) | L | Aanbeveling — op de ESP32 (RMT) onschadelijk |
| 23 | Legacy | `tesseract_rig.ino` (Mega) en `firmware/wokwi/` (AVR) kregen alleen de engine-fix, niet de invoer-fixes #14/#15 | L | Bewust: die varianten zijn vervallen |
| 24 | Afhankelijkheden | Three.js en marked komen van unpkg (CDN): offline werkt de werkbank niet | L | Aanbeveling: eventueel lokaal meeleveren |
| 25 | Werkbank | Ingangsprintje: schema klopte (5V/GND/DATA, elco parallel met de streep aan GND, 330Ω in serie), maar de tekening miste de verbinding DATA-klem → 330Ω en het −-draadje van de elco kruiste over de +-verbinding | L | **Vervallen**: printje vervangen door de prototype-opstelling (#11) |
| 26 | Werkbank | 5 draden naar het breadboard liepen deels dóór de printplaat (o.a. 5V en GND naar de ESP32) | L | **Opgelost**: jumpers gaan recht omhoog en over de bordrand; de smoke test controleert het |
| 27 | Hardware-ontwerp | Ongebruikte ingangen van de 74AHCT125 (2A–4A, 2OE–4OE) zweven; de datasheet eist vastleggen op VCC/GND | L | **Gedocumenteerd** (`BEDRADING.md` §2, info-kaartje levelshifter); niet in 3D getekend |

## 3. De 3D-omgeving: wat er veranderd is

**Weergave** (`bench/stage.js`)
- Kleurbeheer + **Neutral-tone-mapping** (Khronos PBR Neutral). Getest tegen AgX en ACES: alleen Neutral
  houdt de 8 spelkleuren verzadigd en onderscheidbaar (AgX maakte ze pastel). Vereiste three.js r160 → r165.
- **Studio-reflectiekaart** (eigen donkere studio met lichtpanelen) → metaal, printplaten en kunststof
  reflecteren geloofwaardig. **Zachte schaduwen** (PCF, 2048²) van de plafondlamp; de schaduwkaart wordt
  alleen herberekend als er iets verandert. **HDR-bloom** laat felle leds echt gloeien, plus subtiele vignettering.
- **Gekleurd licht**: elke cel werpt haar gemiddelde ledkleur als licht op staven, voet en werkbank.
- **Kwaliteit hoog/laag** (*Weergave → Kwaliteit*): automatisch "laag" op telefoons/zwakke apparaten,
  keuze wordt onthouden.

**Werkplaats**: werkbank met massief houten blad (procedurele houtnerf), stalen onderstel en onderplank,
blauwgrijze ESD-mat met aardingsdrukknop, gaatjesbord, betonvloer, plafond-ledlamp. Alle texturen worden
in de browser gegenereerd (geen afbeeldingsbestanden).

**Onderdelen op ware grootte** (`bench/parts.js`; schaal 1 eenheid = 4 cm, **Inschatting**: kubusjes ~2 cm,
pitch ~25 mm, rig ~50 cm hoog):
- ESP32-DevKitC (WROOM-module met afschermkap en printantenne, micro-USB, EN/BOOT, rode power-led, correct
  gelabelde pinrijen) op een **830-punts breadboard**; 5V, GND en GPIO13 zitten op de juiste pinnen.
- **74AHCT125** als DIP-14 over de middengoot, met 1OE→GND-jumper (pin 1→7), 1A = pin 2, 1Y = pin 3.
- **5V/10A-voeding** (geperforeerde kap, schroefklemmen L/N/⏚/−V/+V, DC-OK-led, V-ADJ) met netsnoer van de
  werkbank af.
- **Schakelkastje** met verlichte wipschakelaar die meebeweegt met *Aan/Uit*; **inline steekzekering 10A**
  (rood, zichtbaar door de klep), gevolgd door de **verdeelblokken 5V + GND** (hendelklemmen; het GND-blok is
  het "één sterpunt" uit `BEDRADING.md` §6) met de **1000µF** (streep aan de −-poot) over de binnenste klemmen.
- **330Ω** (oranje-oranje-bruin-goud) op het breadboard, direct achter de levelshifter in de kolom van 1Y.
  Dit is de prototype-opstelling; in de eindbouw horen 330Ω en 1000µF bij led #0 (`BEDRADING.md` §2).
- **Draadloze controller** (DualShock-4-vorm, lichtbalk gloeit als hij verbonden is) en een paar
  werkplaats-accessoires (soldeertin, multimeter die 5,02 V meet).

**Draden**: in plaats van bogen door de lucht liggen draden op de werkbank; dikte per functie (16–18 AWG
voeding, 22 AWG naar het breadboard, jumpers met dupont-huisjes). Alles naar de rig loopt als **kabelboom**
over de voet en langs de paal (met tie-wraps), **dóór** kubus D via de geboorde middenkolom (zoals de paal in
het Blender-model) en langs de staaf de middelste kubus in, naar led #0. De injectieparen lopen binnendoor — door kubus C,
langs de staven en tussen de lagen kubusjes — naar de eerste led van hun arm. Staven en paal lopen
hart-op-hart door de kubussen.

**Bediening**: klik een onderdeel → de camera vliegt erheen en kadert het; labels schuiven niet meer over
elkaar; laadscherm en een duidelijke melding als WebGL ontbreekt.

**Prestaties** (gemeten in headless Chromium met software-rendering; **Inschatting** voor echte GPU's):
~415 draw-calls en ~157k driehoeken per frame, 10 shaderprogramma's. Op een gangbare laptop-GPU verwacht ik
60 fps op "hoog"; "laag" is er voor telefoons. Echte-GPU-fps zijn niet gemeten (de cloudcontainer heeft geen GPU).

## 4. Hardware-ontwerp

**Power-injectie (doorgevoerd).** Feed op #0 (C) plus injectie op #54 (L), #108 (D) en #162 (B). Elke
injectie zit op de eerste led van die arm, in de laag die naar het midden wijst, zodat de draden langs de
staven lopen. Worst case 54 leds × 60 mA ≈ 3,2 A per segment, vanaf twee kanten gevoed.

**Ledvolgorde binnen een kubus (aanbeveling, niet doorgevoerd).** De strip-index is `kubus × 27 + idx` met
`idx = (i+1) + 3(j+1) + 9(k+1)`: een raster. Na elke 3 leds springt de ketting terug naar het begin van de
volgende rij (diagonaal, ~2,2× de pitch). Een **slangvolgorde** (boustrophedon) maakt elke stap 1 pitch:
kortere draden, minder soldeerfouten. Kosten: één vertaaltabel strip-index → (kubus, idx) in de firmware,
`engine.js`/werkbank en `BEDRADING.md`. **Beslis dit vóór je gaat solderen**; daarna is het een herbedrading.

**Volgorde van de kubussen** (C→R→L→U→D→F→B) is voor de draadlengte vrijwel neutraal: elke sprong tussen
armen loopt via het midden. Laten zoals hij is.

## 5. Firmware

- **Undo-ringbuffer** (bevinding #1) geldt via de gedeelde `tesseract_engine.h` voor álle varianten.
- **ESP32-rig**: één zet tegelijk, statusmelding na elke zet. Ongewijzigd en in orde bevonden: Bluepad32-
  knopmapping (□=X, ✕=A, ○=B, △=Y), stick-hysterese, RMT-timing, GPIO13 (geen strapping-pin), en
  `random()` zonder `randomSeed()` — **Inschatting**: arduino-esp32 gebruikt dan de hardware-RNG (`esp_random`).
- **Niet gecompileerd voor het echte bord** in deze omgeving (geen ESP32-core/Bluepad32 aanwezig). De
  wijzigingen zijn een early-return en een extra functie-aanroep; de engine zelf is wél native gecompileerd
  en getest.

## 6. Tests & CI

| Test | Wat | Resultaat |
|---|---|---|
| `node engine.test.js` | engine.js = game-projectie | 28/28 |
| `node firmware/test/parity.test.mjs` | C++-engine = engine.js over 4.033 willekeurige operaties (189 leds, sticker-id's, isSolved, undo-diepte, 4D-zicht) | groen (rood vóór fix #1) |
| `node tools/smoke.mjs` | werkbank start foutloos, alle verbindingen getekend, prototype-opstelling, geen draad door het breadboard, rendert, toetsenbord-spel, infopaneel, weergaveknoppen; iPhone 15 Pro portret + landschap | 46/46 |
| `game/test/*.test.js` | wiskunde + academy van de game (jsdom) | groen |

Alles draait in GitHub Actions (`.github/workflows/tests.yml`) bij elke push en pull request.

## 7. Openstaande aanbevelingen (op prioriteit)

1. **Wokwi-project bijwerken** (#20): upload de nieuwe `tesseract_engine.h` en `firmware/wokwi_esp32/sketch.ino`.
2. **Slangvolgorde van de leds** (#21) — beslissen vóór de fysieke bouw.
3. **Firmware op het echte bord compileren** na deze wijzigingen (Arduino IDE, Bluepad32-boardpakket) en
   één keer het undo-gedrag na 20+ zetten controleren.
4. **Three.js lokaal meeleveren** (#24) als de werkbank ook offline (beurs, workshop) moet werken.
5. **Idle-refresh beperken** (#22) — alleen als je stroom/warmte wilt besparen.
