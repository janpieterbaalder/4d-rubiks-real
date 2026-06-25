# BEDRADING & HARDWARE — fysieke 4D-Rubiks-opstelling (ESP32)

Dit document is de **bouwhandleiding**: onderdelenlijst, pin-voor-pin bedrading,
stroombudget, led-volgorde en een veilige bouwvolgorde. De opstelling wordt gebouwd met een
**ESP32 + Bluepad32** (draadloze controller via de ingebouwde Bluetooth). Het hoort bij:

- **[hardware.html](hardware.html)** — de interactieve 3D-werkbank én speelbare digital twin in
  één scène: klik elk onderdeel aan en zie de draadjes oplichten, of speel direct op de 189 leds
  (start met `python serve.py`, ga naar `http://localhost:8000/hardware.html`).
- **[firmware/esp32_bluepad32/](firmware/esp32_bluepad32/)** — `esp32_bluepad32.ino` +
  `tesseract_engine.h`, de code die op de ESP32 draait (de engine 1-op-1 geport uit `engine.js`).

> **Kernidee:** niets beweegt mechanisch. Een "draai" verplaatst geen plastic — alleen de
> **kleuren** van 189 ledjes verschuiven (de cellen permuteren wiskundig). Je leest de draai
> af aan een heldere golf die in de draairichting langs de ledjes loopt.

---

## 1. Onderdelenlijst (BOM)

Eén controller-pad: **ESP32 + Bluepad32**. De ESP32 koppelt de gamepad draadloos via zijn
**ingebouwde** Bluetooth — geen USB Host Shield en geen dongle nodig. Enige extra t.o.v. een
5V-bord is één **3,3V→5V levelshifter** op de datalijn.

| # | Onderdeel | Aantal | Keuze / specificatie | Indicatie* | Waarom |
|---|-----------|--------|----------------------|-----------|--------|
| 1 | **Microcontroller** | 1 | **ESP32-dev-board** (bijv. WROOM DevKitC) | €6–12 | ~320 KB RAM, ingebouwde Bluetooth (Bluepad32), RMT-led-timing |
| 2 | **Levelshifter** | 1 | **74AHCT125** (of 74HCT245) | €1–2 | tilt de 3,3V-datalijn naar een geldige 5V-high voor de WS2812 |
| 3 | RGB-leds | 189 | **WS2812B / NeoPixel** (los, strip of matrix-segmenten) | €25–60 | individueel adresseerbaar, 1 datadraad voor alle 189 |
| 4 | Voeding | 1 | **5V / 10A** (geregeld; full-white: ≥15A — zie §4) | €12–25 | 189 leds trekken veel stroom; USB kan dit niet |
| 5 | Controller | 1 | **PS4/PS5/Xbox/8BitDo/Switch Pro** (plug-and-pair) of **DualShock 3** (koppelstap) | €15–60 | bewegen, draaien, 4D, husselen/reset |
| 6 | Condensator | 1 | **1000µF / 10–16V** elektrolytisch | €0,50 | buffert stroompieken bij de leds |
| 7 | Weerstand | 1 | **330Ω** (220–470Ω ok) | €0,10 | beschermt de data-ingang van led #1 |
| 8 | Aan/uit-schakelaar | 1 | rocker/schakelaar **≥10A** (15A bij full-white; of MOSFET-module) | €2–5 | onderbreekt de 5V-lijn |
| 9 | Zekering (aanbevolen) | 1 | inline **10A** (15A traag bij full-white) + houder | €2 | beschermt de **dunste draad**, niet de last |
| 10| Draad | — | **16–18 AWG** voor 5V/GND-hoofdlijnen, 22–24 AWG signaal | €5 | dikke draad voor de stroom, dun voor signalen |
| 11| Diversen | — | breadboard/PCB, dupont-draadjes, JST-connectoren, krimpkous | €10 | montage |
| 12| Behuizing | 7 kubussen | doorschijnend-wit PETG/acryl, 3D-print | zelf | je eigen 3D-model |

\* Ruwe hobby-prijzen, sterk afhankelijk van bron. Reken op **€80–160** totaal exclusief behuizing.

### Waarom ESP32 (en niet een 5V-Arduino)
- **Controller-koppeling:** ingebouwde Bluetooth → géén USB Host Shield + dongle (Bluepad32 doet
  PS4/PS5/Xbox/8BitDo/Switch Pro plug-and-pair; een DualShock 3 vereist één koppelstap).
- **RAM:** ~320 KB vrij — de engine + buffers (~5 KB) en de Bluepad32/BTstack komen niet in de buurt
  van de limiet.
- **WS2812-timing:** FastLED stuurt de leds via de **RMT-hardware**, dus `show()` van 189 leds
  blokkeert de Bluetooth niet.
- **Logica-spanning:** de ESP32 werkt op 3,3V, dus je hebt **één levelshifter** op de datalijn nodig
  (74AHCT125). Voed het ESP32-board via zijn **5V/VIN**-pin (de onboard-regelaar maakt er 3,3V van) —
  nooit 5V rechtstreeks op de **3V3**-pin.

> **Firmware:** [`firmware/esp32_bluepad32/esp32_bluepad32.ino`](firmware/esp32_bluepad32/esp32_bluepad32.ino),
> bouwhandleiding [`firmware/esp32_bluepad32/README-esp32.md`](firmware/esp32_bluepad32/README-esp32.md).

---

## 2. Volledige bedradingstabel (pin-voor-pin) — ESP32

Kleurcodes komen overeen met de 3D-werkbank: 🔴 +5V · ⚫ GND · 🟡 Data 3,3V (vóór de levelshifter) ·
🟠 Data 5V (ná de levelshifter) · 🟣 Bluetooth (draadloos).

### Voeding (aparte 5V-bron)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| Voeding **+5V** | Aan/uit-schakelaar `in` | 🔴 | dikke draad (16–18 AWG) |
| Schakelaar `out` | ESP32 **5V/VIN**-pin | 🔴 | voedt de ESP32 (regelaar → 3,3V); **nooit** op de 3V3-pin |
| Schakelaar `out` | Levelshifter **VCC** | 🔴 | de shifter draait op 5V |
| Schakelaar `out` | Led-rig **+5V** (bij DIN) | 🔴 | dikke draad naar de leds |
| Voeding **GND** | ESP32 **GND** | ⚫ | **gemeenschappelijke massa!** |
| Voeding **GND** | Levelshifter **GND** | ⚫ | gedeeld met de ESP32 (anders geen geldige 5V-high) |
| Voeding **GND** | Led-rig **GND** (bij DIN) | ⚫ | dikke draad |

### Datalijn naar de leds (via de levelshifter)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| ESP32 **GPIO13** | Levelshifter ingang **A1** | 🟡 | 3,3V-data (`LED_PIN` in de firmware) |
| Levelshifter uitgang **Y1** | 330Ω weerstand `in` | 🟠 | nu een geldige 5V-high |
| 330Ω `out` | Led-rig **DIN** (led #0) | 🟠 | weerstand zo dicht mogelijk bij led #0 |

> De 74AHCT125 is een quad-buffer met per kanaal een **enable** (`1OE`, actief-laag): koppel
> `1OE` aan **GND** zodat buffer 1 altijd doorgeeft. Eén kanaal volstaat voor de datalijn.

### Buffercondensator (bij de leds, vlak bij DIN)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| Elco **+** | Led-rig **+5V** | 🔴 | 1000µF |
| Elco **−** (streep) | Led-rig **GND** | ⚫ | **let op polariteit** |

### Controller (draadloos — geen shield, geen dongle)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| Gamepad | ESP32 **ingebouwde Bluetooth** | 🟣 | draadloos, via Bluepad32 |

> **Koppelen:** PS4/PS5/Xbox/8BitDo/Switch Pro → zet de controller in **pairing-mode** en hij
> verbindt (DS4: Share + PS ingedrukt tot de balk dubbel knippert). Een **DualShock 3** vereist
> dat je zijn "master"-Bluetooth-adres één keer op de **MAC van deze ESP32** zet (de firmware print
> die MAC bij het opstarten; gebruik sixaxispairtool / SixaxisPairer) — daarna verbindt hij draadloos.
>
> **Husselen/Reset** zitten op de controller (**SELECT/START**) — losse fysieke knoppen zijn niet nodig.

### Power-injectie (zie §4)
| Van | Naar | Kleur |
|---|---|---|
| Voeding **+5V** | Led-rig **+5V** bij rechter/boven/achter-arm | 🔴 |
| Voeding **GND** | Led-rig **GND** bij dezelfde armen | ⚫ |

---

## 3. Tekstueel bedradingsschema

```
        ┌──────────────────────────── 5V VOEDING (5V / 10A) ─────────────────────────────┐
        │ +5V ──[ AAN/UIT ≥10A ]──[ 10A zekering ]──┬──────────────► ESP32 5V/VIN-pin      │
        │                                           ├──────────────► Levelshifter VCC       │
        │                                           ├──────────────► Led-rig +5V (#0)       │
        │                                           ├───► +5V injectie ► arm R              │
        │                                           ├───► +5V injectie ► arm U              │
        │                                           └───► +5V injectie ► arm B              │
        │ GND ──────────────────────────────────────┬──────────────► ESP32 GND  (GEMEEN!)   │
        │                                            ├─────────────► Levelshifter GND        │
        │                                            ├─────────────► Led-rig GND (#0)         │
        │                                            └───► GND injectie ► arms R/U/B         │
        └──────────────────────────────────────────────────────────────────────────────┘

   ESP32 GPIO13 ──🟡3,3V──► [ 74AHCT125 ] ──🟠5V──[ 330Ω ]──► DIN (led #0)
                            (1OE → GND)            1000µF: + op +5V, − op GND  (bij led #0)

   Controller (PS4/PS5/Xbox/8BitDo/Switch Pro of DS3) → ESP32 ingebouwde Bluetooth (Bluepad32).
   Husselen/Reset = SELECT/START op de controller.
```

---

## 4. Voeding & stroombudget — het belangrijkste

**De som:** 189 leds × ~60 mA (vol wit, max) = **~11,3 A** bij 5V (≈57 W). In de praktijk speel
je met verzadigde, gedimde kleuren → meestal **3–6 A**. De firmware *mikt* daar ook op:
`setBrightness(200)` + `setMaxPowerInVoltsAndMilliamps(5, 6000)` dimt automatisch om onder ~6 A
te blijven. **De voeding kies je niet op die ~6 A maar op de capped build (10 A)** — zie hieronder.

> ⚠️ **Die firmware-limiet is software, geen zekering.** Het is een schatting die FastLED bij
> elke frame toepast; een herprogrammering, `setBrightness(255)`, een vastgelopen sketch of het
> weglaten van de power-limiter heft hem op. **Dimensioneer voeding, schakelaar, zekering en
> draad daarom altijd op wat de voeding fysiek kán leveren / de echte worst case — nooit op het
> firmware-getal.** Een zekering beschermt de **dunste draad** eronder, niet de last.

**Kies één van twee samenhangende bouwsets** (verhoog ze altijd als geheel, niet los):

| | **Capped build** (standaard) | **Full-white build** (alle 189 op vol wit) |
|---|---|---|
| Voeding | 5V / **10A** | 5V / **≥15A** |
| Zekering (+5V) | **10A** | **15A traag** |
| Schakelaar | **≥10A** | **≥15A** |
| Hoofd-draad 5V/GND | **16 AWG** | **14 AWG** |
| Firmware | laat `FASTLED_MAX_MA ≤ 8000` | verhoog `FASTLED_MAX_MA`/helderheid |

De BOM en het schema hierboven gaan uit van de **capped build** (5V / 10A). Wil je full-white?
Verhoog dan álle vier de regels (voeding, zekering, schakelaar, draaddikte) samen.

**Draaddikte — regel: de zekering ≤ ampacity van de dunste draad eronder:**
- Hoofdlijnen 5V & GND: **16 AWG** bij 10A (18 AWG is krap voor 10A), **14 AWG** bij 15A.
- Injectie-takken: 20 AWG mag bij normaal gebruik (elke tak draagt maar een deel), maar besef:
  een kortsluiting op een tak wordt alléén door de hoofdzekering onderbroken → houd takken kort
  of gebruik ≥18 AWG.
- Signalen: 22–24 AWG.

### Power-injectie (spanningsval voorkomen)
5V zakt weg over een lange ledketen → verre leds worden dof en het wit verkleurt geel/oranje.
Oplossing: voer **5V én GND rechtstreeks vanaf de voeding** op meerdere punten in de keten bij,
niet alleen aan het begin.

- **Minimaal:** injecteer bij led #0 (kubus C) **plus** bij de start van elke verre arm.
- **Vuistregel:** elke ~50–60 leds (≈ elke 2 kubussen) een 5V+GND-injectie.
- Injecteer **altijd 5V én GND samen** op hetzelfde punt; de **datalijn blijft één doorgaande
  ketting** (data injecteer je niet).

---

## 5. De datalijn & de led-volgorde (cruciaal voor kloppende kleuren)

Alle 189 leds hangen in **één ketting**: `DOUT` van elke led naar `DIN` van de volgende. De
firmware nummert ze **0…188**:

```
strip-index = kubus-index × 27 + led-index-in-kubus
kubus-volgorde: C=0, R=1, L=2, U=3, D=4, F=5, B=6
```

Binnen elke kubus moet led-index `idx` (0…26) op een **vaste fysieke plek** zitten, anders
kloppen de kleuren niet met de wiskunde. Die plek staat in `ORIENT` (zie `tesseract_engine.h`
en `engine.js`) en wordt **automatisch voor je uitgeprint**:

> In `setup()` roept de firmware `printWiringChart()` aan. Open de **Seriële Monitor (115200
> baud)** en je krijgt voor elke led: `strip# : kubus : x,y,z`. Soldeer led `strip#` op die
> (x,y,z)-plek (−1/0/1 per as) binnen de betreffende kubus. Zo is de bedrading gegarandeerd
> gelijk aan de simulatie en de game.

De **W-as (binnen↔buiten)** van elke arm-kubus loopt **radiaal**: de binnenste laag wijst naar
het midden en is zichtbaar. Daardoor matcht elke draai precies de game (dit was de
oorspronkelijke "draai leek onzichtbaar"-bug; opgelost in `ORIENT`).

---

## 6. Veiligheid & veelgemaakte fouten

1. **Gemeenschappelijke GND.** De massa van voeding, ESP32, levelshifter én leds moet aan elkaar.
   Zonder gedeelde GND "zweeft" het datasignaal → willekeurig geknipper. (Fout #1 bij WS2812.) Bij
   **power-injectie** moeten álle GND-takken van hetzelfde voeding-massapunt (één sterpunt) komen,
   zodat alle led-segmenten dezelfde datareferentie delen.
2. **330Ω in de datalijn**, vlak bij led #0 — dempt spanningspieken (achter de levelshifter).
3. **1000µF condensator** over 5V/GND bij de leds — vangt inschakelpieken. Kies **10–16V**
   (niet de 6,3V-ondergrens). **Polariteit:** − (streep) naar GND. Tip: bij lange armen ook een
   kleinere elco (100–470µF) bij elk injectiepunt.
4. **Levelshifter (3,3V → 5V) op de datalijn**, bijv. een 74AHCT125 (TTL-ingang, accepteert 3,3V).
   Voed die levelshifter met **5V** en deel zijn **GND** met de ESP32, anders is zijn uitgang geen
   geldige 5V-high. (Zonder shifter werkt het soms tóch — maar onbetrouwbaar; bouw hem erin.)
5. **Voed het ESP32-board via zijn 5V/VIN-pin** (de onboard-regelaar maakt er 3,3V van) — sluit
   **nooit** 5V rechtstreeks op de **3V3**-pin aan, en geen >5V op 5V/VIN. Let op de polariteit;
   er zit geen bescherming op de 5V-pin.
6. **Niet USB én 5V/VIN tegelijk** voeden zonder nadenken. Tijdens **programmeren**: ESP32 via USB,
   de 5V-voeding van het bord los (leds via de aparte voeding, massa's wél verbonden).
   **Zelfstandig**: 5V/VIN uit de voeding, USB eraf.
7. **Begin niet op vol wit.** Test met lage helderheid; voer de stroom pas op als bedrading en
   koeling kloppen.
8. **Dikke draad + zekering** op de 5V-hoofdlijn; de zekering ≤ ampacity van de dunste draad
   eronder (zie §4). Dunne draadjes worden warm bij 6–10 A.

---

## 7. Bouw- en testvolgorde (incrementeel — nooit alles tegelijk)

1. **ESP32 + USB.** Upload `esp32_bluepad32.ino` (of test eerst de logica in de browser met de
   Wokwi-testbank). Open de Seriële Monitor (115200) → de wiring-chart **en de ESP32-MAC**
   verschijnen. (Nog geen leds nodig.)
2. **Controller koppelen.** Zet de gamepad in pairing-mode (DS3: eenmalige MAC-koppelstap). Zie je
   in de Seriële Monitor de knop-events? Dan werkt de besturing.
3. **Knoppen-test.** Loop alle controller-acties na in de seriële uitvoer (bewegen, draaien, 4D,
   undo, husselen/reset) vóór je de leds aansluit.
4. **Een kort stukje leds** (bijv. 1 kubus = 27) op **GPIO13** via de **levelshifter + 330Ω**,
   gevoed uit de **aparte voeding** (massa met de ESP32 verbonden!). Klopt de kleurvolgorde met de
   chart? Pas dan uitbreiden.
5. **Bouw de keten uit** naar 189 leds, met **power-injectie** en de **condensator**.
6. **Schakelaar + zekering** in de 5V-lijn.
7. Speel — en vergelijk met de [3D-werkbank + digital twin](hardware.html). Alle acties (incl.
   husselen/reset via SELECT/START) zitten al op de controller; losse fysieke knoppen zijn niet nodig.

---

## 8. Software

| Bestand | Rol |
|---|---|
| `firmware/esp32_bluepad32/esp32_bluepad32.ino` | **rig-firmware**: leds + **draadloze controller via de ingebouwde ESP32-Bluetooth (Bluepad32)** + draai-animatie. Spiegelt de bediening van `hardware.html`. Zie [`README-esp32.md`](firmware/esp32_bluepad32/README-esp32.md). |
| `firmware/tesseract_engine.h` | de geporte 4D-engine (≈ `engine.js`) — de wiskunde + de led-soldeerkaart (`ORIENT` / `printWiringChart`) + `freeRam()`. Gedeeld door de rig én de Wokwi-testbank. |
| `firmware/wokwi_esp32/sketch.ino` | **Wokwi ESP32-logica-testbank** (PS-layout nagebootst: 2 sticks + D-pad + 4 face-knoppen + SELECT/START + OLED): zelfde engine + leds + besturingsmodel, want Wokwi kan geen Bluetooth-gamepad simuleren. **LED-data op GPIO13 = de bouw-pin**, zodat de testbank ook als bedradingsreferentie dient. |

**Libraries voor de rig** (Arduino IDE): **Bluepad32** (installeer het *ESP32 Bluepad32*
board-package — zie `README-esp32.md`) en **FastLED**. De Wokwi-testbank gebruikt daarnaast
**Adafruit SSD1306 + Adafruit GFX** (voor de OLED).

**Uploaden:** kies het ESP32-bord uit het Bluepad32-board-package, juiste poort, upload. Open de
Seriële Monitor op **115200** baud voor de wiring-chart, de ESP32-MAC en meldingen.

### Eerst testen zonder hardware: Wokwi
[Wokwi](https://wokwi.com) draait **echte** ESP32-code tegen gesimuleerde WS2812-leds in de
browser, zodat je de logica en adressering test vóór je iets koopt. (Wokwi tekent geen
3D-tesseract — daarvoor is `hardware.html`.)

> ℹ️ **Wokwi kan geen Bluetooth-gamepad simuleren.** Geen enkele simulator (Wokwi, QEMU-ESP32,
> Renode, Proteus) kan een gekoppelde BT-controller nadoen. Daarom bootst de Wokwi-testbank
> [`firmware/wokwi_esp32/sketch.ino`](firmware/wokwi_esp32/sketch.ino) de **controller-layout na
> met losse onderdelen** (2 analoge sticks + D-pad + 4 face-knoppen + SELECT/START + OLED) om de
> spel-logica, led-adressering én het besturingsmodel te testen — met dezelfde `tesseract_engine.h`,
> as-native navigatie en "vlak + richting"-draaimodel als de rig. De échte draadloze besturing
> (`firmware/esp32_bluepad32/esp32_bluepad32.ino`) test je op de hardware zelf.
>
> **▶ Opgeslagen project:** https://wokwi.com/projects/467721462500426753 ("4d Rubiks real –
> ESP32-testbank") — de actuele ESP32-build met de nagebootste controller-layout.
>
> **Kant-en-klaar (zelf bouwen):** in [`firmware/wokwi_esp32/`](firmware/wokwi_esp32/) staan
> `sketch.ino` (ESP32-build), een complete `diagram.json` (ESP32 + 2 sticks + D-pad + 4 face-knoppen
> + SELECT/START + OLED + 330Ω + een 189-pixel led-strip), een `libraries.txt` en een stap-voor-stap
> [`README-wokwi-esp32.md`](firmware/wokwi_esp32/README-wokwi-esp32.md).

---

## 9. Het "8e cel"-concept (4D-rotatie)

Een tesseract heeft **8 cellen**, maar je bouwt er fysiek **7** (midden + 6 armen). De 8e
("buitenste") cel is verborgen. Met de **● linkerstick (4D-knop) op de centrale cel van een arm-kubus**
voer je een **4D-rotatie** uit: die kubus wordt logisch het midden; alleen de ledkleuren
verschuiven (de fysieke kubussen bewegen niet). Zo haal je verborgen cellen in beeld — precies
zoals `Ctrl`+klik in de game en de centreer-knop in de simulatie.

---

*Single source of truth:* de bedrading hierboven, de `CONNECTIONS`-tabel in
[hardware.js](hardware.js) én de firmware
[esp32_bluepad32.ino](firmware/esp32_bluepad32/esp32_bluepad32.ino) draaien allemaal op de
**ESP32 + Bluepad32**-besturing (LED-data **GPIO13** via een 3,3V→5V levelshifter, controller via
de ingebouwde Bluetooth). Wijzig je een pin of een aansluiting, pas dan alle drie aan. De
joystick/OLED-pinnen leven enkel in de Wokwi-testbank
[`firmware/wokwi_esp32/sketch.ino`](firmware/wokwi_esp32/sketch.ino) + `diagram.json` (die kan
geen BT-gamepad simuleren) — en dáár staat de LED-data nu óók op GPIO13, gelijk aan de bouw.

> De oudere Mega + USB-Host-Shield + PS3BT-variant is **vervallen**; bouw uitsluitend met de ESP32.
