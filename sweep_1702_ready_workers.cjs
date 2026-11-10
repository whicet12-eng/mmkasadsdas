const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

const GAS_PRICE = 50000000n; // 0.05 gwei
const CLAIM_GAS_LIMIT = 120000n;
const TRANSFER_GAS_LIMIT = 35000n;

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

async function main() {
  log("================================================================");
  log(">>> MULAI PANEN 1.702 WORKER YANG SUDAH MEMILIKI GAS PENUH <<<");
  log(`Tujuan Penampungan (r3s.ai): ${R3S}`);
  log("Biaya tambahan: 0 BNB (semua gas sudah tersedia di dompet worker)");
  log("================================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const workers = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/master_wallets_all.json", "utf8"));

  log("Memindai dan mengumpulkan worker yang siap eksekusi...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad });
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    results.push(...await mc.aggregate3(calls.slice(i, i + 600)));
  }

  const readyWorkers = [];
  let totalPending = 0n;

  for (let i = 0; i < workers.length; i++) {
    const pend = BigInt(results[i * 2].returnData);
    const bnb = BigInt(results[i * 2 + 1].returnData);
    if (pend >= ethers.parseUnits("0.05", 18) && bnb >= 6500000000000n) {
      readyWorkers.push({ ...workers[i], pend, bnb });
      totalPending += pend;
    }
  }

  log(`Worker siap dipanen: ${readyWorkers.length} worker`);
  log(`Total estimasi HASH: ${ethers.formatUnits(totalPending, 18)} HASH`);

  let successCount = 0;
  let failCount = 0;
  let totalSwept = 0n;

  for (let i = 0; i < readyWorkers.length; i += 25) {
    const chunk = readyWorkers.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        // 1. Claim
        const txClaim = await w.sendTransaction({
          to: POOL,
          data: "0x4e71d92d",
          gasLimit: CLAIM_GAS_LIMIT,
          gasPrice: GAS_PRICE,
          chainId: 56
        });
        await txClaim.wait();

        // 2. Transfer
        const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await token.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await token.transfer(R3S, bal, {
            gasLimit: TRANSFER_GAS_LIMIT,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcSweep = await txSweep.wait();
          if (rcSweep.status === 1) return { success: true, amount: bal };
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
        totalSwept += r.amount;
      } else {
        failCount++;
      }
    }

    if ((i + 25) % 200 === 0 || i + 25 >= readyWorkers.length) {
      log(`  Progres: ${Math.min(i + 25, readyWorkers.length)}/${readyWorkers.length} (Sukses: ${successCount}, Gagal: ${failCount}, HASH: ${ethers.formatUnits(totalSwept, 18)})`);
    }
  }

  const finalR3sHash = await (new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider)).balanceOf(R3S);
  log("\n================ HASIL AKHIR PANEN 1.702 WORKER ================");
  log(`Total Worker Diproses: ${readyWorkers.length}`);
  log(`Sukses:                ${successCount}`);
  log(`Gagal:                 ${failCount}`);
  log(`HASH Disapu Sesi Ini:  ${ethers.formatUnits(totalSwept, 18)} HASH`);
  log(`Saldo Akhir HASH r3s:  ${ethers.formatUnits(finalR3sHash, 18)} HASH`);
  log("================================================================");
}

main().catch(console.error);
