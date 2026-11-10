#!/bin/bash
# Usage: ./build.sh /path/to/discrete/src/crypto
set -e
CRYPTO=${1:-/root/discrete/src/crypto}
gcc -O3 -c "$CRYPTO/yespower.c" -I"$CRYPTO" -o yespower.o
gcc -O3 -c "$CRYPTO/blake256.c" -I"$CRYPTO" -o blake256.o
nvcc -O3 -std=c++17 -gencode arch=compute_120,code=sm_120 -I"$CRYPTO" xds_gpu.cu yespower.o blake256.o -o xds_gpu
echo built xds_gpu
