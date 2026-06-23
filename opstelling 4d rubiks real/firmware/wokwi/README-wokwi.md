# Wokwi-simulatie van de firmware

> ## ▶ Live project (al opgebouwd & opgeslagen)
> **https://wokwi.com/projects/467182062676747265** — "4d Rubiks real".
> ⚠️ Dat opgeslagen project is nog de **oude** 3-joystick/menu-build. De huidige `sketch.ino` +
> `diagram.json` in deze map zijn vernieuwd naar de **PS3-layout** (2 sticks + D-pad + face-knoppen).
> Wil je de besturing zoals hieronder beschreven, plak dan de nieuwe `sketch.ino` en `diagram.json`
> (zie "Snelste manier"). De bibliotheken blijven gelijk (FastLED + Adafruit GFX + SSD1306).

Test de engine + led-adressering in de browser — sticks, D-pad, face-knoppen, OLED en de
189-led-keten — zonder hardware te kopen. Wokwi draait de C++-code tegen gesimuleerde onderdelen,
dus je valideert hier de **logica en de bedrading/adressering**.

> ℹ️ **Dit is de logica-testbank** [`sketch.ino`](sketch.ino). De échte rig draait op een
> **draadloze controller** die Wokwi **niet** kan simuleren — of dat nu de aanbevolen
> **ESP32 + Bluepad32** ([`../esp32_bluepad32/`](../esp32_bluepad32/)) is of de Mega + PS3BT
> ([`../tesseract_rig.ino`](../tesseract_rig.ino)). Daarom bootst deze build dezelfde
> controller-layout na met onderdelen die Wokwi *wél* kan simuleren (2 analoge sticks + D-pad +
> 4 face-knoppen + SELECT/START). De **mapping, de as-native navigatie én het "vlak armeren +
> richting"-draaimodel zijn identiek aan beide rig-firmwares en aan `hardware.html`** — alleen de
> draadloze link is nagebootst. Alle builds delen dezelfde `tesseract_engine.h`, dus wat je hier over
> kleuren/adressering/besturing verifieert, klopt 1-op-1 op de rig.

> Wokwi tekent géén 3D-tesseract: de 189 leds staan als één rij. Voor de ruimtelijke beleving
> (7 kubussen) én de speelervaring gebruik je [`../../hardware.html`](../../hardware.html).

## ✅ Geverifieerd (deze opstelling is echt gedraaid in Wokwi)

Dit project is op wokwi.com getest met een Arduino Mega:
- **Compileert** schoon met FastLED + Adafruit SSD1306/GFX.
- **Boot en draait** stabiel; de seriële monitor (115200) toont de volledige
  `printWiringChart()` van led 0 t/m 188, bv. `0 : C(midden) : -1,-1,-1` … `188 : B(achter) : 1,1,-1`,
  gevolgd door `Vrij SRAM na init (byte): …` (controleer dat er ruime marge t.o.v. 8192 is).
- OLED, sticks, knoppen en de 189-led-strip worden aangestuurd.

> ⚠️ **Wat de echte run aan het licht bracht (en waarom hardware testen loont):** een eerdere
> versie liep over de **8 KB SRAM** van de Mega en kwam in een reset-loop terecht (de seriële
> uitvoer was onleesbare rommel). De animatie-scratch is daarop **bit-gepakt** en de
> undo-historie verkleind (`HIST_MAX 16`); nu past het met marge. Op een **ESP32** (520 KB)
> speelt dit sowieso niet. Dit is precies het soort runtime-probleem dat geen enkele
> compile-controle vindt — alleen een echte run.

## Snelste manier (web — geen installatie)

1. Ga naar **[wokwi.com](https://wokwi.com)**, **log in** (rechtsboven) → *New Project* →
   **Arduino Mega**. (Inloggen is nodig om straks te kunnen **Save**en.)
2. Vervang de inhoud van het `sketch.ino`-tabblad door die van de **[`sketch.ino`](sketch.ino)** in
   deze map (de controller-testbank met PS3-layout — alles selecteren, plakken). *Niet*
   `../tesseract_rig.ino`: dat is de PS3-rig-firmware en die kan Wokwi niet draaien.
3. **Twee bestanden, niet samenvoegen!** Voeg de engine als losse header toe — kies één:
   - **Uploaden (makkelijkst):** klik het **▾** naast de bestandstabs → *Upload file(s)…* →
     kies **[`../tesseract_engine.h`](../tesseract_engine.h)**.
   - **Of plakken:** ▾ → *New file…* → naam exact **`tesseract_engine.h`** → plak de inhoud.
   > Plak de engine **nooit ín** `sketch.ino`: dan zet Arduino's auto-prototype-generator de
   > prototypes bóven de typedefs en faalt de build (`'Mat4' was not declared`).
4. Open het tabblad **`diagram.json`** en plak de inhoud van **[`diagram.json`](diagram.json)**.
5. Tabblad **`Library Manager`** → blauwe **+** (*Add a new library*) → zoek **FastLED** en klik
   erop; nogmaals **+** → zoek **Adafruit SSD1306** en klik erop (**Adafruit GFX** komt
   automatisch mee). Dit schrijft `libraries.txt` voor je.
6. Klik **▶ Start** (~10s compileren). Open de **Serial Monitor** (115200) → de
   `printWiringChart()` soldeerkaart rolt eruit (`0 : C(midden) : -1,-1,-1` … `188 : …`).
7. **Save** (linksboven) → nu staat het onder jouw account.

## Bedienen in de simulatie (gelijk aan de PS3-controller / `hardware.html`)

| Onderdeel | Doen | Actie |
| --- | --- | --- |
| **D-pad** ▲▼◀▶ (N/S/W/E) | klikken | selectie verplaatsen in het grondvlak (achter/voor/links/rechts) |
| **R-stick ▲ / ▼** | sleep de rechter stick op/neer | naar de boven-/onder-kubus (U/D) |
| **R-stick indrukken** (R3) | klik de rechter stick | zet terug (undo) |
| **L-stick ◀ / ▶** | sleep de linker stick links/rechts | draairichting (−/+); houd vast en kies een vlak |
| **L-stick indrukken** (L3) | klik de linker stick | 4D-rotatie (op de centrale cel van een armkubus) |
| **□ / ✕ / ○ / △** | klik de face-knoppen | vlak XY / YZ / XZ / grip (ribbe 180° of hoek ±120°) |
| **SELECT / START** | klikken | husselen / reset |
| OLED | — | toont cel + gearmeerd vlak + richting + opgelost-status |
| Led-strip (189) | — | de kleuren verschuiven; bij een draai zie je de helderheids-golf lopen |

- Een vlak **armeer** je met een face-knop en voer je uit met een richting (L-stick), of andersom —
  net als op de echte controller en in `hardware.html`.
- Sticks staan in rust in het midden (≈ 512). Voelt op/neer op de R-stick omgekeerd? Wissel dan de
  twee tekens in `readVerticalStick()` — dat is enkel de stick-polariteit van het sim-onderdeel.

## Goed om te weten

- **Voeding:** Wokwi voedt alles vanaf het bord (geen aparte 5V-bron in de sim). Op échte
  hardware voed je de 189 leds uit een **aparte 5V-voeding** met gedeelde massa en
  power-injectie — zie [`../../BEDRADING.md`](../../BEDRADING.md) §4.
- **Snelheid:** 189 gesimuleerde leds + de golf-animatie kunnen in de browser wat traag
  lopen. Dat zegt niets over de echte Mega (die is hier ruim snel genoeg).
- **Pinnen** (zie de `#define`s boven in `sketch.ino`): data pin 6 via 330Ω; L-stick A0 + SW 22;
  R-stick A3 + SW 23; D-pad 30/31/32/33 (N/S/W/E); face-knoppen 34/35/36/37 (□/✕/○/△);
  SELECT/START 26/28; OLED 20/21. Dit is de Wokwi-testbank-bedrading; de échte rig gebruikt in
  plaats van sticks/knoppen de USB Host Shield + PS3-controller (zie `../../BEDRADING.md`).

## Lokaal simuleren (optioneel)

Wil je vanuit **VS Code** simuleren met de *Wokwi for VS Code*-extensie? Gebruik dan
[`wokwi.toml`](wokwi.toml) en laat het wijzen naar je gecompileerde `.hex`/`.elf`
(Arduino CLI of PlatformIO). Voor de web-versie hierboven is dat niet nodig.
