# ESP32 + Bluepad32 — de aanbevolen rig-firmware

`esp32_bluepad32.ino` stuurt de **189 WS2812B-leds** aan en leest een **draadloze
controller** (PS4/PS5/Xbox/8BitDo/Switch Pro — of een PS3 met een koppelstap) via de
**ingebouwde Bluetooth van de ESP32**, met de **Bluepad32**-bibliotheek. Geen USB Host
Shield, geen losse dongle.

> Deelt dezelfde `tesseract_engine.h` (wiskunde + led-soldeerkaart) als de game, de 3D-werkbank
> (`hardware.html`), de Wokwi-testbank en de Mega-rig. Navigatie (as-native) en het
> "vlak armeren + richting"-draaimodel zijn **identiek**.

## Waarom ESP32 i.p.v. Arduino Mega (dit is de betere optie)

| | **ESP32 + Bluepad32** (aanbevolen) | Mega + USB Host Shield + PS3BT (`../tesseract_rig.ino`) |
|---|---|---|
| Geheugen | ~320 KB vrij — nooit krap | 8 KB, krap; de PS3BT-build is nooit op RAM getest |
| WS2812-timing | via **RMT-hardware** → `FastLED.show()` blokkeert Bluetooth niet | interrupts ~6 ms uit per frame; lastig naast USB-host |
| Bluetooth | **ingebouwd** (Bluepad32) | USB Host Shield 2.0 + BT-dongle nodig |
| Logica | 3,3V → **levelshifter** op de datalijn nodig | 5V → direct |
| Snelheid | 240 MHz, dual-core | 16 MHz |

Enige extra t.o.v. de Mega: één **3,3V→5V levelshifter** (bijv. 74AHCT125) op de datalijn.
Dat weegt ruimschoots op tegen de Mega-krapte.

## BOM-verschil t.o.v. `BEDRADING.md`

- **Vervalt:** Arduino Mega, USB Host Shield 2.0, USB-Bluetooth-dongle.
- **Komt erbij:** een **ESP32-dev-board** (bijv. ESP32-WROOM DevKitC, €6–12) en een
  **levelshifter** 74AHCT125 (of 74HCT245), €1–2.
- **Gelijk:** 189× WS2812B, 5V-voeding (10A capped / ≥15A full-white), 1000µF, 330Ω,
  schakelaar, zekering, power-injectie, behuizing — zie `BEDRADING.md §1/§4`.
- **Controller:** een PS4/PS5/Xbox/8BitDo/Switch-Pro is het simpelst (plug-and-pair).
  Een **DualShock 3** kan ook, maar heeft een eenmalige koppelstap (zie onder).

## Bedrading (verschilt alleen in de controller + de datalijn)

```
ESP32 GPIO 13 ──► 74AHCT125 (in)        74AHCT125 (uit) ──[ 330Ω ]──► DIN (led #0)
74AHCT125: VCC = 5V, GND gedeeld met ESP32 (anders is de 5V-uitgang ongeldig)
5V-voeding ──► ESP32 5V/VIN-pin (de onboard-regelaar maakt er 3,3V van) — NOOIT 5V op 3V3
5V-voeding ──► led-rig +5V (#0) + power-injectie (arms R/U/B), 1000µF bij #0, GEMEENSCHAPPELIJKE GND
```

Alle led-stroom-, injectie-, zekering- en draaddikte-regels zijn identiek aan `BEDRADING.md §4`.

## Installeren (Arduino IDE)

1. **Bluepad32-boardpakket** (dit levert de ESP32+Bluepad32-varianten van de boards):
   - *Bestand → Voorkeuren → Additional Boards Manager URLs* — voeg toe:
     `https://raw.githubusercontent.com/ricardoquesada/esp32-arduino-lib-builder/master/bluepad32_files/package_esp32_bluepad32_index.json`
   - *Tools → Board → Boards Manager* → zoek **esp32_bluepad32** → installeren.
   - Kies bij *Tools → Board* het **ESP32 Bluepad32**-bord dat bij jouw module past
     (bijv. *ESP32 Bluepad32 / ESP32 Dev Module*).
2. **FastLED** via *Library Manager*.
3. **Engine-header naast de sketch zetten** (Arduino compileert een hele map, dus de header
   moet in *deze* map staan). Kies één:
   - **Kopiëren:** kopieer `../tesseract_engine.h` naar deze map (`esp32_bluepad32/`).
   - **Symlink (Linux/Mac):** `ln -s ../tesseract_engine.h tesseract_engine.h` in deze map.
   > De **bron** blijft `firmware/tesseract_engine.h` (single source of truth). Werk je die
   > bij, ververs dan de kopie/symlink. (Net als bij de Wokwi-testbank.)
4. Selecteer poort, **Upload**. Open de **Seriële Monitor (115200)**: je ziet de
   `printWiringChart()`-soldeerkaart, het **vrije heap**, en het **Bluetooth-adres van de ESP32**.

## Koppelen

- **PS4 / PS5 / Xbox / 8BitDo / Switch Pro:** zet de controller in **koppelmodus**
  (DS4: *Share* + *PS* ingedrukt tot de lichtbalk dubbel knippert) — Bluepad32 verbindt automatisch.
- **DualShock 3:** de DS3 wil dat zijn **"master"-adres** gelijk is aan het Bluetooth-adres van
  de ESP32 (dat de firmware bij het opstarten print). Zet dat één keer met *sixaxispairtool* /
  *SixaxisPairer* terwijl de DS3 met USB aan een pc hangt — daarna verbindt hij draadloos.
  (Dit is hetzelfde idee als de `SetBdaddr`-stap bij de Mega.)
- Eén keer fris herkoppelen nodig? Haal de `// BP32.forgetBluetoothKeys();` in `setup()` uit
  commentaar, upload, en zet hem daarna weer terug.

## Besturing (gelijk aan `hardware.html` / de Mega-rig)

| Knop | Actie |
| --- | --- |
| **D-pad** ▲▼◀▶ | selectie verplaatsen N/S/W/E (grondvlak x/z) |
| **R-stick** ▲ / ▼ | naar de boven-/onder-kubus (U/D) |
| **R-stick indrukken** (R3) | zet terug (undo) |
| **L-stick** ◀ / ▶ | draairichting (−/+); houd vast en kies een vlak |
| **L-stick indrukken** (L3) | 4D-rotatie (op de centrale cel van een armkubus) |
| **□ / ✕ / ○ / △** | vlak XY / YZ / XZ / grip (ribbe 180° of hoek ±120°) |
| **SELECT / START** | husselen / reset |

Bluepad32 normaliseert de knop-posities, dus de mapping klopt voor PlayStation- én Xbox-knoppen
(□=west, ✕=zuid, ○=oost, △=noord). Voelt de R-stick op/neer omgekeerd? Wissel de twee tekens in
`readVerticalStick()`.

## Testen zonder hardware

Wokwi kan **geen** Bluetooth/Bluepad32 simuleren. Logica + led-adressering + besturingsmodel test je
in de browser met de testbank [`../wokwi/sketch.ino`](../wokwi/sketch.ino) (zelfde engine, knoppen
in plaats van een draadloze controller). De ruimtelijke beleving zit in
[`../../hardware.html`](../../hardware.html).
