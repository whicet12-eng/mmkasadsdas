DUAL MINING: ONE MINER, TWO ALGORITHMS AT ONCE
==============================================
MeshPool Miner 0.8.47


WHAT IT DOES
------------

One process mines two different algorithms at the same time: the graphics
card on one, the processor on the other. Two pools, two jobs, two sets of
shares, one program.

  meshpool-miner --algo x16rt --backend cuda --pool pool.meshpool.net:3344 \
                 --user YOUR_ADDRESS.rig1 \
                 --cpu-algo minotaurx --cpu-pool pool.meshpool.net:3345 \
                 --threads 24

That command mines Avian on both of its algorithms at once. X16RT belongs on
the card, MinotaurX on the processor, both pay the same address, and the
chain credits whichever side finds a block.


WHY IT EXISTS
-------------

Two reasons, and the second is the real one.

The processor in a mining rig is normally idle. A card mining X16RT leaves
sixteen or thirty-two threads doing nothing, and those threads are enough to
mine a CPU algorithm properly.

The second reason is rented servers. Most rental platforms run exactly one
container image per machine. You cannot start a second container for the
processor, so without this the CPU half of the machine is simply wasted. One
process solves that, because the platform only ever sees one image.


HOW TO USE IT
-------------

--cpu-algo is the switch. Without it the miner behaves exactly as it always
has, one algorithm, and nothing about an existing setup changes.

  --cpu-algo <algo>       the algorithm for the processor. This turns dual
                          mining on.
  --cpu-pool <host:port>  the pool for it. Defaults to --pool.
  --cpu-user <address>    the address for it. Defaults to --user.
  --threads N             threads for the processor stream. All of them by
                          default; leave some free if the machine does
                          anything else.

With --cpu-algo set, the first stream gets the card and only the card, and
the processor belongs entirely to the second stream.


TWO COINS, TWO WALLETS
----------------------

The streams are independent, so they need not be the same coin. Card on one
chain, processor on another, two different addresses:

  meshpool-miner --algo x16rt --backend cuda --pool pool.meshpool.net:3344 \
                 --user RYOUR_AVIAN_ADDRESS.rig1 \
                 --cpu-algo yespower --cpu-pool pool.meshpool.net:3340 \
                 --cpu-user dragon1YOUR_DRAGONCHAIN_ADDRESS.rig1 \
                 --threads 24

The address decides the chain, so each stream is charged its own chain's fee
rate automatically. Two different wallets on the SAME coin work too: each
pool credits whichever address sent it the shares.

Each stream keeps its own pool fallback list, its own fee account and its own
connection. If one pool goes down, the other keeps mining.


WHAT YOU WILL SEE
-----------------

The banner prints both streams, the second under a heading of its own, with
its algorithm, pool, address and fee. Share lines are tagged s1 and s2 so it
is clear which stream earned what:

  s1 GPU0 accepted blk 5228331  work  47.6 MH   1.1x  [ 7ms] [...:3344]
  s2 CPU  accepted blk 5228331  work  1.12 MH   5.2x  [ 7ms] [...:3345]

The stats table carries one row per device with its stream and algorithm:

  GPU0   :   35.05 MH/s [    97|    0|    0]  s1 x16rt
  CPU    :   11.13 kH/s [     8|    0|    0]  s2 minotaurx
  Total  :   35.06 MH/s [   105|    0|    0]  two algorithms, summed

Read the per-stream rows, not the total. Adding a GPU hashrate to a CPU
hashrate gives a number with no meaning; the total exists because rig
management software reads it.


DOCKER
------

  docker run --gpus all -it bawls/meshminer:0.8.47 \
      --algo x16rt --backend cuda --pool pool.meshpool.net:3344 \
      --user YOUR_ADDRESS.rig1 \
      --cpu-algo minotaurx --cpu-pool pool.meshpool.net:3345 --threads 24

One container, both algorithms. On a rented machine that only loads one
image, this is the whole point.


HIVEOS
------

A Flight Sheet has one algorithm field, one URL and one template, so it
cannot describe two streams on its own. Put the second stream in "Extra
config arguments" instead:

  --cpu-algo minotaurx --cpu-pool pool.meshpool.net:3345 --threads 24

Those arguments land last on the command line and the miner picks them up.
The wrapper forces the card-side backend for you when it sees --cpu-algo.


WHAT WILL STOP YOU
------------------

The miner refuses these before it opens a single connection, and says why:

  - --cpu-algo together with --backend cpu. Nothing would be left for the
    first stream to mine on.
  - a first algorithm with no GPU kernel, such as minotaurx or yespower.
    Those are processor algorithms; put them on --cpu-algo instead.
  - an unknown --cpu-algo, or no graphics card present.


FEES
----

Each stream pays its own chain's fee, at its own rate, shown in the banner
for both. Two streams on one coin means one address and two ports, so the
same fee address appears twice. Nothing is hidden: the rate and the address
are printed at every start, and a fee stint is coloured while it happens and
tagged with the stream it belongs to.


HONEST NOTES
------------

  - This is not a new idea. SRBMiner-Multi has mined several algorithms at
    once for years. What is described here is what THIS miner does.
  - The total hashrate line sums two algorithms, which is meaningless on its
    own. The per-stream rows are the real numbers.
  - Rigs with more than one card have not been tested with two streams. The
    per-device rows and --device are unchanged in shape, but say so if it
    misbehaves.
  - Only the first stream restarts a failed backend. If the processor
    stream's pool disappears it retries on its own; if the card's backend
    dies the process exits, as before, so a launcher can restart it.
