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

  console.log(`Total worker wallets loaded: ${allWorkers.length}`);

  // 1. Check BNB balances via multicall
  const calls = allWorkers.map(w => ({
    target: multicallAddress,
    allowFailure: true,
    callData: "0x4d2301cc" + w.address.slice(2).toLowerCase().padStart(64, "0")
  }));

  const res = [];
  for (let i = 0; i < calls.length; i += 150) {
    res.push(...(await mc.aggregate3(calls.slice(i, i + 150))));
  }

  const NEEDED = 9500000000000n; // 0.0000095 BNB (covers 145k gas for claim + 40k gas for transfer)
  const toTopup = [];
  let totalTopupWei = 0n;

  for (let i = 0; i < allWorkers.length; i++) {
    const bnb = BigInt(res[i].returnData);
    if (bnb < NEEDED) {
      const deficit = NEEDED - bnb;
      toTopup.push({ ...allWorkers[i], deficit });
      totalTopupWei += deficit;
    }
  }

  console.log(`Wallets needing top-up: ${toTopup.length} (Total BNB needed: ${ethers.formatEther(totalTopupWei)} BNB)`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const w3Bal = await provider.getBalance(wallet3.address);
  console.log(`Wallet 3 balance: ${ethers.formatEther(w3Bal)} BNB`);

  const gasPrice = 50000000n; // 0.05 gwei

  // Top up in batches of 25
  if (toTopup.length > 0) {
    console.log(`Step 1: Funding ${toTopup.length} wallets from Wallet 3...`);
    let startNonce = await provider.getTransactionCount(wallet3.address);
    for (let b = 0; b < toTopup.length; b += 25) {
      const chunk = toTopup.slice(b, b + 25);
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
      console.log(`Funded batch ${Math.floor(b / 25) + 1} (${Math.min(b + 25, toTopup.length)}/${toTopup.length})`);
    }
    console.log("All funding transactions confirmed!");
  }

  // Step 2: Broadcast claim() on all 495 wallets in batches of 15
  console.log(`Step 2: Calling claim() on all ${allWorkers.length} wallets with gasLimit 145000...`);
  let claimSuccess = 0;
  for (let b = 0; b < allWorkers.length; b += 15) {
    const chunk = allWorkers.slice(b, b + 15);
    const txPromises = chunk.map(async (wData) => {
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
        if (rcpt.status === 1) claimSuccess++;
      } catch (e) {
        console.error(`Claim error ${wData.address}:`, e.message);
      }
    });
    await Promise.all(txPromises);
    console.log(`Claimed ${Math.min(b + 15, allWorkers.length)}/${allWorkers.length} (Success: ${claimSuccess})`);
  }

  // Step 3: Broadcast transfer() to r3s on all 495 wallets in batches of 15
  console.log(`Step 3: Transferring all HASH tokens to r3s (${r3s})...`);
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ];
  let sweepSuccess = 0;
  let sweptHashTotal = 0n;

  for (let b = 0; b < allWorkers.length; b += 15) {
    const chunk = allWorkers.slice(b, b + 15);
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
    console.log(`Swept ${Math.min(b + 15, allWorkers.length)}/${allWorkers.length} (Swept: ${ethers.formatUnits(sweptHashTotal, 18)} HASH)`);
  }

  console.log(`ALL 495 WALLETS FINISHED!`);
  console.log(`Total Claim Success: ${claimSuccess}/${allWorkers.length}`);
  console.log(`Total Swept Success: ${sweepSuccess}`);
  console.log(`Total HASH Swept to r3s: ${ethers.formatUnits(sweptHashTotal, 18)} HASH`);
}

main().catch(console.error);
