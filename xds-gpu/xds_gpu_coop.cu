// Cooperative Shared-Memory GPU implementation of yespower-discrete
// Each block = 1 instance. S-box (96 KB) is in ultra-fast Shared Memory.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>
#include <chrono>

extern "C" {
#include "yespower.h"
#include "blake256.h"
}

#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { \
  fprintf(stderr, "CUDA error %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1);} } while (0)

typedef uint64_t u64;
typedef uint32_t u32;

static const u32 PN = 4096, PR = 32;
#define TAPE_LEN    3312u
#define TAPE_WORDS  414u
#define B_BYTES     (128u * PR)                 // 4096
#define V_BYTES     ((size_t)128 * PR * PN)     // 16 MiB
#define SBOX1       32768u                      // 32 KB per S-box
#define S_BYTES     (3u * SBOX1)                // 96 KB total
#define XY_BYTES    4224u
#define TAPE_STRIDE 3328u
#define SMASK2      0x00007FF000007FF0ULL

__constant__ uint8_t c_slot[16] = {0, 13, 10, 7, 4, 1, 14, 11, 8, 5, 2, 15, 12, 9, 6, 3};

__device__ __forceinline__ u32 rotl32(u32 x, int n) { return (x << n) | (x >> (32 - n)); }

__device__ __forceinline__ u64 add2(u64 a, u64 b) {
  u32 lo = (u32)a + (u32)b;
  u32 hi = (u32)(a >> 32) + (u32)(b >> 32);
  return ((u64)hi << 32) | lo;
}

__device__ __forceinline__ void ldb(u64 *X, const u64 *p) {
#pragma unroll
  for (int k = 0; k < 8; k++) X[k] = p[k];
}
__device__ __forceinline__ void stb(u64 *p, const u64 *X) {
#pragma unroll
  for (int k = 0; k < 8; k++) p[k] = X[k];
}
__device__ __forceinline__ void xorb(u64 *X, const u64 *p) {
#pragma unroll
  for (int k = 0; k < 8; k++) X[k] ^= p[k];
}

__device__ __forceinline__ void salsa(u64 *X, u64 *Bout) {
  u32 x[16];
  x[0] = (u32)X[0];        x[1] = (u32)(X[6] >> 32);
  x[2] = (u32)X[5];        x[3] = (u32)(X[3] >> 32);
  x[4] = (u32)X[2];        x[5] = (u32)(X[0] >> 32);
  x[6] = (u32)X[7];        x[7] = (u32)(X[5] >> 32);
  x[8] = (u32)X[4];        x[9] = (u32)(X[2] >> 32);
  x[10] = (u32)X[1];       x[11] = (u32)(X[7] >> 32);
  x[12] = (u32)X[6];       x[13] = (u32)(X[4] >> 32);
  x[14] = (u32)X[3];       x[15] = (u32)(X[1] >> 32);
#define R(a, b) rotl32((a), (b))
  x[4] ^= R(x[0] + x[12], 7);   x[8] ^= R(x[4] + x[0], 9);
  x[12] ^= R(x[8] + x[4], 13);  x[0] ^= R(x[12] + x[8], 18);
  x[9] ^= R(x[5] + x[1], 7);    x[13] ^= R(x[9] + x[5], 9);
  x[1] ^= R(x[13] + x[9], 13);  x[5] ^= R(x[1] + x[13], 18);
  x[14] ^= R(x[10] + x[6], 7);  x[2] ^= R(x[14] + x[10], 9);
  x[6] ^= R(x[2] + x[14], 13);  x[10] ^= R(x[6] + x[2], 18);
  x[3] ^= R(x[15] + x[11], 7);  x[7] ^= R(x[3] + x[15], 9);
  x[11] ^= R(x[7] + x[3], 13);  x[15] ^= R(x[11] + x[7], 18);
  x[1] ^= R(x[0] + x[3], 7);    x[2] ^= R(x[1] + x[0], 9);
  x[3] ^= R(x[2] + x[1], 13);   x[0] ^= R(x[3] + x[2], 18);
  x[6] ^= R(x[5] + x[4], 7);    x[7] ^= R(x[6] + x[5], 9);
  x[4] ^= R(x[7] + x[6], 13);   x[5] ^= R(x[4] + x[7], 18);
  x[11] ^= R(x[10] + x[9], 7);  x[8] ^= R(x[11] + x[10], 9);
  x[9] ^= R(x[8] + x[11], 13);  x[10] ^= R(x[9] + x[8], 18);
  x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9);
  x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
#undef R
  u64 s[8];
  s[0] = (u64)x[0]  | ((u64)x[5] << 32);
  s[1] = (u64)x[10] | ((u64)x[15] << 32);
  s[2] = (u64)x[4]  | ((u64)x[9] << 32);
  s[3] = (u64)x[14] | ((u64)x[3] << 32);
  s[4] = (u64)x[8]  | ((u64)x[13] << 32);
  s[5] = (u64)x[2]  | ((u64)x[7] << 32);
  s[6] = (u64)x[12] | ((u64)x[1] << 32);
  s[7] = (u64)x[6]  | ((u64)x[11] << 32);
#pragma unroll
  for (int k = 0; k < 8; k++) {
    u64 v = add2(s[k], X[k]);
    X[k] = v;
    Bout[k] = v;
  }
}

__device__ __forceinline__ void pwx_simd(u64 &x0, u64 &x1, const u64 *S0, const u64 *S1) {
  u64 x = x0 & SMASK2;
  const u64 *p0 = (const u64 *)((const uint8_t *)S0 + (u32)x);
  const u64 *p1 = (const u64 *)((const uint8_t *)S1 + (x >> 32));
  x0 = ((x0 >> 32) * (u32)x0 + p0[0]) ^ p1[0];
  x1 = ((x1 >> 32) * (u32)x1 + p0[1]) ^ p1[1];
}

__device__ __forceinline__ void pwx_wr(u64 x0, u64 x1, u64 *Sw, u32 w) {
  u64 *p = (u64 *)((uint8_t *)Sw + w);
  p[0] = x0;
  p[1] = x1;
}

__device__ __forceinline__ void pwxform(u64 *X, u64 *&S0, u64 *&S1, u64 *&S2, u32 &w) {
  pwx_simd(X[0], X[1], S0, S1); pwx_wr(X[0], X[1], S0, w);
  pwx_simd(X[2], X[3], S0, S1); pwx_wr(X[2], X[3], S1, w);
  w += 16;
  pwx_simd(X[4], X[5], S0, S1); pwx_wr(X[4], X[5], S0, w);
  pwx_simd(X[6], X[7], S0, S1); pwx_wr(X[6], X[7], S1, w);
  w += 16;
  pwx_simd(X[0], X[1], S0, S1); pwx_wr(X[0], X[1], S0, w);
  pwx_simd(X[2], X[3], S0, S1); pwx_wr(X[2], X[3], S1, w);
  w += 16;
  pwx_simd(X[4], X[5], S0, S1);
  pwx_simd(X[6], X[7], S0, S1);
  pwx_simd(X[0], X[1], S0, S1); pwx_wr(X[0], X[1], S0, w);
  pwx_simd(X[2], X[3], S0, S1); pwx_wr(X[2], X[3], S1, w);
  w += 16;
  pwx_simd(X[4], X[5], S0, S1);
  pwx_simd(X[6], X[7], S0, S1);
  w &= (u32)SMASK2;
  u64 *t = S2; S2 = S1; S1 = S0; S0 = t;
}

struct PCtx { u64 *S0, *S1, *S2; u32 w; };
struct Inj  { const u32 *tape; u64 ctr; u32 phase, pi; };

__device__ void inject(u64 *Xb, int r, Inj *ij) {
  u32 *xw = (u32 *)Xb;
  u32 words = 32u * (u32)r, mask = words - 1u;
  u64 ctr = ij->ctr;
  u32 i = ij->pi;
  u32 q = (u32)(ctr % TAPE_WORDS);
  u32 lo = ij->tape[2 * q], hi = ij->tape[2 * q + 1];
  u32 pc;
  switch (ij->phase) {
    case 0: pc = 0x243F6A88u; break;
    case 1: pc = 0x85A308D3u; break;
    case 2: pc = 0x13198A2Eu; break;
    default: pc = 0x03707344u; break;
  }
#define GETW(qq) xw[((qq) >> 4) * 16 + c_slot[(qq) & 15u]]
  u32 a = GETW(0u);
  u32 b = GETW(words >> 1);
  u32 c = GETW(words - 1u);
  u32 selector = a ^ rotl32(b, 7) ^ rotl32(c, 17) ^ (0x9E3779B9u * (u32)(ctr + 1u)) ^
                 (0x7F4A7C15u * (u32)(i + 1u)) ^ pc;
  u32 lane0 = selector & mask;
  u32 delta = ((selector >> 16) & mask) | 1u;
  u32 lane1 = (lane0 + delta) & mask;
  GETW(lane0) ^= lo;
  GETW(lane1) ^= hi;
#undef GETW
  ij->ctr = ctr + 1u;
  ij->pi = i + 1u;
}

__device__ __forceinline__ void load_shuffle(const u32 *w, u64 *d) {
  d[0] = (u64)w[0]  | ((u64)w[5] << 32);
  d[1] = (u64)w[10] | ((u64)w[15] << 32);
  d[2] = (u64)w[4]  | ((u64)w[9] << 32);
  d[3] = (u64)w[14] | ((u64)w[3] << 32);
  d[4] = (u64)w[8]  | ((u64)w[13] << 32);
  d[5] = (u64)w[2]  | ((u64)w[7] << 32);
  d[6] = (u64)w[12] | ((u64)w[1] << 32);
  d[7] = (u64)w[6]  | ((u64)w[11] << 32);
}
__device__ __forceinline__ void store_unshuffle(const u64 *d, u32 *w) {
  w[0] = (u32)d[0];  w[1] = (u32)(d[6] >> 32);
  w[2] = (u32)d[5];  w[3] = (u32)(d[3] >> 32);
  w[4] = (u32)d[2];  w[5] = (u32)(d[0] >> 32);
  w[6] = (u32)d[7];  w[7] = (u32)(d[5] >> 32);
  w[8] = (u32)d[4];  w[9] = (u32)(d[2] >> 32);
  w[10] = (u32)d[1]; w[11] = (u32)(d[7] >> 32);
  w[12] = (u32)d[6]; w[13] = (u32)(d[4] >> 32);
  w[14] = (u32)d[3]; w[15] = (u32)(d[1] >> 32);
}

__device__ void blockmix_salsa(const u64 *Bin, u64 *Bout) {
  u64 X[8];
  ldb(X, Bin + 8);
  xorb(X, Bin);
  salsa(X, Bout);
  xorb(X, Bin + 8);
  salsa(X, Bout + 8);
}

__device__ u32 blockmix_salsa_xor(const u64 *Bin1, const u64 *Bin2, u64 *Bout) {
  u64 X[8];
#pragma unroll
  for (int k = 0; k < 8; k++) X[k] = Bin1[8 + k] ^ Bin2[8 + k];
  xorb(X, Bin1);
  xorb(X, Bin2);
  salsa(X, Bout);
  xorb(X, Bin1 + 8);
  xorb(X, Bin2 + 8);
  salsa(X, Bout + 8);
  return (u32)X[0];
}

__device__ void blockmix(const u64 *Bin, u64 *Bout, int r, PCtx *c) {
  u64 *S0 = c->S0, *S1 = c->S1, *S2 = c->S2;
  u32 w = c->w;
  int rr = 2 * r - 1, i = 0;
  u64 X[8];
  ldb(X, Bin + rr * 8);
  while (1) {
    xorb(X, Bin + i * 8);
    pwxform(X, S0, S1, S2, w);
    if (i >= rr) break;
    stb(Bout + i * 8, X);
    i++;
  }
  c->S0 = S0; c->S1 = S1; c->S2 = S2; c->w = w;
  salsa(X, Bout + i * 8);
}

__device__ u32 blockmix_xor(const u64 *Bin1, const u64 *Bin2, u64 *Bout, int r, PCtx *c) {
  u64 *S0 = c->S0, *S1 = c->S1, *S2 = c->S2;
  u32 w = c->w;
  int rr = 2 * r - 1, i = 0;
  u64 X[8];
#pragma unroll
  for (int k = 0; k < 8; k++) X[k] = Bin1[rr * 8 + k] ^ Bin2[rr * 8 + k];
  rr--;
  while (1) {
    xorb(X, Bin1 + i * 8);
    xorb(X, Bin2 + i * 8);
    pwxform(X, S0, S1, S2, w);
    stb(Bout + i * 8, X);
    xorb(X, Bin1 + (i + 1) * 8);
    xorb(X, Bin2 + (i + 1) * 8);
    pwxform(X, S0, S1, S2, w);
    if (i >= rr) break;
    stb(Bout + (i + 1) * 8, X);
    i += 2;
  }
  i++;
  c->S0 = S0; c->S1 = S1; c->S2 = S2; c->w = w;
  salsa(X, Bout + i * 8);
  return (u32)X[0];
}

__device__ u32 blockmix_xor_save(u64 *Bin1out, u64 *Bin2, int r, PCtx *c) {
  u64 *S0 = c->S0, *S1 = c->S1, *S2 = c->S2;
  u32 w = c->w;
  int rr = 2 * r - 1, i = 0;
  u64 X[8], Y[8];
#pragma unroll
  for (int k = 0; k < 8; k++) X[k] = Bin1out[rr * 8 + k] ^ Bin2[rr * 8 + k];
  rr--;
  while (1) {
#pragma unroll
    for (int k = 0; k < 8; k++) { Y[k] = Bin2[i * 8 + k] ^ Bin1out[i * 8 + k]; }
    stb(Bin2 + i * 8, Y);
    xorb(X, Y);
    pwxform(X, S0, S1, S2, w);
    stb(Bin1out + i * 8, X);
#pragma unroll
    for (int k = 0; k < 8; k++) { Y[k] = Bin2[(i + 1) * 8 + k] ^ Bin1out[(i + 1) * 8 + k]; }
    stb(Bin2 + (i + 1) * 8, Y);
    xorb(X, Y);
    pwxform(X, S0, S1, S2, w);
    if (i >= rr) break;
    stb(Bin1out + (i + 1) * 8, X);
    i += 2;
  }
  i++;
  c->S0 = S0; c->S1 = S1; c->S2 = S2; c->w = w;
  salsa(X, Bin1out + i * 8);
  return (u32)X[0];
}

__device__ void smix1(u32 *B, int r, u32 N, u64 *V, u64 *XY, PCtx *ctx, Inj *ij) {
  const int s = 2 * r;
  u64 *X = V, *Y = V + s * 8, *V_j;
  u32 i, j, n;

  for (i = 0; i < 2; i++) load_shuffle(B + i * 16, X + i * 8);

  if (ctx)
    for (i = 1; i < (u32)r; i++) blockmix(X + (i - 1) * 2 * 8, X + i * 2 * 8, 1, ctx);

  inject(X, r, ij);
  if (ctx) blockmix(X, Y, r, ctx); else blockmix_salsa(X, Y);
  X = Y + s * 8;
  inject(Y, r, ij);
  if (ctx) blockmix(Y, X, r, ctx); else blockmix_salsa(Y, X);
  j = (u32)X[(2 * r - 1) * 8];

  for (n = 2; n < N; n <<= 1) {
    u32 m = (n < N / 2) ? n : (N - 1 - n);
    for (i = 1; i < m; i += 2) {
      Y = X + s * 8;
      j &= n - 1;
      j += i - 1;
      V_j = V + (size_t)j * s * 8;
      inject(X, r, ij);
      j = ctx ? blockmix_xor(X, V_j, Y, r, ctx) : blockmix_salsa_xor(X, V_j, Y);
      j &= n - 1;
      j += i;
      V_j = V + (size_t)j * s * 8;
      X = Y + s * 8;
      inject(Y, r, ij);
      j = ctx ? blockmix_xor(Y, V_j, X, r, ctx) : blockmix_salsa_xor(Y, V_j, X);
    }
  }
  n >>= 1;

  j &= n - 1;
  j += N - 2 - n;
  V_j = V + (size_t)j * s * 8;
  Y = X + s * 8;
  inject(X, r, ij);
  j = ctx ? blockmix_xor(X, V_j, Y, r, ctx) : blockmix_salsa_xor(X, V_j, Y);
  j &= n - 1;
  j += N - 1 - n;
  V_j = V + (size_t)j * s * 8;
  inject(Y, r, ij);
  if (ctx) blockmix_xor(Y, V_j, XY, r, ctx); else blockmix_salsa_xor(Y, V_j, XY);

  for (i = 0; i < (u32)(2 * r); i++) store_unshuffle(XY + i * 8, B + i * 16);
}

__device__ void smix2(u32 *B, int r, u32 N, u32 Nloop, u64 *V, u64 *XY, PCtx *ctx, Inj *ij) {
  const int s = 2 * r;
  u64 *X = XY;
  u32 i, j;
  for (i = 0; i < (u32)(2 * r); i++) load_shuffle(B + i * 16, X + i * 8);
  j = (u32)X[(2 * r - 1) * 8] & (N - 1);
  do {
    u64 *V_j = V + (size_t)j * s * 8;
    inject(X, r, ij);
    j = blockmix_xor_save(X, V_j, r, ctx) & (N - 1);
    V_j = V + (size_t)j * s * 8;
    inject(X, r, ij);
    j = blockmix_xor_save(X, V_j, r, ctx) & (N - 1);
  } while (Nloop -= 2);
  for (i = 0; i < (u32)(2 * r); i++) store_unshuffle(X + i * 8, B + i * 16);
}

// -----------------------------------------------------------------------------
// COOPERATIVE KERNEL:
// 1 Block = 1 Hash Candidate
// S-box is in Shared Memory (96 KB)
// -----------------------------------------------------------------------------
__global__ void smix_coop_kernel(uint8_t *Bbuf, const uint8_t *tapes, uint8_t *Vbuf, uint8_t *XYbuf, int ninstances) {
  int inst_id = blockIdx.x;
  if (inst_id >= ninstances) return;
  int lane = threadIdx.x;

  extern __shared__ uint8_t s_mem[]; // 96 KB
  uint8_t *S = s_mem;

  u32 *B = (u32 *)(Bbuf + (size_t)inst_id * B_BYTES);
  u64 *V = (u64 *)(Vbuf + (size_t)inst_id * V_BYTES);
  u64 *XY = (u64 *)(XYbuf + (size_t)inst_id * XY_BYTES);

  Inj ij;
  ij.tape = (const u32 *)(tapes + (size_t)inst_id * TAPE_STRIDE);
  ij.ctr = 0; ij.phase = 0; ij.pi = 0;

  PCtx ctx;
  ctx.S0 = (u64 *)S;
  ctx.S1 = (u64 *)(S + SBOX1);
  ctx.S2 = (u64 *)(S + 2 * SBOX1);
  ctx.w = 0;

  if (lane == 0) {
    // S-box generation: smix1(B, 1, Sbytes/128, S0, XY, NULL)
    ij.phase = 0; ij.pi = 0;
    smix1(B, 1, S_BYTES / 128, (u64 *)S, XY, nullptr, &ij);

    // fill
    ij.phase = 1; ij.pi = 0;
    smix1(B, PR, PN, V, XY, &ctx, &ij);

    // read/write
    ij.phase = 2; ij.pi = 0;
    u32 Nloop = (PN + 2) / 3;
    Nloop++; Nloop &= ~1u;
    smix2(B, PR, PN, Nloop, V, XY, &ctx, &ij);
  }
}

// -----------------------------------------------------------------------------
// Host test & benchmark
// -----------------------------------------------------------------------------
static uint64_t rng_state = 0xabcdef12345678ULL;
static uint8_t rnd8() {
  rng_state ^= rng_state << 13; rng_state ^= rng_state >> 7; rng_state ^= rng_state << 17;
  return (uint8_t)(rng_state >> 24);
}

struct Cand {
  uint8_t H[64];
  uint8_t tape[TAPE_STRIDE];
  uint8_t init[32];
  uint8_t B[B_BYTES];
};

int main(int argc, char **argv) {
  int batch = argc > 1 ? atoi(argv[1]) : 36;
  int rounds = argc > 2 ? atoi(argv[2]) : 2;

  printf("=== Cooperative Shared-Memory Kernel (1 Block = 1 Hash, S-box in 96KB ShMem) ===\n");
  printf("Target: %d instances concurrently\n", batch);

  uint8_t P[32];
  for (int i = 0; i < 32; i++) P[i] = rnd8();
  yespower_params_t yp = {PN, PR, P, 32};

  std::vector<Cand> cands(batch);
  for (auto &c : cands) {
    for (auto &b : c.H) b = rnd8();
    memset(c.tape, 0, sizeof(c.tape));
    for (u32 i = 0; i < TAPE_LEN; i++) c.tape[i] = rnd8();
    memset(c.B, 0, sizeof(c.B));
    blake256_hash(c.init, c.H, 64);
    pbkdf2_blake256(c.init, 32, P, 32, 1, c.B, 128);
    memcpy(c.init, c.B, 32);
  }

  uint8_t *dB, *dT, *dV, *dXY;
  CK(cudaMalloc(&dB, (size_t)batch * B_BYTES));
  CK(cudaMalloc(&dT, (size_t)batch * TAPE_STRIDE));
  CK(cudaMalloc(&dV, (size_t)batch * V_BYTES));
  CK(cudaMalloc(&dXY, (size_t)batch * XY_BYTES));

  std::vector<uint8_t> hB((size_t)batch * B_BYTES), hT((size_t)batch * TAPE_STRIDE);
  for (int i = 0; i < batch; i++) {
    memcpy(&hB[(size_t)i * B_BYTES], cands[i].B, B_BYTES);
    memcpy(&hT[(size_t)i * TAPE_STRIDE], cands[i].tape, TAPE_STRIDE);
  }
  CK(cudaMemcpy(dT, hT.data(), hT.size(), cudaMemcpyHostToDevice));

  // Configure dynamic shared memory to 96 KB
  CK(cudaFuncSetAttribute(smix_coop_kernel, cudaFuncAttributeMaxDynamicSharedMemorySize, S_BYTES));

  cudaEvent_t e0, e1;
  cudaEventCreate(&e0); cudaEventCreate(&e1);
  double best = 1e30;

  for (int rd = 0; rd < rounds; rd++) {
    CK(cudaMemcpy(dB, hB.data(), hB.size(), cudaMemcpyHostToDevice));
    cudaEventRecord(e0);
    // Launch: 'batch' blocks, 32 threads per block, 96 KB dynamic shared memory
    smix_coop_kernel<<<batch, 32, S_BYTES>>>(dB, dT, dV, dXY, batch);
    cudaEventRecord(e1);
    CK(cudaGetLastError());
    CK(cudaEventSynchronize(e1));
    float ms = 0;
    cudaEventElapsedTime(&ms, e0, e1);
    printf("round %d: batch=%d  %.1f ms  => %.1f H/s\n", rd, batch, ms, batch * 1000.0 / ms);
    if (ms < best) best = ms;
  }
  printf("BEST COOP: %.1f H/s (batch=%d blocks)\n", batch * 1000.0 / best, batch);

  CK(cudaMemcpy(hB.data(), dB, hB.size(), cudaMemcpyDeviceToHost));

  int bad = 0;
  int nv = batch < 4 ? batch : 4;
  for (int i = 0; i < nv; i++) {
    uint8_t gpu[32], cpu[32];
    hmac_blake256_hash(gpu, &hB[(size_t)i * B_BYTES] + B_BYTES - 64, 64, cands[i].init, 32);
    yespower_binary_t y;
    if (yespower_discrete_tls(cands[i].H, 64, &yp, cands[i].tape, &y) != 0) {
      printf("cpu failed\n"); return 1;
    }
    memcpy(cpu, y.uc, 32);
    bool ok = memcmp(gpu, cpu, 32) == 0;
    if (!ok) bad++;
    printf("verify[%d]: %s\n  cpu=%02x%02x.. gpu=%02x%02x..\n", i, ok ? "MATCH" : "MISMATCH",
           cpu[0], cpu[1], gpu[0], gpu[1]);
  }
  printf(bad ? "RESULT: %d MISMATCH\n" : "RESULT: ALL MATCH (%d checked)\n", bad ? bad : nv);
  return bad ? 2 : 0;
}
