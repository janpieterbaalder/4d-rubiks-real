# Wokwi-simulatie op een **ESP32** (logica-testbank van de draadloze rig)

Dit is de **ESP32**-variant van de Wokwi-testbank. Hij draait dezelfde engine + besturingslogica
als de échte draadloze firmware ([`../esp32_bluepad32/`](../esp32_bluepad32/)), maar op een
**gesimuleerde ESP32** in de browser — zónder iets aan te sluiten.

> ⚠️ **Wat Wokwi niet kan: Bluetooth.** De echte rig koppelt een Bluetooth-gamepad via
> **Bluepad32**. Geen enkele simulator (Wokwi, QEMU-ESP32, Renode, Proteus) kan een gekoppelde
> BT-controller nadoen. Daarom bootst deze build de controller na met onderdelen die Wokwi *wél*
> kan simuleren: **2 analoge sticks + D-pad + 4 face-knoppen + SELECT/START**. De mapping, de
> as-native navigatie en het "vlak armeren + richting"-draaimodel zijn **1-op-1 gelijk** aan
> `esp32_bluepad32` en aan `hardware.html`. Alles is dus te verifiëren behalve de letterlijke
> BT-pairing — en dat is precies de hardware-stap die hierna komt.

> Wokwi tekent géén 3D-tesseract: de 189 leds staan als één rij. Voor de ruimtelijke beleving én
> het spelen gebruik je [`../../hardware.html`](../../hardware.html).

## Snelste manier (web — geen installatie)

1. Ga naar **[wokwi.com](https://wokwi.com)**, **log in**, → *New Project* → **ESP32**.
2. Vervang het `sketch.ino`-tabblad door **[`sketch.ino`](sketch.ino)** uit deze map.
3. **Twee bestanden, niet samenvoegen!** Voeg de engine als losse header toe: ▾ naast de tabs →
   *Upload file…* → kies **[`../tesseract_engine.h`](../tesseract_engine.h)** (of *New file…* →
   naam exact `tesseract_engine.h` → plak de inhoud). Plak de engine **nooit ín** `sketch.ino`
   (dan zet Arduino's auto-prototype-generator de prototypes bóven de typedefs en faalt de build).
4. Open het `diagram.json`-tabblad en plak **[`diagram.json`](diagram.json)**.
5. `libraries.txt` → plak **[`libraries.txt`](libraries.txt)**. **FastLED is op `@3.7.8` gepind** —
   dat is het "sweet spot": **3.6.0** is té oud voor Wokwi's nieuwe ESP32-core (IDF 5 / arduino-esp32
   3.x → compile-fout `'RMTMEM' was not declared`), terwijl **3.9.x** de zware `fl/ui`-headers
   meesleept die cc1plus op Wokwi's gratis **2 GB**-buildserver out-of-memory laten gaan (én met onze
   `Button`-naam botsten). **3.7.8** heeft de nieuwe RMT5-driver én is licht genoeg om te compileren.
6. Klik **▶ Start**. Open de **Serial Monitor** (115200) → de `printWiringChart()` soldeerkaart
   rolt eruit (`0 : C(midden) : -1,-1,-1` … `188 : B(achter) : 1,1,-1`), gevolgd door
   `Vrij heap na init (byte): …` (ruim, ~520 KB op ESP32).
7. **Save** → nu staat het onder jouw account.

## Pinmap (ESP32 DevKit v1)

| Functie | GPIO | Opmerking |
| --- | --- | --- |
| LED-data (WS2812 → 330 Ω → DIN) | **13** | FastLED RMT — **gelijk aan de bouw-firmware** (`esp32_bluepad32` + `hardware.html`), zodat deze testbank ook als bedradingsreferentie dient |
| L-stick X (draairichting −/+) | **34** | ADC1 (input-only) |
| L-stick druk (L3 = 4D-rotatie) | **25** | pull-up |
| R-stick Y (boven/onder U/D) | **35** | ADC1 (input-only) |
| R-stick druk (R3 = undo) | **26** | pull-up |
| D-pad N / S / W / E | **23 / 14 / 27 / 32** | grondvlak x,z (N van 13 → 23 verhuisd, want 13 = LED-data) |
| □ / ✕ / ○ / △ (XY / YZ / XZ / grip) | **33 / 19 / 4 / 16** | 16 = RX2 |
| SELECT / START (husselen / reset) | **17 / 18** | 17 = TX2 |
| OLED I²C (SDA / SCL, 0x3C) | **21 / 22** | — |

> ESP32-eigenaardigheden die in deze sketch zijn afgevangen: `analogReadResolution(10)` zodat de
> ADC 0..1023 teruggeeft (centrum ~512, net als de AVR-rig), `esp_random()` als husselseed (geen
> `A8`-pin), en `Wire.begin(21, 22)` voor I²C. Analoge sticks staan op ADC1-pinnen; strapping- en
> flash-pinnen (0, 2, 5, 6–11, 12, 15) zijn vermeden.

## Bedienen

Identiek aan de Mega-testbank en aan `hardware.html` — zie
[`../wokwi/README-wokwi.md`](../wokwi/README-wokwi.md) (sectie *Bedienen in de simulatie*).
Voelt op/neer op de R-stick omgekeerd? Wissel de twee tekens in `readVerticalStick()`.
