#!/usr/bin/env bash
# MeshPool - Avian (AVN, x16rt) -- MAINNET, the GPU side. NVIDIA GPU.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3344
WALLET=PUT_YOUR_AVIAN_ADDRESS_HERE
WORKER=rig1


if [ "$WALLET" = "PUT_YOUR_AVIAN_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own Avian address first (it starts with R)."
  echo
  exit 1
fi


chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo x16rt --backend cuda --pool "$POOL" --user "$WALLET.$WORKER"
