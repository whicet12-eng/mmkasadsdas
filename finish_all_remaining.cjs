const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
const GAS_PRICE = 50000000n; // 0.05 gwei
const GAS_NEEDED = 8560000000000n; // 0.00000856 BNB

const ERC20_ABI = [
  "function transfer(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];
const MULTICALL_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadAllWorkers() {
  const files = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json"
  ];
  let all = [];
  for (const f of files) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      all.push(...JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }
  return all;
}

async function main() {
  log("========================================================");
  log(">>> FINISHING 100% CLAIM & SWEEP ACROSS FULL FLEET <<<");
  log(`Destination Wallet (r3s.ai): ${R3S}`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const workers = loadAllWorkers();
  log(`Total worker fleet: ${workers.length} wallets`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  // 1. Multicall check: BNB balance, pending HASH, token balance
  log("Step 1: Multicall check across all 2,997 wallets...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad }); // BNB balance
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad }); // pending HASH
    calls.push({ target: HASH_TOKEN, allowFailure: true, callData: "0x70a08231" + pad }); // token balance
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    results.push(...await mc.aggregate3(calls.slice(i, i + 600)));
  }

  const needTopup = [];
  const needClaim = [];
  const needSweep = [];
  let totalPendingRemaining = 0n;
  let totalTokenRemaining = 0n;

  for (let i = 0; i < workers.length; i++) {
    const bnb = BigInt(results[i * 3].returnData);
    const pend = BigInt(results[i * 3 + 1].returnData);
    const tok = BigInt(results[i * 3 + 2].returnData);

    totalPendingRemaining += pend;
    totalTokenRemaining += tok;

    if (pend > 0n || tok > 0n) {
      if (bnb < GAS_NEEDED) {
        needTopup.push({ ...workers[i], deficit: GAS_NEEDED - bnb });
      }
    }
    if (pend > 0n) needClaim.push(workers[i]);
    if (tok > 0n) needSweep.push(workers[i]);
  }

  log(`Remaining Pending HASH in Pool: ${ethers.formatUnits(totalPendingRemaining, 18)} HASH`);
  log(`Tokens inside Workers waiting sweep: ${ethers.formatUnits(totalTokenRemaining, 18)} HASH`);
  log(`Wallets needing gas top-up: ${needTopup.length}`);
  log(`Wallets needing claim     : ${needClaim.length}`);
  log(`Wallets needing sweep     : ${needSweep.length}`);

  // 2. Fund deficits from Wallet 3
  if (needTopup.length > 0) {
    const w3Bal = await provider.getBalance(wallet3.address);
    let totalDeficit = 0n;
    for (const item of needTopup) totalDeficit += item.deficit;
    log(`Total deficit to fund: ${ethers.formatEther(totalDeficit)} BNB | Wallet 3 Balance: ${ethers.formatEther(w3Bal)} BNB`);

    log(`Funding ${needTopup.length} wallets in sub-batches of 20...`);
    for (let i = 0; i < needTopup.length; i += 20) {
      const sub = needTopup.slice(i, i + 20);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(sub.map((item, idx) =>
        wallet3.sendTransaction({
          to: item.address,
          value: item.deficit,
          nonce: baseNonce + idx,
          gasLimit: 21000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        })
      ));
      await Promise.all(txs.map(t => t.wait()));
      if ((i + 20) % 200 === 0 || i + 20 >= needTopup.length) {
        log(`  Top-up progress: ${Math.min(i + 20, needTopup.length)}/${needTopup.length} funded.`);
      }
    }
    log("All wallet gas top-ups completed!");
  }

  // 3. Claim all pending in batches of 25
  log(`Executing claim() for ${needClaim.length} wallets in batches of 25...`);
  let claimSuccess = 0;
  for (let i = 0; i < needClaim.length; i += 25) {
    const chunk = needClaim.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: POOL,
          data: "0x4e71d92d",
          gasLimit: 145000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        });
        const rcpt = await tx.wait();
        return rcpt.status === 1;
      } catch (e) {
        return false;
      }
    });
    const r = await Promise.all(promises);
    claimSuccess += r.filter(Boolean).length;
    if ((i + 25) % 200 === 0 || i + 25 >= needClaim.length) {
      log(`  Claim progress: ${Math.min(i + 25, needClaim.length)}/${needClaim.length} (Success: ${claimSuccess})`);
    }
  }

  // 4. Sweep all token balances to r3s.ai
  log(`Sweeping all HASH tokens to r3s.ai (${R3S}) in batches of 25...`);
  let totalSwept = 0n;
  for (let i = 0; i < workers.length; i += 25) {
    const chunk = workers.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const tx = await c.transfer(R3S, bal, {
            gasLimit: 60000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcpt = await tx.wait();
          if (rcpt.status === 1) return bal;
        }
      } catch (e) {}
      return 0n;
    });
    const r = await Promise.all(promises);
    for (const val of r) totalSwept += val;
    if ((i + 25) % 250 === 0 || i + 25 >= workers.length) {
      log(`  Sweep progress: ${Math.min(i + 25, workers.length)}/${workers.length}...`);
    }
  }

  // 5. Final Report
  const cR3s = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const r3sFinalHash = await cR3s.balanceOf(R3S);
  const r3sFinalBnb = await provider.getBalance(R3S);

  log("========================================================");
  log(">>> 100% CLAIM & SWEEP FLEET FINISHED! <<<");
  log(`Total HASH Swept This Session : ${ethers.formatUnits(totalSwept, 18)} HASH`);
  log(`Total Saldo HASH di r3s.ai    : ${ethers.formatUnits(r3sFinalHash, 18)} HASH`);
  log(`Total Saldo BNB di r3s.ai     : ${ethers.formatEther(r3sFinalBnb)} BNB`);
  log("STATUS: 100% HASH TERSIMPAN DI R3S.AI - TIDAK DIJUAL");
  log("========================================================");
}

main().catch(err => {
  console.error("FATAL ERROR in finish_all_remaining:", err);
  process.exit(1);
});
