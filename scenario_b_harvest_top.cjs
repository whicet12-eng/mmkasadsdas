const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const DEST = ethers.getAddress("0xcb34ccd05d2c21edf182d3d592f6ff2c80e34747".toLowerCase());
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";

const GAS_PRICE = 50000000n; // 0.05 gwei
const TARGET_GAS = 8500000000000n; // 0.0000085 BNB (170,000 gas @ 0.05 gwei - buffer for claim 104k + transfer 47k)
const TOPUP_TX_COST = 1050000000000n; // 0.00000105 BNB (21,000 gas @ 0.05 gwei)

const ERC20_ABI = [
  "function transfer(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("===================================================================");
  log(">>> MULAI PANEN SKENARIO B: WORKER DENGAN HASH TERBANYAK <<<");
  log(`Tujuan Akhir HASH: ${DEST}`);
  log("===================================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const mcAbi = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ];
  const mc = new ethers.Contract(MULTICALL, mcAbi, provider);

  // 1. Muat seluruh worker
  const filenames = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json",
    "wallets_500.json"
  ];
  const workers = [];
  for (const f of filenames) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const w of arr) {
        workers.push(w);
      }
    }
  }
  log(`Total worker armada dimuat: ${workers.length}`);

  // 2. Query saldo BNB, pending HASH, dan HASH wallet
  log("Memindai status on-chain seluruh worker via Multicall3...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad }); // getEthBalance
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad }); // pendingOf
    calls.push({ target: HASH_TOKEN, allowFailure: true, callData: "0x70a08231" + pad }); // balanceOf
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    const chunk = calls.slice(i, i + 600);
    const res = await mc.aggregate3(chunk);
    results.push(...res);
  }

  const workerStats = [];
  for (let i = 0; i < workers.length; i++) {
    const bnbRes = results[i * 3];
    const pendRes = results[i * 3 + 1];
    const hashRes = results[i * 3 + 2];

    const bnbBal = bnbRes.success && bnbRes.returnData !== "0x" ? BigInt(bnbRes.returnData) : 0n;
    const pending = pendRes.success && pendRes.returnData !== "0x" ? BigInt(pendRes.returnData) : 0n;
    const hashInWallet = hashRes.success && hashRes.returnData !== "0x" ? BigInt(hashRes.returnData) : 0n;

    const deficit = bnbBal >= TARGET_GAS ? 0n : TARGET_GAS - bnbBal;
    const cost = deficit > 0n ? deficit + TOPUP_TX_COST : 0n;

    workerStats.push({
      ...workers[i],
      bnbBal,
      pending,
      hashInWallet,
      totalHash: pending + hashInWallet,
      deficit,
      cost
    });
  }

  // 3. Urutkan berdasarkan total HASH terbanyak & efisiensi
  workerStats.sort((a, b) => {
    if (b.totalHash > a.totalHash) return 1;
    if (b.totalHash < a.totalHash) return -1;
    if (a.deficit < b.deficit) return -1;
    if (a.deficit > b.deficit) return 1;
    return 0;
  });

  // 4. Hitung budget Wallet 3
  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Saldo Wallet 3 Distributor: ${ethers.formatEther(w3Bal)} BNB`);

  const safetyReserve = ethers.parseEther("0.00002");
  const availableBudget = w3Bal > safetyReserve ? w3Bal - safetyReserve : 0n;
  log(`Budget yang dialokasikan: ${ethers.formatEther(availableBudget)} BNB`);

  let budgetSpent = 0n;
  let totalPendingEst = 0n;
  const selected = [];

  for (const item of workerStats) {
    if (item.totalHash === 0n) continue;
    if (budgetSpent + item.cost <= availableBudget) {
      budgetSpent += item.cost;
      totalPendingEst += item.totalHash;
      selected.push(item);
    } else {
      break;
    }
  }

  log(`Target yang dipilih: ${selected.length} worker teratas`);
  log(`Estimasi HASH yang akan dipanen: ${ethers.formatUnits(totalPendingEst, 18)} HASH`);
  log(`Total estimasi BNB terpakai: ${ethers.formatEther(budgetSpent)} BNB`);

  if (selected.length === 0) {
    log("Tidak ada worker yang dapat diproses dengan budget saat ini.");
    return;
  }

  // 5. Kirim top-up BNB dari Wallet 3 (hanya untuk worker yang punya defisit)
  const needTopup = selected.filter(x => x.deficit > 0n);
  log(`Jumlah worker yang memerlukan top-up BNB: ${needTopup.length}`);

  if (needTopup.length > 0) {
    log("Mengirim top-up dari Wallet 3 dalam sub-batch 20...");
    for (let i = 0; i < needTopup.length; i += 20) {
      const chunk = needTopup.slice(i, i + 20);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(chunk.map((item, idx) =>
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
      log(`  Top-up progres: ${Math.min(i + 20, needTopup.length)}/${needTopup.length} selesai`);
    }
    log("Semua top-up gas selesai!");
  }

  // 6. Eksekusi Claim & Sweep langsung ke DEST dalam sub-batch 15
  log(`Memulai eksekusi Claim & Transfer ke ${DEST}...`);
  let successCount = 0;
  let failCount = 0;
  let totalHashSwept = 0n;

  for (let i = 0; i < selected.length; i += 15) {
    const chunk = selected.slice(i, i + 15);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);

        // Jika worker punya pending di pool, lakukan claim
        if (wData.pending > 0n) {
          const txClaim = await w.sendTransaction({
            to: POOL,
            data: "0x4e71d92d", // claim()
            gasLimit: 140000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          await txClaim.wait();
        }

        // Cek saldo HASH di worker dan transfer ke DEST
        const bal = await token.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await token.transfer(DEST, bal, {
            gasLimit: 55000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcptSweep = await txSweep.wait();
          if (rcptSweep.status === 1) {
            return { success: true, amount: bal };
          }
        }
        return { success: true, amount: 0n };
      } catch (err) {
        return { success: false, amount: 0n, error: err.message };
      }
    });

    const resChunk = await Promise.all(promises);
    for (const r of resChunk) {
      if (r.success) {
        successCount++;
        totalHashSwept += r.amount;
      } else {
        failCount++;
      }
    }
    log(`Progres Panen: ${Math.min(i + 15, selected.length)}/${selected.length} | Berhasil: ${successCount} | Gagal: ${failCount} | Total Disapu: ${ethers.formatUnits(totalHashSwept, 18)} HASH`);
  }

  const tokenContract = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const destBal = await tokenContract.balanceOf(DEST);
  const w3Remaining = await provider.getBalance(wallet3.address);

  log("===================================================================");
  log(`>>> PANEN SKENARIO B SELESAI <<<`);
  log(`Total worker berhasil: ${successCount} dari ${selected.length}`);
  log(`Total HASH berhasil disapu ke tujuan: ${ethers.formatUnits(totalHashSwept, 18)} HASH`);
  log(`Saldo HASH akhir di ${DEST}: ${ethers.formatUnits(destBal, 18)} HASH`);
  log(`Sisa saldo BNB di Wallet 3: ${ethers.formatEther(w3Remaining)} BNB`);
  log("===================================================================");
}

main().catch(err => {
  console.error("Error fatal:", err);
  process.exit(1);
});
