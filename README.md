# 4D Rubiks — echte LED-installatie

Een fysieke **4D-rubikskubus** als licht-installatie: **189 WS2812B-leds** in 7 doorschijnende
kubussen (midden + 6 armen, elk 3×3×3 = 27 leds), aangestuurd door een **ESP32** met een draadloze
**controller** via de ingebouwde Bluetooth (**Bluepad32**) — een Arduino Mega + PS3BT is het
alternatief. Niets beweegt mechanisch — een "draai" verschuift alleen de **kleuren** van de ledjes
(de cellen permuteren wiskundig), en je leest de draai af aan een heldere golf die in de
draairichting langs de ledjes loopt.

> **▶ Live 3D-omgeving:** **https://janpieterbaalder.github.io/4d-rubiks-real/** — de volledige
> interactieve werkbank + speelbare twin draait in je browser (geen installatie nodig).
>
> De volledige, speelbare **4D-Rubiks-game** zit **mee in deze repo** en opent vanuit de werkbank
> via de tab **🎮 Game** (`opstelling 4d rubiks real/game/`) — geen externe link.

## Wat zit erin

| Map / bestand | Inhoud |
|---|---|
| **[`opstelling 4d rubiks real/`](opstelling%204d%20rubiks%20real/)** | De kern. `hardware.html` + `hardware.js` (+ `bench/`) = realistische 3D-werkplaats met alle onderdelen op ware grootte (klik elk onderdeel voor uitleg + bedrading) **én** de speelbare digital twin op de 189 leds. |
| `opstelling 4d rubiks real/engine.js` | De geverifieerde 4D-engine (twists, grips, centreren, 189-led-uitlezing, `ORIENT`). 28 tests in `engine.test.js`. |
| `opstelling 4d rubiks real/firmware/` | Firmware: **`esp32_bluepad32/`** (aanbevolen: ESP32 + draadloze controller via Bluepad32) + `tesseract_rig.ino` (alternatief: Mega + PS3BT) + `tesseract_engine.h` (de engine 1-op-1 in C++, bewezen met `firmware/test/parity.test.mjs`). Plus Wokwi-logica-testbanken in `firmware/wokwi_esp32/` en `firmware/wokwi/`. |
| `opstelling 4d rubiks real/BEDRADING.md` | De bouwhandleiding: onderdelenlijst, pin-voor-pin bedrading, stroombudget, led-volgorde, bouw-/testvolgorde. |
| `opstelling 4d rubiks real/game/` | De complete, speelbare **4D-Rubiks-game** (Tesseract), meegeleverd en bereikbaar via de tab **🎮 Game** in de werkbank. |
| **[`4d rubiks 3d model/`](4d%20rubiks%203d%20model/)** | Het Blender-model van de fysieke opstelling (7 kubussen, verbindingsstaafjes, staander met ronde voet) + renders. |
| `playstation controller/` | Ontwerp-asset van de controller-bediening. |

## Starten (de 3D-werkbank)

De pagina gebruikt ES-modules + Three.js (CDN), dus serveer de map lokaal:

```bash
cd "opstelling 4d rubiks real"
python serve.py
# open daarna http://localhost:8000/hardware.html (bij voorkeur in Edge of Chrome)
```

## Besturing

PS3-controller (of de toetsen tussen haakjes): **D-pad** = bewegen in het grondvlak (`WASD`),
**R-stick ▲▼** = boven/onder-kubus (`I`/`K`), **L-stick ◀▶** = draairichting (`←`/`→`),
**□ ✕ ○ △** = vlak XY / YZ / XZ / grip (`Z`/`X`/`C`/`V`), **L3** = 4D-rotatie (`Enter`),
**R3** = undo (`Backspace`), **SELECT/START** = husselen/reset (`Shift+S`/`Shift+R`).

## Testen

```bash
cd "opstelling 4d rubiks real"
node engine.test.js                 # 28 checks: de engine
node firmware/test/parity.test.mjs  # C++-firmware-engine == engine.js (g++/clang++)
node tools/smoke.mjs                # 3D-werkbank headless (npm i playwright)
```

Alle tests (ook die van de game) draaien automatisch in GitHub Actions. De volledige analyse van deze
verbeterronde — bevindingen, status en openstaande aanbevelingen — staat in **[ANALYSE.md](ANALYSE.md)**.

---

*De 4D-Rubiks-game zit mee in `opstelling 4d rubiks real/game/` (waar de engine uit is afgeleid).
De upstream-broncode bestaat ook als losse repo:*
[tesseract-4d-rubiks-cube](https://github.com/janpieterbaalder/tesseract-4d-rubiks-cube).
