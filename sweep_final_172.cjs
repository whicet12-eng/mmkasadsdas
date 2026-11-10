const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

const GAS_PRICE = 50000000n; // 0.05 gwei
const TX_GAS_LIMIT = 21000n;
const TRANSFER_GAS_LIMIT = 35000n;

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];
const MULTICALL_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("==========================================================================");
  log(">>> EKSEKUSI FINAL: 172 WORKER TERAKHIR (271.74 HASH) KE R3S.AI <<<");
  log("==========================================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);

  const filenames = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json",
    "wallets_500.json"
  ];
  const workersMap = new Map();
  for (const f of filenames) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const w of arr) workersMap.set(w.address.toLowerCase(), w);
    }
  }
  const workers = Array.from(workersMap.values());

  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
    calls.push({ target: HASH_TOKEN, allowFailure: true, callData: "0x70a08231" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    const chunk = await mc.aggregate3(calls.slice(i, i + 600));
    results.push(...chunk);
  }

  const recipients = [];
  const donors = [];

  for (let i = 0; i < workers.length; i++) {
    const bnbBal = BigInt(results[i * 2].returnData);
    const tokenBal = BigInt(results[i * 2 + 1].returnData);

    if (tokenBal > 0n) {
      recipients.push({ worker: workers[i], bnbBal, tokenBal });
    } else if (bnbBal > 2000000000000n) {
      const sendable = bnbBal - (TX_GAS_LIMIT * GAS_PRICE);
      if (sendable > 0n) donors.push({ worker: workers[i], bnbBal, sendable });
    }
  }

  log(`Target recipients: ${recipients.length} worker`);
  log(`Available donors: ${donors.length} worker`);

  const gasPerWorker = 2000000000000n; // 0.000002 BNB
  const totalNeeded = BigInt(recipients.length) * (gasPerWorker + 1050000000000n);
  log(`Total BNB needed in Wallet 3: ${ethers.formatEther(totalNeeded)} BNB`);

  // Step 1: Siphon safely in sub-batches of 15
  let currentW3Bal = await provider.getBalance(wallet3.address);
  log(`Current Wallet 3 balance: ${ethers.formatEther(currentW3Bal)} BNB`);

  const siphonBatchSize = 15;
  for (let i = 0; i < donors.length && currentW3Bal < (totalNeeded + 50000000000000n); i += siphonBatchSize) {
    const batch = donors.slice(i, i + siphonBatchSize);
    log(`Siphoning batch ${i / siphonBatchSize + 1} (${batch.length} donors)...`);
    await Promise.all(batch.map(async (d) => {
      try {
        const signer = new ethers.Wallet(d.worker.privateKey, provider);
        const tx = await signer.sendTransaction({
          to: wallet3.address,
          value: d.sendable,
          gasLimit: TX_GAS_LIMIT,
          gasPrice: GAS_PRICE
        });
        await tx.wait();
      } catch (err) {
        log(`Donor ${d.worker.address} error: ${err.message}`);
      }
    }));
    currentW3Bal = await provider.getBalance(wallet3.address);
    log(`  Wallet 3 balance now: ${ethers.formatEther(currentW3Bal)} BNB`);
  }

  // Step 2: Distribute to recipients
  log(`Distributing gas to ${recipients.length} recipients...`);
  const distBatch = 20;
  for (let i = 0; i < recipients.length; i += distBatch) {
    const batch = recipients.slice(i, i + distBatch);
    let baseNonce = await provider.getTransactionCount(wallet3.address, "latest");
    const txs = await Promise.all(batch.map((r, idx) =>
      wallet3.sendTransaction({
        to: r.worker.address,
        value: gasPerWorker,
        nonce: baseNonce + idx,
        gasLimit: TX_GAS_LIMIT,
        gasPrice: GAS_PRICE,
        chainId: 56
      })
    ));
    await Promise.all(txs.map(t => t.wait()));
    log(`  Funded: ${Math.min(i + distBatch, recipients.length)}/${recipients.length} workers`);
  }

  // Step 3: Sweep tokens from all recipients
  log(`Sweeping token HASH from ${recipients.length} workers to ${R3S}...`);
  let successCount = 0;
  let totalHashSwept = 0n;
  const sweepBatch = 25;
  for (let i = 0; i < recipients.length; i += sweepBatch) {
    const batch = recipients.slice(i, i + sweepBatch);
    await Promise.all(batch.map(async (item) => {
      try {
        const signer = new ethers.Wallet(item.worker.privateKey, provider);
        const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, signer);
        const tx = await c.transfer(R3S, item.tokenBal, {
          gasLimit: TRANSFER_GAS_LIMIT,
          gasPrice: GAS_PRICE
        });
        await tx.wait();
        successCount++;
        totalHashSwept += item.tokenBal;
      } catch (e) {
        log(`Recipient ${item.worker.address} error: ${e.message}`);
      }
    }));
    log(`  Swept: ${Math.min(i + sweepBatch, recipients.length)}/${recipients.length} (Success: ${successCount}, HASH: ${ethers.formatEther(totalHashSwept)})`);
  }

  // Step 4: Final verification
  const tokenC = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  const finalR3sHash = await tokenC.balanceOf(R3S);
  log("==========================================================================");
  log(`>>> SEMUA HASH BERHASIL DISAPU! TOTAL HASH DI R3S.AI: ${ethers.formatEther(finalR3sHash)} HASH <<<`);
  log("==========================================================================");
}

main().catch(console.error);
