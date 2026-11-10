#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <cuda_runtime.h>

#define ROL64(a, offset) (((a) << (offset)) ^ ((a) >> (64 - (offset))))

__device__ __constant__ uint64_t d_rc[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL,
    0x8000000080008000ULL, 0x000000000000808bULL, 0x0000000080000001ULL,
    0x8000000080008081ULL, 0x8000000000008009ULL, 0x000000000000008aULL,
    0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL,
    0x8000000000008003ULL, 0x8000000000008002ULL, 0x8000000000000080ULL,
    0x000000000000800aULL, 0x800000008000000aULL, 0x8000000080008081ULL,
    0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL
};

__device__ __forceinline__ void keccak_f1600(uint64_t *s) {
    #pragma unroll
    for (int round = 0; round < 24; round++) {
        // Theta
        uint64_t C[5], D[5];
        C[0] = s[0] ^ s[5] ^ s[10] ^ s[15] ^ s[20];
        C[1] = s[1] ^ s[6] ^ s[11] ^ s[16] ^ s[21];
        C[2] = s[2] ^ s[7] ^ s[12] ^ s[17] ^ s[22];
        C[3] = s[3] ^ s[8] ^ s[13] ^ s[18] ^ s[23];
        C[4] = s[4] ^ s[9] ^ s[14] ^ s[19] ^ s[24];

        D[0] = C[4] ^ ROL64(C[1], 1);
        D[1] = C[0] ^ ROL64(C[2], 1);
        D[2] = C[1] ^ ROL64(C[3], 1);
        D[3] = C[2] ^ ROL64(C[4], 1);
        D[4] = C[3] ^ ROL64(C[0], 1);

        uint64_t B[25];
        // Rho and Pi
        B[0]  = s[0] ^ D[0];
        B[10] = ROL64(s[1] ^ D[1], 1);
        B[7]  = ROL64(s[10] ^ D[0], 3);
        B[11] = ROL64(s[7] ^ D[2], 6);
        B[17] = ROL64(s[11] ^ D[1], 10);
        B[18] = ROL64(s[17] ^ D[2], 15);
        B[3]  = ROL64(s[18] ^ D[3], 21);
        B[5]  = ROL64(s[3] ^ D[3], 28);
        B[16] = ROL64(s[5] ^ D[0], 36);
        B[8]  = ROL64(s[16] ^ D[1], 45);
        B[21] = ROL64(s[8] ^ D[3], 55);
        B[24] = ROL64(s[21] ^ D[1], 2);
        B[4]  = ROL64(s[24] ^ D[4], 14);
        B[15] = ROL64(s[4] ^ D[4], 27);
        B[23] = ROL64(s[15] ^ D[0], 41);
        B[19] = ROL64(s[23] ^ D[3], 56);
        B[13] = ROL64(s[19] ^ D[4], 8);
        B[12] = ROL64(s[13] ^ D[3], 25);
        B[2]  = ROL64(s[12] ^ D[2], 43);
        B[20] = ROL64(s[2] ^ D[2], 62);
        B[14] = ROL64(s[20] ^ D[0], 18);
        B[22] = ROL64(s[14] ^ D[4], 39);
        B[9]  = ROL64(s[22] ^ D[2], 61);
        B[6]  = ROL64(s[9] ^ D[4], 20);
        B[1]  = ROL64(s[6] ^ D[1], 44);

        // Chi and Iota
        s[0]  = B[0]  ^ ((~B[1])  & B[2]) ^ d_rc[round];
        s[1]  = B[1]  ^ ((~B[2])  & B[3]);
        s[2]  = B[2]  ^ ((~B[3])  & B[4]);
        s[3]  = B[3]  ^ ((~B[4])  & B[0]);
        s[4]  = B[4]  ^ ((~B[0])  & B[1]);

        s[5]  = B[5]  ^ ((~B[6])  & B[7]);
        s[6]  = B[6]  ^ ((~B[7])  & B[8]);
        s[7]  = B[7]  ^ ((~B[8])  & B[9]);
        s[8]  = B[8]  ^ ((~B[9])  & B[5]);
        s[9]  = B[9]  ^ ((~B[5])  & B[6]);

        s[10] = B[10] ^ ((~B[11]) & B[12]);
        s[11] = B[11] ^ ((~B[12]) & B[13]);
        s[12] = B[12] ^ ((~B[13]) & B[14]);
        s[13] = B[13] ^ ((~B[14]) & B[10]);
        s[14] = B[14] ^ ((~B[10]) & B[11]);

        s[15] = B[15] ^ ((~B[16]) & B[17]);
        s[16] = B[16] ^ ((~B[17]) & B[18]);
        s[17] = B[17] ^ ((~B[18]) & B[19]);
        s[18] = B[18] ^ ((~B[19]) & B[15]);
        s[19] = B[19] ^ ((~B[15]) & B[16]);

        s[20] = B[20] ^ ((~B[21]) & B[22]);
        s[21] = B[21] ^ ((~B[22]) & B[23]);
        s[22] = B[22] ^ ((~B[23]) & B[24]);
        s[23] = B[23] ^ ((~B[24]) & B[20]);
        s[24] = B[24] ^ ((~B[20]) & B[21]);
    }
}

// Bswap for uint64_t
__device__ __forceinline__ uint64_t bswap64(uint64_t x) {
    return __byte_perm((uint32_t)x, (uint32_t)(x >> 32), 0x0123) |
           (((uint64_t)__byte_perm((uint32_t)x, (uint32_t)(x >> 32), 0x4567)) << 32);
}

__global__ void mine_kernel(
    uint64_t seed0, uint64_t seed1, uint64_t seed2, uint64_t seed3,
    uint64_t nonce_prefix, uint64_t start_nonce,
    uint64_t target_high64,
    uint64_t *results, uint32_t *result_count, uint32_t max_results
) {
    uint64_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    uint64_t current_nonce_low = start_nonce + idx;

    // Build Keccak state
    // Bytes 0..31: seed in little-endian lanes
    // Bytes 32..63: nonce in big-endian bytes
    // Notice: abi.encode(bytes32, uint256):
    // seed is 32 bytes as is.
    // nonce is uint256 big-endian, so:
    // bytes 32..39: 0
    // bytes 40..47: 0
    // bytes 48..55: nonce_prefix (high 64 bits of nonce, big endian)
    // bytes 56..63: current_nonce_low (low 64 bits of nonce, big endian)
    //
    // In Keccak lane (little endian):
    // lane 4 (bytes 32..39): all 0
    // lane 5 (bytes 40..47): all 0
    // lane 6 (bytes 48..55): big-endian bytes of nonce_prefix -> in LE word, that is bswap64(nonce_prefix)
    // lane 7 (bytes 56..63): big-endian bytes of current_nonce_low -> in LE word, that is bswap64(current_nonce_low)

    uint64_t s[25];
    s[0] = seed0;
    s[1] = seed1;
    s[2] = seed2;
    s[3] = seed3;
    s[4] = 0;
    s[5] = 0;
    s[6] = bswap64(nonce_prefix);
    s[7] = bswap64(current_nonce_low);
    s[8] = 0x0000000000000001ULL; // padding 0x01
    s[9] = 0; s[10] = 0; s[11] = 0; s[12] = 0;
    s[13] = 0; s[14] = 0; s[15] = 0;
    s[16] = 0x8000000000000000ULL; // padding 0x80
    s[17] = 0; s[18] = 0; s[19] = 0; s[20] = 0;
    s[21] = 0; s[22] = 0; s[23] = 0; s[24] = 0;

    keccak_f1600(s);

    // Hash output:
    // s[0] little-endian bytes 0..7 are output bytes 0..7.
    // In uint256(hash), byte 0 is MSB.
    // So the top 64 bits of uint256 is bswap64(s[0]).
    uint64_t hash_high64 = bswap64(s[0]);

    if (hash_high64 <= target_high64) {
        uint32_t slot = atomicAdd(result_count, 1);
        if (slot < max_results) {
            results[slot] = current_nonce_low;
        }
    }
}

int main(int argc, char **argv) {
    if (argc < 4) {
        printf("Usage: %s <seed_hex> <target_high64_hex> <count> [gpu_id]\n", argv[0]);
        return 1;
    }

    const char *seed_hex = argv[1];
    if (strncmp(seed_hex, "0x", 2) == 0) seed_hex += 2;
    uint64_t target_high64 = strtoull(argv[2], NULL, 16);
    uint32_t target_count = atoi(argv[3]);
    int gpu_id = (argc > 4) ? atoi(argv[4]) : 0;

    cudaSetDevice(gpu_id);

    // Parse seed into 4 uint64_t little-endian words
    uint8_t seed_bytes[32];
    for (int i = 0; i < 32; i++) {
        sscanf(seed_hex + i * 2, "%2hhx", &seed_bytes[i]);
    }

    uint64_t seed_lanes[4];
    memcpy(seed_lanes, seed_bytes, 32);

    uint64_t *d_results;
    uint32_t *d_count;
    cudaMalloc(&d_results, target_count * sizeof(uint64_t));
    cudaMalloc(&d_count, sizeof(uint32_t));
    cudaMemset(d_count, 0, sizeof(uint32_t));

    uint64_t nonce_prefix = 0; // high 64 bits
    uint64_t current_nonce = ((uint64_t)rand() << 32) ^ rand();

    uint32_t threads = 256;
    uint32_t blocks = 65536; // 16.7M threads per batch
    uint64_t batch_size = (uint64_t)threads * blocks;

    uint32_t found = 0;
    uint64_t host_results[64];

    while (found < target_count) {
        mine_kernel<<<blocks, threads>>>(
            seed_lanes[0], seed_lanes[1], seed_lanes[2], seed_lanes[3],
            nonce_prefix, current_nonce,
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
