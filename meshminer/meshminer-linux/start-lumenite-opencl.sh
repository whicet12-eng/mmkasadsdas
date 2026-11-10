#!/usr/bin/env bash
# MeshPool - Lumenite (HomeScrypt v1.2) on an AMD card (OpenCL) -- MAINNET
# For an NVIDIA card use start-lumenite-v12.sh (CUDA) instead. Needs the
# AMD OpenCL runtime (amdgpu-pro or ROCm; HiveOS has it).
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3335
WALLET=PUT_YOUR_LUMENITE_ADDRESS_HERE
WORKER=rig1
# opencl = the cards only; opencl+cpu adds the processor.
BACKEND=opencl

if [ "$WALLET" = "PUT_YOUR_LUMENITE_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own lmt1 address first."
  echo
  exit 1
fi

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --pool "$POOL" --user "$WALLET.$WORKER" --backend "$BACKEND" --algo v12
