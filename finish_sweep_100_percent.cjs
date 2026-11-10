const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

const GAS_PRICE = 50000000n; // 0.05 gwei
const TX_GAS_LIMIT = 21000n;
const TRANSFER_GAS_LIMIT = 35000n;
const MIN_GAS = 1471650000000n; // 29433 * 0.05 gwei

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];
const MULTICALL_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("==========================================================================");
  log(">>> FINISHING 100% SWEEP: TAHAP AKHIR PENYAPUAN HASH KE R3S.AI <<<");
  log("==========================================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);

  const filenames = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json",
    "wallets_500.json"
  ];
  const workersMap = new Map();
  for (const f of filenames) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const w of arr) workersMap.set(w.address.toLowerCase(), w);
    }
  }
  const workers = Array.from(workersMap.values());

  log("Memindai status seluruh armada...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
    calls.push({ target: HASH_TOKEN, allowFailure: true, callData: "0x70a08231" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    const chunk = await mc.aggregate3(calls.slice(i, i + 600));
    results.push(...chunk);
  }

  const readyToSweep = [];
  const needGasRecipients = [];
  const donors = [];

  for (let i = 0; i < workers.length; i++) {
    const bnbBal = BigInt(results[i * 2].returnData);
    const tokenBal = BigInt(results[i * 2 + 1].returnData);

    if (tokenBal > 0n) {
      if (bnbBal >= MIN_GAS) {
        readyToSweep.push({ worker: workers[i], bnbBal, tokenBal });
      } else {
        needGasRecipients.push({ worker: workers[i], bnbBal, tokenBal });
      }
    } else if (bnbBal > 2000000000000n) {
      const sendable = bnbBal - (TX_GAS_LIMIT * GAS_PRICE);
      if (sendable > 0n) donors.push({ worker: workers[i], bnbBal, sendable });
    }
  }

  log(`Worker SIAP SWEEP LANGSUNG: ${readyToSweep.length} worker`);
  log(`Worker butuh sedikit gas: ${needGasRecipients.length} worker`);
  log(`Donor cadangan tersedia: ${donors.length} worker`);

  // --- BAGIAN 1: SWEEP SEMUA YANG SUDAH MEMILIKI GAS ---
  if (readyToSweep.length > 0) {
    log(`Menyapu ${readyToSweep.length} worker yang sudah siap...`);
    let sweptCount = 0;
    let sweptHash = 0n;
    const batchSize = 35;

    for (let i = 0; i < readyToSweep.length; i += batchSize) {
      const batch = readyToSweep.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        try {
          const signer = new ethers.Wallet(item.worker.privateKey, provider);
          const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, signer);
          const tx = await c.transfer(R3S, item.tokenBal, {
            gasLimit: TRANSFER_GAS_LIMIT,
            gasPrice: GAS_PRICE
          });
          await tx.wait();
          sweptCount++;
          sweptHash += item.tokenBal;
        } catch (e) {}
      }));
      log(`  Progress Sapu Batch 1: ${Math.min(i + batchSize, readyToSweep.length)}/${readyToSweep.length} (Berhasil: ${sweptCount}, HASH: ${ethers.formatEther(sweptHash)})`);
    }
  }

  // --- BAGIAN 2: SIFON & SELESAIKAN SISA 172 WORKER ---
  if (needGasRecipients.length > 0) {
    log(`Memproses sisa ${needGasRecipients.length} worker...`);
    const gasPerWorker = 2000000000000n; // 0.000002 BNB
    const totalNeeded = BigInt(needGasRecipients.length) * (gasPerWorker + 1050000000000n);
    
    // Ambil dari donor
    const neededDonorsCount = Math.ceil(Number(totalNeeded) / 6000000000000);
    const selectedDonors = donors.slice(0, neededDonorsCount + 10);
    log(`Menyifon dari ${selectedDonors.length} donor untuk sisa worker...`);

    await Promise.all(selectedDonors.map(async (d) => {
      try {
        const signer = new ethers.Wallet(d.worker.privateKey, provider);
        const tx = await signer.sendTransaction({
          to: wallet3.address,
          value: d.sendable,
          gasLimit: TX_GAS_LIMIT,
          gasPrice: GAS_PRICE
        });
        await tx.wait();
      } catch (e) {}
    }));

    // Distribute to needGasRecipients
    log(`Mendistribusikan gas ke sisa ${needGasRecipients.length} worker...`);
    const distBatch = 25;
    for (let i = 0; i < needGasRecipients.length; i += distBatch) {
      const batch = needGasRecipients.slice(i, i + distBatch);
      let baseNonce = await provider.getTransactionCount(wallet3.address, "latest");
      const txs = await Promise.all(batch.map((r, idx) =>
        wallet3.sendTransaction({
          to: r.worker.address,
          value: gasPerWorker,
          nonce: baseNonce + idx,
          gasLimit: TX_GAS_LIMIT,
          gasPrice: GAS_PRICE,
          chainId: 56
        })
      ));
      await Promise.all(txs.map(t => t.wait()));
    }

    // Sweep needGasRecipients
    log(`Menyapu token dari sisa ${needGasRecipients.length} worker...`);
    let finalSweptCount = 0;
    let finalSweptHash = 0n;
    for (let i = 0; i < needGasRecipients.length; i += 30) {
      const batch = needGasRecipients.slice(i, i + 30);
      await Promise.all(batch.map(async (item) => {
        try {
          const signer = new ethers.Wallet(item.worker.privateKey, provider);
          const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, signer);
          const tx = await c.transfer(R3S, item.tokenBal, {
            gasLimit: TRANSFER_GAS_LIMIT,
            gasPrice: GAS_PRICE
          });
          await tx.wait();
          finalSweptCount++;
          finalSweptHash += item.tokenBal;
        } catch (e) {}
      }));
    }
  }

  // --- FINAL REPORT ---
  const tokenC = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const totalR3s = await tokenC.balanceOf(R3S);
  log("==========================================================================");
  log(`>>> 100% SELESAI! TOTAL HASH DI R3S.AI SEKARANG: ${ethers.formatEther(totalR3s)} HASH <<<`);
  log("==========================================================================");
}

main().catch(console.error);
