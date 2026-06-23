# 4D Rubiks — echte LED-installatie

Een fysieke **4D-rubikskubus** als licht-installatie: **189 WS2812B-leds** in 7 doorschijnende
kubussen (midden + 6 armen, elk 3×3×3 = 27 leds), aangestuurd door een Arduino Mega met een
draadloze **PS3-controller** (USB Host Shield + PS3BT). Niets beweegt mechanisch — een "draai"
verschuift alleen de **kleuren** van de ledjes (de cellen permuteren wiskundig), en je leest de
draai af aan een heldere golf die in de draairichting langs de ledjes loopt.

> **▶ Live 3D-omgeving:** **https://janpieterbaalder.github.io/4d-rubiks-real/** — de volledige
> interactieve werkbank + speelbare twin draait in je browser (geen installatie nodig).
>
> **Speel de originele 4D-game online:** https://janpieterbaalder.github.io/tesseract-4d-rubiks-cube/
> — ook bereikbaar via de tab **🎮 Online game** in de 3D-werkbank.

## Wat zit erin

| Map / bestand | Inhoud |
|---|---|
| **[`opstelling 4d rubiks real/`](opstelling%204d%20rubiks%20real/)** | De kern. `hardware.html` + `hardware.js` = interactieve 3D-werkbank (klik elk onderdeel voor uitleg + bedrading) **én** de speelbare digital twin op de 189 led-meshes. |
| `opstelling 4d rubiks real/engine.js` | De geverifieerde 4D-engine (twists, grips, centreren, 189-led-uitlezing, `ORIENT`). 28 tests in `engine.test.js`. |
| `opstelling 4d rubiks real/firmware/` | Arduino-firmware: `tesseract_rig.ino` (PS3BT-besturing) + `tesseract_engine.h` (de engine 1-op-1 in C++). Plus een Wokwi-logica-testbank in `firmware/wokwi/`. |
| `opstelling 4d rubiks real/BEDRADING.md` | De bouwhandleiding: onderdelenlijst, pin-voor-pin bedrading, stroombudget, led-volgorde, bouw-/testvolgorde. |
| **[`4d rubiks 3d model/`](4d%20rubiks%203d%20model/)** | Het Blender-model van de fysieke opstelling (7 kubussen, verbindingsstaafjes, staander met ronde voet) + renders. |
| `playstation controller/` | Ontwerp-asset van de controller-bediening. |

## Starten (de 3D-werkbank)

De pagina gebruikt ES-modules + Three.js (CDN), dus serveer de map lokaal:

```bash
cd "opstelling 4d rubiks real"
python serve.py
# open daarna http://localhost:8000/hardware.html
```

## Besturing

PS3-controller (of de toetsen tussen haakjes): **D-pad** = bewegen in het grondvlak (`WASD`),
**R-stick ▲▼** = boven/onder-kubus (`I`/`K`), **L-stick ◀▶** = draairichting (`←`/`→`),
**□ ✕ ○ △** = vlak XY / YZ / XZ / grip (`Z`/`X`/`C`/`V`), **L3** = 4D-rotatie (`Enter`),
**R3** = undo (`Backspace`), **SELECT/START** = husselen/reset (`Shift+S`/`Shift+R`).

## De engine testen

```bash
cd "opstelling 4d rubiks real"
node engine.test.js   # verwacht: 28 checks passed.
```

---

*De originele 4D-Rubiks-game (waar de engine uit is afgeleid) staat in een aparte repo:*
[tesseract-4d-rubiks-cube](https://github.com/janpieterbaalder/tesseract-4d-rubiks-cube).
