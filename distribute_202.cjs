const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const gasPrice = 50000000n; // 0.05 gwei
  const FUND_AMOUNT = ethers.parseEther("0.000012"); // 0.000012 BNB

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const wallets = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_202.json", "utf8"));
  console.log(`Funding ${wallets.length} wallets from Wallet 3 in sub-batches of 15...`);

  const BATCH = 15;
  for (let i = 0; i < wallets.length; i += BATCH) {
    const chunk = wallets.slice(i, i + BATCH);
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
    console.log(`  Funded ${Math.min(i + BATCH, wallets.length)}/${wallets.length} wallets...`);
  }
  console.log(`All 202 wallets successfully funded!`);
}

main().catch(console.error);
