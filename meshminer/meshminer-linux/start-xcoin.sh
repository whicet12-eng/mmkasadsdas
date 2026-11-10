#!/usr/bin/env bash
# xCoin (XID) -- MAINNET, NVIDIA GPU with at least 6 GB.
# Pool: MeshPool. Paid in the block's own coinbase (MeshDirect): no payout
# threshold. WALLET must be an xpa1r... address from an xCoin node wallet
# (nex-cli getnewaddress): xCoin accepts only post-quantum outputs, and the
# pool refuses any other address at login. The first start builds a 4 GB
# dataset on the card; it grows 128 MB every two weeks.
# POWER: empty leaves the card alone; a number sets watts (needs root).
cd "$(dirname "$0")"

POOL=pool.meshpool.net:3350
WALLET=PUT_YOUR_XCOIN_ADDRESS_HERE
WORKER=rig1
POWER=

if [ "$WALLET" = "PUT_YOUR_XCOIN_ADDRESS_HERE" ]; then
  echo "Edit this file and set WALLET to your own xpa1r address first."
  exit 1
fi
PWR=""
[ -n "$POWER" ] && PWR="--power $POWER"
USER="$WALLET"
[ -n "$WORKER" ] && USER="$WALLET.$WORKER"
./meshpool-miner --algo metaldag --backend cuda --pool "$POOL" --user "$USER" --pass x $PWR
