const { ethers } = require("ethers");
const fs = require("fs");

async function registerAll() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const poolAddress = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const wallets150 = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_150.json", "utf8"));

  const gasPrice = 50000000n; // 0.05 gwei

  console.log(`Broadcasting register() for ${wallets150.length} wallets in batches of 15...`);

  let successCount = 0;
  for (let batch = 0; batch < wallets150.length; batch += 15) {
    const chunk = wallets150.slice(batch, batch + 15);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: poolAddress,
          data: "0x1aa3a008", // register()
          value: 0n,
          gasLimit: 140000n,
          gasPrice: gasPrice,
          chainId: 56
        });
        const rcpt = await tx.wait();
        if (rcpt.status === 1) successCount++;
      } catch (e) {
        // already registered or other
      }
    });

    await Promise.all(promises);
    console.log(`Registered ${Math.min(batch + 15, wallets150.length)}/${wallets150.length} (Success: ${successCount})`);
  }

  console.log(`ALL 150 WALLETS REGISTRATION FINISHED! Total Registered: ${successCount}`);
}

registerAll().catch(console.error);
