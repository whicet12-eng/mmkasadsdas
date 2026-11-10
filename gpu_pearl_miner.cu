#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <cuda_runtime.h>

#define KECCAK_ROUND 24

__constant__ uint64_t d_RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
    0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
    0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL,
    0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
    0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
    0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL,
    0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL
};

__device__ __forceinline__ uint64_t ROTL64(uint64_t a, uint32_t b) {
    return (a << b) | (a >> (64 - b));
}

__device__ __forceinline__ void keccak_f1600(uint64_t *A) {
    #pragma unroll
    for (int i = 0; i < KECCAK_ROUND; i++) {
        uint64_t c0 = A[0] ^ A[5] ^ A[10] ^ A[15] ^ A[20];
        uint64_t c1 = A[1] ^ A[6] ^ A[11] ^ A[16] ^ A[21];
        uint64_t c2 = A[2] ^ A[7] ^ A[12] ^ A[17] ^ A[22];
        uint64_t c3 = A[3] ^ A[8] ^ A[13] ^ A[18] ^ A[23];
        uint64_t c4 = A[4] ^ A[9] ^ A[14] ^ A[19] ^ A[24];

        uint64_t d1 = ROTL64(c1, 1) ^ c4;
        uint64_t d2 = ROTL64(c2, 1) ^ c0;
        uint64_t d3 = ROTL64(c3, 1) ^ c1;
        uint64_t d4 = ROTL64(c4, 1) ^ c2;
        uint64_t d0 = ROTL64(c0, 1) ^ c3;

        A[0] ^= d1; A[5] ^= d1; A[10] ^= d1; A[15] ^= d1; A[20] ^= d1;
        A[1] ^= d2; A[6] ^= d2; A[11] ^= d2; A[16] ^= d2; A[21] ^= d2;
        A[2] ^= d3; A[7] ^= d3; A[12] ^= d3; A[17] ^= d3; A[22] ^= d3;
        A[3] ^= d4; A[8] ^= d4; A[13] ^= d4; A[18] ^= d4; A[23] ^= d4;
        A[4] ^= d0; A[9] ^= d0; A[14] ^= d0; A[19] ^= d0; A[24] ^= d0;

        c1 = ROTL64(A[1], 1);
        A[1] = ROTL64(A[6], 44);
        A[6] = ROTL64(A[9], 20);
        A[9] = ROTL64(A[22], 61);
        A[22] = ROTL64(A[14], 39);
        A[14] = ROTL64(A[20], 18);
        A[20] = ROTL64(A[2], 62);
        A[2] = ROTL64(A[12], 43);
        A[12] = ROTL64(A[13], 25);
        A[13] = ROTL64(A[19], 8);
        A[19] = ROTL64(A[23], 56);
        A[23] = ROTL64(A[15], 41);
        A[15] = ROTL64(A[4], 27);
        A[4] = ROTL64(A[24], 14);
        A[24] = ROTL64(A[21], 2);
        A[21] = ROTL64(A[8], 55);
        A[8] = ROTL64(A[16], 45);
        A[16] = ROTL64(A[5], 36);
        A[5] = ROTL64(A[3], 28);
        A[3] = ROTL64(A[18], 21);
        A[18] = ROTL64(A[17], 15);
        A[17] = ROTL64(A[11], 10);
        A[11] = ROTL64(A[7], 6);
        A[7] = ROTL64(A[10], 3);
        A[10] = c1;

        c0 = A[0] ^ (~A[1] & A[2]);
        c1 = A[1] ^ (~A[2] & A[3]);
        A[2] ^= ~A[3] & A[4];
        A[3] ^= ~A[4] & A[0];
        A[4] ^= ~A[0] & A[1];
        A[0] = c0;
        A[1] = c1;

        c0 = A[5] ^ (~A[6] & A[7]);
        c1 = A[6] ^ (~A[7] & A[8]);
        A[7] ^= ~A[8] & A[9];
        A[8] ^= ~A[9] & A[5];
        A[9] ^= ~A[5] & A[6];
        A[5] = c0;
        A[6] = c1;

        c0 = A[10] ^ (~A[11] & A[12]);
        c1 = A[11] ^ (~A[12] & A[13]);
        A[12] ^= ~A[13] & A[14];
        A[13] ^= ~A[14] & A[10];
        A[14] ^= ~A[10] & A[11];
        A[10] = c0;
        A[11] = c1;

        c0 = A[15] ^ (~A[16] & A[17]);
        c1 = A[16] ^ (~A[17] & A[18]);
        A[17] ^= ~A[18] & A[19];
        A[18] ^= ~A[19] & A[15];
        A[19] ^= ~A[15] & A[16];
        A[15] = c0;
        A[16] = c1;

        c0 = A[20] ^ (~A[21] & A[22]);
        c1 = A[21] ^ (~A[22] & A[23]);
        A[22] ^= ~A[23] & A[24];
        A[23] ^= ~A[24] & A[20];
        A[24] ^= ~A[20] & A[21];
        A[20] = c0;
        A[21] = c1;

        A[0] ^= d_RC[i];
    }
}

__device__ __forceinline__ uint64_t bswap64_device(uint64_t x) {
    uint32_t low = (uint32_t)x;
    uint32_t high = (uint32_t)(x >> 32);
    uint32_t swapped_low = __byte_perm(high, 0, 0x0123);
    uint32_t swapped_high = __byte_perm(low, 0, 0x0123);
    return (((uint64_t)swapped_high) << 32) | swapped_low;
}

__global__ void mine_kernel(
    uint64_t s0, uint64_t s1, uint64_t s2, uint64_t s3,
    uint64_t start_nonce,
    uint64_t target_high64,
    uint64_t *d_results, uint32_t *d_count, uint32_t max_results
) {
    uint64_t tid = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
    uint64_t nonce = start_nonce + tid;

    uint64_t state[25];
    state[0] = s0;
    state[1] = s1;
    state[2] = s2;
    state[3] = s3;
    state[4] = 0;
    state[5] = 0;
    state[6] = 0;
    state[7] = bswap64_device(nonce);
    state[8] = 0x0000000000000001ULL;
    state[9] = 0; state[10] = 0; state[11] = 0; state[12] = 0;
    state[13] = 0; state[14] = 0; state[15] = 0;
    state[16] = 0x8000000000000000ULL;
    state[17] = 0; state[18] = 0; state[19] = 0; state[20] = 0;
    state[21] = 0; state[22] = 0; state[23] = 0; state[24] = 0;

    keccak_f1600(state);

    // Hash high 64 bits in big-endian comparison
    uint64_t hash_high64 = bswap64_device(state[0]);

    if (hash_high64 <= target_high64) {
        uint32_t idx = atomicAdd(d_count, 1);
        if (idx < max_results) {
            d_results[idx] = nonce;
        }
    }
}

int main(int argc, char **argv) {
    if (argc < 4) {
        printf("Usage: %s <seed_hex> <target_high64_hex> <count> [device_id]\n", argv[0]);
        return 1;
    }

    const char *seed_hex = argv[1];
    if (strncmp(seed_hex, "0x", 2) == 0) seed_hex += 2;
    uint64_t target_high64 = strtoull(argv[2], NULL, 16);
    uint32_t target_count = atoi(argv[3]);
    int device_id = (argc > 4) ? atoi(argv[4]) : 0;

    cudaSetDevice(device_id);

    uint8_t seed_bytes[32];
    for (int i = 0; i < 32; i++) sscanf(seed_hex + i * 2, "%2hhx", &seed_bytes[i]);
    uint64_t seed_lanes[4];
    memcpy(seed_lanes, seed_bytes, 32);

    uint64_t *d_results;
    uint32_t *d_count;
    cudaMalloc(&d_results, target_count * sizeof(uint64_t));
    cudaMalloc(&d_count, sizeof(uint32_t));
    cudaMemset(d_count, 0, sizeof(uint32_t));

    uint32_t threads_per_block = 256;
    uint32_t num_blocks = 65536; // 16,777,216 nonces per kernel launch
    uint64_t batch_size = (uint64_t)threads_per_block * num_blocks;

    uint64_t current_nonce = ((uint64_t)rand() << 32) ^ rand();
    uint32_t found = 0;
    uint64_t host_results[64];

    while (found < target_count) {
        mine_kernel<<<num_blocks, threads_per_block>>>(
            seed_lanes[0], seed_lanes[1], seed_lanes[2], seed_lanes[3],
            current_nonce,
            target_high64,
            d_results, d_count, target_count
        );
        cudaDeviceSynchronize();

        uint32_t count = 0;
        cudaMemcpy(&count, d_count, sizeof(uint32_t), cudaMemcpyDeviceToHost);

        if (count > found) {
            uint32_t to_fetch = (count > target_count) ? target_count : count;
            cudaMemcpy(host_results, d_results, to_fetch * sizeof(uint64_t), cudaMemcpyDeviceToHost);
            for (uint32_t i = found; i < to_fetch; i++) {
                printf("FOUND_NONCE: %llu\n", (unsigned long long)host_results[i]);
                fflush(stdout);
            }
            found = to_fetch;
            if (found >= target_count) break;
        }

        current_nonce += batch_size;
    }

    cudaFree(d_results);
    cudaFree(d_count);
    return 0;
}
