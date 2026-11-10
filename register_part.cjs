const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const file = process.argv[2] || "/workspaces/mmkasadsdas/wallets_part1.json";
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const pool = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const gasPrice = 50000000n; // 0.05 gwei

  const wallets = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`[${file}] Starting register() for ${wallets.length} wallets in batches of 20...`);

  let successCount = 0;
  const BATCH = 20;
  for (let i = 0; i < wallets.length; i += BATCH) {
    const chunk = wallets.slice(i, i + BATCH);
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
        // error
      }
      return false;
    });
    const res = await Promise.all(promises);
    successCount += res.filter(Boolean).length;
    console.log(`[${file}] Registered ${Math.min(i + BATCH, wallets.length)}/${wallets.length} (Success: ${successCount})`);
  }
  console.log(`[${file}] FINISHED! Total Registered: ${successCount}/${wallets.length}`);
}

main().catch(console.error);
