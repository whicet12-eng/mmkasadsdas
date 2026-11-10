const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
const GAS_PRICE = 50000000n; // 0.05 gwei
const TARGET_GAS = 8900000000000n; // 0.0000089 BNB (~178,000 gas @ 0.05 gwei for claim + transfer)
const TOPUP_TX_COST = 1050000000000n; // 0.00000105 BNB (21,000 gas @ 0.05 gwei)

const ERC20_ABI = [
  "function transfer(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("========================================================");
  log(">>> EKSEKUSI CLAIM & SWEEP WORKER >= 1.5 HASH KE R3S.AI <<<");
  log(`Tujuan Penampungan (r3s.ai): ${R3S}`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const targetWorkers = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/workers_target_1311.json", "utf8"));
  log(`Total worker target (>= 1.5 HASH): ${targetWorkers.length}`);

  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Saldo Wallet 3 Distributor: ${ethers.formatEther(w3Bal)} BNB`);

  // Hitung total defisit
  let totalDeficit = 0n;
  for (const item of targetWorkers) {
    const def = BigInt(item.deficit);
    totalDeficit += (def > 0n ? def + TOPUP_TX_COST : 0n);
  }
  log(`Total gas BNB yang dibutuhkan Wallet 3: ${ethers.formatEther(totalDeficit)} BNB`);

  if (w3Bal < ethers.parseEther("0.001")) {
    log("⚠️ Saldo Wallet 3 belum mencukupi untuk distribusi.");
    log(`Silakan transfer minimal 0.0118 BNB ke Wallet 3: ${wallet3.address}`);
    return;
  }

  // Alokasi worker sesuai saldo Wallet 3 yang tersedia
  const w3Available = w3Bal > ethers.parseEther("0.0001") ? w3Bal - ethers.parseEther("0.0001") : 0n;
  let budgetSpent = 0n;
  const selected = [];

  for (const item of targetWorkers) {
    const def = BigInt(item.deficit);
    const cost = def > 0n ? def + TOPUP_TX_COST : 0n;
    if (budgetSpent + cost <= w3Available) {
      budgetSpent += cost;
      selected.push(item);
    } else {
      break;
    }
  }

  log(`Target yang dapat diproses dengan saldo saat ini: ${selected.length} worker`);
  log(`Total estimasi BNB terpakai: ${ethers.formatEther(budgetSpent)} BNB`);

  // 1. Distribusi top-up BNB dari Wallet 3
  const needTopup = selected.filter(x => BigInt(x.deficit) > 0n);
  log(`Jumlah worker yang memerlukan top-up: ${needTopup.length}`);

  if (needTopup.length > 0) {
    log("Mengirim top-up dari Wallet 3 dalam sub-batch 25...");
    for (let i = 0; i < needTopup.length; i += 25) {
      const chunk = needTopup.slice(i, i + 25);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(chunk.map((item, idx) =>
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
      log(`  Top-up progres: ${Math.min(i + 25, needTopup.length)}/${needTopup.length} worker selesai`);
    }
    log("Top-up seluruh worker selesai!");
  }

  // 2. Eksekusi Claim & Sweep per batch 25 worker
  log("Memulai eksekusi Claim & Sweep ke r3s.ai...");
  let successCount = 0;
  let failCount = 0;
  let totalHashSwept = 0n;

  for (let i = 0; i < selected.length; i += 25) {
    const chunk = selected.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        // Claim
        const txClaim = await w.sendTransaction({
          to: POOL,
          data: "0x4e71d92d", // claim()
          gasLimit: 133000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        });
        await txClaim.wait();

        // Check token balance & Transfer ke r3s
        const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await token.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await token.transfer(R3S, bal, {
            gasLimit: 45000n,
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
        return { success: false, amount: 0n };
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
    log(`Progres Claim & Sweep: ${Math.min(i + 25, selected.length)}/${selected.length} | Berhasil: ${successCount} | Gagal: ${failCount} | HASH Tersapu: ${ethers.formatEther(totalHashSwept)}`);
  }

  log("========================================================");
  log(`>>> PROSES SELESAI <<<`);
  log(`Total worker berhasil: ${successCount}`);
  log(`Total worker gagal: ${failCount}`);
  log(`Total HASH berhasil disapu ke r3s.ai: ${ethers.formatEther(totalHashSwept)} HASH`);
  log("========================================================");
}

main().catch(err => {
  console.error("Error fatal:", err);
  process.exit(1);
});
