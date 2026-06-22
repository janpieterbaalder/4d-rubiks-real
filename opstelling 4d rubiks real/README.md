# Opstelling 4D Rubiks — 3D werkbank + speelbare digital twin

`hardware.html` is de **enige ingang**: één 3D-scène met zowel de **hardware** (Arduino Mega,
USB Host Shield + Bluetooth-dongle + draadloze PS3-controller, voeding, weerstand, condensator,
schakelaar en de 189-WS2812B-led-rig) als de **speelbare game** op diezelfde 189 led-meshes —
7 oplichtende kubussen (midden + 6 armen, elk 27 leds = **189 RGB-leds**). Klik een onderdeel
aan voor uitleg + bedrading, of speel direct (klik een ledje / PS3-widget / toetsenbord).
Aangestuurd door dezelfde, wiskundig geverifieerde engine als de game.

Zie [PLAN.md](PLAN.md) voor het volledige plan en [BEDRADING.md](BEDRADING.md) voor de
bouwhandleiding (BOM, pin-voor-pin, stroombudget, led-volgorde).

## Starten

De pagina gebruikt ES-modules + Three.js (van een CDN), dus serveer de map even
lokaal (dubbelklikken op `hardware.html` werkt niet vanwege module-beveiliging):

```powershell
cd "C:\Users\rogst\Desktop\Prive\4d rubbiks real\opstelling 4d rubiks real"
python serve.py
# open daarna http://localhost:8000/hardware.html in Chrome/Edge
```

`serve.py` is een dev-server die caching uitschakelt, zodat wijzigingen altijd direct
zichtbaar zijn na verversen (gewone `python -m http.server` kan oude JS uit de cache tonen).

(Three.js komt nu van internet; voor een offline versie kunnen we het later lokaal meeleveren.)

## Besturing

Coördinaten (as-native, gelijk aan de fysieke led-plaatsing `ORIENT` en de firmware):
x = links(−)/rechts(+), y = onder(−)/boven(+), z = achter(−)/voor(+).
Kubus 0 in het midden (−1..1), de 6 armkubussen op ±3.

Speel met de **PS3-controller-widget** onderin (1-op-1 met de echte draadloze controller), met
het **toetsenbord**, of klik direct een ledje aan.

| PS3-controller | Toetsenbord | Actie |
| --- | --- | --- |
| **D-pad** ▲▼◀▶ | `W`/`S`/`A`/`D` | Verplaats de selectie in het grondvlak (achter/voor/links/rechts) |
| **R-stick** ▲ / ▼ | `I` / `K` | Verplaats naar de boven- / onder-kubus |
| **L-stick** ◀ / ▶ | `←` / `→` | Draairichting (−/+); houd vast en kies een vlak |
| **□ / ✕ / ○ / △** | `Z` / `X` / `C` / `V` | Vlak XY / YZ / XZ / grip (ribbe 180° of hoek ±120°) |
| **L-stick ●** (L3) | `Enter` | 4D-rotatie (op de centrale cel van een armkubus) |
| **R-stick ●** (R3) | `Backspace` | Zet terug (undo) |
| **SELECT / START** | `Shift+S` / `Shift+R` | Husselen / reset |
| Slepen / scroll | | Camera draaien / verschuiven / zoomen |

**Niets beweegt mechanisch** — een rotatie verandert alleen de kleuren van de ledjes. Per cel
gelden exact de zetten uit het spel: de 3 vlakdraaien (`XY/YZ/XZ` ±90°, bij armkubussen met `W`),
plus bij randcellen een **180°-flip** en bij hoekcellen een **±120°-spin**. Centrale cellen kennen
alleen de 4D-rotatie. Een vlak "armeer" je met een face-knop en voer je uit met een richting (of
andersom) — net als op de echte controller.

### Oriëntatie: een getrouwe (niet-getaperde) kopie van de game
Elke kubus staat **exact georiënteerd zoals de game de bijbehorende cel projecteert**
(`engine.ORIENT`, afgeleid uit de 4D→3D-`project()` en in `engine.test.js` gecontroleerd
tegen die formules). Cruciaal: de interne **W-as** (binnen↔buiten) van elke armkubus loopt
*radiaal* — de `w=−1`-laag wijst naar het midden en is dus zichtbaar. (Een eerdere versie
knoopte W aan de diepte-as, waardoor een binnenste-cel-draai alleen verborgen achterlagen
veranderde en het leek alsof er niets gebeurde.) Hierdoor matcht elke draai van elke cel de
game. De Arduino moet de leds in deze oriëntatie bedraden.

### Hoe je een draai *ziet* zonder dat er iets beweegt
Een draai is een **permutatie**: elke kleur verhuist van een bron-led naar een doel-led, en
die verhuizingen vormen kleine kringetjes (4-cycli bij 90°, 3-cycli bij hoek-spins/8e-cel,
2-cycli bij rand-flips). De sim leest die permutatie uit (`engine.placements()` vóór/na de
zet) en laat een **heldere golf langs elk kringetje in de draairichting lopen**, terwijl elke
led naar zijn nieuwe kleur overvloeit zodra de golf passeert; leds die niet meedraaien dimmen
even weg (spotlight). Zo lees je de draai — óók op een effen opgeloste kubus, waar geen enkele
kleur verandert. Alles is pure led-kleur + helderheid over tijd, dus **1-op-1 na te maken op
de WS2812-leds** (de Arduino voert exact dezelfde golf uit).

## Bestanden

| Bestand | Doel |
| --- | --- |
| `engine.js` | Geverifieerde 4D-engine: twists, grips (180°/120°), centreren, `placements()`/`ledState()` (189-led-uitlezing + permutatie), `ORIENT` (kubus-oriëntatie = game-projectie) |
| `engine.test.js` | 28 controles die bewijzen dat de engine-port klopt, incl. ORIENT == game-projectie (`node engine.test.js`) |
| `hardware.html` + `hardware.js` | **De enige ingang**: interactieve 3D-werkbank (klik elk onderdeel voor uitleg + bedrading, gekleurde draadjes + stroom-/data-animatie) **én** de speelbare game op de 189 led-meshes (PS3-controller-widget + toetsenbord) |
| `BEDRADING.md` | Bouwhandleiding: BOM, pin-voor-pin tabel, stroombudget, led-volgorde, bouw-/testvolgorde |
| `firmware/tesseract_rig.ino` | Arduino-firmware (Mega): leds + **PS3-controller (PS3BT via USB Host Shield)** + draai-animatie |
| `firmware/tesseract_engine.h` | De 4D-engine in C++ (1-op-1 port van `engine.js`) — single source of truth voor de wiskunde + de led-soldeerkaart |
| `firmware/wokwi/sketch.ino` | Wokwi-logica-testbank (3 joysticks + OLED): zelfde engine/leds, want Wokwi kan geen PS3-host simuleren — zie `firmware/wokwi/README-wokwi.md` |
| `serve.py` | Dev-server zonder caching |
| `preview-*.png` | Referentiebeelden (opgelost / gehusseld) |

## Eén omgeving: hardware + spel in één scène

`hardware.html` combineert de bedrading-werkbank én de speelbare digital twin in dezelfde
3D-scène (draait onder `python serve.py`). Klik onderdelen aan om de bedrading te begrijpen, of
speel meteen op de 189 led-meshes. Zie **[BEDRADING.md](BEDRADING.md)** voor de volledige
hardware-handleiding. Voor browser-logica-tests van de firmware zonder hardware: de
Wokwi-testbank in [`firmware/wokwi/`](firmware/wokwi/).

## Engine-test draaien

```powershell
node engine.test.js   # verwacht: 28 checks passed.
```
