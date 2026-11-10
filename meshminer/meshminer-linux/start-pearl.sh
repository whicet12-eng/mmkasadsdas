#!/usr/bin/env bash
# MeshPool - Pearl (PRL, NoisyGEMM) -- MAINNET. NVIDIA RTX 30-series or
# newer only (tensor cores). Miner fee 0.5% on MeshPool, 1.5% on other pools.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3363
WALLET=PUT_YOUR_PEARL_ADDRESS_HERE
WORKER=rig1

if [ "$WALLET" = "PUT_YOUR_PEARL_ADDRESS_HERE" ]; then
  echo
  echo "  Edit this file and set WALLET to your own Pearl address first (prl1p...)."
  echo
  exit 1
fi

chmod +x ./meshpool-miner 2>/dev/null
exec ./meshpool-miner --algo pearl --pool "$POOL" --user "$WALLET.$WORKER"
