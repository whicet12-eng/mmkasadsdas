const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const pool = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const gasPrice = 50000000n; // 0.05 gwei
  const FUND_AMOUNT = ethers.parseEther("0.000012"); // 0.000012 BNB

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const wallets = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_300.json", "utf8"));
  console.log(`Loaded ${wallets.length} new wallets to fund and register...`);

  const w3Bal = await provider.getBalance(wallet3.address);
  console.log(`Wallet 3 starting balance: ${ethers.formatEther(w3Bal)} BNB`);

  // Phase 1: Distribute 0.000012 BNB to all 300 wallets in batches of 15
  console.log(`\n========================================`);
  console.log(`>>> PHASE 1: DISTRIBUSI BNB KE 300 WALLET <<<`);
  console.log(`========================================`);
  const DIST_BATCH = 15;
  for (let i = 0; i < wallets.length; i += DIST_BATCH) {
    const chunk = wallets.slice(i, i + DIST_BATCH);
    let baseNonce = await provider.getTransactionCount(wallet3.address);
    const txs = await Promise.all(chunk.map((w, idx) => 
      wallet3.sendTransaction({
        to: w.address,
        value: FUND_AMOUNT,
        nonce: baseNonce + idx,
        gasLimit: 21000n,
        gasPrice: gasPrice,
        chainId: 56
      })
    ));
    await Promise.all(txs.map(t => t.wait()));
    console.log(`[Distribusi] Didanai ${Math.min(i + DIST_BATCH, wallets.length)}/${wallets.length} wallet...`);
  }
  console.log(`[PHASE 1 SELESAI] Semua 300 wallet berhasil didanai!`);

  // Phase 2: Register all 300 wallets to the mining pool
  console.log(`\n========================================`);
  console.log(`>>> PHASE 2: REGISTRASI 300 WALLET KE MINING POOL <<<`);
  console.log(`========================================`);
  const REG_BATCH = 20;
  let successCount = 0;
  for (let i = 0; i < wallets.length; i += REG_BATCH) {
    const chunk = wallets.slice(i, i + REG_BATCH);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: pool,
          data: "0x1aa3a008", // register()
          gasLimit: 140000n,
          gasPrice: gasPrice,
          chainId: 56
        });
        const rcpt = await tx.wait();
        if (rcpt.status === 1) return true;
      } catch (e) {
        console.error(`Register err ${wData.address}:`, e.message);
      }
      return false;
    });
    const res = await Promise.all(promises);
    successCount += res.filter(Boolean).length;
    console.log(`[Registrasi] ${Math.min(i + REG_BATCH, wallets.length)}/${wallets.length} wallet diproses (Sukses: ${successCount})`);
  }

  console.log(`\n========================================`);
  console.log(`>>> PHASE 2 SELESAI! Total Registered: ${successCount}/${wallets.length} <<<`);
  console.log(`========================================`);
}

main().catch(console.error);
