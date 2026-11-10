const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

const GAS_PRICE = 50000000n; // 0.05 gwei (biaya gas paling murah di BSC)
const TX_GAS_LIMIT = 21000n; // gas untuk kirim native BNB
const TRANSFER_GAS_LIMIT = 40000n; // gas limit aman untuk ERC20 transfer (riil: 29.433)
const TRANSFER_GAS_COST = TRANSFER_GAS_LIMIT * GAS_PRICE; // 2,000,000,000,000 wei (0.000002 BNB)
const TX_GAS_COST = TX_GAS_LIMIT * GAS_PRICE; // 1,050,000,000,000 wei (0.00000105 BNB)

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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  log("==========================================================================");
  log(">>> PIPELINE SAPU INTERNAL OTOMATIS: 100% BEBAS BIAYA DEPOSIT BARU <<<");
  log(`Tujuan Penampungan HASH (r3s.ai): ${R3S}`);
  log("Strategi: Sifon gas menganggur armada -> Danai worker penerima -> Sapu HASH");
  log("==========================================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);

  // 1. Memuat seluruh worker
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
  log(`Total armada dimuat: ${workers.length} worker`);

  // 2. Multicall cek saldo BNB & HASH
  log("Memindai saldo seluruh armada via Multicall3...");
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

  const recipients = []; // worker yang punya HASH
  const donors = [];     // worker yang punya idle BNB > 0.000002 BNB & tanpa token

  for (let i = 0; i < workers.length; i++) {
    const bnbBal = BigInt(results[i * 2].returnData);
    const tokenBal = BigInt(results[i * 2 + 1].returnData);

    if (tokenBal > 0n) {
      const neededBnb = bnbBal >= TRANSFER_GAS_COST ? 0n : (TRANSFER_GAS_COST - bnbBal);
      recipients.push({ worker: workers[i], bnbBal, tokenBal, neededBnb });
    } else if (bnbBal > 2000000000000n) { // > 0.000002 BNB
      const sendable = bnbBal - TX_GAS_COST;
      if (sendable > 0n) {
        donors.push({ worker: workers[i], bnbBal, sendable });
      }
    }
  }

  const totalHashToSweep = recipients.reduce((acc, r) => acc + r.tokenBal, 0n);
  const totalBnbNeededForRecipients = recipients.reduce((acc, r) => acc + r.neededBnb, 0n);
  // Biaya kirim dari wallet3 ke recipients (21,000 gas * 0.05 gwei = TX_GAS_COST)
  const recipientsNeedingGas = recipients.filter(r => r.neededBnb > 0n);
  const totalTxFeeFromW3 = BigInt(recipientsNeedingGas.length) * TX_GAS_COST;
  const grandTotalBnbRequired = totalBnbNeededForRecipients + totalTxFeeFromW3;

  log(`Worker penerima (memegang HASH): ${recipients.length} worker`);
  log(`Total HASH siap disapu ke r3s: ${ethers.formatEther(totalHashToSweep)} HASH`);
  log(`Worker yang butuh top-up gas: ${recipientsNeedingGas.length} worker`);
  log(`Total gas BNB yang dibutuhkan Wallet 3: ${ethers.formatEther(grandTotalBnbRequired)} BNB`);
  log(`Worker donor yang tersedia: ${donors.length} worker`);

  // Cek saldo awal Wallet 3
  let w3Bal = await provider.getBalance(wallet3.address);
  log(`Saldo awal Wallet 3: ${ethers.formatEther(w3Bal)} BNB`);

  // --------------------------------------------------------------------------
  // LANGKAH 1: SIFON GAS DARI DONOR JIKA SALDO WALLET 3 KURANG
  // --------------------------------------------------------------------------
  if (w3Bal < grandTotalBnbRequired) {
    const deficit = grandTotalBnbRequired - w3Bal + 20000000000000n; // buffer safety
    log(`Mengumpulkan ${ethers.formatEther(deficit)} BNB dari donor cadangan...`);
    
    let collected = 0n;
    const selectedDonors = [];
    for (const d of donors) {
      selectedDonors.push(d);
      collected += d.sendable;
      if (collected >= deficit) break;
    }

    log(`Memilih ${selectedDonors.length} worker donor untuk menyuplai gas...`);
    const donorBatchSize = 30;
    for (let i = 0; i < selectedDonors.length; i += donorBatchSize) {
      const batch = selectedDonors.slice(i, i + donorBatchSize);
      await Promise.all(batch.map(async (d) => {
        try {
          const signer = new ethers.Wallet(d.worker.privateKey, provider);
          const tx = await signer.sendTransaction({
            to: wallet3.address,
            value: d.sendable,
            gasLimit: TX_GAS_LIMIT,
            gasPrice: GAS_PRICE
          });
          await tx.wait();
        } catch (e) {
          // ignore or retry
        }
      }));
      log(`  Tersifon: ${Math.min(i + donorBatchSize, selectedDonors.length)}/${selectedDonors.length} donor`);
    }

    w3Bal = await provider.getBalance(wallet3.address);
    log(`Saldo Wallet 3 setelah sifon: ${ethers.formatEther(w3Bal)} BNB`);
  } else {
    log("Saldo Wallet 3 sudah mencukupi untuk mendistribusikan gas!");
  }

  // --------------------------------------------------------------------------
  // LANGKAH 2: DISTRIBUSIKAN GAS KE WORKER PENERIMA
  // --------------------------------------------------------------------------
  if (recipientsNeedingGas.length > 0) {
    log(`Mendistribusikan gas ke ${recipientsNeedingGas.length} worker penerima...`);
    const distBatchSize = 25;
    for (let i = 0; i < recipientsNeedingGas.length; i += distBatchSize) {
      const batch = recipientsNeedingGas.slice(i, i + distBatchSize);
      let baseNonce = await provider.getTransactionCount(wallet3.address, "latest");
      
      const sentTxs = await Promise.all(batch.map((r, idx) =>
        wallet3.sendTransaction({
          to: r.worker.address,
          value: r.neededBnb,
          nonce: baseNonce + idx,
          gasLimit: TX_GAS_LIMIT,
          gasPrice: GAS_PRICE,
          chainId: 56
        })
      ));

      await Promise.all(sentTxs.map(t => t.wait()));
      log(`  Terdanai: ${Math.min(i + distBatchSize, recipientsNeedingGas.length)}/${recipientsNeedingGas.length} worker`);
    }
    log("Distribusi gas selesai 100%!");
  }

  // --------------------------------------------------------------------------
  // LANGKAH 3: SAPU SELURUH HASH KE R3S.AI
  // --------------------------------------------------------------------------
  log(`Memulai penyapuan token HASH dari ${recipients.length} worker ke ${R3S}...`);
  let successCount = 0;
  let totalSwept = 0n;
  const sweepBatchSize = 30;

  for (let i = 0; i < recipients.length; i += sweepBatchSize) {
    const batch = recipients.slice(i, i + sweepBatchSize);
    
    await Promise.all(batch.map(async (item) => {
      try {
        const signer = new ethers.Wallet(item.worker.privateKey, provider);
        const tokenContract = new ethers.Contract(HASH_TOKEN, ERC20_ABI, signer);
        const tx = await tokenContract.transfer(R3S, item.tokenBal, {
          gasLimit: TRANSFER_GAS_LIMIT,
          gasPrice: GAS_PRICE
        });
        await tx.wait();
        successCount++;
        totalSwept += item.tokenBal;
      } catch (err) {
        // Log brief error if any
      }
    }));

    log(`  Progress Sapu: ${Math.min(i + sweepBatchSize, recipients.length)}/${recipients.length} worker (Sukses: ${successCount}, HASH: ${ethers.formatEther(totalSwept)})`);
  }

  // --------------------------------------------------------------------------
  // RINGKASAN AKHIR
  // --------------------------------------------------------------------------
  log("==========================================================================");
  log(">>> EKSEKUSI PIPELINE SELESAI <<<");
  const tokenContract = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const finalR3sHash = await tokenContract.balanceOf(R3S);
  log(`Worker Berhasil Disapu: ${successCount} dari ${recipients.length}`);
  log(`Total HASH Disapu Sesi Ini: ${ethers.formatEther(totalSwept)} HASH`);
  log(`Saldo Akhir HASH di r3s.ai: ${ethers.formatEther(finalR3sHash)} HASH`);
  log("==========================================================================");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
