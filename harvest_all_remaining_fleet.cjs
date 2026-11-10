const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

// PARAMETER GAS ULTRA-MINIMAL
const GAS_PRICE = 50000000n; // 0.05 gwei (batas terendah BSC konsensus)
const TRANSFER_GAS_LIMIT = 32000n; // Transfer hanya butuh 29.233 gas karena saldo r3s sudah > 0
const CLAIM_GAS_LIMIT = 110000n;   // Claim hanya butuh 103.504 gas

const SWEEP_TARGET_BNB = 1600000000000n; // 0.0000016 BNB (cukup untuk 32.000 gas)
const FULL_TARGET_BNB = 7100000000000n;  // 0.0000071 BNB (cukup untuk 142.000 gas: claim 110k + transfer 32k)

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
  const filenames = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json",
    "wallets_500.json"
  ];
  const workers = [];
  for (const f of filenames) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) workers.push(...JSON.parse(fs.readFileSync(p, "utf8")));
  }
  return workers;
}

async function main() {
  log("================================================================");
  log(">>> MULAI PANEN SELURUH ARMADA (MODE ULTRA-MINIMAL GAS) <<<");
  log(`Tujuan Penampungan (r3s.ai): ${R3S}`);
  log(`Gas Price: 0.05 gwei | Transfer GasLimit: 32k | Claim GasLimit: 110k`);
  log("================================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const workers = loadAllWorkers();
  log(`Total database worker: ${workers.length}`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Saldo Wallet 3 Distributor: ${ethers.formatEther(w3Bal)} BNB`);

  // 1. Multicall Scan
  log("Memindai status seluruh worker...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad });
    calls.push({ target: HASH_TOKEN, allowFailure: true, callData: "0x70a08231" + pad });
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    results.push(...await mc.aggregate3(calls.slice(i, i + 600)));
  }

  const group1_sweepOnly = [];
  const group2_claimAndSweep = [];
  let g1HashTotal = 0n;
  let g2HashTotal = 0n;

  for (let i = 0; i < workers.length; i++) {
    const pend = results[i * 3].success ? BigInt(results[i * 3].returnData) : 0n;
    const tok = results[i * 3 + 1].success ? BigInt(results[i * 3 + 1].returnData) : 0n;
    const bnb = results[i * 3 + 2].success ? BigInt(results[i * 3 + 2].returnData) : 0n;

    if (tok > ethers.parseUnits("0.01", 18)) {
      const def = bnb >= SWEEP_TARGET_BNB ? 0n : (SWEEP_TARGET_BNB - bnb);
      group1_sweepOnly.push({ ...workers[i], tok, bnb, def });
      g1HashTotal += tok;
    } else if (pend >= ethers.parseUnits("0.05", 18)) {
      const def = bnb >= FULL_TARGET_BNB ? 0n : (FULL_TARGET_BNB - bnb);
      group2_claimAndSweep.push({ ...workers[i], pend, bnb, def });
      g2HashTotal += pend;
    }
  }

  log(`Group 1 (Sudah Pegang Token): ${group1_sweepOnly.length} worker | Total: ${ethers.formatUnits(g1HashTotal, 18)} HASH`);
  log(`Group 2 (Belum Klaim):        ${group2_claimAndSweep.length} worker | Total: ${ethers.formatUnits(g2HashTotal, 18)} HASH`);
  log(`TOTAL HASH AKAN DIPANEN:     ${ethers.formatUnits(g1HashTotal + g2HashTotal, 18)} HASH`);

  // =========================================================================
  // FASE 1: TOP-UP & SWEEP GROUP 1
  // =========================================================================
  log("\n>>> MEMULAI FASE 1: SWEEP GROUP 1 <<<");
  const g1Topup = group1_sweepOnly.filter(x => x.def > 0n);
  log(`Worker Group 1 yang butuh top-up: ${g1Topup.length}/${group1_sweepOnly.length}`);

  if (g1Topup.length > 0) {
    for (let i = 0; i < g1Topup.length; i += 25) {
      const chunk = g1Topup.slice(i, i + 25);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(chunk.map((item, idx) =>
        wallet3.sendTransaction({
          to: item.address,
          value: item.def,
          nonce: baseNonce + idx,
          gasLimit: 21000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        })
      ));
      await Promise.all(txs.map(t => t.wait()));
    }
    log("Top-up Group 1 selesai!");
  }

  log(`Mengirim transfer HASH Group 1 (${group1_sweepOnly.length} worker) ke r3s.ai...`);
  let g1Success = 0;
  let g1Fail = 0;
  let g1Swept = 0n;

  for (let i = 0; i < group1_sweepOnly.length; i += 25) {
    const chunk = group1_sweepOnly.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await token.balanceOf(w.address);
        if (bal > 0n) {
          const tx = await token.transfer(R3S, bal, {
            gasLimit: TRANSFER_GAS_LIMIT,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rc = await tx.wait();
          if (rc.status === 1) return { success: true, amount: bal };
        }
        return { success: true, amount: 0n };
      } catch (e) {
        return { success: false, amount: 0n };
      }
    });

    const res = await Promise.all(promises);
    for (const r of res) {
      if (r.success) {
        g1Success++;
        g1Swept += r.amount;
      } else {
        g1Fail++;
      }
    }
    if ((i + 25) % 200 === 0 || i + 25 >= group1_sweepOnly.length) {
      log(`  Fase 1 progres: ${Math.min(i + 25, group1_sweepOnly.length)}/${group1_sweepOnly.length} (Sukses: ${g1Success}, Gagal: ${g1Fail}, HASH: ${ethers.formatUnits(g1Swept, 18)})`);
    }
  }

  // =========================================================================
  // FASE 2: TOP-UP, CLAIM & SWEEP GROUP 2
  // =========================================================================
  log("\n>>> MEMULAI FASE 2: CLAIM & SWEEP GROUP 2 <<<");
  const g2Topup = group2_claimAndSweep.filter(x => x.def > 0n);
  log(`Worker Group 2 yang butuh top-up: ${g2Topup.length}/${group2_claimAndSweep.length}`);

  if (g2Topup.length > 0) {
    for (let i = 0; i < g2Topup.length; i += 25) {
      const chunk = g2Topup.slice(i, i + 25);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(chunk.map((item, idx) =>
        wallet3.sendTransaction({
          to: item.address,
          value: item.def,
          nonce: baseNonce + idx,
          gasLimit: 21000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        })
      ));
      await Promise.all(txs.map(t => t.wait()));
      if ((i + 25) % 250 === 0 || i + 25 >= g2Topup.length) {
        log(`  Top-up Group 2 progres: ${Math.min(i + 25, g2Topup.length)}/${g2Topup.length} selesai`);
      }
    }
    log("Top-up Group 2 selesai!");
  }

  log(`Mengeksekusi Claim & Sweep Group 2 (${group2_claimAndSweep.length} worker)...`);
  let g2Success = 0;
  let g2Fail = 0;
  let g2Swept = 0n;

  for (let i = 0; i < group2_claimAndSweep.length; i += 25) {
    const chunk = group2_claimAndSweep.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        // Claim
        const txClaim = await w.sendTransaction({
          to: POOL,
          data: "0x4e71d92d",
          gasLimit: CLAIM_GAS_LIMIT,
          gasPrice: GAS_PRICE,
          chainId: 56
        });
        await txClaim.wait();

        // Sweep
        const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await token.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await token.transfer(R3S, bal, {
            gasLimit: TRANSFER_GAS_LIMIT,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rc = await txSweep.wait();
          if (rc.status === 1) return { success: true, amount: bal };
        }
        return { success: true, amount: 0n };
      } catch (e) {
        return { success: false, amount: 0n };
      }
    });

    const res = await Promise.all(promises);
    for (const r of res) {
      if (r.success) {
        g2Success++;
        g2Swept += r.amount;
      } else {
        g2Fail++;
      }
    }
    if ((i + 25) % 200 === 0 || i + 25 >= group2_claimAndSweep.length) {
      log(`  Fase 2 progres: ${Math.min(i + 25, group2_claimAndSweep.length)}/${group2_claimAndSweep.length} (Sukses: ${g2Success}, Gagal: ${g2Fail}, HASH: ${ethers.formatUnits(g2Swept, 18)})`);
    }
  }

  // =========================================================================
  // LAPORAN AKHIR
  // =========================================================================
  const finalR3sHash = await (new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider)).balanceOf(R3S);
  const finalR3sBnb = await provider.getBalance(R3S);
  const finalW3Bnb = await provider.getBalance(wallet3.address);

  log("\n================================================================");
  log(">>> REKAPITULASI AKHIR PANEN SELURUH ARMADA <<<");
  log(`Total HASH Masuk di r3s.ai: ${ethers.formatUnits(finalR3sHash, 18)} HASH`);
  log(`Fase 1 (Sweep Token):       ${g1Success} worker sukses (${ethers.formatUnits(g1Swept, 18)} HASH)`);
  log(`Fase 2 (Claim & Sweep):     ${g2Success} worker sukses (${ethers.formatUnits(g2Swept, 18)} HASH)`);
  log(`Total HASH Disapu Sesi Ini: ${ethers.formatUnits(g1Swept + g2Swept, 18)} HASH`);
  log(`Saldo Akhir BNB r3s.ai:     ${ethers.formatEther(finalR3sBnb)} BNB (~$${(Number(ethers.formatEther(finalR3sBnb)) * 700).toFixed(2)})`);
  log(`Sisa BNB di Wallet 3:       ${ethers.formatEther(finalW3Bnb)} BNB`);
  log("================================================================");
}

main().catch(console.error);
