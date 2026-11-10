const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const mc = new ethers.Contract(multicallAddress, [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ], provider);

  const pool = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const hashToken = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
  const r3s = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
  const gasPrice = 50000000n; // 0.05 gwei
  const NEEDED = 11000000000000n; // 0.000011 BNB
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ];

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

  const targets = allWorkers.slice(400);
  console.log(`Processing remaining ${targets.length} wallets (Batch 9: #401-#450, Batch 10: #451-#495)...`);

  // 1. Check BNB balances
  const balCalls = targets.map(w => ({
    target: multicallAddress,
    allowFailure: true,
    callData: "0x4d2301cc" + w.address.slice(2).toLowerCase().padStart(64, "0")
  }));
  const balRes = await mc.aggregate3(balCalls);

  const needTopup = [];
  for (let i = 0; i < targets.length; i++) {
    const bnb = BigInt(balRes[i].returnData);
    if (bnb < NEEDED) {
      needTopup.push({ ...targets[i], deficit: NEEDED - bnb });
    }
  }

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  if (needTopup.length > 0) {
    console.log(`Top-up gas needed for ${needTopup.length} wallets from Wallet 3 in sub-batches of 10...`);
    for (let i = 0; i < needTopup.length; i += 10) {
      const sub = needTopup.slice(i, i + 10);
      let baseNonce = await provider.getTransactionCount(wallet3.address);
      const txs = await Promise.all(sub.map((item, idx) => 
        wallet3.sendTransaction({
          to: item.address,
          value: item.deficit,
          nonce: baseNonce + idx,
          gasLimit: 21000n,
          gasPrice: gasPrice,
          chainId: 56
        })
      ));
      await Promise.all(txs.map(t => t.wait()));
      console.log(`  Topped up ${i + sub.length}/${needTopup.length} wallets...`);
    }
    console.log(`Top-up completed!`);
  } else {
    console.log(`All wallets already have sufficient gas.`);
  }

  // 2. Process Batch 9 (#401-#450)
  console.log(`\n========================================`);
  console.log(`>>> EKSEKUSI BATCH 9/10 (50 Wallets: #401 s/d #450) <<<`);
  console.log(`========================================`);
  const batch9 = targets.slice(0, 50);
  let b9Claimed = 0;
  for (let s = 0; s < batch9.length; s += 10) {
    const sub = batch9.slice(s, s + 10);
    const promises = sub.map(async (wData) => {
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
        return rcpt.status === 1;
      } catch (e) {
        return false;
      }
    });
    const res = await Promise.all(promises);
    b9Claimed += res.filter(Boolean).length;
  }
  console.log(`[Batch 9] Claim berhasil: ${b9Claimed}/${batch9.length}`);

  console.log(`[Batch 9] Sweeping HASH ke r3s...`);
  let b9Swept = 0n;
  for (let s = 0; s < batch9.length; s += 10) {
    const sub = batch9.slice(s, s + 10);
    const promises = sub.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(hashToken, erc20Abi, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const tx = await c.transfer(r3s, bal, {
            gasLimit: 60000n,
            gasPrice: gasPrice
          });
          const rcpt = await tx.wait();
          if (rcpt.status === 1) return bal;
        }
      } catch (e) {
        console.error(`Sweep err ${wData.address}:`, e.message);
      }
      return 0n;
    });
    const res = await Promise.all(promises);
    for (const r of res) b9Swept += r;
  }
  console.log(`[Batch 9 SELESAI] HASH disapu: ${ethers.formatUnits(b9Swept, 18)} HASH`);

  // 3. Process Batch 10 (#451-#495)
  console.log(`\n========================================`);
  console.log(`>>> EKSEKUSI BATCH 10/10 (45 Wallets: #451 s/d #495) <<<`);
  console.log(`========================================`);
  const batch10 = targets.slice(50);
  let b10Claimed = 0;
  for (let s = 0; s < batch10.length; s += 10) {
    const sub = batch10.slice(s, s + 10);
    const promises = sub.map(async (wData) => {
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
        return rcpt.status === 1;
      } catch (e) {
        return false;
      }
    });
    const res = await Promise.all(promises);
    b10Claimed += res.filter(Boolean).length;
  }
  console.log(`[Batch 10] Claim berhasil: ${b10Claimed}/${batch10.length}`);

  console.log(`[Batch 10] Sweeping HASH ke r3s...`);
  let b10Swept = 0n;
  for (let s = 0; s < batch10.length; s += 10) {
    const sub = batch10.slice(s, s + 10);
    const promises = sub.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(hashToken, erc20Abi, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const tx = await c.transfer(r3s, bal, {
            gasLimit: 60000n,
            gasPrice: gasPrice
          });
          const rcpt = await tx.wait();
          if (rcpt.status === 1) return bal;
        }
      } catch (e) {
        console.error(`Sweep err ${wData.address}:`, e.message);
      }
      return 0n;
    });
    const res = await Promise.all(promises);
    for (const r of res) b10Swept += r;
  }
  console.log(`[Batch 10 SELESAI] HASH disapu: ${ethers.formatUnits(b10Swept, 18)} HASH`);

  const cR3s = new ethers.Contract(hashToken, erc20Abi, provider);
  const r3sFinal = await cR3s.balanceOf(r3s);
  console.log(`\n========================================`);
  console.log(`>>> SEMUA 10 BATCH (495 WORKER WALLET) SELESAI DI-CLAIM! <<<`);
  console.log(`Batch 9 Swept: ${ethers.formatUnits(b9Swept, 18)} HASH`);
  console.log(`Batch 10 Swept: ${ethers.formatUnits(b10Swept, 18)} HASH`);
  console.log(`Total HASH di r3s saat ini: ${ethers.formatUnits(r3sFinal, 18)} HASH`);
  console.log(`========================================`);
}

main().catch(console.error);
