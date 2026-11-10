const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const gasPrice = 50000000n; // 0.05 gwei
  const FUND_AMOUNT = ethers.parseEther("0.000012"); // 0.000012 BNB

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const wallets = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_2000.json", "utf8"));
  console.log(`Starting funding for ${wallets.length} wallets from Wallet 3 in sub-batches of 25...`);

  const BATCH = 25;
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
    if ((i + BATCH) % 100 === 0 || i + BATCH >= wallets.length) {
      console.log(`  Funded ${Math.min(i + BATCH, wallets.length)}/${wallets.length} wallets...`);
    }
  }
  console.log(`ALL 2,000 WALLETS SUCCESSFULLY FUNDED!`);
}

main().catch(console.error);
