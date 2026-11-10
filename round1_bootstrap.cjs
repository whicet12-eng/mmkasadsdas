const { ethers } = require("ethers");
const fs = require("fs");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const pool = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const hashToken = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
  const r3s = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
  const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const mc = new ethers.Contract(multicallAddress, [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ], provider);

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
  let all = [];
  for (const f of files) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) all.push(...JSON.parse(fs.readFileSync(p, "utf8")));
  }

  // Check pending of all wallets to find top earners
  console.log("Checking pending HASH of all 795 wallets...");
  const calls = all.map(w => ({
    target: pool,
    allowFailure: true,
    callData: "0xf44136a1" + w.address.slice(2).toLowerCase().padStart(64, "0")
  }));
  const res = await mc.aggregate3(calls);
  const list = [];
  for (let i = 0; i < all.length; i++) {
    list.push({ ...all[i], pending: BigInt(res[i].returnData) });
  }
  list.sort((a, b) => (b.pending > a.pending ? 1 : -1));

  // Select top 25 wallets
  const targets = list.slice(0, 25);
  console.log(`Selected top 30 wallets (Total pending: ${ethers.formatUnits(targets.reduce((acc, x) => acc + x.pending, 0n), 18)} HASH).`);

  // Check BNB balances of top 30
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
    console.log(`Top-up needed for ${needTopup.length} wallets from Wallet 3...`);
    let baseNonce = await provider.getTransactionCount(wallet3.address);
    const txs = await Promise.all(needTopup.map((item, idx) =>
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
    console.log("Top-up confirmed!");
  }

  // Claim top 30
  console.log("Executing claim() for 30 wallets...");
  let claimSuccess = 0;
  for (let s = 0; s < targets.length; s += 10) {
    const sub = targets.slice(s, s + 10);
    const promises = sub.map(async (wData) => {
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
  }
  console.log(`Claimed: ${claimSuccess}/${targets.length}`);

  // Sweep top 30
  console.log(`Transferring HASH to r3s (${r3s})...`);
  let totalSwept = 0n;
  for (let s = 0; s < targets.length; s += 10) {
    const sub = targets.slice(s, s + 10);
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
    const r = await Promise.all(promises);
    for (const val of r) totalSwept += val;
  }

  console.log(`\n>>> ROUND 1 BOOTSTRAP SELESAI! <<<`);
  console.log(`Total HASH berhasil disapu ke r3s: ${ethers.formatUnits(totalSwept, 18)} HASH`);
}

main().catch(console.error);
