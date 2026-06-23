/* ============================================================================
   esp32_bluepad32.ino — RECOMMENDED firmware for the physical 4D-Rubiks rig.
   ----------------------------------------------------------------------------
   ESP32 (any dev board with built-in Bluetooth Classic) + Bluepad32. Drives 189
   WS2812B LEDs (7 cubes × 27) and reads a WIRELESS gamepad (PS3 / PS4 / PS5 /
   Xbox / 8BitDo / Switch Pro …) over the ESP32's OWN Bluetooth — no USB Host
   Shield, no dongle. The puzzle MATH lives in tesseract_engine.h (a 1:1 port of
   the verified engine.js), so a turn behaves exactly like the game, the 3D bench
   (hardware.html), the Wokwi testbench and the Mega rig.

   WHY THIS IS THE PREFERRED BUILD (over ../tesseract_rig.ino on a Mega):
     • RAM:   ESP32 has ~320 KB free DRAM; the engine + buffers (~5 KB) and the
              Bluepad32/BTstack are never close to the limit. The Mega's 8 KB is
              tight (and the PS3BT variant was never memory-tested).
     • Timing: FastLED drives WS2812 through the ESP32 RMT peripheral (hardware
              timing), so showing 189 LEDs does NOT block Bluetooth — the AVR's
              "interrupts off ~6 ms during show()" problem disappears.
     • Wiring: built-in BT means no USB Host Shield + dongle; just a 3.3V→5V level
              shifter on the data line (see README-esp32.md / BEDRADING.md).

   NOTHING MOVES MECHANICALLY — a "turn" only changes LED COLOURS. The eye reads the
   turn from a bright wave that sweeps along the real permutation cycle (same trick as
   the bench), so you can follow it even on a solved (single-colour) cube.

   The input layer mirrors the on-screen controller widget in hardware.html and the
   Mega rig 1:1: same as-native navigation (engine X→x, Y→y, Z→z) and the same
   "arm a plane, then give a direction" rotation model.

   ---- LIBRARIES / BOARD ------------------------------------------------------
     Bluepad32 (install the "ESP32 Bluepad32" board package — see README-esp32.md)
     FastLED   (Library Manager)
     tesseract_engine.h ships with the rig — COPY it into THIS sketch folder
       (Arduino compiles a folder; the header must sit next to this .ino).

   ---- WIRING (see README-esp32.md + BEDRADING.md) ---------------------------
     LED data  : GPIO 13 -> 74AHCT125 (3.3V->5V level shifter) -> 330Ω -> DIN of LED #0
     Power     : separate 5V supply -> LEDs (+ 1000µF cap, common GND with the ESP32);
                 feed the ESP32 board via its 5V/VIN pin (its regulator makes 3.3V).
     Level shifter: VCC = 5V, GND shared with ESP32; input accepts the 3.3V GPIO.

   ---- CONTROLLER MAPPING (mirrors hardware.html / ../tesseract_rig.ino) ------
     D-pad ▲▼◀▶          : move the selection N/S/W/E (ground plane: x and z)
     R-stick ▲ / ▼       : move to the up- / down-cube (U/D, the y-axis)
     R-stick press (R3)  : undo
     L-stick ◀ / ▶       : rotation direction (−/+); hold it, then tap a face button
     L-stick press (L3)  : 4D rotation (on an arm-cube's centre cell)
     △ / □ / ○ / ✕       : grip / plane 0 (XY) / plane 2 (XZ) / plane 1 (YZ)
     SELECT / START      : husselen / reset
   (Arm a plane with a face button, then push a direction — or hold a direction and
    tap a face button. Either order rotates, exactly like the bench.)

   ---- PAIRING ---------------------------------------------------------------
   DS4 / DS5 / Xbox / 8BitDo / Switch Pro: just put the controller in pairing mode
   (DS4: Share + PS held until the bar double-flashes) and it connects. A DualShock 3
   needs its "master" Bluetooth address set to THIS ESP32's MAC once (the firmware
   prints the MAC at boot; use sixaxispairtool / SixaxisPairer) — same idea as the
   Mega's SetBdaddr step. Wokwi cannot simulate Bluetooth: logic-test with
   firmware/wokwi/sketch.ino.
   ========================================================================== */
#include <Bluepad32.h>
#include <FastLED.h>
#include "tesseract_engine.h"

// ----------------------------------------------------------------- pins
#define LED_PIN        13       // WS2812 data via a 3.3V->5V level shifter + 330Ω

// ----------------------------------------------------------------- tuning
#define FASTLED_MAX_MA 6000     // FastLED software brightness-scaling target — NOT a hardware fuse (see BEDRADING.md §4)
#define LED_BRIGHTNESS 200      // global master brightness 0..255
#define TWIST_MS       1500UL   // duration of one turn's colour sweep
#define ANALOG_DEAD    128      // gamepad analog-stick dead-zone (Bluepad32 axes are −512..511)

// D-pad bit values (Bluepad32 standard)
enum { DP_UP = 0x01, DP_DOWN = 0x02, DP_RIGHT = 0x04, DP_LEFT = 0x08 };

// brightness levels (emissive feel) for the static display
#define I_BASE     60           // other cubes
#define I_SELCUBE  110          // the selected cube
#define I_SEL      235          // the selected cell

// ----------------------------------------------------------------- objects
CRGB leds[NLED];
Tesseract puzzle;
ControllerPtr gPad = nullptr;   // the single active gamepad

// ----------------------------------------------------------------- per-slot tables (as-native, identical to ../tesseract_rig.ino)
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

// ----------------------------------------------------------------- state
int8_t selSlot = SLOT_C, selIdx = 13;   // 13 = centre cubie of cube C
bool scrambledOnce = false, solved = true;
uint16_t moveCount = 0;

// rotation interaction (port of ../tesseract_rig.ino / hardware.js)
int8_t armDir   = 0;    // -1 / +1 / 0 — rotation direction currently held on the L-stick
int8_t armPlane = -1;   // 0/1/2 = plane, 3 = grip, -1 = none armed
int8_t lStickState = 0; // hysteresis latch for the L-stick X (direction)
int8_t rStickState = 0; // hysteresis latch for the R-stick Y (U/D movement)

// previous button state for clean rising-edge detection (Bluepad32 gives current state each update)
struct PadPrev { bool up, down, left, right, sq, cr, ci, tr, l3, r3, sel, sta; } prev = {};

// ----------------------------------------------------------------- helpers (port of ../tesseract_rig.ino)
void decodeVi(int idx, int &i, int &j, int &k) { i = (idx % 3) - 1; j = ((idx / 3) % 3) - 1; k = (idx / 9) - 1; }
int  nzCount(int idx) { int i, j, k; decodeVi(idx, i, j, k); return (i != 0) + (j != 0) + (k != 0); }
bool isCentreCell(int slot, int idx) { return slot != -1 && idx == 13; }

// global lattice coord of (slot,idx) = cube centre + the physical ORIENT offset (as-native).
void gcoord(int slot, int idx, int &gx, int &gy, int &gz) {
  int8_t ox, oy, oz; orientOf(slot, idx, ox, oy, oz);
  gx = SLOTS[slot].cx + ox; gy = SLOTS[slot].cy + oy; gz = SLOTS[slot].cz + oz;
}

// inverse of ORIENT per cube: a physical (x,y,z) offset inside a cube -> in-cube (i,j,k).
void orientInv(int slot, int x, int y, int z, int &i, int &j, int &k) {
  switch (slot) {
    case SLOT_C: i =  x; j =  y; k =  z; break;
    case SLOT_R: i =  y; j =  z; k =  x; break;
    case SLOT_L: i =  y; j =  z; k = -x; break;
    case SLOT_U: i =  x; j =  z; k =  y; break;
    case SLOT_D: i =  x; j =  z; k = -y; break;
    case SLOT_F: i =  x; j =  y; k =  z; break;
    case SLOT_B: i =  x; j =  y; k = -z; break;
  }
}
// inverse: global (gx,gy,gz) -> slot/idx, or returns false if no cell there.
bool cellAt(int gx, int gy, int gz, int8_t &slot, int8_t &idx) {
  auto farf = [](int a) -> int { return a >= 2 ? 1 : (a <= -2 ? -1 : 0); };
  int fx = farf(gx), fy = farf(gy), fz = farf(gz);
  if (abs(fx) + abs(fy) + abs(fz) > 1) return false;
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

// the in-cell grip axis u for the selected cubie (port of ../tesseract_rig.ino gripAxis).
void gripAxis(int8_t &d, int8_t &sd, float u[3]) {
  int8_t va = SLOTS[selSlot].vAxis;
  int A[3], n = 0; for (int a = 0; a < 4; a++) if (a != va) A[n++] = a;
  int i, j, k; decodeVi(selIdx, i, j, k); int vi[3] = { i, j, k };
  int8_t vview[4] = { 0, 0, 0, 0 }; for (int t = 0; t < 3; t++) vview[A[t]] = vi[t];
  puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  int inAx[3], m = 0; for (int a = 0; a < 4; a++) if (a != d) inAx[m++] = a;
  for (int t = 0; t < 3; t++) {
    int s = 0; for (int kk = 0; kk < 4; kk++) s += puzzle.view4[kk][inAx[t]] * vview[kk];
    u[t] = (float)s;
  }
}

// ============================================================================
//  LED rendering + the permutation-wave move animation  (identical to the Mega rig)
// ============================================================================
uint8_t  curKey[NPOS];
uint16_t gIdScan[NPOS];
bool     animating = false;
uint32_t animStart = 0;
uint8_t  aOldKey[NPOS], aNewKey[NPOS], aPhase[NPOS];   // aPhase: 0..200, 255 = does not move
static uint8_t  posBefore[NPIECE * 4];

static inline CRGB keyColor(uint8_t key) {
  if (key >= 8) return CRGB::Black;
  return CRGB(CELL_RGB[key][0], CELL_RGB[key][1], CELL_RGB[key][2]);
}
static inline uint8_t lerp8(uint8_t a, uint8_t b, float t) { return (uint8_t)(a + (b - a) * t + 0.5f); }
static inline float ease(float k) { return k < 0.5f ? 2 * k * k : 1 - (( -2 * k + 2) * (-2 * k + 2)) / 2; }

uint8_t staticBrightness(int slot, int idx) {
  if (slot == selSlot) return idx == selIdx ? I_SEL : I_SELCUBE;
  return I_BASE;
}

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

void captureBefore() {
  puzzle.scan(aOldKey, gIdScan);
  for (int i = 0; i < NPIECE * 4; i++) posBefore[i] = POS_NONE;
  for (int p = 0; p < NPOS; p++) if (gIdScan[p] != ID_NONE) posBefore[gIdScan[p]] = p;
}

#define BITN ((NPOS + 7) / 8)
#define BGET(a, i) ((a)[(i) >> 3] & (1 << ((i) & 7)))
#define BSET(a, i) ((a)[(i) >> 3] |= (1 << ((i) & 7)))
void beginAnim() {
  puzzle.scan(aNewKey, gIdScan);
  for (int i = 0; i < NPOS; i++) aPhase[i] = 255;
  static uint8_t nextPos[NPOS], incoming[BITN], visited[BITN];
  for (int i = 0; i < NPOS; i++) nextPos[i] = POS_NONE;
  memset(incoming, 0, BITN); memset(visited, 0, BITN);
  for (int p = 0; p < NPOS; p++) {
    uint16_t id = gIdScan[p]; if (id == ID_NONE) continue;
    uint8_t src = posBefore[id];
    if (src == POS_NONE || src == p) continue;
    nextPos[src] = p; BSET(incoming, p);
  }
  for (int pass = 0; pass < 2; pass++)
    for (int start = 0; start < NPOS; start++) {
      if (nextPos[start] == POS_NONE || BGET(visited, start)) continue;
      if (pass == 0 && BGET(incoming, start)) continue;
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
void execRotation(int plane, int dir) {
  if (isCentreCell(selSlot, selIdx)) return;
  if (plane == 3) {
    int nz = nzCount(selIdx);
    if (nz == 2) doGrip(PI);
    else if (nz == 3) doGrip(dir * 2.0f * PI / 3.0f);
  } else {
    doTwist(plane, dir);
  }
}
void setDir(int d) { armDir = d; if (armPlane != -1) { execRotation(armPlane, d); armPlane = -1; } }
void clearDir(int d) { if (armDir == d) armDir = 0; }
void pressPlane(int p) {
  if (isCentreCell(selSlot, selIdx)) return;
  if (p == 3) { int nz = nzCount(selIdx); if (nz != 2 && nz != 3) return; }
  if (armDir != 0) execRotation(p, armDir);
  else armPlane = (armPlane == p ? -1 : p);
}
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

void reportStatus() {
  int gx, gy, gz; gcoord(selSlot, selIdx, gx, gy, gz);
  int8_t d, sd; puzzle.viewToLogical(SLOTS[selSlot].vAxis, SLOTS[selSlot].vSign, d, sd);
  Serial.print(F("sel (")); Serial.print(gx); Serial.print(','); Serial.print(gy); Serial.print(','); Serial.print(gz);
  Serial.print(F(") ")); Serial.print(SLOTS[selSlot].nl); Serial.print('/'); Serial.print(POS_LABEL[nzCount(selIdx)]);
  Serial.print(F(" cel=")); Serial.print(CELL_LABEL[colorKey(d, sd)]);
  Serial.print(F("  ")); Serial.print(solved ? F("opgelost") : F("bezig")); Serial.print(F("  z:")); Serial.println(moveCount);
}

// ============================================================================
//  INPUT — wireless gamepad via Bluepad32
// ============================================================================
// L-stick X = held rotation direction (−/+). LEVEL: act on each change of the dead-zoned state.
void readDirectionStick(ControllerPtr ctl) {
  int lx = ctl->axisX();                                // −512..511, centre ~0
  int dir = (lx < -ANALOG_DEAD) ? -1 : (lx > ANALOG_DEAD) ? +1 : 0;
  if (dir != lStickState) {
    if (lStickState != 0) clearDir(lStickState);
    if (dir != 0) setDir(dir);
    lStickState = dir;
  }
}
// R-stick Y = move to the up-/down-cube. One move per push (edge on threshold crossing).
// Bluepad32 Y axis: negative = stick up, positive = down.
void readVerticalStick(ControllerPtr ctl) {
  int ry = ctl->axisRY();
  int dir = (ry < -ANALOG_DEAD) ? +1 : (ry > ANALOG_DEAD) ? -1 : 0;   // up = +y (U), down = −y (D)
  if (dir != rStickState) {
    if (dir == +1)      moveSel(0,  1, 0);   // U (boven)
    else if (dir == -1) moveSel(0, -1, 0);   // D (onder)
    rStickState = dir;
  }
}

// process one gamepad frame; returns true if anything changed (for a redraw)
bool processGamepad(ControllerPtr ctl) {
  bool dirty = false;
  // navigation — D-pad (ground plane x/z), rising-edge
  uint8_t dp = ctl->dpad();
  bool up = dp & DP_UP, down = dp & DP_DOWN, left = dp & DP_LEFT, right = dp & DP_RIGHT;
  if (up && !prev.up)       { moveSel( 0, 0, -1); dirty = true; }   // N (achter)
  if (down && !prev.down)   { moveSel( 0, 0,  1); dirty = true; }   // S (voor)
  if (left && !prev.left)   { moveSel(-1, 0,  0); dirty = true; }   // W (links)
  if (right && !prev.right) { moveSel( 1, 0,  0); dirty = true; }   // E (rechts)
  prev.up = up; prev.down = down; prev.left = left; prev.right = right;

  // R-stick vertical (U/D) + L-stick direction (held)
  int8_t rBefore = rStickState; readVerticalStick(ctl); if (rStickState != rBefore) dirty = true;
  readDirectionStick(ctl);

  // face buttons (Bluepad32 normalises positions): □=x() ✕=a() ○=b() △=y(), rising-edge
  bool sq = ctl->x(), cr = ctl->a(), ci = ctl->b(), tr = ctl->y();
  if (sq && !prev.sq) { pressPlane(0); dirty = true; }   // □ vlak XY
  if (cr && !prev.cr) { pressPlane(1); dirty = true; }   // ✕ vlak YZ
  if (ci && !prev.ci) { pressPlane(2); dirty = true; }   // ○ vlak XZ
  if (tr && !prev.tr) { pressPlane(3); dirty = true; }   // △ grip
  prev.sq = sq; prev.cr = cr; prev.ci = ci; prev.tr = tr;

  // actions — rising-edge
  bool l3 = ctl->l3(), r3 = ctl->r3(), sel = ctl->miscSelect(), sta = ctl->miscStart();
  if (l3 && !prev.l3)   { press4D();    dirty = true; }   // 4D rotation
  if (r3 && !prev.r3)   { doUndo();     dirty = true; }   // undo
  if (sel && !prev.sel) { doScramble(); dirty = true; }   // husselen
  if (sta && !prev.sta) { doReset();    dirty = true; }   // reset
  prev.l3 = l3; prev.r3 = r3; prev.sel = sel; prev.sta = sta;

  return dirty;
}

// ----------------------------------------------------------------- Bluepad32 callbacks
void onConnectedController(ControllerPtr ctl) {
  if (gPad == nullptr && ctl->isGamepad()) {
    gPad = ctl;
    Serial.println(F("Gamepad verbonden."));
    reportStatus();
  } else {
    Serial.println(F("Extra/onbekend apparaat genegeerd."));
  }
}
void onDisconnectedController(ControllerPtr ctl) {
  if (gPad == ctl) { gPad = nullptr; armDir = 0; armPlane = -1; lStickState = rStickState = 0; prev = PadPrev(); }
  Serial.println(F("Gamepad losgekoppeld."));
}

// ============================================================================
//  SETUP / LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NLED).setCorrection(TypicalLEDStrip);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, FASTLED_MAX_MA);   // comfort/thermal target (software); the fuse + PSU are the real protection
  FastLED.setBrightness(LED_BRIGHTNESS);

  printWiringChart();    // one-time solder map over Serial (115200 baud) — see BEDRADING.md §5
  Serial.print(F("Vrij heap na init (byte): ")); Serial.println(ESP.getFreeHeap());   // ESP32: ~290 KB+, zeeën van ruimte

  const uint8_t *addr = BP32.localBdAddress();
  Serial.print(F("ESP32 Bluetooth-adres (zet dit als 'master' op een DS3): "));
  for (int i = 0; i < 6; i++) { if (i) Serial.print(':'); if (addr[i] < 16) Serial.print('0'); Serial.print(addr[i], HEX); }
  Serial.println();
  BP32.setup(&onConnectedController, &onDisconnectedController);
  // BP32.forgetBluetoothKeys();   // uncomment once to force a fresh pairing, then re-comment
  BP32.enableVirtualDevice(false);
  Serial.println(F("Zet de controller in koppelmodus. Mapping: zie hardware.html / README-esp32.md."));

  renderStatic(); FastLED.show();
}

void loop() {
  // 1) animation has priority: while a turn is sweeping, just render frames (input is ignored)
  if (animating) {
    if (!renderAnim()) { animating = false; renderStatic(); }
    FastLED.show();
    BP32.update();              // keep the BT link serviced
    return;
  }

  bool dataUpdated = BP32.update();
  if (dataUpdated && gPad && gPad->isConnected() && gPad->isGamepad()) {
    bool dirty = processGamepad(gPad);
    if (dirty && !animating) { renderStatic(); reportStatus(); }
  }
  FastLED.show();
}
