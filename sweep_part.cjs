const { ethers } = require("ethers");
const fs = require("fs");

async function sweepPart() {
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
  // Take first 70
  const chunk = walletsWithHash.slice(0, 70);
  console.log(`Processing first batch of ${chunk.length} wallets...`);

  // 2. Fund them with 0.00000035 BNB from Wallet 3
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const startNonce = await provider.getTransactionCount(wallet3.address);
  const gasPrice = 50000000n; // 0.05 gwei

  console.log(`Sending 0.00000035 BNB from Wallet 3 starting at nonce ${startNonce}...`);
  const topupPromises = [];
  for (let i = 0; i < chunk.length; i++) {
    topupPromises.push(wallet3.sendTransaction({
      to: chunk[i].address,
      value: ethers.parseEther("0.00000035"),
      nonce: startNonce + i,
      gasLimit: 21000n,
      gasPrice: gasPrice,
      chainId: 56
    }));
  }

  const topupTxs = await Promise.all(topupPromises);
  await Promise.all(topupTxs.map(tx => tx.wait()));
  console.log("Top-ups confirmed for first 70 wallets!");

  // 3. Each wallet transfers HASH to r3s
  console.log(`Transferring HASH to r3s (${r3s})...`);
  const erc20Abi = ["function transfer(address to, uint256 amount) returns (bool)"];
  let totalTransferred = 0n;

  for (let b = 0; b < chunk.length; b += 14) {
    const sub = chunk.slice(b, b + 14);
    const txPromises = sub.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(hashToken, erc20Abi, w);
        const tx = await c.transfer(r3s, wData.hashBal, {
          gasLimit: 55000n,
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
    console.log(`Sub-batch ${Math.floor(b / 14) + 1} confirmed!`);
  }

  console.log(`BATCH 1 COMPLETE! Total HASH transferred: ${ethers.formatUnits(totalTransferred, 18)} HASH`);
}

sweepPart().catch(console.error);
