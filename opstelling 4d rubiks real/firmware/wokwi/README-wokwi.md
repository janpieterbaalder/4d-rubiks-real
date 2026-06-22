# Wokwi-simulatie van de firmware

> ## ▶ Live project (al opgebouwd & opgeslagen)
> **https://wokwi.com/projects/467182062676747265** — "4d Rubiks real".
> Compleet: `sketch.ino`, `tesseract_engine.h`, `diagram.json` en de 3 bibliotheken
> (FastLED + Adafruit GFX + Adafruit SSD1306). Open en klik op ▶ — geen opnieuw bouwen nodig.
> (Klikbare snelkoppeling: [`4d-rubiks-wokwi.url`](4d-rubiks-wokwi.url).)

Test de engine + led-adressering in de browser — joysticks, OLED, knoppen en de 189-led-keten —
zonder hardware te kopen. Wokwi draait de C++-code tegen gesimuleerde onderdelen, dus je valideert
hier de **logica en de bedrading/adressering**.

> ℹ️ **Dit is de logica-testbank** [`sketch.ino`](sketch.ino) (3 joysticks + OLED). De échte
> rig-firmware [`../tesseract_rig.ino`](../tesseract_rig.ino) gebruikt een draadloze PS3-controller
> (PS3BT via USB Host Shield), die Wokwi **niet** kan simuleren. Beide delen dezelfde
> `tesseract_engine.h`, dus wat je hier over kleuren/adressering verifieert, klopt 1-op-1 op de rig.

> Wokwi tekent géén 3D-tesseract: de 189 leds staan als één rij. Voor de ruimtelijke beleving
> (7 kubussen) én de speelervaring gebruik je [`../../hardware.html`](../../hardware.html).

## ✅ Geverifieerd (deze opstelling is echt gedraaid in Wokwi)

Dit project is op wokwi.com getest met een Arduino Mega:
- **Compileert** schoon met FastLED + Adafruit SSD1306/GFX.
- **Boot en draait** stabiel; de seriële monitor (115200) toont de volledige
  `printWiringChart()` van led 0 t/m 188, bv. `0 : C(midden) : -1,-1,-1` … `188 : B(achter) : 1,1,-1`.
- OLED, joysticks en de 189-led-strip worden aangestuurd.

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
   deze map (de joystick/OLED-testbank — alles selecteren, plakken). *Niet* `../tesseract_rig.ino`:
   dat is de PS3-rig-firmware en die kan Wokwi niet draaien.
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

## Bedienen in de simulatie

| Onderdeel | Doen |
| --- | --- |
| Joystick A/B/C | sleep de stick met de muis (rust = midden ≈ 512, matcht de firmware) |
| Knop *husselen* (pin 26) | klikken |
| Knop *reset* (pin 28) | klikken |
| OLED | toont live de notatie + zetten + opgelost-status |
| Led-strip (189) | de kleuren verschuiven; bij een draai zie je de helderheids-golf lopen |

- **Joystick A** beweegt horizontaal; **indrukken** (klik de stick) = 4D-rotatie.
- **Joystick B** beweegt verticaal; **indrukken** = zet terug (undo).
- **Joystick C** scrollt het rotatie-menu op de OLED; **indrukken** = draai uitvoeren.

## Goed om te weten

- **Voeding:** Wokwi voedt alles vanaf het bord (geen aparte 5V-bron in de sim). Op échte
  hardware voed je de 189 leds uit een **aparte 5V-voeding** met gedeelde massa en
  power-injectie — zie [`../../BEDRADING.md`](../../BEDRADING.md) §4.
- **Snelheid:** 189 gesimuleerde leds + de golf-animatie kunnen in de browser wat traag
  lopen. Dat zegt niets over de echte Mega (die is hier ruim snel genoeg).
- **Pinnen:** exact gelijk aan `BEDRADING.md` en de `#define`s in de firmware (A0/A1/22,
  A2/A3/23, A4/A5/24, OLED 20/21, data pin 6 via 330Ω, knoppen 26/28).

## Lokaal simuleren (optioneel)

Wil je vanuit **VS Code** simuleren met de *Wokwi for VS Code*-extensie? Gebruik dan
[`wokwi.toml`](wokwi.toml) en laat het wijzen naar je gecompileerde `.hex`/`.elf`
(Arduino CLI of PlatformIO). Voor de web-versie hierboven is dat niet nodig.
