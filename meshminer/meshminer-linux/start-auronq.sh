#!/usr/bin/env bash
# MeshPool - AuronQ (AURQ, AQM64) -- MAINNET. Processor and/or NVIDIA card:
# every thread and every hash on the card holds 64 MB of memory (Argon2id).
# By default one thread per physical core, capped so the memory fits in 3/4
# of what is free, and the card takes all the hashes that fit in its memory;
# set THREADS to override. Miner fee 0.5% on MeshPool.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3359
WALLET=PUT_YOUR_AURONQ_ADDRESS_HERE
WORKER=rig1
THREADS=
# cpu = processor only, cuda = NVIDIA card only, both = card and processor.
BACKEND=cpu

if [ "$WALLET" = "PUT_YOUR_AURONQ_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own AuronQ address first (aurq1...)."
  echo
  exit 1
fi

THR=
[ -n "$THREADS" ] && THR="--threads $THREADS"

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo auronq --backend "$BACKEND" --pool "$POOL" --user "$WALLET.$WORKER" $THR
