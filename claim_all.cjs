const { ethers } = require("ethers");
const fs = require("fs");

async function claimAll() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const poolAddress = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";

  const allWallets = [];
  for (const f of ["wallets_50.json", "wallets_35.json", "wallets_60.json"]) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      allWallets.push(...JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }

  console.log(`Starting claim() for ${allWallets.length} worker wallets in batches of 15...`);

  let successCount = 0;
  let failCount = 0;

  for (let batch = 0; batch < allWallets.length; batch += 15) {
    const chunk = allWallets.slice(batch, batch + 15);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: poolAddress,
          data: "0x4e71d92d", // claim()
          gasLimit: 145000n,
          gasPrice: 50000000n, // 0.05 gwei
          chainId: 56
        });
        const rcpt = await tx.wait();
        if (rcpt.status === 1) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    });

    await Promise.all(promises);
    console.log(`Processed ${Math.min(batch + 15, allWallets.length)}/${allWallets.length} wallets (Success: ${successCount}, Fail: ${failCount})`);
  }

  console.log(`FINISHED ALL CLAIMS! Total Success: ${successCount}, Fail: ${failCount}`);
}

claimAll().catch(console.error);
