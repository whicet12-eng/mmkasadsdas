const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const DEST = ethers.getAddress("0xcb34ccd05d2c21edf182d3d592f6ff2c80e34747".toLowerCase());
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
  log(">>> MULAI CLAIM & SWEEP HASH V1 KE WALLET TUJUAN <<<");
  log(`Tujuan Akhir HASH: ${DEST}`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const targetWorkers = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/workers_target_1311.json", "utf8"));
  log(`Total worker target (>= 1.5 HASH): ${targetWorkers.length}`);

  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Saldo Wallet 3 Distributor: ${ethers.formatEther(w3Bal)} BNB`);

  // Alokasi budget dengan menyisakan 0.000035 BNB buffer
  const safetyBuffer = ethers.parseEther("0.000035");
  const availableBudget = w3Bal > safetyBuffer ? w3Bal - safetyBuffer : 0n;
  log(`Budget yang dialokasikan: ${ethers.formatEther(availableBudget)} BNB`);

  // Urutkan worker berdasarkan efisiensi: gas terendah & reward tertinggi
  const withEff = targetWorkers.map(w => {
    const def = BigInt(w.deficit);
    const cost = def > 0n ? def + TOPUP_TX_COST : 0n;
    const costEth = parseFloat(ethers.formatEther(cost || 1n));
    return {
      ...w,
      cost,
      efficiency: cost > 0n ? w.pending / costEth : 999999999
    };
  });
  withEff.sort((a, b) => b.efficiency - a.efficiency);

  let budgetSpent = 0n;
  let totalPendingEst = 0;
  const selected = [];

  for (const item of withEff) {
    if (budgetSpent + item.cost <= availableBudget) {
      budgetSpent += item.cost;
      totalPendingEst += item.pending;
      selected.push(item);
    } else {
      break;
    }
  }

  log(`Target yang dipilih: ${selected.length} worker`);
  log(`Estimasi HASH yang akan dipanen: ${totalPendingEst.toFixed(4)} HASH`);
  log(`Total estimasi BNB terpakai: ${ethers.formatEther(budgetSpent)} BNB`);

  // 1. Kirim top-up BNB dari Wallet 3
  const needTopup = selected.filter(x => BigInt(x.deficit) > 0n);
  log(`Jumlah worker yang memerlukan top-up: ${needTopup.length}`);

  if (needTopup.length > 0) {
    log("Mengirim top-up dari Wallet 3 dalam sub-batch 20...");
    for (let i = 0; i < needTopup.length; i += 20) {
      const chunk = needTopup.slice(i, i + 20);
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
      log(`  Top-up progres: ${Math.min(i + 20, needTopup.length)}/${needTopup.length} selesai`);
    }
    log("Top-up gas selesai!");
  }

  // 2. Eksekusi Claim & Sweep langsung ke DEST
  log(`Memulai eksekusi Claim & Transfer ke ${DEST}...`);
  let successCount = 0;
  let failCount = 0;
  let totalHashSwept = 0n;

  for (let i = 0; i < selected.length; i += 20) {
    const chunk = selected.slice(i, i + 20);
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

        // Check token balance & Transfer ke DEST
        const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await token.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await token.transfer(DEST, bal, {
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
    log(`Progres: ${Math.min(i + 20, selected.length)}/${selected.length} | Berhasil: ${successCount} | Gagal: ${failCount} | Total Terkirim ke DEST: ${ethers.formatEther(totalHashSwept)} HASH`);
  }

  const tokenContract = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const destBal = await tokenContract.balanceOf(DEST);
  const w3Remaining = await provider.getBalance(wallet3.address);

  log("========================================================");
  log(`>>> PROSES PANEN SELESAI <<<`);
  log(`Total worker berhasil: ${successCount} dari ${selected.length}`);
  log(`Total HASH berhasil disapu ke DEST: ${ethers.formatEther(totalHashSwept)} HASH`);
  log(`Saldo HASH akhir di ${DEST}: ${ethers.formatEther(destBal)} HASH`);
  log(`Sisa saldo BNB di Wallet 3: ${ethers.formatEther(w3Remaining)} BNB`);
  log("========================================================");
}

main().catch(err => {
  console.error("Error fatal:", err);
  process.exit(1);
});
