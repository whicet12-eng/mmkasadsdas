#!/usr/bin/env bash
# MeshPool - NULL (Equihash 144,5) -- MAINNET. NVIDIA card only (about 3 GB
# of card memory). Miner fee 0.5% on MeshPool, 1.2% on other pools.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3361
WALLET=PUT_YOUR_NULL_ADDRESS_HERE
WORKER=rig1

if [ "$WALLET" = "PUT_YOUR_NULL_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own NULL address first (null1...)."
  echo
  exit 1
fi

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo null --backend cuda --pool "$POOL" --user "$WALLET.$WORKER"
