const { ethers } = require("ethers");
const fs = require("fs");

async function distribute() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const wallets200 = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_200.json", "utf8"));

  const gasPrice = 50000000n; // 0.05 gwei
  const amountWei = ethers.parseEther("0.000012");
  let startNonce = await provider.getTransactionCount(wallet3.address);

  console.log(`Distributing 0.000012 BNB to ${wallets200.length} wallets starting at nonce ${startNonce}...`);

  for (let b = 0; b < wallets200.length; b += 25) {
    const chunk = wallets200.slice(b, b + 25);
    const txPromises = chunk.map((w, idx) => {
      return wallet3.sendTransaction({
        to: w.address,
        value: amountWei,
        nonce: startNonce + b + idx,
        gasLimit: 21000n,
        gasPrice: gasPrice,
        chainId: 56
      });
    });
    const txs = await Promise.all(txPromises);
    await Promise.all(txs.map(t => t.wait()));
    console.log(`Funded batch ${Math.floor(b / 25) + 1} (${Math.min(b + 25, wallets200.length)}/${wallets200.length})`);
  }

  console.log("ALL 200 WALLETS FUNDED SUCCESSFULLY!");
}

distribute().catch(console.error);
