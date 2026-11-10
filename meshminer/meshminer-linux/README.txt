MeshPool Miner 0.8.47
===========================

A miner for MeshPool.

  Lumenite (LMT)     HomeScrypt v1.2, NVIDIA or AMD GPU, or processor
  Dragonchain (DRGN) yespower, processor
  Avian (AVN)        two algorithms on one coin: X16RT on an NVIDIA GPU,
                     MinotaurX on the processor. Same address for both.
  RCPU (RCPU)        RandomX, processor
  ConnectCoin (CONN) RandomX V2, processor
  Riecoin (RIC)      prime constellations, NVIDIA GPU (any Riecoin pool)
  xCoin (XID)        MetalDAG, NVIDIA GPU with 6 GB or more
  Discrete (XDS)     DiscretePower, processor and/or NVIDIA GPU
  AuronQ (AURQ)      AQM64 (Argon2id, 64 MB a hash), processor and/or NVIDIA GPU
  NULL (NULL)        Equihash 144,5, NVIDIA GPU
  Pearl (PRL)        NoisyGEMM, NVIDIA RTX 30-series or newer


QUICK START
-----------

Lumenite:  edit start-lumenite-v12.sh, set WALLET to your lmt1 address,
           save, and run it. AMD card: start-lumenite-opencl.sh instead
           (OpenCL).

Dragonchain: the same with start-dragonchain.sh and your dragon1
           address. CPU only.

RCPU:      the same with start-rcpu.sh and your rcpu1 address -- not a
           confidential rcpux1 address, which a block reward cannot pay.
           CPU only; the first start builds a 2 GB dataset (a few seconds).

ConnectCoin: the same with start-connectcoin.sh and your cc1p address
           (the pool takes only cc1p... addresses). CPU only; the first
           start builds a 2 GB dataset (a few seconds), and it is rebuilt
           in place, a pause of a second or two, when the chain's RandomX
           key changes (every 12,288 blocks).

Riecoin:   the same with start-riecoin.sh and your ric1q address. It
           mines on MeshPool (port 3349) by default, paid in the block's
           own coinbase; change POOL in the file for another Riecoin pool.
           The first start makes a prime table (under a second) and loads
           it onto the card.

xCoin:     the same with start-xcoin.sh and your xpa1r address, made
           in an xCoin node wallet (nex-cli getnewaddress). xCoin takes
           only post-quantum outputs, so the pool refuses any other kind.
           The first start builds a 4 GB dataset on the card (a few
           seconds); it grows 128 MB every two weeks and is rebuilt then.

Discrete:  the same with start-discrete.sh and your disc1q address. It
           runs on the processor by default; set BACKEND=cuda in the
           file for an NVIDIA card, or both for the card and the
           processor together. Every thread (and every hash in flight
           on the card) uses 16 MB, and the rate is memory-bound, so on
           a 16-core desktop THREADS=16 beats using every logical
           processor. The pool holds the signing keys (see REQUIREMENTS)
           and takes 10% at payout.

AuronQ:    the same with start-auronq.sh and your aurq1 address. It
           runs on the processor by default; set BACKEND=cuda in the
           file for an NVIDIA card, or both for the card and the
           processor together. Every thread holds 64 MB of memory for
           the whole run, so the miner starts one thread per physical
           core and caps that to fit in 3/4 of your free memory (it
           prints what it chose). THREADS= in the file overrides the
           count, never the cap. The card holds one hash per 64 MB of
           free memory and takes all it can by default.

NULL:      the same with start-null.sh and your null1 address. NVIDIA
           card only, about 3 GB of card memory; the card is checked
           against the chain's own test vectors at every start.

Pearl:     the same with start-pearl.sh and your prl1p address. NVIDIA
           RTX 30-series or newer only (it needs tensor cores; a 20-series
           card is refused). The card is checked at every start, and
           every share is checked on the processor before it is sent.
           Any Pearl pool works: point --pool at Kryptex, 2Miners,
           Suprnova, LuckyPool or f2pool with the login that pool asks
           for and the miner finds the pool's protocol by itself
           (--pearl-dialect public skips the probe). MeshPool takes the
           other Pearl miners too.

Avian:     start-avian-x16rt.sh for the card, start-avian-minotaurx.sh
           for the processor, both with your R... address. A rig with a
           card and spare CPU can run both at once.

           Or start-avian-dual.sh, which mines BOTH at once in ONE
           miner: the card on X16RT and the processor on MinotaurX,
           paying the same address. See README-dual.txt.

That is all. There is nothing to install and no config file.


WHAT IS IN HERE
---------------

  meshpool-miner        the miner
  start-lumenite-v12.sh    mine Lumenite on MeshPool (port 3335)
  start-lumenite-opencl.sh the same on an AMD card (OpenCL)
  start-dragonchain.sh     mine Dragonchain on MeshPool (port 3340), CPU
  start-avian-x16rt.sh     mine Avian X16RT on MeshPool (port 3344), GPU
  start-avian-minotaurx.sh mine Avian MinotaurX on MeshPool (port 3345), CPU
  start-avian-dual.sh      mine BOTH Avian algorithms at once, one miner
  start-rcpu.sh            mine RCPU on MeshPool (port 3348), CPU
  start-connectcoin.sh     mine ConnectCoin on MeshPool (port 3351), CPU
  start-riecoin.sh         mine Riecoin on MeshPool (port 3349), GPU
  start-xcoin.sh           mine xCoin on MeshPool (port 3350), GPU
  start-discrete.sh        mine Discrete on MeshPool (port 3358), CPU and/or GPU
  start-auronq.sh          mine AuronQ on MeshPool (port 3359), CPU and/or GPU
  start-null.sh            mine NULL on MeshPool (port 3361), GPU
  start-pearl.sh           mine Pearl on MeshPool (port 3363), GPU
  README-dual.txt           how dual mining works, and two coins at once
  check-gpu.sh             verify your GPU computes correct hashes


REQUIREMENTS
------------

  Lumenite     NVIDIA RTX 20-series or newer, or any 64-bit processor.
               AMD cards through OpenCL (--backend opencl), with the
               AMD driver installed (Adrenalin on Windows, the amdgpu /
               ROCm OpenCL runtime on Linux; HiveOS has it), and 4 GB or
               more of memory -- each hash in flight needs 16 MB.
               No CUDA toolkit needed; the driver is enough. Measured
               on an RX 9070 XT (16 GB, ROCm 7.2): about 2.9 kH/s once
               the autotune has run (by itself on the first job, about
               half a minute). A Radeon VII does about 1.2 kH/s. Run
               check-gpu first (it tests OpenCL too); if anything fails
               the miner tells the pool what the driver said.

  RCPU         a 64-bit processor and about 2.3 GB of free memory
               (--randomx-light runs in 256 MB at a tenth of the speed).

  ConnectCoin  the same as RCPU. About 10 kH/s on a 16-core Ryzen 9
               9950X3D (32 threads).

  Huge pages   RandomX (Bitfuc, RCPU, ConnectCoin) uses 2 MiB pages when
               it can, and ordinary ones when not; the start-up line says
               which. Windows: run the miner once as Administrator (it
               grants "Lock pages in memory"), then sign out and in.
               Linux: run as root and the miner reserves them itself;
               otherwise sudo sysctl -w vm.nr_hugepages=1280. HiveOS: done
               for you. Linux without a reservation (the Docker image,
               for one) now falls back to the kernel's transparent
               huge pages by itself. MESHMINER_NO_HUGEPAGES=1 turns
               them off. Windows refuses large pages with "OS error
               1450" when memory is fragmented after long uptime;
               the miner frees cached memory and retries, and if it
               still fails, a restart and an early start is the fix.

  Registers    On Linux as root (HiveOS is), the miner writes the
               same CPU registers every RandomX miner does on Ryzen
               and Intel, worth 5-15 % on Zen 3 and later, and puts
               them back when it ends. MESHMINER_NO_MSR=1 leaves
               them alone. Not on Windows (it needs a driver).

  Riecoin      NVIDIA RTX 20-series or newer with at least 4 GB of
               memory (it uses about 2.7 GB).

  xCoin        NVIDIA RTX 20-series or newer with at least 6 GB of
               memory (the dataset is 4 GB at launch, +128 MB every two
               weeks). About 97 MH/s on a 3080 Ti.

  Discrete     any 64-bit processor, 16 MB of memory per thread, about
               195 H/s a thread; 1.9 kH/s from 16 threads on a 16-core
               Ryzen 9 9950X3D (more threads is slower: memory-bound).
               NVIDIA RTX 20-series or newer: 589 H/s on a 3080 Ti at
               160-240 W, about three CPU cores' worth. The card holds
               one hash per 16 MB of free memory, so a 24-32 GB card
               should do about twice that. Not on OpenCL / AMD cards.
               The proof of work signs every nonce (ML-DSA-65, a
               post-quantum signature) and the key has to be held by
               whoever mines: the pool hands each connection one of its
               own deposit keys, the miner signs locally, and the pool
               pays the block reward out by PPLNS to the disc1q address
               in your --user. Your own wallet key is never involved.

  AuronQ       any 64-bit processor with 64 MB of memory per thread
               (Argon2id, two passes): about 30 H/s a core, 140-160 H/s
               from 16 threads on a 16-core Ryzen 9 9950X3D (more
               threads add nothing: memory-bound). One thread per
               physical core by default, see QUICK START.
               NVIDIA RTX 20-series or newer: 858 H/s on a 3080 Ti with
               157 hashes in flight (10 GB), five to six times the 16
               CPU threads. The card holds one hash per 64 MB of free
               memory and the rate is linear in that, so a 24 GB card
               should do about 1.9 kH/s. Not on OpenCL / AMD cards:
               --backend opencl is refused.

  NULL         NVIDIA RTX 20-series or newer with 4 GB or more of memory
               (about 3 GB in use). About 130 Sol/s on a 3080 Ti at
               stock power. Not on OpenCL / AMD cards, and the processor
               only mines the test network.

  Pearl        NVIDIA RTX 30-series or newer (Ampere and later) with
               2 GB or more of memory. About 108 TH/s on a 3080 Ti at
               stock power. The rate is in TH/s, the unit Pearl uses
               (int8 multiply-adds per second); it does not compare
               with H/s on any other coin. Not on OpenCL / AMD cards,
               not on the processor, and not on 20-series cards.

  GTX 10-series and older cards are not supported.


OPTIONS
-------

  --pool a,b,c        fallback pools in order. If the first cannot be
                      reached the miner moves to the next, and checks
                      every minute whether a better one is back.
  --power 250         cap the card at 250 W. Needs administrator (root).
                      On HomeScrypt a 3080 Ti holds full speed at 250 W
                      and runs much cooler.
  --power auto        Riecoin only: find the limit by itself. It starts
                      at 3/4 of the card's default and adds 10 W a minute
                      while that still buys speed, stopping before 80 C or
                      a driver slowdown. The result is remembered per card;
                      --power retune starts over, --power-temp 75 sets a
                      lower ceiling. Needs administrator (root).
  --tune              Riecoin only: measure this card's best pipeline
                      settings. It reads the card (SMs, L2, shared memory)
                      and then times each setting for a few seconds, about
                      three minutes in all, mining nothing meanwhile. Done
                      by itself the first time a card is seen and remembered
                      by the card's name and power limit, so a changed limit
                      is measured again; --tune measures again, --no-tune
                      skips it, --tune 10 spends 10 s a setting.
                      --tune-verbose names each setting and, at the end,
                      prints the --ric-* flags that pin the result on any
                      machine.
  --ric-old-shares    Riecoin only: send only shares whose first five
                      numbers are prime in a row, as versions before 0.8.13
                      did, for a pool that still counts them that way.
                      MeshPool counts every share the chain's rule accepts.
  --device 0,1        mine on some cards only
  --backend opencl    Lumenite on an AMD card (or any OpenCL GPU);
                      opencl+cpu adds the processor. --device then uses
                      the OpenCL numbers printed in the banner. An
                      integrated GPU is listed but only mined if named.
  --bench 20          Lumenite: hash on the card for 20 s and print H/s,
                      no pool needed. Add --backend opencl for AMD.
  --gpu-batch 640     Discrete and AuronQ: hashes in flight on the card.
                      By default the miner takes the free memory minus
                      1 GB, which keeps Windows from quietly paging the
                      card's memory to RAM (four times slower). 640 fits
                      a 12 GB card with a light desktop on Discrete (16 MB
                      a hash); on AuronQ (64 MB a hash) the same card
                      holds about 157. Leave the default on a card that
                      also drives monitors.
  --threads 16        Discrete: processor threads (all logical processors
                      by default; on a 16-core desktop 16 is faster).
                      AuronQ: one per physical core by default, capped
                      so threads x 64 MB fits in 3/4 of free memory.
  --fan auto          leave the fans to the driver
  --help              everything else


FEES
----

The miner takes a small fee by mining to the developer's address for a
slice of the time, shown in the banner and in pink while it happens:

  Lumenite    0.5% on MeshPool, 1.2% on other pools
  Avian       0.5% on MeshPool, 1% on other pools -- and on Avian the fee
              is mined on whichever pool you use, to the address shown
  the others  0.5% on MeshPool, 1.2% on other pools -- RCPU included
  Bitfuc, Korsh and Slithy Tove have no MeshPool pool, so their fee is
  mined on whichever pool you use, to the address shown, as on Avian.
  Slithy Tove's testnet mines free until its mainnet on 2026-11-01.

  Riecoin     no fee yet.
  xCoin       0.5% on MeshPool, 1.2% on other pools.
  ConnectCoin 0.5% on MeshPool, 1.2% on other pools.
  Discrete    0.5% on MeshPool, 1.2% on other pools. During the fee
              slice the miner logs in to the pool with the developer's
              disc1q address instead of yours, the pool hands that
              session a key of its own, and the shares are credited to
              that address -- the same stint model as every other coin,
              just with the pool holding the keys. Separate from the
              pool's own 10% at payout.
  AuronQ      0.5% on MeshPool, 1.2% on other pools. The fee is mined
              on whichever pool you use, to the address shown, as on
              Avian (MeshPool's is the only AuronQ stratum there is).
  NULL        0.5% on MeshPool, 1.2% on other pools, mined on whichever
              pool you use, as on AuronQ.
  Pearl       0.5% on MeshPool, 1.5% on other pools, mined on whichever
              pool you use, as on AuronQ.

Nothing is hidden: the address and the rate are printed at every start.


RIECOIN: WHAT THE NUMBERS MEAN
------------------------------

Riecoin does not hash; the card tests numbers for being prime. The rate
is shown in c/s, candidates tested per second, and does not compare with
H/s on any other coin or with the "hashrate" on block explorers.

  tuples a/b/c/d/e/f/g   how often 1, 2, ... 7 primes in a row were found
  5 or 6 in a row        a share: shows the pool you are working
  7 in a row             a block, "full 7-tuple" in the log

Each step is about 20 times rarer than the one before. The stats line
also shows the card's temperature, power and clock: if the rate drops
while the temperature climbs, the card is throttling.
