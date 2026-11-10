#!/usr/bin/env bash
# GPU self-test: does this card compute the same hashes as the reference?
# Run once per card before mining. Pass "nonsense" to test FishHashPlus,
# "opencl" (or "amd") for HomeScrypt through OpenCL, nothing for HomeScrypt
# on CUDA.
cd "$(dirname "$0")"
chmod +x ./meshpool-miner 2>/dev/null
case "${1:-}" in
  nonsense|fishhash*) exec ./meshpool-miner --algo fishhashplus --verify 256 ;;
  opencl|amd)         exec ./meshpool-miner --backend opencl --verify ;;
  *)                  exec ./meshpool-miner --verify ;;
esac
