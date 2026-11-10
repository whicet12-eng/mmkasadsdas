#!/usr/bin/env bash
# Riecoin (RIC) -- MAINNET, NVIDIA GPU.
# Pool: MeshPool. Paid in the block's own coinbase (MeshDirect): no payout
# threshold, and the miner's dev fee is 0.5% here (2.5% on other pools).
# WALLET must be a ric1q address. For Stelo.xyz (0.8% fee, payout from
# 0.625 RIC): POOL=stelo.xyz:2005 and WORKER empty.
# POWER: empty leaves the card alone; a number sets watts; "auto" tunes it
# (about ten minutes the first time, then remembered). Both need root.
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3349
WALLET=PUT_YOUR_RIECOIN_ADDRESS_HERE
WORKER=rig1
POWER=

if [ "$WALLET" = "PUT_YOUR_RIECOIN_ADDRESS_HERE" ]; then
  echo "Edit this file and set WALLET to your own ric1 address first."
  exit 1
fi
PWR=""
[ -n "$POWER" ] && PWR="--power $POWER"
USER="$WALLET"
[ -n "$WORKER" ] && USER="$WALLET.$WORKER"
./meshpool-miner --algo riecoin --pool "$POOL" --user "$USER" --pass x $PWR
