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

  const calls = all.map(w => ({
    target: multicallAddress,
    allowFailure: true,
    callData: "0x4d2301cc" + w.address.slice(2).toLowerCase().padStart(64, "0")
  }));
  const res = await mc.aggregate3(calls);
  const targets = [];
  for (let i = 0; i < all.length; i++) {
    if (BigInt(res[i].returnData) >= 10000000000000n) {
      targets.push(all[i]);
    }
  }

  console.log(`Executing claim() for ${targets.length} wallets...`);
  let claimSuccess = 0;
  for (let i = 0; i < targets.length; i += 25) {
    const chunk = targets.slice(i, i + 25);
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
    console.log(`  Claimed ${Math.min(i + 25, targets.length)}/${targets.length} (Success: ${claimSuccess})`);
  }

  console.log(`Sweeping HASH to r3s...`);
  let totalSwept = 0n;
  for (let i = 0; i < targets.length; i += 25) {
    const chunk = targets.slice(i, i + 25);
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
    for (const val of r) totalSwept += val;
  }

  const cR3s = new ethers.Contract(hashToken, erc20Abi, provider);
  const r3sFinal = await cR3s.balanceOf(r3s);

  console.log(`\n========================================`);
  console.log(`>>> SWEEP 311 WALLETS SELESAI! <<<`);
  console.log(`Total HASH berhasil disapu: ${ethers.formatUnits(totalSwept, 18)} HASH`);
  console.log(`Total Saldo HASH di r3s: ${ethers.formatUnits(r3sFinal, 18)} HASH`);
  console.log(`========================================`);
}

main().catch(console.error);
