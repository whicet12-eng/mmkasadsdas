#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <cuda_runtime.h>

__constant__ uint32_t d_K[64] = {
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

__device__ inline uint32_t d_bswap32(uint32_t x) {
    return __byte_perm(x, 0, 0x0123);
}

__device__ void d_sha256_transform(uint32_t state[8], const uint32_t block[16]) {
    uint32_t W[64];
    #pragma unroll
    for (int i = 0; i < 16; i++) W[i] = block[i];
    #pragma unroll
    for (int i = 16; i < 64; i++) {
        W[i] = sigma1(W[i - 2]) + W[i - 7] + sigma0(W[i - 15]) + W[i - 16];
    }

    uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
    uint32_t e = state[4], f = state[5], g = state[6], h = state[7];

    #pragma unroll
    for (int i = 0; i < 64; i++) {
        uint32_t T1 = h + SIGMA1(e) + CH(e, f, g) + d_K[i] + W[i];
        uint32_t T2 = SIGMA0(a) + MAJ(a, b, c);
        h = g; g = f; f = e; e = d + T1;
        d = c; c = b; b = a; a = T1 + T2;
    }

    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

__global__ void orex_kernel(
    uint32_t mid0, uint32_t mid1, uint32_t mid2, uint32_t mid3,
    uint32_t mid4, uint32_t mid5, uint32_t mid6, uint32_t mid7,
    uint64_t base_nonce, uint64_t total_hashes, int difficulty,
    int *g_found, uint64_t *g_winning_nonce, int *g_winning_zeros, uint32_t *g_winning_hash
) {
    uint64_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    uint64_t stride = (uint64_t)gridDim.x * blockDim.x;

    for (uint64_t offset = idx; offset < total_hashes; offset += stride) {
        if (*g_found) return;

        uint64_t nonce = base_nonce + offset;

        // Decimal conversion
        char nonce_str[32];
        char *p = nonce_str;
        uint64_t temp = nonce;
        do {
            *p++ = '0' + (temp % 10);
            temp /= 10;
        } while (temp);
        int nlen = p - nonce_str;
        for (int i = 0; i < nlen / 2; i++) {
            char t = nonce_str[i];
            nonce_str[i] = nonce_str[nlen - 1 - i];
            nonce_str[nlen - 1 - i] = t;
        }

        uint8_t block1_bytes[64];
        #pragma unroll
        for (int i = 0; i < 64; i++) block1_bytes[i] = 0;
        for (int i = 0; i < nlen; i++) block1_bytes[i] = nonce_str[i];
        block1_bytes[nlen] = 0x80;

        uint64_t total_bits = (uint64_t)(64 + nlen) * 8;
        #pragma unroll
        for (int i = 0; i < 8; i++) {
            block1_bytes[63 - i] = (total_bits >> (i * 8)) & 0xff;
        }

        uint32_t block1[16];
        #pragma unroll
        for (int i = 0; i < 16; i++) {
            uint32_t val = (block1_bytes[i*4] << 24) | (block1_bytes[i*4+1] << 16) | (block1_bytes[i*4+2] << 8) | block1_bytes[i*4+3];
            block1[i] = val;
        }

        uint32_t state[8];
        state[0] = mid0; state[1] = mid1; state[2] = mid2; state[3] = mid3;
        state[4] = mid4; state[5] = mid5; state[6] = mid6; state[7] = mid7;

        d_sha256_transform(state, block1);

        int zeros = __clz(state[0]);
        if (zeros >= difficulty) {
            if (atomicExch(g_found, 1) == 0) {
                *g_winning_nonce = nonce;
                *g_winning_zeros = zeros;
                for (int i = 0; i < 8; i++) g_winning_hash[i] = state[i];
            }
            return;
        }
    }
}

static const uint32_t K_host[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

static void host_sha256_transform(uint32_t state[8], const uint32_t block[16]) {
    uint32_t W[64];
    for (int i = 0; i < 16; i++) W[i] = block[i];
    for (int i = 16; i < 64; i++) {
        W[i] = sigma1(W[i - 2]) + W[i - 7] + sigma0(W[i - 15]) + W[i - 16];
    }
    uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
    uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
    for (int i = 0; i < 64; i++) {
        uint32_t T1 = h + SIGMA1(e) + CH(e, f, g) + K_host[i] + W[i];
        uint32_t T2 = SIGMA0(a) + MAJ(a, b, c);
        h = g; g = f; f = e; e = d + T1;
        d = c; c = b; b = a; a = T1 + T2;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "Usage: %s <challenge> <difficulty> <start_nonce> [max_hashes]\n", argv[0]);
        return 1;
    }

    const char *chal = argv[1];
    int difficulty = atoi(argv[2]);
    uint64_t base_nonce = strtoull(argv[3], NULL, 10);
    uint64_t max_hashes = argc > 4 ? strtoull(argv[4], NULL, 10) : 25000000;

    // Precompute midstate
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
    host_sha256_transform(midstate, block0);

    int *d_found;
    uint64_t *d_winning_nonce;
    int *d_winning_zeros;
    uint32_t *d_winning_hash;

    cudaMalloc(&d_found, sizeof(int));
    cudaMalloc(&d_winning_nonce, sizeof(uint64_t));
    cudaMalloc(&d_winning_zeros, sizeof(int));
    cudaMalloc(&d_winning_hash, 8 * sizeof(uint32_t));

    cudaMemset(d_found, 0, sizeof(int));

    int blockSize = 256;
    int numBlocks = 256; // 65,536 threads

    orex_kernel<<<numBlocks, blockSize>>>(
        midstate[0], midstate[1], midstate[2], midstate[3],
        midstate[4], midstate[5], midstate[6], midstate[7],
        base_nonce, max_hashes, difficulty,
        d_found, d_winning_nonce, d_winning_zeros, d_winning_hash
    );
    cudaDeviceSynchronize();

    int h_found = 0;
    cudaMemcpy(&h_found, d_found, sizeof(int), cudaMemcpyDeviceToHost);

    if (h_found) {
        uint64_t h_nonce = 0;
        int h_zeros = 0;
        uint32_t h_hash[8];
        cudaMemcpy(&h_nonce, d_winning_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
        cudaMemcpy(&h_zeros, d_winning_zeros, sizeof(int), cudaMemcpyDeviceToHost);
        cudaMemcpy(h_hash, d_winning_hash, 8 * sizeof(uint32_t), cudaMemcpyDeviceToHost);

        char hash_str[65];
        for (int i = 0; i < 8; i++) sprintf(hash_str + i * 8, "%08x", h_hash[i]);
        hash_str[64] = '\0';

        printf("FOUND %lu %d %s\n", (unsigned long)h_nonce, h_zeros, hash_str);
    } else {
        printf("DONE %lu\n", (unsigned long)max_hashes);
    }

    cudaFree(d_found);
    cudaFree(d_winning_nonce);
    cudaFree(d_winning_zeros);
    cudaFree(d_winning_hash);

    return 0;
}
