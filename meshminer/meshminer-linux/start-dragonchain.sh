#!/usr/bin/env bash
# MeshPool - Dragonchain (DRGN, yespower 1.0) -- MAINNET. CPU only.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3340
WALLET=PUT_YOUR_DRAGONCHAIN_ADDRESS_HERE
WORKER=rig1
THREADS=

if [ "$WALLET" = "PUT_YOUR_DRAGONCHAIN_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own dragon1 address first."
  echo
  exit 1
fi

THR=
[ -n "$THREADS" ] && THR="--threads $THREADS"

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo yespower --backend cpu --pool "$POOL" --user "$WALLET.$WORKER" $THR
