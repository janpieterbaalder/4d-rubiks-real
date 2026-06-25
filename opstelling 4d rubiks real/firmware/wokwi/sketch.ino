/* ============================================================================
   sketch.ino — WOKWI LOGIC-TEST variant (PS3-layout nagebootst met losse onderdelen).
   ----------------------------------------------------------------------------
   This is the *Wokwi* build. Wokwi cannot simulate a USB host / PS3 controller,
   so this variant rebuilds the SAME control surface as the wireless rig out of
   parts Wokwi *can* simulate: two analog sticks + a D-pad + four face buttons +
   SELECT/START. The mapping, the as-native navigation and the "arm a plane, then
   give a direction" rotation model are now IDENTICAL to ../tesseract_rig.ino and
   to the 3D bench (hardware.html) — only the wireless link is faked. So what you
   verify here about colours, addressing AND the controls now matches the rig 1:1.

   Both sketches share the SAME tesseract_engine.h (the single source of truth for
   the math + the LED solder map). The puzzle MATH lives there (a 1:1 port of the
   verified engine.js), so a turn behaves exactly like the game and the simulator.

   NOTHING MOVES MECHANICALLY — a "turn" only changes LED COLOURS. The eye reads the
   turn from a bright wave that sweeps along the real permutation cycle (same trick as
   the rig), so you can follow it even on a solved (single-colour) cube.

   ---- LIBRARIES (install via Arduino IDE → Library Manager) ------------------
     FastLED                         (LED driver + automatic power limiting)
     Adafruit SSD1306 + Adafruit GFX (OLED status HUD — handy in the sim; the real
                                      rig has no OLED, the 189 LEDs are the display)
   Wire.h and the engine header come with the sketch.

   ---- WIRING (see diagram.json + BEDRADING.md) ------------------------------
     LED data    : pin 6  -> 330Ω -> DIN of LED #0   (5V data, no level shifter on Mega)
     L-stick     : VRx A0, SW pin 22   (X = rotation direction −/+ ; press L3 = 4D rotation)
     R-stick     : VRy A3, SW pin 23   (Y = up/down cube U/D       ; press R3 = undo)
     D-pad       : N pin 30, S pin 31, W pin 32, E pin 33   (ground plane: x and z)
     Face buttons: □ pin 34, ✕ pin 35, ○ pin 36, △ pin 37   (vlak XY / YZ / XZ / grip)
     SELECT/START: pin 26 (husselen) / pin 28 (reset)
     OLED        : SDA 20, SCL 21 (I²C, addr 0x3C)
     Power       : separate 5V supply -> LEDs (+ a 1000µF cap and common GND with the Mega)

   ---- CONTROLLER MAPPING (mirrors ../tesseract_rig.ino / hardware.html) ------
     D-pad ▲▼◀▶          : move the selection N/S/W/E (ground plane: x and z)
     R-stick ▲ / ▼       : move to the up- / down-cube (U/D, the y-axis)
     R-stick press (R3)  : undo
     L-stick ◀ / ▶       : rotation direction (−/+); hold it, then tap a face button
     L-stick press (L3)  : 4D rotation (on an arm-cube's centre cell)
     △ / □ / ○ / ✕       : grip / plane 0 (XY) / plane 2 (XZ) / plane 1 (YZ)
     SELECT / START      : husselen / reset
   ========================================================================== */
#include <FastLED.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "tesseract_engine.h"

// ----------------------------------------------------------------- pins
#define LED_PIN        6
#define LSTICK_X       A0       // rotation direction (−/+)
#define LSTICK_SW      22       // L3 = 4D rotation
#define RSTICK_Y       A3       // up/down cube (U/D)
#define RSTICK_SW      23       // R3 = undo
#define BTN_N          30       // D-pad ▲  (achter, z−)
#define BTN_S          31       // D-pad ▼  (voor,   z+)
#define BTN_W          32       // D-pad ◀  (links,  x−)
#define BTN_E          33       // D-pad ▶  (rechts, x+)
#define BTN_SQUARE     34       // □  vlak 0 (XY)
#define BTN_CROSS      35       // ✕  vlak 1 (YZ)
#define BTN_CIRCLE     36       // ○  vlak 2 (XZ)
#define BTN_TRIANGLE   37       // △  grip (ribbe 180° / hoek ±120°)
#define BTN_SELECT     26       // husselen
#define BTN_START      28       // reset

// ----------------------------------------------------------------- tuning
#define FASTLED_MAX_MA 6000     // FastLED software brightness-scaling target — NOT a hardware fuse (see BEDRADING.md §4)
#define LED_BRIGHTNESS 200      // global master brightness 0..255
#define TWIST_MS       1500UL   // duration of one turn's colour sweep
#define AX_DEAD        240      // joystick dead-zone around centre (0..1023, centre ~512)

// brightness levels (emissive feel) for the static display
#define I_BASE     60           // other cubes
#define I_SELCUBE  110          // the selected cube
#define I_SEL      235          // the selected cell

// ----------------------------------------------------------------- objects
CRGB leds[NLED];
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Tesseract puzzle;

// Named PadButton (not Button) to dodge FastLED 3.9's global fl::Button, and forward-declared here —
// before the first function — so Arduino's auto-prototype generator emits a valid prototype for
// pressed(PadButton&). The full struct + the pressed() helper live in the INPUT section below.
struct PadButton;

// ----------------------------------------------------------------- per-slot tables (as-native, identical to ../tesseract_rig.ino)
// view axis/sign used by viewToLogical, and the cube's global-coordinate centre. The centre uses the
// as-native scheme: engine X→x, Y→y, Z→z (so U is +y, F is +z, etc.) — exactly like the rig + bench.
struct SlotInfo { int8_t vAxis, vSign; int8_t cx, cy, cz; const char *nl; };
const SlotInfo SLOTS[NSLOT] = {
  /* C */ { AX_W, -1,  0,  0,  0, "midden" },
  /* R */ { AX_X, +1,  3,  0,  0, "rechts" },
  /* L */ { AX_X, -1, -3,  0,  0, "links"  },
  /* U */ { AX_Y, +1,  0,  3,  0, "boven"  },
  /* D */ { AX_Y, -1,  0, -3,  0, "onder"  },
  /* F */ { AX_Z, +1,  0,  0,  3, "voor"   },
  /* B */ { AX_Z, -1,  0,  0, -3, "achter" },
};
const char *CELL_LABEL[8] = { "Right", "Left", "Top", "Bottom", "Front", "Back", "Outer", "Inner" };
const char *POS_LABEL[4]  = { "kern", "vlak", "rand", "hoek" };
const char  AXC[4]        = { 'X', 'Y', 'Z', 'W' };

// ----------------------------------------------------------------- state
int8_t selSlot = SLOT_C, selIdx = 13;   // 13 = centre cubie of cube C
bool scrambledOnce = false, solved = true;
uint16_t moveCount = 0;

// rotation interaction (port of ../tesseract_rig.ino / hardware.js): a plane is "armed" by a face
// button and fired by a direction, OR a held direction + a face button fires immediately.
int8_t armDir   = 0;    // -1 / +1 / 0 — rotation direction currently held on the L-stick
int8_t armPlane = -1;   // 0/1/2 = plane, 3 = grip, -1 = none armed
int8_t lStickState = 0; // hysteresis latch for the L-stick X (direction)
int8_t rStickState = 0; // hysteresis latch for the R-stick Y (U/D movement)

// ----------------------------------------------------------------- helpers (port of ../tesseract_rig.ino)
void decodeVi(int idx, int &i, int &j, int &k) { i = (idx % 3) - 1; j = ((idx / 3) % 3) - 1; k = (idx / 9) - 1; }
int  nzCount(int idx) { int i, j, k; decodeVi(idx, i, j, k); return (i != 0) + (j != 0) + (k != 0); }
bool isCentreCell(int slot, int idx) { return slot != -1 && idx == 13; }

// global lattice coord of (slot,idx) = cube centre + the physical ORIENT offset (as-native).
void gcoord(int slot, int idx, int &gx, int &gy, int &gz) {
  int8_t ox, oy, oz; orientOf(slot, idx, ox, oy, oz);     // engine.h solder-map offset, in {-1,0,1}
  gx = SLOTS[slot].cx + ox; gy = SLOTS[slot].cy + oy; gz = SLOTS[slot].cz + oz;
}

// inverse of ORIENT per cube: a physical (x,y,z) offset inside a cube -> in-cube (i,j,k).
// Mirrors ORIENT_INV in hardware.js (the exact inverse of orientOf in tesseract_engine.h).
void orientInv(int slot, int x, int y, int z, int &i, int &j, int &k) {
  switch (slot) {
    case SLOT_C: i =  x; j =  y; k =  z; break;   // ORIENT.C = [i,j,k]
    case SLOT_R: i =  y; j =  z; k =  x; break;   // ORIENT.R = [k,i,j]
    case SLOT_L: i =  y; j =  z; k = -x; break;   // ORIENT.L = [-k,i,j]
    case SLOT_U: i =  x; j =  z; k =  y; break;   // ORIENT.U = [i,k,j]
    case SLOT_D: i =  x; j =  z; k = -y; break;   // ORIENT.D = [i,-k,j]
    case SLOT_F: i =  x; j =  y; k =  z; break;   // ORIENT.F = [i,j,k]
    case SLOT_B: i =  x; j =  y; k = -z; break;   // ORIENT.B = [i,j,-k]
  }
}
// inverse: global (gx,gy,gz) -> slot/idx, or returns false if no cell there. Arm axes match the
// physical layout: R/L on x, U/D on y, F/B on z (same as hardware.js cellAt).
bool cellAt(int gx, int gy, int gz, int8_t &slot, int8_t &idx) {
  auto farf = [](int a) -> int { return a >= 2 ? 1 : (a <= -2 ? -1 : 0); };
  int fx = farf(gx), fy = farf(gy), fz = farf(gz);
  if (abs(fx) + abs(fy) + abs(fz) > 1) return false;            // diagonal: not inside one cube
  int s = SLOT_C;
  if (fx)      s = fx > 0 ? SLOT_R : SLOT_L;
  else if (fy) s = fy > 0 ? SLOT_U : SLOT_D;
  else if (fz) s = fz > 0 ? SLOT_F : SLOT_B;
  int i, j, k;
  orientInv(s, gx - SLOTS[s].cx, gy - SLOTS[s].cy, gz - SLOTS[s].cz, i, j, k);
  if (i < -1 || i > 1 || j < -1 || j > 1 || k < -1 || k > 1) return false;
  slot = s; idx = (i + 1) + 3 * (j + 1) + 9 * (k + 1);
  return true;
}

// the in-cell grip axis u for the selected cubie (port of ../tesseract_rig.ino gripAxis). Works purely
// in view/logical space, so it is independent of the global navigation scheme.
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

// label of plane `p` for the currently selected cell (e.g. "XY", "YW"), for the OLED HUD
void planeLabel(int p, char out[3]) {
  out[0] = out[1] = '?'; out[2] = 0;
  int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  int8_t planes[3][2]; planesFor(d, planes);
  out[0] = AXC[planes[p][0]]; out[1] = AXC[planes[p][1]];
}

// ============================================================================
//  LED rendering + the permutation-wave move animation  (unchanged from the rig twin)
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

// ----------------------------------------------------------------- move actions (port of ../tesseract_rig.ino)
void afterMove() {
  if (scrambledOnce) moveCount++;
  solved = puzzle.isSolved();
  beginAnim();
}
void doTwist(int planeIdx, int dir) {
  int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  captureBefore(); puzzle.twist(d, sd, planeIdx, dir); afterMove();
}
void doGrip(float theta) {
  int8_t d, sd; float u[3]; gripAxis(d, sd, u);
  captureBefore(); puzzle.grip(d, sd, u, theta); afterMove();
}

// a rotation = a plane (or grip) combined with a direction (port of hardware.js execRotation)
void execRotation(int plane, int dir) {
  if (isCentreCell(selSlot, selIdx)) return;
  if (plane == 3) {                                   // grip
    int nz = nzCount(selIdx);
    if (nz == 2) doGrip(PI);                          // edge: 180° (its own inverse)
    else if (nz == 3) doGrip(dir * 2.0f * PI / 3.0f); // corner: ±120°
  } else {
    doTwist(plane, dir);                              // plane 0/1/2: always valid for a non-centre cell
  }
}
void setDir(int d) { armDir = d; if (armPlane != -1) { execRotation(armPlane, d); armPlane = -1; } }
void clearDir(int d) { if (armDir == d) armDir = 0; }
void pressPlane(int p) {
  if (isCentreCell(selSlot, selIdx)) return;
  if (p == 3) { int nz = nzCount(selIdx); if (nz != 2 && nz != 3) return; }  // grip only on edge/corner
  if (armDir != 0) execRotation(p, armDir);          // direction already held -> rotate now
  else armPlane = (armPlane == p ? -1 : p);          // else arm the plane, wait for a direction
}

// tap L-stick (L3) on an arm cube's centre cell -> that cube becomes central (4D rotation)
void press4D() {
  if (selSlot != SLOT_C && isCentreCell(selSlot, selIdx)) {
    int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
    captureBefore(); puzzle.centerCell(d, sd); selSlot = SLOT_C; selIdx = 13; armPlane = -1; beginAnim();
  }
}
void doUndo() {
  captureBefore();
  if (puzzle.undo()) { solved = puzzle.isSolved(); beginAnim(); }
}
void moveSel(int dx, int dy, int dz) {
  int gx, gy, gz; gcoord(selSlot, selIdx, gx, gy, gz);
  int8_t ns, ni;
  if (cellAt(gx + dx, gy + dy, gz + dz, ns, ni)) { selSlot = ns; selIdx = ni; armPlane = -1; }
}
void doScramble() { puzzle.resetView(); puzzle.scramble(26); scrambledOnce = true; solved = false; moveCount = 0; selSlot = SLOT_C; selIdx = 13; armPlane = -1; renderStatic(); }
void doReset()    { puzzle.reset(); puzzle.resetView(); scrambledOnce = false; solved = true; moveCount = 0; selSlot = SLOT_C; selIdx = 13; armPlane = -1; renderStatic(); }

// ============================================================================
//  INPUT — two analog sticks (latched) + debounced buttons
// ============================================================================
struct PadButton { uint8_t pin; bool prev; uint32_t tEdge; };
bool pressed(PadButton &b) {               // true once on a clean press (active-low)
  bool down = digitalRead(b.pin) == LOW;
  bool fire = false;
  if (down != b.prev && millis() - b.tEdge > 25) { b.tEdge = millis(); if (down) fire = true; b.prev = down; }
  return fire;
}
PadButton bN = { BTN_N }, bS = { BTN_S }, bW = { BTN_W }, bE = { BTN_E };
PadButton bSquare = { BTN_SQUARE }, bCross = { BTN_CROSS }, bCircle = { BTN_CIRCLE }, bTriangle = { BTN_TRIANGLE };
PadButton bL3 = { LSTICK_SW }, bR3 = { RSTICK_SW }, bSelect = { BTN_SELECT }, bStart = { BTN_START };

// L-stick X = held rotation direction (−/+). It is a LEVEL (held), so we act on each change of
// the dead-zoned state: enter ±X arms a direction (and fires an armed plane), return to centre clears it.
void readDirectionStick() {
  int lx = analogRead(LSTICK_X) - 512;                // 0..1023, centre ~512
  int dir = (lx < -AX_DEAD) ? -1 : (lx > AX_DEAD) ? +1 : 0;
  if (dir != lStickState) {
    if (lStickState != 0) clearDir(lStickState);
    if (dir != 0) setDir(dir);
    lStickState = dir;
  }
}
// R-stick Y = move to the up-/down-cube. One move per push: fires on the threshold crossing, then
// needs a return to centre before it can fire again (the dead-zoned state must change).
// NB: if up/down feels inverted in the sim, swap the two signs below — it's just the stick polarity.
bool readVerticalStick() {
  int ry = analogRead(RSTICK_Y) - 512;
  int dir = (ry > AX_DEAD) ? +1 : (ry < -AX_DEAD) ? -1 : 0;   // up = +y (U), down = −y (D)
  bool moved = false;
  if (dir != rStickState) {
    if (dir == +1)      { moveSel(0,  1, 0); moved = true; }   // U (boven)
    else if (dir == -1) { moveSel(0, -1, 0); moved = true; }   // D (onder)
    rStickState = dir;
  }
  return moved;
}

// ============================================================================
//  OLED HUD (status; the real rig has no OLED — the 189 LEDs are the display)
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

  oled.setCursor(0, 24);
  if (isCentreCell(selSlot, selIdx)) {
    if (selSlot == SLOT_C) oled.print("centrale cel 0'");
    else { oled.print("centrale cel"); oled.setCursor(0, 34); oled.print("L3 = 4D-rotatie"); }
  } else {
    // show the armed plane + held direction (the "arm a plane, give a direction" model)
    oled.print("vlak: ");
    if (armPlane == -1) oled.print("(geen)");
    else if (armPlane == 3) oled.print(nzCount(selIdx) == 2 ? "grip 180" : "grip 120");
    else { char lab[3]; planeLabel(armPlane, lab); oled.print(lab); }
    oled.setCursor(0, 34); oled.print("richting: ");
    oled.print(armDir == 0 ? "-" : (armDir > 0 ? "+ (rechts)" : "- (links)"));
    oled.setCursor(0, 44); oled.print("face=armeer  stick=draai");
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
  pinMode(LSTICK_SW, INPUT_PULLUP); pinMode(RSTICK_SW, INPUT_PULLUP);
  pinMode(BTN_N, INPUT_PULLUP); pinMode(BTN_S, INPUT_PULLUP); pinMode(BTN_W, INPUT_PULLUP); pinMode(BTN_E, INPUT_PULLUP);
  pinMode(BTN_SQUARE, INPUT_PULLUP); pinMode(BTN_CROSS, INPUT_PULLUP);
  pinMode(BTN_CIRCLE, INPUT_PULLUP); pinMode(BTN_TRIANGLE, INPUT_PULLUP);
  pinMode(BTN_SELECT, INPUT_PULLUP); pinMode(BTN_START, INPUT_PULLUP);
  randomSeed(analogRead(A8) ^ micros());

  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NLED).setCorrection(TypicalLEDStrip);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, FASTLED_MAX_MA);   // comfort/thermal target (software); the fuse + PSU are the real protection
  FastLED.setBrightness(LED_BRIGHTNESS);

  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println(F("OLED niet gevonden (adres 0x3C?)"));
  oled.clearDisplay(); oled.display();

  printWiringChart();    // one-time solder map over Serial (115200 baud) — see BEDRADING.md
  Serial.print(F("Vrij SRAM na init (byte): ")); Serial.println(freeRam());   // Mega heeft 8192; houd ruime marge
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
  // 2) navigation — D-pad (ground plane x/z) + R-stick vertical (y)
  if (pressed(bN)) { moveSel( 0, 0, -1); dirty = true; }   // N (achter)
  if (pressed(bS)) { moveSel( 0, 0,  1); dirty = true; }   // S (voor)
  if (pressed(bW)) { moveSel(-1, 0,  0); dirty = true; }   // W (links)
  if (pressed(bE)) { moveSel( 1, 0,  0); dirty = true; }   // E (rechts)
  if (readVerticalStick()) dirty = true;                    // U / D (boven / onder)

  // 3) rotation — L-stick direction (held) + face buttons (planes / grip)
  readDirectionStick();
  if (pressed(bSquare))   { pressPlane(0); dirty = true; }  // vlak XY
  if (pressed(bCross))    { pressPlane(1); dirty = true; }  // vlak YZ
  if (pressed(bCircle))   { pressPlane(2); dirty = true; }  // vlak XZ
  if (pressed(bTriangle)) { pressPlane(3); dirty = true; }  // grip (ribbe 180° / hoek ±120°)

  // 4) actions
  if (pressed(bL3))     { press4D();    dirty = true; }     // 4D rotation
  if (pressed(bR3))     { doUndo();     dirty = true; }     // undo
  if (pressed(bSelect)) { doScramble(); dirty = true; }     // husselen
  if (pressed(bStart))  { doReset();    dirty = true; }     // reset

  if (dirty && !animating) { renderStatic(); }
  FastLED.show();
  // refresh the OLED on change, otherwise at a calm cadence (I²C writes are slow)
  static uint32_t lastHud = 0;
  if (dirty || millis() - lastHud > 150) { drawHUD(); lastHud = millis(); }
}
