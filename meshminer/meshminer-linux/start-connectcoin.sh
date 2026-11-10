#!/usr/bin/env bash
# MeshPool - ConnectCoin (RandomX V2) -- MAINNET. CPU only, about 2.3 GB of RAM.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3351
WALLET=PUT_YOUR_CONNECTCOIN_ADDRESS_HERE
WORKER=rig1
THREADS=

if [ "$WALLET" = "PUT_YOUR_CONNECTCOIN_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own ConnectCoin address first (cc1p...)."
  echo
  exit 1
fi

THR=
[ -n "$THREADS" ] && THR="--threads $THREADS"

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo connectcoin --backend cpu --pool "$POOL" --user "$WALLET.$WORKER" $THR
