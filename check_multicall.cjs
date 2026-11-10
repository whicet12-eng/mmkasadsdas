const { ethers } = require("ethers");
const fs = require("fs");

async function checkAll() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const abi = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ];
  const mc = new ethers.Contract(multicallAddress, abi, provider);
  const pool = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";

  const allWallets = [
    { name: "Wallet 1 (Binance)", address: "0xCF909F35B2aC8Ad7c36f30B1574263b3A49368a3" },
    { name: "Wallet 2 (Binance)", address: "0xd59878Bc7D16e2A9D777256def9239E4441848A3" },
    { name: "Wallet 3", address: "0x5e9e7e37e553d6cc79eD671E8B861b1693cFA5fF" }
  ];

  for (const filename of ["wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json", "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json", "wallets_500.json"]) {
    const p = `/workspaces/mmkasadsdas/${filename}`;
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const w of arr) {
        allWallets.push({ name: `Wallet #${w.index + 3}`, address: w.address });
      }
    }
  }

  const calls = [];
  for (const w of allWallets) {
    const param = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({
      target: pool,
      allowFailure: true,
      callData: "0xf44136a1" + param // pendingOf
    });
    calls.push({
      target: pool,
      allowFailure: true,
      callData: "0x8086b8ba" + param // accountOf
    });
  }

  const chunkSize = 600; // 300 wallets per multicall call
  const results = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    const chunk = calls.slice(i, i + chunkSize);
    const res = await mc.aggregate3(chunk);
    results.push(...res);
  }

  let activeCount = 0;
  let totalHashrate = 0.0;
  let totalPending = 0n;
  let totalClaimed = 0n;

  for (let i = 0; i < allWallets.length; i++) {
    const pendRes = results[i * 2];
    const accRes = results[i * 2 + 1];

    if (pendRes.success && pendRes.returnData !== "0x") {
      totalPending += BigInt(pendRes.returnData);
    }

    if (accRes.success && accRes.returnData.length >= 66) {
      const hex = accRes.returnData.slice(2);
      const hashVal = BigInt("0x" + hex.slice(0, 64));
      const claimedVal = BigInt("0x" + hex.slice(64 * 3, 64 * 4));
      const isReg = BigInt("0x" + hex.slice(64 * 4, 64 * 5)) > 0n;

      if (isReg) {
        activeCount++;
        totalHashrate += Number(hashVal) / 1e18;
      }
      totalClaimed += claimedVal;
    }
  }

  const output = {
    timestamp: new Date().toISOString(),
    total_wallets: allWallets.length,
    active_wallets: activeCount,
    total_hashrate: totalHashrate,
    total_pending_hash: ethers.formatUnits(totalPending, 18),
    total_claimed_hash: ethers.formatUnits(totalClaimed, 18),
    total_earned_hash: ethers.formatUnits(totalPending + totalClaimed, 18)
  };

  console.log(JSON.stringify(output, null, 2));
}

checkAll().catch(console.error);
