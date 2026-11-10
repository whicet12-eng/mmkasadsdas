#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>

static const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
#define CH(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define SIGMA0(x) (ROTR(x, 2) ^ ROTR(x, 13) ^ ROTR(x, 22))
#define SIGMA1(x) (ROTR(x, 6) ^ ROTR(x, 11) ^ ROTR(x, 25))
#define sigma0(x) (ROTR(x, 7) ^ ROTR(x, 18) ^ ((x) >> 3))
#define sigma1(x) (ROTR(x, 17) ^ ROTR(x, 19) ^ ((x) >> 10))

static inline uint32_t bswap32(uint32_t x) {
    return __builtin_bswap32(x);
}

static inline void sha256_transform(uint32_t state[8], const uint32_t block[16]) {
    uint32_t W[64];
    for (int i = 0; i < 16; i++) W[i] = block[i];
    for (int i = 16; i < 64; i++) {
        W[i] = sigma1(W[i - 2]) + W[i - 7] + sigma0(W[i - 15]) + W[i - 16];
    }

    uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
    uint32_t e = state[4], f = state[5], g = state[6], h = state[7];

    for (int i = 0; i < 64; i++) {
        uint32_t T1 = h + SIGMA1(e) + CH(e, f, g) + K[i] + W[i];
        uint32_t T2 = SIGMA0(a) + MAJ(a, b, c);
        h = g; g = f; f = e; e = d + T1;
        d = c; c = b; b = a; a = T1 + T2;
    }

    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

// Counts leading zero bits across 32-byte hash
static inline int count_leading_zero_bits(const uint32_t state[8]) {
    int total = 0;
    for (int i = 0; i < 8; i++) {
        uint32_t val = state[i];
        if (val == 0) {
            total += 32;
        } else {
            total += __builtin_clz(val);
            break;
        }
    }
    return total;
}

int main(int argc, char **argv) {
    if (argc < 5) {
        fprintf(stderr, "Usage: %s <challenge> <difficulty> <start_nonce> <max_hashes>\n", argv[0]);
        return 1;
    }

    const char *chal = argv[1];
    int difficulty = atoi(argv[2]);
    uint64_t nonce = strtoull(argv[3], NULL, 10);
    uint64_t max_hashes = strtoull(argv[4], NULL, 10);

    // 1. Precompute Midstate for block 0 (chal is 64 bytes)
    uint32_t midstate[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };
    uint32_t block0[16];
    for (int i = 0; i < 16; i++) {
        uint32_t val;
        memcpy(&val, chal + i * 4, 4);
        block0[i] = bswap32(val);
    }
    sha256_transform(midstate, block0);

    // 2. Main mining loop
    uint8_t block1_bytes[64];
    uint32_t block1[16];
    uint32_t final_state[8];
    char nonce_str[32];

    uint64_t end_nonce = nonce + max_hashes;
    uint64_t tried = 0;

    while (nonce < end_nonce) {
        // Form ASCII nonce
        // Fast integer to string
        char *p = nonce_str;
        uint64_t temp = nonce;
        do {
            *p++ = '0' + (temp % 10);
            temp /= 10;
        } while (temp);
        int nlen = p - nonce_str;
        // reverse
        for (int i = 0; i < nlen / 2; i++) {
            char t = nonce_str[i];
            nonce_str[i] = nonce_str[nlen - 1 - i];
            nonce_str[nlen - 1 - i] = t;
        }

        memset(block1_bytes, 0, 64);
        memcpy(block1_bytes, nonce_str, nlen);
        block1_bytes[nlen] = 0x80;

        uint64_t total_bits = (uint64_t)(64 + nlen) * 8;
        for (int i = 0; i < 8; i++) {
            block1_bytes[63 - i] = (total_bits >> (i * 8)) & 0xff;
        }

        for (int i = 0; i < 16; i++) {
            uint32_t val;
            memcpy(&val, block1_bytes + i * 4, 4);
            block1[i] = bswap32(val);
        }

        memcpy(final_state, midstate, 32);
        sha256_transform(final_state, block1);

        tried++;

        // Quick check: first word must have at least min(32, difficulty) leading zeros
        int first_clz = __builtin_clz(final_state[0]);
        if (first_clz >= difficulty || (first_clz == 32 && difficulty > 32)) {
            int zeros = count_leading_zero_bits(final_state);
            if (zeros >= difficulty) {
                // Print solution
                char hash_hex[65];
                for (int i = 0; i < 8; i++) {
                    sprintf(hash_hex + i * 8, "%08x", final_state[i]);
                }
                hash_hex[64] = '\0';
                printf("FOUND %lu %d %s\n", (unsigned long)nonce, zeros, hash_hex);
                return 0;
            }
        }

        nonce++;
    }

    printf("DONE %lu\n", (unsigned long)tried);
    return 0;
}
