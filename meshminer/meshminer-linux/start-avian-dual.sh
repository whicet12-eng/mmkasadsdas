#!/usr/bin/env bash
# MeshPool - Avian (AVN), BOTH algorithms in ONE miner -- MAINNET.
#
# The card mines X16RT on port 3344 and the processor mines MinotaurX on
# 3345, at the same time, paying the same address. Avian credits whichever
# side finds a block.
#
# THREADS is for the processor side only. See README-dual.txt for what the
# output means, and for running two different coins or wallets instead.
cd "$(dirname "$0")"

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
exec ./meshpool-miner --algo x16rt --backend cuda --pool pool.meshpool.net:3344 --user "$WALLET.$WORKER" --cpu-algo minotaurx --cpu-pool pool.meshpool.net:3345 $THR
