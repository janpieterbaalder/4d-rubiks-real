# Opstelling 4D Rubiks — echte bouw + 3D-testomgeving

Doel: de bestaande 4D-rubiks game (`../code 4d rubiks spel`) in het echt namaken als
een fysieke installatie met oplichtende cellen, en die installatie eerst volledig
testen in een 3D-omgeving voordat er hardware gekocht wordt.

## Het concept (samengevat)

- **7 doorschijnend-witte kubussen** (midden + 6 eromheen op een statief), exact zoals
  het Blender-model in `../4d rubiks 3d model`. Dit zijn de zichtbare *cellen* van de
  tesseract.
- Elke kubus = **3×3×3 = 27 kleinere kubusjes** (cubies), elk met een **RGB-ledje**
  erin. Totaal **7 × 27 = 189 RGB-leds** (type WS2812B / NeoPixel — individueel
  adresseerbaar, in serie te schakelen).
- **Niets mechanisch.** Een "draai" verplaatst geen plastic; alleen de *kleuren* van de
  ledjes veranderen. Precies wat jij wil.
- **Besturing:**
  - Joystick 1 → horizontaal door de cellen "hoppen" (selectie verplaatsen).
  - Joystick 2 → verticaal door de cellen hoppen.
  - Joystick 3 → draaiingen kiezen/noteren/uitvoeren, gekoppeld aan het schermpje.
  - De geselecteerde cel licht **feller** op dan de rest.
- **Schermpje** (klein OLED/LCD) toont de notatie van de draai die je gaat maken.
- **Aan/uit-knop** + Arduino/microcontroller die alles aanstuurt.

## De kernvraag: hoe "test je het in 3D"?

Er zijn drie soorten simulatie. Ze testen verschillende dingen; de sterkste aanpak is
ze te combineren in deze volgorde.

### A. Three.js webslimulator — de interactieve "digital twin"  ⭐ aanbevolen kern
Eén HTML-pagina (net als de bestaande game) die de **hele fysieke opstelling** in 3D
toont: de 7 oplichtende kubussen, 3 sleepbare joysticks, het OLED-schermpje, de aan/uit-
knop en (schematisch) de Arduino. Je kunt erin klikken/slepen en ziet live de selectie
oplichten, draaien uitvoeren, kleuren veranderen en de notatie op het scherm.
- **Hergebruikt de al-bewezen 4D twist-engine uit `app.js`** → de wiskunde klopt al.
- Draait overal, geen installatie. Dit beantwoordt direct "hoe werkt het in de praktijk".
- Beperking: het is een *gedrags*-twin, geen elektronica-simulatie (vindt geen
  bedradings- of firmwarefouten).

### B. Wokwi — firmware + elektronica valideren
Wokwi draait **echte Arduino-C++-code** tegen gesimuleerde joysticks, WS2812-leds, OLED
en knoppen. Bewijst dat de firmware en bedrading kloppen vóór je onderdelen koopt.
- Wokwi ondersteunt WS2812-strips/-matrix, dus 189 leds als strip/raster te testen.
- Beperking (jouw vermoeden klopt): Wokwi tekent **geen 3D-tesseract** — leds staan plat.
  Je test er de *logica/adressering*, niet de ruimtelijke beleving.

### C. Blender — fotorealistische look + bouwtekeningen
Het bestaande `.blend` bevat de 7-kubus-opstelling al. Hiermee maken we exploded views,
maten, en realistische renders van de "doorschijnend glimmende" look + eventueel een
korte animatie van een draai. Voor *hoe het eruit gaat zien* en voor fabricage.
- Beperking: niet interactief.

**Advies:** A bouwen als interactieve testomgeving (hoofdvraag), B voor de firmware,
C voor look & fabricage. Begin met A.

## Wat is er nodig (hardware-schets / BOM)

| Onderdeel | Keuze | Opmerking |
| --- | --- | --- |
| Microcontroller | **ESP32** (of RP2040 / Arduino Mega) | Uno heeft te weinig RAM/ADC voor 189 leds + 3 joysticks |
| Leds | **189× WS2812B** (NeoPixel) | individueel adresseerbaar, 1 datadraad |
| Voeding | **5V, ~10A** netvoeding | zie waarschuwing hieronder |
| Joysticks | 3× analoge 2-assige thumb-joystick (met drukknop) | 6 analoge + 3 digitale ingangen |
| Scherm | I²C **OLED SSD1306** (128×64) of 20×4 LCD | toont notatie/toestand |
| Aan/uit | schakelaar op de 5V-voeding + evt. soft-reset-knop | |
| Diverse | levelshifter (3.3V→5V data), 1000µF condensator, 330Ω weerstand, power-injection-draden | betrouwbaarheid ledketen |
| Behuizing | doorschijnend wit PETG/acryl cubies, frame voor het "+"-kruis | 3D-printen mogelijk |

### Dingen waar je misschien nog niet aan dacht
1. **Stroom!** 189 leds op vol wit ≈ 11A bij 5V. In de praktijk (verzadigde kleuren,
   gedimd) eerder 3–6A, maar je hebt een stevige 5V-voeding + **power injection**
   (5V op meerdere plekken in de keten injecteren) nodig, anders worden verre leds dof
   en kleurverschoven.
2. **De 8e cel.** Een tesseract heeft 8 cellen, maar fysiek bouw je er maar 7 (midden +
   6 armen). De 8e ("buitenste/verborgen") cel zie je niet. Je hebt dus een **4D-
   draai/centreer-besturing** nodig om verborgen cellen in beeld te halen — dit is het
   lastigste concept bij de overstap naar fysiek. In de game zit dit op Shift+slepen /
   ctrl-klik.
3. **Levelshifter** tussen 3.3V-ESP32 en 5V-leddata.
4. **Warmte & bedrading**: 189 leds = veel soldeerpunten; overweeg geknipte WS2812-
   strips of een PCB i.p.v. losse leds.
5. **Diffusie**: ledje iets van de wand af + gefrost plastic geeft een gelijkmatige gloed.
6. **Firmware-hergebruik**: de twist-permutatietabellen uit `app.js` kunnen als C-arrays
   geëxporteerd worden, zodat de bewezen wiskunde 1-op-1 naar de Arduino gaat.

## Beslissingen (16-6-2026)
1. **Leds:** RGB WS2812B, **189 stuks** (7 cellen × 27 blokjes) — volledige game-fidelity.
   63 (7×9) zou maar één 3×3-vlak per kubus tonen en verliest het patroon binnenin de cel.
2. **A + B gefuseerd in één omgeving.** Three.js-3D-twin + besturingslogica als "single
   source of truth" in JS, later uitbreidbaar met **avr8js** (de engine onder Wokwi) om de
   echte Arduino-firmware in dezelfde browserpagina te draaien. Doel-microcontroller voor de
   gefuseerde sim: **Arduino Mega** (genoeg RAM/pins; avr8js ondersteunt AVR).
3. **4D-rotatie = centreren** (idee van JP): selecteer de middencel van een buitenste kubus
   + druk → die kubus wordt logisch het midden; alleen de ledkleuren verschuiven (4-cyclus,
   de fysieke kubussen bewegen niet). Lost meteen het "8e cel"-probleem op.
4. **Besturingsschema:** open voor verbetering; centreer-bediening hierboven is de eerste
   verbetering t.o.v. het oorspronkelijke schema.

## Status
- [x] Map aangemaakt
- [x] Plan opgesteld
- [x] Aanpak gekozen: gefuseerde A+B-omgeving, 189 leds
- [x] Engine geëxtraheerd uit `app.js` (`engine.js`, 27 tests groen)
- [x] Interactieve 3D-testomgeving gebouwd (`index.html` + `sim.js`): 7 kubussen,
      189 leds, 3 joysticks, notatie-scherm, aan/uit, centreren — allemaal getest
- [x] **Draai komt nu overeen met de game.** Twee fixes:
      (A) *De echte bug:* kubus-oriëntatie. Bij een binnenste-cel-draai veranderde er niets
      zichtbaars (verandering zat op verborgen achterlagen). Opgelost met `engine.ORIENT`:
      elke kubus georiënteerd zoals de game-projectie, met de W-as (binnen↔buiten) radiaal —
      binnenlaag wijst naar het midden. Geverifieerd tegen de echte `project()`-formules
      (engine.test.js, alle 7 kubussen matchen).
      (B) *Leesbaarheid:* permutatie-volgende **helderheids-golf** (via `engine.placements()`)
      in de draairichting + spotlight-dimming. Puur led-kleur+helderheid → 1-op-1 naar WS2812.
- [x] **Interactieve 3D hardware-werkbank** (`hardware.html` + `hardware.js`): klikbare
      onderdelen (Mega, voeding, 3 joysticks, OLED, condensator, weerstand, schakelaar,
      189-led-rig), gekleurde draden uit één `CONNECTIONS`-tabel, per onderdeel een
      aansluittabel, stroom-/data-animatie en een "stuur dataframe"-demo. Gekoppeld aan de
      speel-sim via een tab.
- [x] **Firmware** (`firmware/tesseract_rig.ino` + `tesseract_engine.h`): de engine 1-op-1
      naar C++ (Arduino Mega), WS2812B-aansturing met FastLED + stroomlimiet, 3 joysticks,
      OLED-notatie, de permutatie-golf-animatie en een `printWiringChart()` soldeerkaart.
- [x] **Bedradingsdocument** (`BEDRADING.md`): BOM, pin-voor-pin tabel (= `CONNECTIONS` =
      firmware-pins), stroombudget/power-injectie, led-volgorde (`ORIENT`), bouw-/testvolgorde,
      Wokwi.
- [x] **LED-positie-consistentiecheck** (10 bronnen): de led-bedrading (idx→`ORIENT`→strip-index)
      is 1-op-1 gelijk overal (geverifieerd). Enige afwijking was het navigatie-coördinaatstelsel
      (oud "JP-schema" vs. as-native in hardware.js) — opgelost door **zowel** de rig-firmware
      `tesseract_rig.ino` **als** de Wokwi-testbank `firmware/wokwi/sketch.ino` op het as-native
      schema te zetten. De Blender-`Tesseract_4D` is een getrouwe schil (kubussen benoemd naar
      cel-sleutel, geen per-led-index).
- [x] **Wokwi-testbank gelijkgetrokken met de rig** (`firmware/wokwi/sketch.ino` + `diagram.json`):
      het oude 3-joystick/scroll-menu is vervangen door een nagebootste PS3-layout (2 sticks + D-pad
      + 4 face-knoppen + SELECT/START), met as-native navigatie en het "vlak + richting"-draaimodel —
      identiek aan de rig en `hardware.html`. Naamgeving F/B in `hardware.js` gelijkgetrokken
      ("voor"/"achter"). `wokwi.toml` wijst nu naar de `sketch.ino`-build. Beide firmwares printen
      `freeRam()` in `setup()` om de SRAM-marge op de Mega te bewaken (de PS3BT-rig is daar nog niet
      fysiek op getest — overweeg ESP32 als de marge te krap blijkt).
- [x] **Firmware geport naar PS3BT** (`tesseract_rig.ino`): draadloze PS3-controller via USB Host
      Shield; bediening spiegelt `hardware.html` (D-pad/sticks bewegen, face-knoppen = vlak, L-stick
      = richting/4D, R-stick = undo, SELECT/START = husselen/reset), arm-vlak-+-richting-model,
      as-native navigatie. OLED vervallen (status → Seriële Monitor). Joystick+OLED blijft als
      Wokwi-logica-testbank `firmware/wokwi/sketch.ino` (deelt dezelfde `tesseract_engine.h`).
- [x] **Opgeruimd** (na kennis-check, niets unieks verloren): `index.html`/`sim.js` +
      `led-pad.html`/`.js` verwijderd, `🎮 Spel`-tab weg. `hardware.html` is nu de **enige ingang**
      (werkbank + speelbare digital twin in één scène).
- [ ] Wokwi logica-testbank (`firmware/wokwi/sketch.ino`) draaien + bedrading op breadboard verifiëren
- [ ] Fysieke bouw
