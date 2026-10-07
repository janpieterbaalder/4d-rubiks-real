/* Minimal host-side stand-in for <Arduino.h>, just enough to compile tesseract_engine.h
   with a normal C++ compiler (g++/clang++) for the parity test in ../parity.test.mjs.
   NOT used on a real board. */
#ifndef HOST_ARDUINO_SHIM_H
#define HOST_ARDUINO_SHIM_H
#include <stdint.h>
#include <stdlib.h>
#include <math.h>      // sqrtf, cosf, sinf, fabsf, lroundf in the global namespace (as on Arduino)
#include <string.h>

#ifndef PI
#define PI 3.1415926535897932384626433832795
#endif
#define F(s) (s)

// deterministic PRNG so a scramble is reproducible on the host
static uint32_t host_rng_state = 12345u;
inline void randomSeed(unsigned long s) { host_rng_state = (uint32_t)s ? (uint32_t)s : 12345u; }
inline long random(long howbig) {
  host_rng_state = host_rng_state * 1103515245u + 12345u;
  return howbig > 0 ? (long)((host_rng_state >> 8) % (uint32_t)howbig) : 0;
}

struct HostSerial {
  template <typename T> void print(const T &) {}
  template <typename T> void print(const T &, int) {}
  template <typename T> void println(const T &) {}
  void println() {}
};
static HostSerial Serial;

#endif
