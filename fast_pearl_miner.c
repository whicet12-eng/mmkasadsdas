#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <omp.h>

extern int keccak_init(void **state, size_t capacity_bytes, uint8_t rounds);
extern int keccak_destroy(void *state);
extern int keccak_absorb(void *state, const uint8_t *in, size_t len);
extern int keccak_digest(void *state, uint8_t *digest, size_t len, uint8_t padding);
extern int keccak_copy(const void *src, void *dst);
extern int keccak_reset(void *state);

int main(int argc, char **argv) {
    if (argc < 4) {
        printf("Usage: %s <seed_hex> <target_high64_hex> <count> [threads]\n", argv[0]);
        return 1;
    }

    const char *seed_hex = argv[1];
    if (strncmp(seed_hex, "0x", 2) == 0) seed_hex += 2;
    uint64_t target_high64 = strtoull(argv[2], NULL, 16);
    int target_count = atoi(argv[3]);
    int threads = (argc > 4) ? atoi(argv[4]) : omp_get_max_threads();
    omp_set_num_threads(threads);

    uint8_t seed[32];
    for (int i = 0; i < 32; i++) sscanf(seed_hex + i*2, "%2hhx", &seed[i]);

    void *base_state = NULL;
    keccak_init(&base_state, 64, 24);
    keccak_absorb(base_state, seed, 32);

    volatile int found_count = 0;
    uint64_t *results = (uint64_t*)malloc(target_count * sizeof(uint64_t));

    #pragma omp parallel
    {
        void *worker_state = NULL;
        keccak_init(&worker_state, 64, 24);

        int tid = omp_get_thread_num();
        uint64_t nonce = ((uint64_t)rand() << 32) ^ ((uint64_t)rand() ^ ((uint64_t)tid << 48));
        uint8_t nonce_buf[32] = {0};
        uint8_t digest[32];

        while (found_count < target_count) {
            keccak_copy(base_state, worker_state);
            uint64_t be_nonce = __builtin_bswap64(nonce);
            memcpy(&nonce_buf[24], &be_nonce, 8);

            keccak_absorb(worker_state, nonce_buf, 32);
            keccak_digest(worker_state, digest, 32, 0x01);

            uint64_t digest_high64 = __builtin_bswap64(*(uint64_t*)digest);
            if (digest_high64 <= target_high64) {
                #pragma omp critical
                {
                    if (found_count < target_count) {
                        results[found_count] = nonce;
                        found_count++;
                        printf("FOUND_NONCE: %llu\n", (unsigned long long)nonce);
                        fflush(stdout);
                    }
                }
            }
            nonce++;
        }
        keccak_destroy(worker_state);
    }

    keccak_destroy(base_state);
    return 0;
}
