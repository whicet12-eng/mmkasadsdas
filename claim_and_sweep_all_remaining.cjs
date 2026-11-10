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
  const NEEDED = 10500000000000n; // 0.0000105 BNB (145k claim + 60k transfer)
  const erc20Abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)"
  ];

  const files = [
    "wallets_50.json",
    "wallets_35.json",
    "wallets_60.json",
    "wallets_150.json",
    "wallets_200.json",
    "wallets_300.json"
  ];
  let allWorkers = [];
  for (const f of files) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      allWorkers.push(...JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }

  console.log(`Loaded ${allWorkers.length} worker wallets to check and sweep...`);

  // 1. Check BNB and pending HASH
  const calls = [];
  for (const w of allWorkers) {
    const p = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: multicallAddress, allowFailure: true, callData: "0x4d2301cc" + p });
    calls.push({ target: pool, allowFailure: true, callData: "0xf44136a1" + p });
  }

  const res = await mc.aggregate3(calls);
  const needTopup = [];
  let totalPending = 0n;

  for (let i = 0; i < allWorkers.length; i++) {
    const bnb = BigInt(res[i * 2].returnData);
    const pending = BigInt(res[i * 2 + 1].returnData);
    totalPending += pending;
    if (bnb < NEEDED && pending > 0n) {
      needTopup.push({ ...allWorkers[i], deficit: NEEDED - bnb });
    }
  }

  console.log(`Total Pending across fleet: ${ethers.formatUnits(totalPending, 18)} HASH`);
  console.log(`Wallets needing gas top-up: ${needTopup.length}`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  if (needTopup.length > 0) {
    console.log(`Top-up gas for ${needTopup.length} wallets from Wallet 3 in sub-batches of 15...`);
    for (let i = 0; i < needTopup.length; i += 15) {
      const sub = needTopup.slice(i, i + 15);
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
      console.log(`  Topped up ${Math.min(i + 15, needTopup.length)}/${needTopup.length} wallets...`);
    }
    console.log(`All top-ups completed!`);
  }

  // 2. Claim all wallets with pending > 0 in chunks of 25
  const claimTargets = [];
  for (let i = 0; i < allWorkers.length; i++) {
    const pending = BigInt(res[i * 2 + 1].returnData);
    if (pending > 0n) claimTargets.push(allWorkers[i]);
  }

  console.log(`Executing claim() for ${claimTargets.length} wallets in batches of 25...`);
  let claimSuccess = 0;
  for (let i = 0; i < claimTargets.length; i += 25) {
    const chunk = claimTargets.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
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
        return rcpt.status === 1;
      } catch (e) {
        return false;
      }
    });
    const r = await Promise.all(promises);
    claimSuccess += r.filter(Boolean).length;
    console.log(`  Claimed ${Math.min(i + 25, claimTargets.length)}/${claimTargets.length} (Success: ${claimSuccess})`);
  }

  // 3. Sweep all HASH to r3s
  console.log(`Sweeping HASH from wallets to r3s (${r3s})...`);
  let grandTotalSwept = 0n;
  for (let i = 0; i < allWorkers.length; i += 25) {
    const chunk = allWorkers.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
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
        // ignore
      }
      return 0n;
    });
    const r = await Promise.all(promises);
    for (const val of r) grandTotalSwept += val;
  }

  const cR3s = new ethers.Contract(hashToken, erc20Abi, provider);
  const r3sFinal = await cR3s.balanceOf(r3s);

  console.log(`\n========================================`);
  console.log(`>>> SWEEP SELESAI! <<<`);
  console.log(`Total HASH berhasil disapu sesi ini: ${ethers.formatUnits(grandTotalSwept, 18)} HASH`);
  console.log(`Total Saldo HASH di r3s: ${ethers.formatUnits(r3sFinal, 18)} HASH`);
  console.log(`========================================`);
}

main().catch(console.error);
