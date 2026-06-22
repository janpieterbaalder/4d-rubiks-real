/* ============================================================================
   sketch.ino — WOKWI LOGIC-TEST variant (3 joysticks + OLED).
   ----------------------------------------------------------------------------
   This is the *Wokwi* build. Wokwi cannot simulate a USB host / PS3 controller,
   so this variant keeps the original 3-joystick + OLED input so you can still
   logic-test the engine, the 189-LED addressing and the permutation-wave in the
   browser. The REAL rig firmware is ../tesseract_rig.ino, which drives the same
   engine + LEDs from a wireless PS3 controller (PS3BT) over a USB Host Shield —
   see BEDRADING.md. Both sketches share the SAME tesseract_engine.h (the single
   source of truth for the math + the LED solder map), so what you verify here
   about colours/addressing holds 1:1 on the rig.

   Arduino Mega 2560. Drives 189 WS2812B LEDs (7 cubes × 27), reads 3 analogue
   joysticks + their buttons + 2 extra buttons, and shows the move notation on an
   I²C OLED. The puzzle MATH lives in tesseract_engine.h (a 1:1 port of the verified
   engine.js), so a turn behaves exactly like the game and the 3D simulator.

   NOTHING MOVES MECHANICALLY — a "turn" only changes LED COLOURS. The eye reads the
   turn from a bright wave that sweeps along the real permutation cycle (same trick as
   the simulator), so you can follow it even on a solved (single-colour) cube.

   ---- LIBRARIES (install via Arduino IDE → Library Manager) ------------------
     FastLED                         (LED driver + automatic power limiting)
     Adafruit SSD1306 + Adafruit GFX (OLED)
   Wire.h and the engine header come with the sketch.

   ---- WIRING (see BEDRADING.md for the full table + diagram) ----------------
     LED data    : pin 6  -> 330Ω -> DIN of LED #0   (5V data, no level shifter on Mega)
     Joystick A  : VRx A0, VRy A1, SW pin 22   (horizontal move ; press = 4D rotation)
     Joystick B  : VRy A2, VRx A3, SW pin 23   (vertical move    ; press = undo)
     Joystick C  : VRy A4, VRx A5, SW pin 24   (scroll menu      ; press = execute turn)
     Scramble btn: pin 26   Reset btn: pin 28   (to GND, INPUT_PULLUP)
     OLED        : SDA 20, SCL 21 (I²C, addr 0x3C)
     Power       : separate 5V supply -> LEDs (+ a 1000µF cap and common GND with the Mega)
   ========================================================================== */
#include <FastLED.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "tesseract_engine.h"

// ----------------------------------------------------------------- pins
#define LED_PIN        6
#define JOYA_X A0
#define JOYA_Y A1
#define JOYA_SW 22
#define JOYB_Y A2
#define JOYB_X A3
#define JOYB_SW 23
#define JOYC_Y A4
#define JOYC_X A5
#define JOYC_SW 24
#define BTN_SCRAMBLE   26
#define BTN_RESET      28

// ----------------------------------------------------------------- tuning
#define FASTLED_MAX_MA 6000     // FastLED software brightness-scaling target — NOT a hardware fuse (see BEDRADING.md §4)
#define LED_BRIGHTNESS 200      // global master brightness 0..255
#define TWIST_MS       1500UL   // duration of one turn's colour sweep
#define AX_DEAD        220      // joystick dead-zone around centre (0..511)
#define AX_RECENTER    90       // must return within this of centre before it can fire again

// brightness levels (emissive feel) for the static display
#define I_BASE     60           // other cubes
#define I_SELCUBE  110          // the selected cube
#define I_SEL      235          // the selected cell

// ---- input types declared up here so Arduino's auto-prototypes resolve them ----
struct Axis   { uint8_t pin; bool latched; };
struct Button { uint8_t pin; bool prev; uint32_t tEdge; };

// ----------------------------------------------------------------- objects
CRGB leds[NLED];
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Tesseract puzzle;

// ----------------------------------------------------------------- per-slot tables (legacy JP-scheme nav for this Wokwi build; the rig firmware ../tesseract_rig.ino uses the as-native scheme)
// view axis/sign used by viewToLogical, and the cube's global-coordinate centre.
struct SlotInfo { int8_t vAxis, vSign; int8_t cx, cy, cz; const char *nl; };
const SlotInfo SLOTS[NSLOT] = {
  /* C */ { AX_W, -1,  0,  0,  0, "midden" },
  /* R */ { AX_X, +1,  3,  0,  0, "rechts" },
  /* L */ { AX_X, -1, -3,  0,  0, "links"  },
  /* U */ { AX_Y, +1,  0,  0,  3, "boven"  },
  /* D */ { AX_Y, -1,  0,  0, -3, "onder"  },
  /* F */ { AX_Z, +1,  0, -3,  0, "voor"   },
  /* B */ { AX_Z, -1,  0,  3,  0, "achter" },
};
const char *CELL_LABEL[8] = { "Right", "Left", "Top", "Bottom", "Front", "Back", "Outer", "Inner" };
const char *POS_LABEL[4]  = { "kern", "vlak", "rand", "hoek" };

// ----------------------------------------------------------------- state
int8_t selSlot = SLOT_C, selIdx = 13;   // 13 = centre cubie of cube C
uint8_t j3idx = 0;                       // highlighted rotation-menu item
bool scrambledOnce = false, solved = true;
uint16_t moveCount = 0;

// ----------------------------------------------------------------- helpers (engine.js-equivalent, JP-scheme nav)
void decodeVi(int idx, int &i, int &j, int &k) { i = (idx % 3) - 1; j = ((idx / 3) % 3) - 1; k = (idx / 9) - 1; }
int  nzCount(int idx) { int i, j, k; decodeVi(idx, i, j, k); return (i != 0) + (j != 0) + (k != 0); }
bool isCentreCell(int slot, int idx) { return slot != -1 && idx == 13; }

void gcoord(int slot, int idx, int &gx, int &gy, int &gz) {
  int i, j, k; decodeVi(idx, i, j, k);
  gx = SLOTS[slot].cx + i; gy = SLOTS[slot].cy - k; gz = SLOTS[slot].cz + j;
}
// inverse: global (gx,gy,gz) -> slot/idx, or returns false if no cell there
bool cellAt(int gx, int gy, int gz, int8_t &slot, int8_t &idx) {
  auto farf = [](int a) -> int { return a >= 2 ? 1 : (a <= -2 ? -1 : 0); };
  int fx = farf(gx), fy = farf(gy), fz = farf(gz);
  if (abs(fx) + abs(fy) + abs(fz) > 1) return false;            // diagonal: no cube
  int s = SLOT_C, lx = gx, ly = gy, lz = gz;
  if (fx)      { s = fx > 0 ? SLOT_R : SLOT_L; lx = gx - 3 * fx; }
  else if (fy) { s = fy > 0 ? SLOT_B : SLOT_F; ly = gy - 3 * fy; }
  else if (fz) { s = fz > 0 ? SLOT_U : SLOT_D; lz = gz - 3 * fz; }
  if (lx < -1 || lx > 1 || ly < -1 || ly > 1 || lz < -1 || lz > 1) return false;
  int v0 = lx, v1 = lz, v2 = -ly;                              // (i,j,k)
  slot = s; idx = (v0 + 1) + 3 * (v1 + 1) + 9 * (v2 + 1);
  return true;
}

// the in-cell grip axis u for the selected cubie (same view-space math as the rig firmware)
void gripAxis(int8_t &d, int8_t &sd, float u[3]) {
  int8_t va = SLOTS[selSlot].vAxis;
  int A[3], n = 0; for (int a = 0; a < 4; a++) if (a != va) A[n++] = a;   // 3 in-cube view axes
  int i, j, k; decodeVi(selIdx, i, j, k); int vi[3] = { i, j, k };
  int8_t vview[4] = { 0, 0, 0, 0 }; for (int t = 0; t < 3; t++) vview[A[t]] = vi[t];
  puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  int inAx[3], m = 0; for (int a = 0; a < 4; a++) if (a != d) inAx[m++] = a;
  for (int t = 0; t < 3; t++) {
    int s = 0; for (int kk = 0; kk < 4; kk++) s += puzzle.view4[kk][inAx[t]] * vview[kk];
    u[t] = (float)s;
  }
}

// ----------------------------------------------------------------- rotation menu (Wokwi joystick build; the rig uses face buttons instead)
struct MenuOpt { uint8_t kind; int8_t planeIdx, dir; float theta; char label[18]; };  // kind 0=plane 1=grip
MenuOpt menu[8]; uint8_t menuN = 0;

void buildMenu() {
  menuN = 0;
  if (isCentreCell(selSlot, selIdx)) return;
  int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  int8_t planes[3][2]; planesFor(d, planes);
  const char axc[4] = { 'X', 'Y', 'Z', 'W' };
  for (int p = 0; p < 3; p++) {
    for (int dir = 1; dir >= -1; dir -= 2) {
      MenuOpt &o = menu[menuN++]; o.kind = 0; o.planeIdx = p; o.dir = dir;
      snprintf(o.label, sizeof(o.label), "vlak %c%c %c90", axc[planes[p][0]], axc[planes[p][1]], dir > 0 ? '+' : '-');
    }
  }
  int nz = nzCount(selIdx);
  if (nz == 2) { MenuOpt &o = menu[menuN++]; o.kind = 1; o.theta = PI; strncpy(o.label, "ribbe-flip 180", sizeof(o.label)); }
  if (nz == 3) {
    MenuOpt &a = menu[menuN++]; a.kind = 1; a.theta =  2.0f * PI / 3.0f; strncpy(a.label, "hoek-spin +120", sizeof(a.label));
    MenuOpt &b = menu[menuN++]; b.kind = 1; b.theta = -2.0f * PI / 3.0f; strncpy(b.label, "hoek-spin -120", sizeof(b.label));
  }
  if (j3idx >= menuN) j3idx = 0;
}

// ============================================================================
//  LED rendering + the permutation-wave move animation
// ============================================================================
uint8_t  curKey[NPOS];          // colour-key currently shown per position
uint16_t gIdScan[NPOS];         // shared scratch for puzzle.scan() (used one-at-a-time)
// animation buffers
bool     animating = false;
uint32_t animStart = 0;
uint8_t  aOldKey[NPOS], aNewKey[NPOS], aPhase[NPOS];   // aPhase: 0..200, 255 = does not move
static uint8_t  posBefore[NPIECE * 4];                 // id -> position before the move

static inline CRGB keyColor(uint8_t key) {
  if (key >= 8) return CRGB::Black;
  return CRGB(CELL_RGB[key][0], CELL_RGB[key][1], CELL_RGB[key][2]);
}
static inline uint8_t lerp8(uint8_t a, uint8_t b, float t) { return (uint8_t)(a + (b - a) * t + 0.5f); }
static inline float ease(float k) { return k < 0.5f ? 2 * k * k : 1 - (( -2 * k + 2) * (-2 * k + 2)) / 2; }

// emissive-style brightness for the static picture: selected cell brightest, its cube mid, rest dim
uint8_t staticBrightness(int slot, int idx) {
  if (slot == selSlot) return idx == selIdx ? I_SEL : I_SELCUBE;
  return I_BASE;
}

// paint the current puzzle state straight onto the strip (scramble / reset / idle)
void renderStatic() {
  puzzle.scan(curKey, gIdScan);
  for (int slot = 0; slot < NSLOT; slot++)
    for (int idx = 0; idx < LEDS_PER_CUBE; idx++) {
      int pos = slot * LEDS_PER_CUBE + idx;
      CRGB c = keyColor(curKey[pos]);
      c.nscale8_video(staticBrightness(slot, idx));
      leds[pos] = c;
    }
}

// call BEFORE committing a move: snapshot colours + id->position
void captureBefore() {
  puzzle.scan(aOldKey, gIdScan);
  for (int i = 0; i < NPIECE * 4; i++) posBefore[i] = POS_NONE;
  for (int p = 0; p < NPOS; p++) if (gIdScan[p] != ID_NONE) posBefore[gIdScan[p]] = p;
}

// call AFTER committing a move: build the permutation wave (id survives, so we can diff)
// bit-packed flags to save SRAM (24 bytes each instead of 189) — see the memory note in engine.h
#define BITN ((NPOS + 7) / 8)
#define BGET(a, i) ((a)[(i) >> 3] & (1 << ((i) & 7)))
#define BSET(a, i) ((a)[(i) >> 3] |= (1 << ((i) & 7)))
void beginAnim() {
  puzzle.scan(aNewKey, gIdScan);
  for (int i = 0; i < NPOS; i++) aPhase[i] = 255;             // 255 = not moving
  static uint8_t nextPos[NPOS], incoming[BITN], visited[BITN];
  for (int i = 0; i < NPOS; i++) nextPos[i] = POS_NONE;
  memset(incoming, 0, BITN); memset(visited, 0, BITN);
  for (int p = 0; p < NPOS; p++) {
    uint16_t id = gIdScan[p]; if (id == ID_NONE) continue;
    uint8_t src = posBefore[id];
    if (src == POS_NONE || src == p) continue;
    nextPos[src] = p; BSET(incoming, p);
  }
  // walk each chain/cycle, hand every destination a phase in (0,1]. Two passes over nextPos
  // (measure length L, then assign) avoids storing the path[] — one less 189-byte buffer.
  for (int pass = 0; pass < 2; pass++)
    for (int start = 0; start < NPOS; start++) {
      if (nextPos[start] == POS_NONE || BGET(visited, start)) continue;
      if (pass == 0 && BGET(incoming, start)) continue;       // pass 0: chain heads first
      int L = 0, k = start;
      while (k != POS_NONE && !BGET(visited, k)) { BSET(visited, k); L++; k = nextPos[k]; }
      k = start;
      for (int i = 0; i < L; i++) {
        int dest = nextPos[k];
        if (dest != POS_NONE) aPhase[dest] = (uint8_t)(((i + 1) * 200) / L);
        k = dest;
        if (k == POS_NONE) break;
      }
    }
  animating = true; animStart = millis();
}

// render one animation frame; returns false when finished
bool renderAnim() {
  const float W = 0.55f, CF = 0.32f, SIG = 0.07f, WAVE_H = 1.25f;
  float k = (millis() - animStart) / (float)TWIST_MS; if (k > 1) k = 1;
  for (int pos = 0; pos < NPOS; pos++) {
    bool moves = aPhase[pos] != 255;
    float ph = moves ? aPhase[pos] / 200.0f : 0.0f;
    float center = ph * W;
    float cf = (k - center) / CF; if (cf < 0) cf = 0; if (cf > 1) cf = 1;
    CRGB a = keyColor(aOldKey[pos]), b = keyColor(aNewKey[pos]);
    float e = ease(cf);
    CRGB c(lerp8(a.r, b.r, e), lerp8(a.g, b.g, e), lerp8(a.b, b.b, e));
    // brightness: base + travelling wave bump; non-moving leds dim (spotlight)
    float inten = staticBrightness(pos / LEDS_PER_CUBE, pos % LEDS_PER_CUBE);
    if (moves) { float d = k - (center + CF * 0.4f); inten += WAVE_H * 60.0f * expf(-(d * d) / (2 * SIG * SIG)); }
    else inten *= 0.45f;
    if (inten > 255) inten = 255;
    c.nscale8_video((uint8_t)inten);
    leds[pos] = c;
  }
  return k < 1;
}

// ----------------------------------------------------------------- move actions
void doTwist(int planeIdx, int dir) {
  int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  captureBefore(); puzzle.twist(d, sd, planeIdx, dir); afterMove();
}
void doGrip(float theta) {
  int8_t d, sd; float u[3]; gripAxis(d, sd, u);
  captureBefore(); puzzle.grip(d, sd, u, theta); afterMove();
}
void afterMove() {
  if (scrambledOnce) moveCount++;
  solved = puzzle.isSolved();
  beginAnim();
}
void execMenu() {
  buildMenu(); if (menuN == 0) return;
  MenuOpt &o = menu[j3idx % menuN];
  if (o.kind == 0) doTwist(o.planeIdx, o.dir); else doGrip(o.theta);
}
// tap joystick A on an arm cube's centre cell -> that cube becomes central (4D rotation)
void press4D() {
  if (selSlot != SLOT_C && isCentreCell(selSlot, selIdx)) {
    int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
    captureBefore(); puzzle.centerCell(d, sd); selSlot = SLOT_C; selIdx = 13; beginAnim();
  }
}
void moveSel(int dx, int dy, int dz) {
  int gx, gy, gz; gcoord(selSlot, selIdx, gx, gy, gz);
  int8_t ns, ni;
  if (cellAt(gx + dx, gy + dy, gz + dz, ns, ni)) { selSlot = ns; selIdx = ni; j3idx = 0; }
}
void scrollMenu(int step) { buildMenu(); if (menuN) j3idx = (j3idx + step + menuN) % menuN; }

void doScramble() { puzzle.resetView(); puzzle.scramble(26); scrambledOnce = true; solved = false; moveCount = 0; selSlot = SLOT_C; selIdx = 13; j3idx = 0; renderStatic(); }
void doReset()    { puzzle.reset(); puzzle.resetView(); scrambledOnce = false; solved = true; moveCount = 0; selSlot = SLOT_C; selIdx = 13; j3idx = 0; renderStatic(); }

// ============================================================================
//  INPUT — analogue joysticks (latched) + debounced buttons
// ============================================================================
int axisDir(Axis &ax) {                 // returns -1 / 0 / +1, fires once per push
  int v = analogRead(ax.pin) - 512;
  if (!ax.latched && abs(v) > AX_DEAD) { ax.latched = true; return v > 0 ? 1 : -1; }
  if (abs(v) < AX_RECENTER) ax.latched = false;
  return 0;
}
Axis axAx = { JOYA_X }, axAy = { JOYA_Y }, axBy = { JOYB_Y }, axCy = { JOYC_Y };

bool pressed(Button &b) {               // true once on a clean press (active-low)
  bool down = digitalRead(b.pin) == LOW;
  bool fire = false;
  if (down != b.prev && millis() - b.tEdge > 25) { b.tEdge = millis(); if (down) fire = true; b.prev = down; }
  return fire;
}
Button bA = { JOYA_SW }, bB = { JOYB_SW }, bC = { JOYC_SW }, bScr = { BTN_SCRAMBLE }, bRst = { BTN_RESET };

// ============================================================================
//  OLED HUD (mirrors the notation screen in the simulator)
// ============================================================================
void drawHUD() {
  oled.clearDisplay();
  oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE);
  int gx, gy, gz; gcoord(selSlot, selIdx, gx, gy, gz);
  int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  int cellKey = colorKey(d, sd);
  oled.setCursor(0, 0);
  oled.print('('); oled.print(gx); oled.print(','); oled.print(gy); oled.print(','); oled.print(gz); oled.print(") ");
  oled.print(CELL_LABEL[cellKey]);
  oled.setCursor(0, 10); oled.print(SLOTS[selSlot].nl); oled.print(" / "); oled.print(POS_LABEL[nzCount(selIdx)]);
  oled.drawFastHLine(0, 20, 128, SSD1306_WHITE);

  buildMenu();
  if (isCentreCell(selSlot, selIdx)) {
    oled.setCursor(0, 24);
    if (selSlot == SLOT_C) oled.print("centrale cel 0'");
    else { oled.print("centrale cel"); oled.setCursor(0, 34); oled.print("druk A = 4D-rotatie"); }
  } else {
    int top = j3idx >= 3 ? j3idx - 2 : 0;                  // simple scroll window
    for (int r = 0; r < 3 && top + r < menuN; r++) {
      int i = top + r; oled.setCursor(0, 24 + r * 10);
      oled.print(i == j3idx ? '>' : ' '); oled.print(' '); oled.print(menu[i].label);
    }
  }
  oled.setCursor(0, 56);
  oled.print(solved ? "opgelost" : "bezig"); oled.print("  z:"); oled.print(moveCount);
  oled.display();
}

// ============================================================================
//  SETUP / LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  pinMode(JOYA_SW, INPUT_PULLUP); pinMode(JOYB_SW, INPUT_PULLUP); pinMode(JOYC_SW, INPUT_PULLUP);
  pinMode(BTN_SCRAMBLE, INPUT_PULLUP); pinMode(BTN_RESET, INPUT_PULLUP);
  randomSeed(analogRead(A8) ^ micros());

  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NLED).setCorrection(TypicalLEDStrip);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, FASTLED_MAX_MA);   // comfort/thermal target (software); the fuse + PSU are the real protection
  FastLED.setBrightness(LED_BRIGHTNESS);

  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println(F("OLED niet gevonden (adres 0x3C?)"));
  oled.clearDisplay(); oled.display();

  printWiringChart();    // one-time solder map over Serial (115200 baud) — see BEDRADING.md
  renderStatic(); FastLED.show(); drawHUD();
}

void loop() {
  // 1) animation has priority: while a turn is sweeping, ignore input
  if (animating) {
    if (!renderAnim()) { animating = false; renderStatic(); }
    FastLED.show();
    static uint32_t lastHud = 0; if (millis() - lastHud > 120) { drawHUD(); lastHud = millis(); }
    return;
  }

  bool dirty = false;
  // 2) navigation — joystick A (horizontal), joystick B (vertical)
  int ax = axisDir(axAx), ay = axisDir(axAy);
  if (ax) { moveSel(ax > 0 ? 1 : -1, 0, 0); dirty = true; }       // east / west
  else if (ay) { moveSel(0, ay > 0 ? 1 : -1, 0); dirty = true; }  // north / south
  int bz = axisDir(axBy);
  if (bz) { moveSel(0, 0, bz > 0 ? 1 : -1); dirty = true; }       // up / down
  // 3) joystick C tilt scrolls the rotation menu
  int cz = axisDir(axCy);
  if (cz) { scrollMenu(cz > 0 ? -1 : 1); dirty = true; }

  // 4) buttons
  if (pressed(bA)) { press4D(); dirty = true; }                  // 4D rotation
  if (pressed(bC)) { execMenu(); }                               // execute the highlighted turn
  if (pressed(bB)) { if (puzzle.undo()) { solved = puzzle.isSolved(); renderStatic(); FastLED.show(); } }
  if (pressed(bScr)) doScramble();
  if (pressed(bRst)) doReset();

  if (dirty && !animating) { renderStatic(); }
  FastLED.show();
  // refresh the OLED on change, otherwise at a calm cadence (I²C writes are slow)
  static uint32_t lastHud = 0;
  if (dirty || millis() - lastHud > 150) { drawHUD(); lastHud = millis(); }
}
