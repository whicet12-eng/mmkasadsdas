const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const abi = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ];
  const mc = new ethers.Contract(multicallAddress, abi, provider);
  const pool = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const hashToken = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
  const r3s = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

  const files = [
    "wallets_50.json",
    "wallets_35.json",
    "wallets_60.json",
    "wallets_150.json",
    "wallets_200.json"
  ];

  let allWorkers = [];
  for (const f of files) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      allWorkers.push(...JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }

  console.log(`Loaded ${allWorkers.length} worker wallets. Processing in batches of 50...`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const gasPrice = 50000000n; // 0.05 gwei
  const NEEDED = 9500000000000n; // 0.0000095 BNB (145k claim + 40k transfer)
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ];

  let grandTotalSwept = 0n;
  let grandTotalClaimSuccess = 0;
  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(allWorkers.length / BATCH_SIZE);

  for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
    const chunk = allWorkers.slice(bIndex * BATCH_SIZE, (bIndex + 1) * BATCH_SIZE);
    console.log(`\n========================================`);
    console.log(`>>> MEMPROSES BATCH ${bIndex + 1}/${totalBatches} (${chunk.length} Wallets: #${bIndex * BATCH_SIZE + 1} s/d #${bIndex * BATCH_SIZE + chunk.length}) <<<`);
    console.log(`========================================`);

    // 1. Check BNB balances in this batch
    const balCalls = chunk.map(w => ({
      target: multicallAddress,
      allowFailure: true,
      callData: "0x4d2301cc" + w.address.slice(2).toLowerCase().padStart(64, "0")
    }));
    const balRes = await mc.aggregate3(balCalls);

    const needTopup = [];
    for (let i = 0; i < chunk.length; i++) {
      const bnb = BigInt(balRes[i].returnData);
      if (bnb < NEEDED) {
        needTopup.push({ ...chunk[i], deficit: NEEDED - bnb });
      }
    }

    // Top up if any
    if (needTopup.length > 0) {
      console.log(`[Batch ${bIndex + 1}] Top-up ${needTopup.length} wallet dari Wallet 3...`);
      let startNonce = await provider.getTransactionCount(wallet3.address);
      const topupTxs = [];
      for (let i = 0; i < needTopup.length; i++) {
        topupTxs.push(wallet3.sendTransaction({
          to: needTopup[i].address,
          value: needTopup[i].deficit,
          nonce: startNonce + i,
          gasLimit: 21000n,
          gasPrice: gasPrice,
          chainId: 56
        }));
      }
      const sentTxs = await Promise.all(topupTxs);
      await Promise.all(sentTxs.map(t => t.wait()));
      console.log(`[Batch ${bIndex + 1}] Top-up selesai & confirmed!`);
    } else {
      console.log(`[Batch ${bIndex + 1}] Semua ${chunk.length} wallet sudah memiliki gas fee yang cukup.`);
    }

    // 2. Broadcast claim() on the 50 wallets in smaller sub-chunks of 10 for safety
    console.log(`[Batch ${bIndex + 1}] Eksekusi claim() untuk ${chunk.length} wallet...`);
    let batchClaimSuccess = 0;
    for (let sub = 0; sub < chunk.length; sub += 10) {
      const subChunk = chunk.slice(sub, sub + 10);
      const claimPromises = subChunk.map(async (wData) => {
        try {
          const w = new ethers.Wallet(wData.privateKey, provider);
          const tx = await w.sendTransaction({
            to: pool,
            data: "0x4e71d92d", // claim()
            gasLimit: 145000n,
            gasPrice: gasPrice,
            chainId: 56
          });
          const rcpt = await tx.wait();
          if (rcpt.status === 1) return true;
        } catch (e) {
          console.error(`Claim error ${wData.address}:`, e.message);
        }
        return false;
      });
      const results = await Promise.all(claimPromises);
      batchClaimSuccess += results.filter(Boolean).length;
    }
    console.log(`[Batch ${bIndex + 1}] Claim berhasil: ${batchClaimSuccess}/${chunk.length}`);
    grandTotalClaimSuccess += batchClaimSuccess;

    // 3. Broadcast transfer() to r3s for the 50 wallets
    console.log(`[Batch ${bIndex + 1}] Transfer HASH ke r3s (${r3s})...`);
    let batchSwept = 0n;
    for (let sub = 0; sub < chunk.length; sub += 10) {
      const subChunk = chunk.slice(sub, sub + 10);
      const sweepPromises = subChunk.map(async (wData) => {
        try {
          const w = new ethers.Wallet(wData.privateKey, provider);
          const c = new ethers.Contract(hashToken, erc20Abi, w);
          const bal = await c.balanceOf(w.address);
          if (bal > 0n) {
            const tx = await c.transfer(r3s, bal, {
              gasLimit: 40000n,
              gasPrice: gasPrice
            });
            const rcpt = await tx.wait();
            if (rcpt.status === 1) return bal;
          }
        } catch (e) {
          console.error(`Sweep error ${wData.address}:`, e.message);
        }
        return 0n;
      });
      const results = await Promise.all(sweepPromises);
      for (const r of results) {
        batchSwept += r;
      }
    }
    grandTotalSwept += batchSwept;
    console.log(`[Batch ${bIndex + 1} SELESAI] HASH yang disapu pada batch ini: ${ethers.formatUnits(batchSwept, 18)} HASH`);
    console.log(`[Total Akumulasi Masuk ke r3s]: ${ethers.formatUnits(grandTotalSwept, 18)} HASH`);
  }

  console.log(`\n========================================`);
  console.log(`>>> SEMUA 10 BATCH SELESAI DIPROSES! <<<`);
  console.log(`Total Claim Berhasil: ${grandTotalClaimSuccess}/${allWorkers.length}`);
  console.log(`Total HASH Terkirim ke r3s: ${ethers.formatUnits(grandTotalSwept, 18)} HASH`);
  console.log(`========================================`);
}

main().catch(console.error);
