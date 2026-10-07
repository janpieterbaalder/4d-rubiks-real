/* engine_host.cpp — runs the FIRMWARE engine (tesseract_engine.h) on the host for the
   C++ <-> JS parity test (parity.test.mjs). Reads one operation per line from stdin and
   prints, after every operation, the complete 189-led readout:

     <solved 0|1> <histN> <189 colour keys, 0..7 or 8=none> | <189 sticker ids or -1>
       | <viewToLogical d,sd for the 8 view directions X+ X- Y+ Y- Z+ Z- W+ W->

   Operations (all integers; theta code 0 = 180°, 1 = +120°, 2 = -120°):
     T d sd plane dir        twist          G d sd ux uy uz code   grip
     C d sd                  centre cell    V                      reset view
     U                       undo           R                      reset puzzle
   Build: g++ -std=c++17 -I shim -I .. engine_host.cpp -o engine_host */
#include <Arduino.h>
#include <iostream>
#include <string>
#include "tesseract_engine.h"

int main() {
  Tesseract t;
  uint8_t key[NPOS];
  uint16_t id[NPOS];
  std::string op;
  while (std::cin >> op) {
    if (op == "T") {
      int d, sd, p, dir; std::cin >> d >> sd >> p >> dir; t.twist(d, sd, p, dir);
    } else if (op == "G") {
      int d, sd, ux, uy, uz, code; std::cin >> d >> sd >> ux >> uy >> uz >> code;
      float u[3] = { (float)ux, (float)uy, (float)uz };
      float theta = code == 0 ? (float)PI : (code == 1 ? 2.0f * (float)PI / 3.0f : -2.0f * (float)PI / 3.0f);
      t.grip(d, sd, u, theta);
    } else if (op == "C") {
      int d, sd; std::cin >> d >> sd; t.centerCell(d, sd);
    } else if (op == "V") {
      t.resetView();
    } else if (op == "U") {
      t.undo();
    } else if (op == "R") {
      t.reset();
    } else {
      std::cerr << "unknown op " << op << "\n"; return 2;
    }
    t.scan(key, id);
    std::cout << (t.isSolved() ? 1 : 0) << ' ' << (int)t.histN;
    for (int i = 0; i < NPOS; i++) std::cout << ' ' << (int)key[i];
    std::cout << " |";
    for (int i = 0; i < NPOS; i++) std::cout << ' ' << (id[i] == ID_NONE ? -1 : (int)id[i]);
    std::cout << " |";
    for (int va = 0; va < 4; va++)
      for (int vs = 1; vs >= -1; vs -= 2) {
        int8_t d, sd; t.viewToLogical(va, vs, d, sd);
        std::cout << ' ' << (int)d << ' ' << (int)sd;
      }
    std::cout << '\n';
  }
  return 0;
}
