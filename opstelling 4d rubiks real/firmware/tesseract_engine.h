/* ============================================================================
   tesseract_engine.h — the verified 4D (3^4) puzzle engine, ported to C++.
   ----------------------------------------------------------------------------
   This is the Arduino twin of engine.js. The MATH IS IDENTICAL — same pieces,
   same twist/grip/centre operations, same LED readout — so a turn on the real
   rig behaves exactly like the game and the 3D simulator. Keep it in the same
   sketch folder as tesseract_rig.ino.

   Memory note (Arduino Mega has 8 KB SRAM): puzzle + undo-history ~2.8 KB, the 189-LED
   buffer ~0.6 KB, the OLED buffer ~1 KB and the (bit-packed) animation scratch ~0.8 KB —
   together ~5.5 KB. Verified to boot in Wokwi (an earlier, un-packed version overran the
   8 KB and reset-looped). Still tight; on an ESP32 (520 KB) there is no concern at all.

   Coordinate / cell conventions (same as engine.js):
     axes  X=0 Y=1 Z=2 W=3 ; W is the inner<->outer (4D) axis.
     8 cells, each a colour; the centre physical cube is the -W cell, the hidden
     8th cell is +W. The 7 physical cubes are indexed C R L U D F B = 0..6.
   ========================================================================== */
#ifndef TESSERACT_ENGINE_H
#define TESSERACT_ENGINE_H
#include <Arduino.h>

// ---- axes ------------------------------------------------------------------
enum { AX_X = 0, AX_Y = 1, AX_Z = 2, AX_W = 3 };

// ---- the 7 physical cubes (strip order = this order) -----------------------
enum { SLOT_C = 0, SLOT_R = 1, SLOT_L = 2, SLOT_U = 3, SLOT_D = 4, SLOT_F = 5, SLOT_B = 6 };
#define NSLOT 7
#define LEDS_PER_CUBE 27
#define NLED (NSLOT * LEDS_PER_CUBE)        // 189
#define NPIECE 80                            // 3^4 - 1
#define NPOS NLED                            // a "position" = slot*27 + idx, 0..188
#define ID_NONE 0xFFFF
#define POS_NONE 0xFF
#define KEY_NONE 8                           // colour-key meaning "no sticker here"

// ---- the 8 cell colours (Okabe-Ito derived) — identical to COLORS in engine.js
//   key = axis*2 + (sign>0 ? 0 : 1):  X+ X- Y+ Y- Z+ Z- W+ W-
static const uint8_t CELL_RGB[8][3] = {
  { 255, 158,  44 },  // 0  X+  vivid orange
  {  95, 200, 255 },  // 1  X-  sky blue
  {   0, 197, 150 },  // 2  Y+  teal-green
  { 199, 123, 255 },  // 3  Y-  violet
  { 255, 224,  61 },  // 4  Z+  yellow
  {  79, 125, 255 },  // 5  Z-  royal blue
  { 255,  83,  64 },  // 6  W+  vermillion red
  { 255, 255, 255 },  // 7  W-  white (inner cube)
};
static inline uint8_t colorKey(int8_t axis, int8_t sign) { return axis * 2 + (sign > 0 ? 0 : 1); }

// which physical cube does view-direction (axis,sign) point to?  -1 = hidden 8th cell
static inline int8_t slotForView(int8_t a, int8_t s) {
  if (a == AX_W) return s < 0 ? SLOT_C : -1;     // -W = centre cube, +W = hidden
  if (a == AX_X) return s > 0 ? SLOT_R : SLOT_L;
  if (a == AX_Y) return s > 0 ? SLOT_U : SLOT_D;
  return s > 0 ? SLOT_F : SLOT_B;                 // Z+ = front, Z- = back
}

// ============================================================================
//  4x4 integer matrix helpers (entries always land on -1/0/1)
// ============================================================================
typedef int8_t Mat4[4][4];
typedef int8_t Vec4[4];

static inline void mat4I(Mat4 M) {
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) M[i][j] = (i == j);
}
static inline void mat4Copy(Mat4 dst, const Mat4 src) {
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) dst[i][j] = src[i][j];
}
static void mat4Mul(Mat4 out, const Mat4 A, const Mat4 B) {   // out = A*B
  Mat4 R;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    int s = 0; for (int k = 0; k < 4; k++) s += A[i][k] * B[k][j];
    R[i][j] = (int8_t)s;
  }
  mat4Copy(out, R);
}
static void mat4Vec(Vec4 out, const Mat4 M, const Vec4 v) {   // out = M*v (rounded == exact here)
  Vec4 r;
  for (int i = 0; i < 4; i++) {
    int s = 0; for (int k = 0; k < 4; k++) s += M[i][k] * v[k];
    r[i] = (int8_t)s;
  }
  for (int i = 0; i < 4; i++) out[i] = r[i];
}

// integer 90° rotation in plane (i,j); dir=+1 sends e_i -> e_j  (engine.js rotInt)
static void rotInt(Mat4 M, int i, int j, int dir) {
  mat4I(M);
  M[i][i] = 0; M[j][j] = 0; M[i][j] = -dir; M[j][i] = dir;
}

// integer rotation by angle a about axis u (3-vector over the cell's in-cell axes inAx[3]);
// identity on the cell's normal axis. Grip angles (180° edge, ±120° corner) round exactly to
// a signed-permutation matrix.  (engine.js rotAxisInt)
static void rotAxisInt(Mat4 M, const int inAx[3], const float u[3], float a) {
  float n = sqrtf(u[0]*u[0] + u[1]*u[1] + u[2]*u[2]);
  float x = u[0]/n, y = u[1]/n, z = u[2]/n;
  float c = cosf(a), s = sinf(a), t = 1.0f - c;
  float R3[3][3] = {
    { c + x*x*t,   x*y*t - z*s, x*z*t + y*s },
    { y*x*t + z*s, c + y*y*t,   y*z*t - x*s },
    { z*x*t - y*s, z*y*t + x*s, c + z*z*t   },
  };
  mat4I(M);
  for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++)
    M[inAx[i]][inAx[j]] = (int8_t)lroundf(R3[i][j]);
}

// signed unit direction of a 4-vector known to lie on one axis
static inline void axisOf(const Vec4 v, int8_t &a, int8_t &s) {
  for (int i = 0; i < 4; i++) if (v[i] != 0) { a = i; s = v[i] > 0 ? 1 : -1; return; }
  a = 0; s = 1;
}

// the 3 twist planes available for a cell on axis d  (engine.js planesFor)
static void planesFor(int d, int8_t planes[3][2]) {
  int8_t p[3], n = 0;
  for (int a = 0; a < 4; a++) if (a != d) p[n++] = a;
  planes[0][0] = p[0]; planes[0][1] = p[1];
  planes[1][0] = p[1]; planes[1][1] = p[2];
  planes[2][0] = p[0]; planes[2][1] = p[2];
}

// ============================================================================
//  the puzzle
// ============================================================================
struct Piece {
  int8_t solved[4];
  int8_t cur[4];
  Mat4   rot;
  uint8_t nStick;
  int8_t  stAxis[4];     // the axes that carry a sticker (solved[a] != 0)
};

// optional move history for undo (kept small to save SRAM)
#define HIST_MAX 16
struct Move {
  bool   grip;
  int8_t d, sd;
  int8_t planeIdx, dir;  // plane twist
  float  u[3], theta;    // grip
};

class Tesseract {
public:
  Piece pieces[NPIECE];
  Mat4  view4;                  // 4D view orientation (centring); identity hides +W
  Move  hist[HIST_MAX];
  uint8_t histN;

  Tesseract() { build(); mat4I(view4); histN = 0; }

  void build() {
    int n = 0;
    for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
    for (int z = -1; z <= 1; z++)
    for (int w = -1; w <= 1; w++) {
      if (x == 0 && y == 0 && z == 0 && w == 0) continue;   // hidden core
      Piece &p = pieces[n++];
      p.solved[0] = x; p.solved[1] = y; p.solved[2] = z; p.solved[3] = w;
      for (int a = 0; a < 4; a++) p.cur[a] = p.solved[a];
      mat4I(p.rot);
      p.nStick = 0;
      for (int a = 0; a < 4; a++) if (p.solved[a] != 0) p.stAxis[p.nStick++] = a;
    }
  }

  void reset() {
    for (int i = 0; i < NPIECE; i++) {
      Piece &p = pieces[i];
      for (int a = 0; a < 4; a++) p.cur[a] = p.solved[a];
      mat4I(p.rot);
    }
    histN = 0;
  }
  void resetView() { mat4I(view4); }

  // current facing axis/sign of a sticker on `piece` (engine.js facingOf)
  void facingOf(const Piece &p, int8_t stickerAxis, int8_t &fa, int8_t &fs) const {
    Vec4 v = { 0, 0, 0, 0 };
    v[stickerAxis] = p.solved[stickerAxis];
    Vec4 r; mat4Vec(r, p.rot, v);
    axisOf(r, fa, fs);
  }

  // rotate the 27-piece slab cur[d]==sd by integer matrix R  (engine.js applyToSlab)
  void applyToSlab(int d, int sd, const Mat4 R) {
    for (int i = 0; i < NPIECE; i++) {
      Piece &p = pieces[i];
      if (p.cur[d] == sd) {
        Vec4 nc; mat4Vec(nc, R, p.cur);
        for (int a = 0; a < 4; a++) p.cur[a] = nc[a];
        mat4Mul(p.rot, R, p.rot);
      }
    }
  }

  // 90° plane twist of cell (d,sd): planeIdx 0..2, dir ±1
  void twist(int d, int sd, int planeIdx, int dir, bool record = true) {
    int8_t planes[3][2]; planesFor(d, planes);
    Mat4 R; rotInt(R, planes[planeIdx][0], planes[planeIdx][1], dir);
    applyToSlab(d, sd, R);
    if (record && histN < HIST_MAX) {
      Move &m = hist[histN++]; m.grip = false; m.d = d; m.sd = sd; m.planeIdx = planeIdx; m.dir = dir;
    }
  }

  // grip: rotate the cell's slab about in-cell axis u (edge 180° / corner ±120°)
  void grip(int d, int sd, const float u[3], float theta, bool record = true) {
    int inAx[3], n = 0; for (int a = 0; a < 4; a++) if (a != d) inAx[n++] = a;
    Mat4 R; rotAxisInt(R, inAx, u, theta);
    applyToSlab(d, sd, R);
    if (record && histN < HIST_MAX) {
      Move &m = hist[histN++]; m.grip = true; m.d = d; m.sd = sd;
      m.u[0] = u[0]; m.u[1] = u[1]; m.u[2] = u[2]; m.theta = theta;
    }
  }

  bool undo() {
    if (histN == 0) return false;
    Move m = hist[--histN];
    if (m.grip) {
      int inAx[3], n = 0; for (int a = 0; a < 4; a++) if (a != m.d) inAx[n++] = a;
      float theta = (fabsf(fabsf(m.theta) - PI) < 1e-4f) ? m.theta : -m.theta;
      Mat4 R; rotAxisInt(R, inAx, m.u, theta); applyToSlab(m.d, m.sd, R);
    } else {
      int8_t planes[3][2]; planesFor(m.d, planes);
      Mat4 R; rotInt(R, planes[m.planeIdx][0], planes[m.planeIdx][1], -m.dir); applyToSlab(m.d, m.sd, R);
    }
    return true;
  }

  // visual solve: every sticker on its home-coloured cell  (engine.js isSolved)
  bool isSolved() const {
    for (int i = 0; i < NPIECE; i++) {
      const Piece &p = pieces[i];
      for (int t = 0; t < p.nStick; t++) {
        int8_t a = p.stAxis[t], fa, fs;
        facingOf(p, a, fa, fs);
        if (fa != a || fs != (p.solved[a] > 0 ? 1 : -1)) return false;
      }
    }
    return true;
  }

  // always-solvable scramble using only legal generators, no immediate cell repeat
  void scramble(int nMoves = 26) {
    reset();
    int last = -1;
    for (int s = 0; s < nMoves; s++) {
      int d, sd;
      do { d = random(4); sd = random(2) ? 1 : -1; }
      while (d * 2 + (sd > 0 ? 0 : 1) == last);
      last = d * 2 + (sd > 0 ? 0 : 1);
      twist(d, sd, random(3), random(2) ? 1 : -1, false);
    }
    histN = 0;
  }

  // centring (JP's 4D rotation): snap cell (d,sd) onto -W. Pure view change.
  // returns true if it rotated, false if already centred.  (engine.js centerCell)
  bool centerCell(int d, int sd) {
    Vec4 nrm = { 0, 0, 0, 0 }; nrm[d] = sd;
    Vec4 cur; mat4Vec(cur, view4, nrm);
    int8_t a, s; axisOf(cur, a, s);
    if (a == AX_W && s == -1) return false;
    Mat4 R; rotInt(R, a, AX_W, -s);
    mat4Mul(view4, R, view4);
    return true;
  }

  // which LOGICAL cell currently sits at view direction (viewAxis,viewSign).
  // n = view4^T · e   (engine.js viewToLogical)
  void viewToLogical(int8_t va, int8_t vs, int8_t &d, int8_t &sd) const {
    Vec4 n;
    for (int i = 0; i < 4; i++) {
      int sum = 0; for (int k = 0; k < 4; k++) sum += view4[k][i] * (k == va ? vs : 0);
      n[i] = (int8_t)sum;
    }
    axisOf(n, d, sd);
  }

  // ---- physical LED readout (engine.js placements / ledState) ----------------
  // Fills, for the CURRENT state:
  //   keyByPos[189]  = colour-key 0..7 per position (slot*27+idx), or KEY_NONE.
  //   idByPos [189]  = stable sticker id at that position (pieceIndex*4 + axis), or ID_NONE.
  // The id survives twists and centring, so diffing idByPos before/after a move yields the
  // exact permutation that drives the "rotation wave" animation.
  void scan(uint8_t keyByPos[NPOS], uint16_t idByPos[NPOS]) const {
    for (int i = 0; i < NPOS; i++) { keyByPos[i] = KEY_NONE; idByPos[i] = ID_NONE; }
    for (int pi = 0; pi < NPIECE; pi++) {
      const Piece &p = pieces[pi];
      Vec4 vcur; mat4Vec(vcur, view4, p.cur);            // piece position in view space
      for (int t = 0; t < p.nStick; t++) {
        int8_t a = p.stAxis[t], fa, fs;
        facingOf(p, a, fa, fs);
        Vec4 e = { 0, 0, 0, 0 }; e[fa] = fs;
        Vec4 vdir; mat4Vec(vdir, view4, e);
        int8_t va, vs; axisOf(vdir, va, vs);
        int8_t slot = slotForView(va, vs);
        if (slot < 0) continue;                          // faces the hidden 8th cube
        int inAx[3], n = 0; for (int ax = 0; ax < 4; ax++) if (ax != va) inAx[n++] = ax;
        int i = vcur[inAx[0]], j = vcur[inAx[1]], k = vcur[inAx[2]];
        int idx = (i + 1) + 3 * (j + 1) + 9 * (k + 1);
        int pos = slot * LEDS_PER_CUBE + idx;
        keyByPos[pos] = colorKey(a, p.solved[a]);
        idByPos[pos]  = (uint16_t)(pi * 4 + a);
      }
    }
  }
};

// ============================================================================
//  ORIENT — how each physical cube is wired, so the rig is a faithful copy of the
//  game's projection. Given an LED's engine index `idx` (0..26), gives its physical
//  lattice spot (x,y,z) in {-1,0,1}^3 inside that cube. Used to PRINT the wiring chart
//  (printWiringChart over Serial). Identical to ORIENT in engine.js / hardware.js.
// ============================================================================
static void orientOf(int slot, int idx, int8_t &x, int8_t &y, int8_t &z) {
  int i = (idx % 3) - 1;
  int j = ((idx / 3) % 3) - 1;
  int k = (idx / 9) - 1;
  switch (slot) {
    case SLOT_C: x =  i; y =  j; z =  k; break;   // inner W- : X->x Y->y Z->z
    case SLOT_R: x =  k; y =  i; z =  j; break;   // +x arm   : W->+x (inner layer faces centre)
    case SLOT_L: x = -k; y =  i; z =  j; break;   // -x arm   : W->-x
    case SLOT_U: x =  i; y =  k; z =  j; break;   // +y arm   : W->+y
    case SLOT_D: x =  i; y = -k; z =  j; break;   // -y arm   : W->-y
    case SLOT_F: x =  i; y =  j; z =  k; break;   // +z arm   : W->+z
    case SLOT_B: x =  i; y =  j; z = -k; break;   // -z arm   : W->-z
  }
}

static const char *SLOT_NAME[NSLOT] = { "C(midden)", "R(rechts)", "L(links)", "U(boven)", "D(onder)", "F(voor)", "B(achter)" };

// Run once from setup() (with Serial open) to get the exact solder map: for every LED in the
// strip, which cube + which physical (x,y,z) spot it must sit in. Saves you guessing.
static void printWiringChart() {
  Serial.println(F("# LED strip wiring chart  (strip# : cube : x,y,z)"));
  for (int slot = 0; slot < NSLOT; slot++) {
    for (int idx = 0; idx < LEDS_PER_CUBE; idx++) {
      int8_t x, y, z; orientOf(slot, idx, x, y, z);
      int stripIndex = slot * LEDS_PER_CUBE + idx;
      Serial.print(stripIndex); Serial.print(F(" : "));
      Serial.print(SLOT_NAME[slot]); Serial.print(F(" : "));
      Serial.print(x); Serial.print(','); Serial.print(y); Serial.print(','); Serial.println(z);
    }
  }
}

// ============================================================================
//  freeRam() — bytes of SRAM still free (the gap between the heap top and the stack).
//  SRAM headroom is the tight resource on an Arduino Mega (8 KB): engine + LED + animation
//  buffers already use ~5 KB, and the rig firmware adds the USB Host Shield / PS3BT stack on
//  top of that. Print it once in setup() and watch it during play — if it drops near zero the
//  sketch will misbehave or reset-loop. On a non-AVR target (e.g. ESP32, 520 KB) it returns
//  -1: there is so much RAM that this crude probe is neither needed nor meaningful.
// ============================================================================
#ifdef __AVR__
extern char __heap_start;
extern char *__brkval;
static int freeRam() {
  char top;
  return (int)(&top - (__brkval ? __brkval : &__heap_start));
}
#else
static int freeRam() { return -1; }
#endif

#endif // TESSERACT_ENGINE_H
