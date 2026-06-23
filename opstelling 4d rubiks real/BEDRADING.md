# BEDRADING & HARDWARE — fysieke 4D-Rubiks-opstelling

Dit document is de **bouwhandleiding**: onderdelenlijst, pin-voor-pin bedrading,
stroombudget, led-volgorde en een veilige bouwvolgorde. Het hoort bij:

- **[hardware.html](hardware.html)** — de interactieve 3D-werkbank én speelbare digital twin in
  één scène: klik elk onderdeel aan en zie de draadjes oplichten, of speel direct op de 189 leds
  (start met `python serve.py`, ga naar `http://localhost:8000/hardware.html`).
- **[firmware/](firmware/)** — `tesseract_rig.ino` (PS3BT) + `tesseract_engine.h`, de code die op
  de Arduino draait (de engine 1-op-1 geport uit `engine.js`).

> **Kernidee:** niets beweegt mechanisch. Een "draai" verplaatst geen plastic — alleen de
> **kleuren** van 189 ledjes verschuiven (de cellen permuteren wiskundig). Je leest de draai
> af aan een heldere golf die in de draairichting langs de ledjes loopt.

---

## 1. Onderdelenlijst (BOM)

De BOM kent twee controller-paden. **Aanbevolen = ESP32 + Bluepad32** (regels 1a/4a); het
**alternatief = Mega + USB Host Shield** (regels 1b/4b/5b/10b). De rest is voor beide gelijk.

| # | Onderdeel | Aantal | Keuze / specificatie | Indicatie* | Waarom |
|---|-----------|--------|----------------------|-----------|--------|
| 1a | **Microcontroller (aanbevolen)** | 1 | **ESP32-dev-board** (bijv. WROOM DevKitC) | €6–12 | ~320 KB RAM, ingebouwde Bluetooth (Bluepad32), RMT-led-timing |
| 4a | **Levelshifter (ESP32-pad)** | 1 | **74AHCT125** (of 74HCT245) | €1–2 | tilt de 3,3V-datalijn naar een geldige 5V-high voor de WS2812 |
| 1b | Microcontroller (alternatief) | 1 | Arduino Mega 2560 | €15–40 | 5V-logica (geen levelshifter), maar 8 KB RAM is krap |
| 4b | USB Host Shield (alt.) | 1 | USB Host Shield 2.0 (MAX3421E; SPI via ICSP) | €10–20 | maakt de 5V-Mega een USB-host; draagt de dongle |
| 5b | Bluetooth-dongle (alt.) | 1 | USB-BT-dongle, CSR-chip | €5 | draadloze brug naar de controller (PS3BT) |
| 10b| USB-kabel (alt.) | 1 | USB-A → mini-USB | €2 | éénmalige DS3-koppeling (SetBdaddr) + opladen |
| 2 | RGB-leds | 189 | **WS2812B / NeoPixel** (los, strip of matrix-segmenten) | €25–60 | individueel adresseerbaar, 1 datadraad voor alle 189 |
| 3 | Voeding | 1 | **5V / 10A** (geregeld; full-white: ≥15A — zie §4) | €12–25 | 189 leds trekken veel stroom; USB kan dit niet |
| 6 | Controller | 1 | **PS4/PS5/Xbox/8BitDo/Switch Pro** (plug-and-pair) of **DualShock 3** (koppelstap) | €15–60 | bewegen, draaien, 4D, husselen/reset |
| 7 | Condensator | 1 | **1000µF / 10–16V** elektrolytisch | €0,50 | buffert stroompieken bij de leds |
| 8 | Weerstand | 1 | **330Ω** (220–470Ω ok) | €0,10 | beschermt de data-ingang van led #1 |
| 9 | Aan/uit-schakelaar | 1 | rocker/schakelaar **≥10A** (15A bij full-white; of MOSFET-module) | €2–5 | onderbreekt de 5V-lijn |
| 11| Zekering (aanbevolen) | 1 | inline **10A** (15A traag bij full-white) + houder | €2 | beschermt de **dunste draad**, niet de last |
| 12| Draad | — | **16–18 AWG** voor 5V/GND-hoofdlijnen, 22–24 AWG signaal | €5 | dikke draad voor de stroom, dun voor signalen |
| 13| Diversen | — | breadboard/PCB, dupont-draadjes, JST-connectoren, krimpkous | €10 | montage |
| 14| Behuizing | 7 kubussen | doorschijnend-wit PETG/acryl, 3D-print | zelf | je eigen 3D-model |

\* Ruwe hobby-prijzen, sterk afhankelijk van bron. Reken op **€100–200** totaal exclusief behuizing.
Het ESP32-pad is doorgaans **goedkoper** (geen shield + dongle) en betrouwbaarder.

### Microcontroller: ESP32 (aanbevolen) vs. Mega

| | **ESP32 + Bluepad32** (aanbevolen) | Arduino Mega 2560 (alternatief) |
|---|---|---|
| Controller-koppeling | **ingebouwde Bluetooth** → géén shield/dongle (Bluepad32) | USB Host Shield (SPI/ICSP) + BT-dongle |
| RAM | ~320 KB vrij (zeeën van ruimte) | 8 KB — krap; de PS3BT-build is nooit op RAM getest |
| WS2812-timing | **RMT-hardware** → `show()` blokkeert Bluetooth niet | interrupts ~6 ms uit per frame; lastig naast USB-host |
| Logica-spanning | 3,3V → **levelshifter nodig** op datalijn | **5V** → stuurt WS2812 direct aan |
| Snelheid | 240 MHz, dual-core | 16 MHz (prima) |
| **Conclusie** | **beste optie: minder onderdelen, ruim geheugen, geen timing-gedoe** | kies dit alleen als je per se 5V-only wilt |

> **Aanbevolen pad:** **ESP32 + Bluepad32** — firmware
> [`firmware/esp32_bluepad32/esp32_bluepad32.ino`](firmware/esp32_bluepad32/esp32_bluepad32.ino),
> bouwhandleiding [`firmware/esp32_bluepad32/README-esp32.md`](firmware/esp32_bluepad32/README-esp32.md).
> Enige extra: één **3,3V→5V levelshifter** (74AHCT125) tussen GPIO → DIN; voed het ESP32-board via
> zijn **5V/VIN**-pin (nooit 5V op 3V3); deel de GND. De controller (PS4/PS5/Xbox/8BitDo/Switch Pro,
> of een DS3 met koppelstap) verbindt via de **ingebouwde** Bluetooth — geen shield/dongle.
>
> **Alternatief (5V-only):** Mega + USB Host Shield + PS3BT — firmware
> [`firmware/tesseract_rig.ino`](firmware/tesseract_rig.ino). Let op de krappe 8 KB SRAM
> (`freeRam()` wordt geprint) en de WS2812+USB-host-timing.

---

## 2. Volledige bedradingstabel (pin-voor-pin)

Kleurcodes komen overeen met de 3D-werkbank: 🔴 +5V · ⚫ GND · 🟡 Data · 🔵 SPI/INT/SS (shield) ·
🟢 USB (dongle) · 🟣 Bluetooth (draadloos).

### Voeding (aparte 5V-bron)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| Voeding **+5V** | Aan/uit-schakelaar `in` | 🔴 | dikke draad (16–18 AWG) |
| Schakelaar `out` | Mega **5V**-pin | 🔴 | voedt de Arduino-logica |
| Schakelaar `out` | Led-rig **+5V** (bij DIN) | 🔴 | dikke draad naar de leds |
| Voeding **GND** | Mega **GND** | ⚫ | **gemeenschappelijke massa!** |
| Voeding **GND** | Led-rig **GND** (bij DIN) | ⚫ | dikke draad |

> ⚠️ **Niet tegelijk** de Mega via USB **én** via de 5V-pin voeden. De 5V-pin zit op hetzelfde
> net als de USB-5V zonder automatische omschakeling (de Mega kiest alleen automatisch tussen
> VIN en USB, **niet** de 5V-pin). Twee 5V-bronnen vechten dan, met mogelijke terugvoeding naar
> je USB-poort. Tijdens **programmeren**: Mega via USB, 5V-pin los, leds via de voeding (massa's
> wel verbonden). **Zelfstandig**: 5V-pin uit de voeding, USB eraf.

### Datalijn naar de leds
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| Mega **pin 6** | 330Ω weerstand `in` | 🟡 | datapin (`LED_PIN` in de firmware) |
| 330Ω `out` | Led-rig **DIN** (led #0) | 🟡 | weerstand zo dicht mogelijk bij led #0 |

### Buffercondensator (bij de leds, vlak bij DIN)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| Elco **+** | Led-rig **+5V** | 🔴 | 1000µF |
| Elco **−** (streep) | Led-rig **GND** | ⚫ | **let op polariteit** |

### USB Host Shield 2.0 — stapelt op de Mega (besturing)
De shield klikt boven op de Mega; je hoeft niets te solderen. Hij gebruikt SPI + twee
stuurpinnen en deelt 5V/GND. **Let op:** kies een shield die SPI via de **ICSP-header** voert —
alleen dán werkt hij op de Mega (de oude Uno-layout met pin 11/12/13 niet).

| Shield-signaal | Mega-pin | Kleur |
|---|---|---|
| VCC (5V) | 5V | 🔴 |
| GND | GND | ⚫ |
| MISO | **50 (ICSP)** | 🔵 |
| MOSI | **51 (ICSP)** | 🔵 |
| SCK | **52 (ICSP)** | 🔵 |
| INT | **9** | 🔵 |
| SS | **10** | 🔵 |

### Bluetooth-dongle + PS3-controller (draadloos)
| Van | Naar | Kleur | Opmerking |
|-----|------|-------|-----------|
| USB-Bluetooth-dongle | USB-A-poort van de shield | 🟢 | CSR-chip werkt het best |
| PS3-controller | dongle (Bluetooth, HID) | 🟣 | draadloos — geen draad |

> **Eénmalig koppelen:** sluit de controller met een **USB-kabel** op de shield aan en draai het
> `SetBdaddr`-hulpsketch uit de USB-Host-Shield-bibliotheek. Dat schrijft het Bluetooth-adres van
> de dongle in de controller; daarna verbindt hij draadloos zodra je op de **PS-knop** drukt.
> Zonder dongle werkt dezelfde controller bedraad via de klasse `PS3USB` (je terugval).
>
> **Husselen/Reset** zitten op de controller (**SELECT/START**) — losse fysieke knoppen zijn niet
> meer nodig.

### Power-injectie (zie §4)
| Van | Naar | Kleur |
|---|---|---|
| Voeding **+5V** | Led-rig **+5V** bij rechter/boven/achter-arm | 🔴 |
| Voeding **GND** | Led-rig **GND** bij dezelfde armen | ⚫ |

---

## 3. Tekstueel bedradingsschema

```
        ┌──────────────────────────── 5V VOEDING (5V / ≥6A) ────────────────────────────┐
        │ +5V ──[ AAN/UIT ≥10A ]──[ 10A zekering ]──┬──────────────► Mega 5V-pin         │
        │                                           ├──────────────► Led-rig +5V (#0)    │
        │                                           ├───► +5V injectie ► arm R           │
        │                                           ├───► +5V injectie ► arm U           │
        │                                           └───► +5V injectie ► arm B           │
        │ GND ──────────────────────────────────────┬──────────────► Mega GND  (GEMEEN!) │
        │                                            ├─────────────► Led-rig GND (#0)     │
        │                                            └───► GND injectie ► arms R/U/B      │
        └──────────────────────────────────────────────────────────────────────────────┘

   Mega pin 6 ──[ 330Ω ]──► DIN (led #0)        1000µF: + op +5V, − op GND  (bij led #0)

   USB Host Shield (stapelt op Mega): SPI via ICSP (MISO 50 / MOSI 51 / SCK 52), INT 9, SS 10
   Bluetooth-dongle in de USB-poort → PS3-controller draadloos (PS3BT). Husselen/Reset = SELECT/START.
```

---

## 4. Voeding & stroombudget — het belangrijkste

**De som:** 189 leds × ~60 mA (vol wit, max) = **~11,3 A** bij 5V (≈57 W). In de praktijk speel
je met verzadigde, gedimde kleuren → meestal **3–6 A**. De firmware *mikt* daar ook op:
`setBrightness(200)` + `setMaxPowerInVoltsAndMilliamps(5, 6000)` dimt automatisch om onder ~6 A
te blijven.

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

De BOM en het schema hierboven gaan uit van de **capped build**. Wil je full-white? Verhoog dan
álle vier de regels (voeding, zekering, schakelaar, draaddikte) samen.

**Draaddikte — regel: de zekering ≤ ampacity van de dunste draad eronder:**
- Hoofdlijnen 5V & GND: **16 AWG** bij 10A (18 AWG is krap voor 10A), **14 AWG** bij 15A.
- Injectie-takken: 20 AWG mag bij normaal gebruik (elke tak draagt maar een deel), maar besef:
  een kortsluiting op een tak wordt alléén door de hoofdzekering onderbroken → houd takken kort
  of gebruik ≥18 AWG.
- Shield/dongle-voeding (via de Mega): trekt weinig, maar hangt ook achter diezelfde
  hoofdzekering — vermijd kortsluiting daar.
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

1. **Gemeenschappelijke GND.** De massa van voeding, Arduino én leds moet aan elkaar. Zonder
   gedeelde GND "zweeft" het datasignaal → willekeurig geknipper. (Fout #1 bij WS2812.) Bij
   **power-injectie** moeten álle GND-takken van hetzelfde voeding-massapunt (één sterpunt)
   komen, zodat alle led-segmenten dezelfde datareferentie delen.
2. **330Ω in de datalijn**, vlak bij led #0 — dempt spanningspieken.
3. **1000µF condensator** over 5V/GND bij de leds — vangt inschakelpieken. Kies **10–16V**
   (niet de 6,3V-ondergrens). **Polariteit:** − (streep) naar GND. Tip: bij lange armen ook een
   kleinere elco (100–470µF) bij elk injectiepunt.
4. **De 5V-pin omzeilt de spanningsregelaar van de Mega.** Dat is hier bewust en prima met een
   nette **geregelde 5V (4,9–5,2V)**, maar de voedingsspanning komt dan rechtstreeks op élk
   5V-onderdeel (Mega, USB Host Shield + dongle, leds). Sluit **nooit** een >5V (VIN-grade) adapter op de
   5V-pin aan en let op de polariteit — er zit geen bescherming op.
5. **Niet USB + 5V-pin tegelijk** voeden zonder nadenken (zie §2).
6. **Begin niet op vol wit.** Test met lage helderheid; voer de stroom pas op als bedrading en
   koeling kloppen.
7. **ESP32?** Dan een **levelshifter** op de datalijn (3,3V → 5V), bijv. een 74AHCT125 (TTL-
   ingang, accepteert 3,3V). Voed die levelshifter met **5V** en deel zijn **GND** met de ESP32,
   anders is zijn uitgang geen geldige 5V-high. Voed het ESP32-board zelf via zijn **5V/VIN**-pin
   (de onboard regelaar maakt er 3,3V van) — nooit 5V rechtstreeks op de **3V3**-pin.
8. **Dikke draad + zekering** op de 5V-hoofdlijn; de zekering ≤ ampacity van de dunste draad
   eronder (zie §4). Dunne draadjes worden warm bij 6–10 A.

---

## 7. Bouw- en testvolgorde (incrementeel — nooit alles tegelijk)

1. **Mega + USB.** Upload `tesseract_rig.ino`. Seriële Monitor → de wiring-chart verschijnt.
   (Nog geen leds nodig.)
2. **USB Host Shield + dongle.** Stapel de shield, prik de BT-dongle erin, upload een
   PS3BT-voorbeeldsketch en koppel de controller (eerst bedraad via `SetBdaddr`). Zie je in de
   Seriële Monitor de knop-events? Dan werkt de besturing.
3. **Knoppen-test.** Loop alle controller-knoppen na in de seriële uitvoer (bewegen, draaien,
   4D, undo, husselen/reset) vóór je de leds aansluit.
4. **Een kort stukje leds** (bijv. 1 kubus = 27) op pin 6 via de 330Ω, gevoed uit de **aparte
   voeding** (massa met de Mega verbonden!). Klopt de kleurvolgorde met de chart? Pas dan
   uitbreiden.
5. **Bouw de keten uit** naar 189 leds, met **power-injectie** en de **condensator**.
6. **Schakelaar + zekering** in de 5V-lijn.
7. **Controller-knoppen** — alle acties (incl. husselen/reset via SELECT/START) zitten al op de
   PS3-controller; losse fysieke knoppen zijn niet nodig.
8. Speel — en vergelijk met de [3D-werkbank + digital twin](hardware.html).

---

## 8. Software

| Bestand | Rol |
|---|---|
| `firmware/esp32_bluepad32/esp32_bluepad32.ino` | **aanbevolen rig-firmware**: leds + **draadloze controller via de ingebouwde ESP32-Bluetooth (Bluepad32)** + draai-animatie. Spiegelt de bediening van `hardware.html`. Zie [`README-esp32.md`](firmware/esp32_bluepad32/README-esp32.md). |
| `firmware/tesseract_rig.ino` | **alternatieve rig-firmware** (5V-only): leds + **draadloze PS3-controller (PS3BT via USB Host Shield)** + draai-animatie. Let op de krappe 8 KB SRAM. |
| `firmware/tesseract_engine.h` | de geporte 4D-engine (≈ `engine.js`) — de wiskunde + de led-soldeerkaart (`ORIENT` / `printWiringChart`) + `freeRam()`. Gedeeld door **alle** firmwares. |
| `firmware/wokwi/sketch.ino` | **Wokwi-logica-testbank** (PS3-layout nagebootst: 2 sticks + D-pad + 4 face-knoppen + SELECT/START + OLED): zelfde engine + leds + besturingsmodel, want Wokwi kan geen PS3-host simuleren |

**Libraries voor de rig** (Arduino IDE → Bibliotheken beheren): **FastLED** en **USB Host Shield
Library 2.0** (`USB_Host_Shield_2.0`, met de `PS3BT`-klasse). `SPI` zit in de IDE. De Wokwi-testbank
gebruikt in plaats van de USB Host Shield ook **Adafruit SSD1306 + Adafruit GFX** (voor de OLED).

> ✅ **Besturing geport naar `PS3BT`.** `tesseract_rig.ino` leest nu een draadloze PS3-controller via
> de USB Host Shield, met dezelfde as-native navigatie en het arm-vlak-+-richting-model als de bench
> (`hardware.html`). De OLED is vervallen (status gaat naar de Seriële Monitor; de 189 leds zíjn de
> display). Wokwi kan geen USB-host/PS3 simuleren, dus daarvoor blijft de testbank
> `firmware/wokwi/sketch.ino` bestaan — die **bootst dezelfde controller-layout na** met sticks +
> knoppen en deelt dezelfde `tesseract_engine.h`, navigatie en draaimodel.

**Uploaden:** kies bord *Arduino Mega 2560*, juiste poort, upload. Open de Seriële Monitor op
**115200** baud voor de wiring-chart en meldingen.

### Eerst testen zonder hardware: Wokwi
[Wokwi](https://wokwi.com) draait **echte** Arduino-code tegen gesimuleerde WS2812-leds in de
browser, zodat je de logica en adressering test vóór je iets koopt. (Wokwi tekent geen
3D-tesseract — daarvoor is `hardware.html`.)

> ℹ️ **Wokwi kan geen echte USB-host/PS3-controller simuleren.** Daarom bootst de Wokwi-testbank
> [`firmware/wokwi/sketch.ino`](firmware/wokwi/sketch.ino) de **PS3-layout na met losse onderdelen**
> (2 analoge sticks + D-pad + 4 face-knoppen + SELECT/START + OLED) om de spel-logica, led-adressering
> én het besturingsmodel te testen — met dezelfde `tesseract_engine.h`, as-native navigatie en
> "vlak + richting"-draaimodel als de rig. De échte PS3-besturing (`firmware/tesseract_rig.ino`)
> test je op de hardware zelf.
>
> **▶ Opgeslagen project:** https://wokwi.com/projects/467182062676747265 ("4d Rubiks real") — let op:
> dat is nog de oude 3-joystick/menu-build; plak de vernieuwde `sketch.ino` + `diagram.json` voor de
> PS3-layout-besturing hierboven.
>
> **Kant-en-klaar (zelf bouwen):** in [`firmware/wokwi/`](firmware/wokwi/) staan `sketch.ino`
> (PS3-layout-build), een complete `diagram.json` (Mega + 2 sticks + D-pad + 4 face-knoppen +
> SELECT/START + OLED + 330Ω + een 189-pixel led-strip), een `libraries.txt`, een klikbare snelkoppeling
> [`4d-rubiks-wokwi.url`](firmware/wokwi/4d-rubiks-wokwi.url) en een stap-voor-stap
> [`README-wokwi.md`](firmware/wokwi/README-wokwi.md).

---

## 9. Het "8e cel"-concept (4D-rotatie)

Een tesseract heeft **8 cellen**, maar je bouwt er fysiek **7** (midden + 6 armen). De 8e
("buitenste") cel is verborgen. Met de **● linkerstick (4D-knop) op de centrale cel van een arm-kubus**
voer je een **4D-rotatie** uit: die kubus wordt logisch het midden; alleen de ledkleuren
verschuiven (de fysieke kubussen bewegen niet). Zo haal je verborgen cellen in beeld — precies
zoals `Ctrl`+klik in de game en de centreer-knop in de simulatie.

---

*Single source of truth:* de bedrading hierboven, de `CONNECTIONS`-tabel in
[hardware.js](hardware.js) én de firmware [tesseract_rig.ino](firmware/tesseract_rig.ino) draaien
nu allemaal op de **USB Host Shield + PS3BT**-besturing (data pin 6, shield-SPI via ICSP, INT 9,
SS 10). Wijzig je een pin of een aansluiting, pas dan alle drie aan. De joystick/OLED-pinnen leven
nog enkel in de Wokwi-testbank [`firmware/wokwi/sketch.ino`](firmware/wokwi/sketch.ino) +
`diagram.json` (die kan geen PS3-host simuleren).
