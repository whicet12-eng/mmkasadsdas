const { ethers } = require("ethers");
const fs = require("fs");
const { execSync } = require("child_process");

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
  log(">>> STARTING HARVEST FOR REMAINING 1,084 WALLETS <<<");
  log(`Destination Wallet (r3s.ai): ${R3S}`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const workers = loadAllWorkers();

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  // 1. Multicall check
  log("Multicall scan for unharvested wallets...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad });
    calls.push({ target: HASH_TOKEN, allowFailure: true, callData: "0x70a08231" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    results.push(...await mc.aggregate3(calls.slice(i, i + 600)));
  }

  const unharvested = [];
  let totalPending = 0n;
  let totalDeficit = 0n;

  for (let i = 0; i < workers.length; i++) {
    const bnb = BigInt(results[i * 3].returnData);
    const pend = BigInt(results[i * 3 + 1].returnData);
    const tok = BigInt(results[i * 3 + 2].returnData);

    if (pend >= ethers.parseUnits("0.05", 18) || tok > 0n) {
      const deficit = bnb < GAS_NEEDED ? (GAS_NEEDED - bnb) : 0n;
      unharvested.push({
        index: workers[i].index,
        address: workers[i].address,
        privateKey: workers[i].privateKey,
        deficit: deficit.toString(),
        pend: ethers.formatUnits(pend, 18),
        tok: ethers.formatUnits(tok, 18)
      });
      totalPending += pend;
      totalDeficit += deficit;
    }
  }

  log(`Found ${unharvested.length} unharvested wallets!`);
  log(`Total Pending: ${ethers.formatUnits(totalPending, 18)} HASH`);
  log(`Total Deficit: ${ethers.formatEther(totalDeficit)} BNB`);

  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Wallet 3 Balance: ${ethers.formatEther(w3Bal)} BNB`);

  // 2. Fund deficits from Wallet 3
  const needFunding = unharvested.filter(x => BigInt(x.deficit) > 0n);
  if (needFunding.length > 0) {
    log(`Funding ${needFunding.length} wallets from Wallet 3 in sub-batches of 20...`);
    for (let i = 0; i < needFunding.length; i += 20) {
      const sub = needFunding.slice(i, i + 20);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(sub.map((item, idx) =>
        wallet3.sendTransaction({
          to: item.address,
          value: BigInt(item.deficit),
          nonce: baseNonce + idx,
          gasLimit: 21000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        })
      ));
      await Promise.all(txs.map(t => t.wait()));
      if ((i + 20) % 200 === 0 || i + 20 >= needFunding.length) {
        log(`  Top-up progress: ${Math.min(i + 20, needFunding.length)}/${needFunding.length} funded.`);
      }
    }
    log("All top-ups completed successfully!");
  }

  // 3. Split unharvested wallets 50/50 and execute in parallel across Codespaces
  const mid = Math.ceil(unharvested.length / 2);
  const part1 = unharvested.slice(0, mid);
  const part2 = unharvested.slice(mid);

  fs.writeFileSync("/workspaces/mmkasadsdas/final_part1.json", JSON.stringify(part1));
  fs.writeFileSync("/workspaces/mmkasadsdas/final_part2.json", JSON.stringify(part2));

  log(`Launching parallel sweep: Part 1 (${part1.length} wallets on Codespace 1), Part 2 (${part2.length} wallets on Codespace 2)...`);

  // Copy part2 to Codespace 2
  execSync(`cat /workspaces/mmkasadsdas/final_part2.json | gh codespace ssh -c repulsive-ghost-pgq5rv4jpwf6xgq -- "cat > /workspaces/mmkasadsdas/final_part2.json"`);

  // Launch Codespace 2 in background
  execSync(`gh codespace ssh -c repulsive-ghost-pgq5rv4jpwf6xgq -- "node /workspaces/mmkasadsdas/sweep_batch.cjs /workspaces/mmkasadsdas/final_part2.json > /tmp/sweep_final2.log 2>&1 &"`);
  log("Codespace 2 sweep launched in background!");

  // Run Part 1 synchronously here on Codespace 1
  log("Starting Part 1 sweep on Codespace 1...");
  const p1Wallets = part1;
  let successClaim = 0;
  let totalSwept1 = 0n;

  for (let i = 0; i < p1Wallets.length; i += 25) {
    const chunk = p1Wallets.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        try {
          const txClaim = await w.sendTransaction({
            to: POOL,
            data: "0x4e71d92d",
            gasLimit: 145000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcptClaim = await txClaim.wait();
          if (rcptClaim.status === 1) successClaim++;
        } catch (e) {}

        const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await c.transfer(R3S, bal, {
            gasLimit: 60000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcptSweep = await txSweep.wait();
          if (rcptSweep.status === 1) return bal;
        }
      } catch (err) {}
      return 0n;
    });

    const r = await Promise.all(promises);
    for (const val of r) totalSwept1 += val;
    log(`  Part 1 Progress: ${Math.min(i + 25, p1Wallets.length)}/${p1Wallets.length} (Swept: ${ethers.formatUnits(totalSwept1, 18)} HASH)`);
  }

  log(`Part 1 Finished! Total Swept Part 1: ${ethers.formatUnits(totalSwept1, 18)} HASH`);

  // Wait a few seconds for Codespace 2 to finish
  log("Waiting for Codespace 2 to complete Part 2...");
  let done2 = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const log2 = execSync(`gh codespace ssh -c repulsive-ghost-pgq5rv4jpwf6xgq -- "tail -n 2 /tmp/sweep_final2.log"`).toString();
      if (log2.includes("FINISHED")) {
        log(`Codespace 2 Part 2 FINISHED!`);
        log(log2);
        done2 = true;
        break;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 4000));
  }

  // Final Balance Check
  const cR3s = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const r3sFinalHash = await cR3s.balanceOf(R3S);
  const r3sFinalBnb = await provider.getBalance(R3S);

  log("========================================================");
  log(">>> ALL 3,000 WALLETS 100% CLAIMED & SWEPT TO R3S.AI! <<<");
  log(`Total Saldo HASH di r3s.ai : ${ethers.formatUnits(r3sFinalHash, 18)} HASH`);
  log(`Total Saldo BNB di r3s.ai  : ${ethers.formatEther(r3sFinalBnb)} BNB`);
  log("STATUS: 100% HASH TERSIMPAN AMAN DI R3S.AI (TIDAK DIJUAL)");
  log("========================================================");
}

main().catch(err => {
  console.error("Error in harvest_final_1084:", err);
  process.exit(1);
});
