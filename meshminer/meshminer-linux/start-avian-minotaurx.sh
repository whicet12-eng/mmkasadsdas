#!/usr/bin/env bash
# MeshPool - Avian (AVN, minotaurx) -- MAINNET, the CPU side. CPU only.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3345
WALLET=PUT_YOUR_AVIAN_ADDRESS_HERE
WORKER=rig1
THREADS=

if [ "$WALLET" = "PUT_YOUR_AVIAN_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own Avian address first (it starts with R)."
  echo
  exit 1
fi

THR=
[ -n "$THREADS" ] && THR="--threads $THREADS"

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo minotaurx --backend cpu --pool "$POOL" --user "$WALLET.$WORKER" $THR
