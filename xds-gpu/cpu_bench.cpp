// Multi-thread CPU baseline for yespower-discrete (real Discrete code).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <thread>
#include <vector>
#include <atomic>
#include <chrono>
extern "C" {
#include "yespower.h"
}
int main(int argc, char **argv) {
  int nt = argc > 1 ? atoi(argv[1]) : 8;
  double secs = argc > 2 ? atof(argv[2]) : 5.0;
  uint8_t P[32] = {1};
  yespower_params_t yp = {4096, 32, P, 32};
  std::atomic<bool> stop{false};
  std::atomic<uint64_t> total{0};
  std::vector<std::thread> th;
  for (int t = 0; t < nt; t++)
    th.emplace_back([&, t] {
      uint8_t H[64], tape[3312];
      memset(H, t, 64);
      for (int i = 0; i < 3312; i++) tape[i] = (uint8_t)(i * 7 + t);
      uint64_t n = 0;
      yespower_binary_t y;
      while (!stop) {
        H[0] = (uint8_t)n; H[1] = (uint8_t)(n >> 8);
        yespower_discrete_tls(H, 64, &yp, tape, &y);
        n++;
      }
      total += n;
      yespower_discrete_tls_free();
    });
  auto t0 = std::chrono::steady_clock::now();
  std::this_thread::sleep_for(std::chrono::milliseconds((int)(secs * 1000)));
  stop = true;
  for (auto &x : th) x.join();
  double el = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  printf("threads=%d  %.0f H/s  (%.1f H/s/thread)\n", nt, total / el, total / el / nt);
}
