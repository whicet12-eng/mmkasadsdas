const { ethers } = require("ethers");
const fs = require("fs");

async function sweep() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const mcAbi = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ];
  const mc = new ethers.Contract(multicallAddress, mcAbi, provider);

  const hashToken = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
  const r3s = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

  const allWallets = [];
  for (const f of ["wallets_50.json", "wallets_35.json", "wallets_60.json"]) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      allWallets.push(...JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }

  // 1. Check who has HASH balance
  const calls = allWallets.map(w => ({
    target: hashToken,
    allowFailure: true,
    callData: "0x70a08231" + w.address.slice(2).toLowerCase().padStart(64, "0")
  }));

  const res = await mc.aggregate3(calls);
  const walletsWithHash = [];
  for (let i = 0; i < allWallets.length; i++) {
    if (res[i].success && res[i].returnData !== "0x") {
      const b = BigInt(res[i].returnData);
      if (b > 0n) {
        walletsWithHash.push({ ...allWallets[i], hashBal: b });
      }
    }
  }

  console.log(`Found ${walletsWithHash.length} wallets holding HASH tokens!`);

  // 2. Fund them with 0.0000007 BNB from Wallet 3
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const startNonce = await provider.getTransactionCount(wallet3.address);
  const feeData = await provider.getFeeData();
  const gasPrice = 50000000n; // 0.05 gwei

  console.log(`Sending top-up gas (0.0000007 BNB) to ${walletsWithHash.length} wallets...`);
  const topupPromises = [];
  for (let i = 0; i < walletsWithHash.length; i++) {
    topupPromises.push(wallet3.sendTransaction({
      to: walletsWithHash[i].address,
      value: ethers.parseEther("0.0000007"),
      nonce: startNonce + i,
      gasLimit: 21000n,
      gasPrice: gasPrice,
      chainId: 56
    }));
  }

  const topupTxs = await Promise.all(topupPromises);
  await Promise.all(topupTxs.map(tx => tx.wait()));
  console.log("All top-ups confirmed!");

  // 3. Each wallet transfers HASH to r3s
  console.log(`Transferring HASH to r3s (${r3s}) in batches of 15...`);
  const erc20Abi = ["function transfer(address to, uint256 amount) returns (bool)"];
  let totalTransferred = 0n;

  for (let batch = 0; batch < walletsWithHash.length; batch += 15) {
    const chunk = walletsWithHash.slice(batch, batch + 15);
    const txPromises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(hashToken, erc20Abi, w);
        const tx = await c.transfer(r3s, wData.hashBal, {
          gasLimit: 60000n,
          gasPrice: gasPrice
        });
        const rcpt = await tx.wait();
        if (rcpt.status === 1) {
          totalTransferred += wData.hashBal;
        }
      } catch (e) {
        console.error(`Transfer fail for ${wData.address}:`, e.message);
      }
    });

    await Promise.all(txPromises);
    console.log(`Batch ${Math.floor(batch / 15) + 1} processed!`);
  }

  console.log(`SWEEP COMPLETE! Total HASH transferred: ${ethers.formatUnits(totalTransferred, 18)} HASH`);
}

sweep().catch(console.error);
