#!/usr/bin/env bash
# MeshPool - RCPU (RandomX) -- MAINNET. CPU only, about 2.3 GB of RAM.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3348
WALLET=PUT_YOUR_RCPU_ADDRESS_HERE
WORKER=rig1
THREADS=

if [ "$WALLET" = "PUT_YOUR_RCPU_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own rcpu1 address first (not rcpux1)."
  echo
  exit 1
fi

THR=
[ -n "$THREADS" ] && THR="--threads $THREADS"

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo rcpu --backend cpu --pool "$POOL" --user "$WALLET.$WORKER" $THR
