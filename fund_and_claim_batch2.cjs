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

  const files = ["wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json"];
  let allWorkers = [];
  for (const f of files) {
    if (fs.existsSync(f)) {
      allWorkers.push(...JSON.parse(fs.readFileSync(f, "utf8")));
    }
  }

  // Check balances & pending
  const calls = [];
  for (const w of allWorkers) {
    const p = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: multicallAddress, allowFailure: true, callData: "0x4d2301cc" + p });
    calls.push({ target: pool, allowFailure: true, callData: "0xf44136a1" + p });
  }

  const res = [];
  for (let i = 0; i < calls.length; i += 150) {
    res.push(...(await mc.aggregate3(calls.slice(i, i + 150))));
  }

  const NEEDED = 9500000000000n; // 0.0000095 BNB (covers 145k claim + 40k transfer)
  const pendingWallets = [];
  for (let i = 0; i < allWorkers.length; i++) {
    const bnb = BigInt(res[i * 2].returnData);
    const pend = BigInt(res[i * 2 + 1].returnData);
    if (pend > 10000000000000000n) { // > 0.01 HASH pending
      const deficit = bnb < NEEDED ? (NEEDED - bnb) : 0n;
      pendingWallets.push({
        ...allWorkers[i],
        bnb,
        pend,
        deficit
      });
    }
  }

  console.log(`Found ${pendingWallets.length} wallets that still need to claim!`);
  // Sort by deficit ascending
  pendingWallets.sort((a, b) => (a.deficit < b.deficit ? -1 : a.deficit > b.deficit ? 1 : 0));

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const w3Bal = await provider.getBalance(wallet3.address);
  console.log("Wallet 3 BNB balance:", ethers.formatEther(w3Bal));

  let spendable = w3Bal - 50000000000000n; // 0.00005 BNB reserve for Wallet 3 gas
  const toFund = [];
  for (const w of pendingWallets) {
    if (w.deficit > 0n && spendable >= (w.deficit + 1050000000000n)) {
      spendable -= (w.deficit + 1050000000000n);
      toFund.push(w);
    }
  }

  console.log(`Funding ${toFund.length} wallets from Wallet 3...`);
  const gasPrice = 50000000n;
  let startNonce = await provider.getTransactionCount(wallet3.address);

  for (let b = 0; b < toFund.length; b += 25) {
    const chunk = toFund.slice(b, b + 25);
    const txPromises = chunk.map((w, idx) => {
      return wallet3.sendTransaction({
        to: w.address,
        value: w.deficit,
        nonce: startNonce + b + idx,
        gasLimit: 21000n,
        gasPrice: gasPrice,
        chainId: 56
      });
    });
    const txs = await Promise.all(txPromises);
    await Promise.all(txs.map(t => t.wait()));
    console.log(`Funded batch ${Math.floor(b / 25) + 1} (${Math.min(b + 25, toFund.length)}/${toFund.length})`);
  }
  console.log("All funding txs confirmed!");

  // Step 2: Claim for all funded wallets
  console.log(`Step 2: Calling claim() on ${toFund.length} wallets with gasLimit 145000...`);
  let claimSuccess = 0;
  for (let b = 0; b < toFund.length; b += 15) {
    const chunk = toFund.slice(b, b + 15);
    const txPromises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: pool,
          data: "0x4e71d92d",
          gasLimit: 145000n,
          gasPrice: gasPrice,
          chainId: 56
        });
        const rcpt = await tx.wait();
        if (rcpt.status === 1) claimSuccess++;
      } catch (e) {
        console.error(`Claim error ${wData.address}:`, e.message);
      }
    });
    await Promise.all(txPromises);
    console.log(`Claimed ${Math.min(b + 15, toFund.length)}/${toFund.length} (Success: ${claimSuccess})`);
  }

  // Step 3: Sweep HASH from these wallets to r3s
  console.log(`Step 3: Transferring HASH from wallets to r3s (${r3s})...`);
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ];
  let sweepSuccess = 0;
  let sweptHashTotal = 0n;

  for (let b = 0; b < toFund.length; b += 15) {
    const chunk = toFund.slice(b, b + 15);
    const txPromises = chunk.map(async (wData) => {
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
          if (rcpt.status === 1) {
            sweepSuccess++;
            sweptHashTotal += bal;
          }
        }
      } catch (e) {
        console.error(`Sweep error ${wData.address}:`, e.message);
      }
    });
    await Promise.all(txPromises);
    console.log(`Swept ${Math.min(b + 15, toFund.length)}/${toFund.length} (Swept: ${ethers.formatUnits(sweptHashTotal, 18)} HASH)`);
  }

  console.log(`BATCH 2 FINISHED! Claim success: ${claimSuccess}, Swept total: ${ethers.formatUnits(sweptHashTotal, 18)} HASH`);
}

main().catch(console.error);
