const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
const GAS_PRICE = 50000000n; // 0.05 gwei
const TARGET_GAS = 7000000000000n; // 0.000007 BNB (~140,000 gas @ 0.05 gwei)
const TOPUP_TX_COST = 1050000000000n; // 0.00000105 BNB (21,000 gas @ 0.05 gwei)

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
  log("========================================================");
  log(">>> MULAI PANEN ARMADA HASH21 KE R3S.AI <<<");
  log(`Tujuan Penampungan (r3s.ai): ${R3S}`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const workers = loadAllWorkers();
  log(`Total worker terdaftar: ${workers.length}`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Saldo Wallet 3 Distributor: ${ethers.formatEther(w3Bal)} BNB`);

  // 1. Scan semua worker via Multicall
  log("Memindai saldo BNB dan pending HASH seluruh worker...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    results.push(...await mc.aggregate3(calls.slice(i, i + 600)));
  }

  const list = [];
  for (let i = 0; i < workers.length; i++) {
    const bnbBal = results[i * 2].success ? BigInt(results[i * 2].returnData) : 0n;
    const pend = results[i * 2 + 1].success ? BigInt(results[i * 2 + 1].returnData) : 0n;
    const deficit = bnbBal >= TARGET_GAS ? 0n : TARGET_GAS - bnbBal;
    const totalCost = deficit > 0n ? deficit + TOPUP_TX_COST : 0n;
    list.push({ ...workers[i], bnbBal, pend, deficit, totalCost });
  }

  // Filter hanya worker yang punya pending HASH >= 0.01
  const activeWorkers = list.filter(w => w.pend >= ethers.parseUnits("0.01", 18));
  // Sort dari biaya top-up terkecil ke terbesar
  activeWorkers.sort((a, b) => (a.totalCost < b.totalCost ? -1 : a.totalCost > b.totalCost ? 1 : 0));

  // Cadangkan 0.0001 BNB di Wallet 3 untuk safety buffer
  const w3Available = w3Bal > ethers.parseEther("0.0001") ? w3Bal - ethers.parseEther("0.0001") : 0n;
  log(`Budget yang dialokasikan: ${ethers.formatEther(w3Available)} BNB`);

  const selected = [];
  let budgetSpent = 0n;
  let totalPendingEst = 0n;

  for (const item of activeWorkers) {
    if (budgetSpent + item.totalCost <= w3Available) {
      budgetSpent += item.totalCost;
      totalPendingEst += item.pend;
      selected.push(item);
    } else {
      break;
    }
  }

  log(`Target yang dipilih: ${selected.length} worker`);
  log(`Estimasi HASH yang akan dipanen: ${ethers.formatUnits(totalPendingEst, 18)} HASH`);
  log(`Total estimasi BNB Wallet 3 terpakai: ${ethers.formatEther(budgetSpent)} BNB`);

  // 2. Kirim top-up BNB dari Wallet 3 bagi yang defisit
  const needTopup = selected.filter(x => x.deficit > 0n);
  log(`Jumlah worker yang memerlukan top-up: ${needTopup.length}`);

  if (needTopup.length > 0) {
    log("Mengirim top-up dari Wallet 3 dalam sub-batch 25...");
    for (let i = 0; i < needTopup.length; i += 25) {
      const chunk = needTopup.slice(i, i + 25);
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
      if ((i + 25) % 250 === 0 || i + 25 >= needTopup.length) {
        log(`  Top-up progres: ${Math.min(i + 25, needTopup.length)}/${needTopup.length} worker selesai`);
      }
    }
    log("Top-up seluruh worker selesai!");
  }

  // 3. Eksekusi Claim & Sweep per batch 25 worker
  log("Memulai eksekusi Claim & Transfer ke r3s.ai...");
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
          gasLimit: 130000n,
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

    if ((i + 25) % 200 === 0 || i + 25 >= selected.length) {
      log(`  Panen progres: ${Math.min(i + 25, selected.length)}/${selected.length} (Sukses: ${successCount}, Gagal: ${failCount}, HASH: ${ethers.formatUnits(totalHashSwept, 18)})`);
    }
  }

  // 4. Laporan Akhir
  const finalR3sHash = await (new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider)).balanceOf(R3S);
  const finalR3sBnb = await provider.getBalance(R3S);
  const finalW3Bnb = await provider.getBalance(wallet3.address);

  log("================ HASIL AKHIR PANEN ================");
  log(`Worker Diproses:     ${selected.length}`);
  log(`Sukses:              ${successCount}`);
  log(`Gagal:               ${failCount}`);
  log(`HASH Berhasil Disapu: ${ethers.formatUnits(totalHashSwept, 18)} HASH`);
  log(`Saldo Akhir HASH r3s: ${ethers.formatUnits(finalR3sHash, 18)} HASH`);
  log(`Saldo Akhir BNB r3s:  ${ethers.formatEther(finalR3sBnb)} BNB (~$${(Number(ethers.formatEther(finalR3sBnb)) * 700).toFixed(2)})`);
  log(`Sisa BNB di Wallet 3: ${ethers.formatEther(finalW3Bnb)} BNB`);
  log("===================================================");
}

main().catch(console.error);
