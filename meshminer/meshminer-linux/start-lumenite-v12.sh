#!/usr/bin/env bash
# MeshPool - Lumenite (HomeScrypt v1.2) -- MAINNET
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3335
WALLET=PUT_YOUR_LUMENITE_ADDRESS_HERE
WORKER=rig1
BACKEND=cuda

if [ "$WALLET" = "PUT_YOUR_LUMENITE_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own lmt1 address first."
  echo
  exit 1
fi

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --pool "$POOL" --user "$WALLET.$WORKER" --backend "$BACKEND" --algo v12
