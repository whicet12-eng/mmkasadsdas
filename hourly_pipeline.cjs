const { ethers } = require("ethers");
const fs = require("fs");
const { execSync } = require("child_process");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S_ADDRESS = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
const USER_RECIPIENT = "0xcb34ccd05d2c21edf182d3d592f6ff2c80e34747";
const GAS_PRICE = 50000000n; // 0.05 gwei
const GAS_NEEDED_PER_WORKER = 10000000000000n; // 0.00001 BNB

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

function loadAllWorkers() {
  const files = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json"
  ];
  let all = [];
  for (const f of files) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      all.push(...JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }
  return all;
}

function getR3sBnbBalance(provider) {
  return provider.getBalance(R3S_ADDRESS);
}

function getR3sHashBalance(provider) {
  const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
  return c.balanceOf(R3S_ADDRESS);
}

async function executeHourlyPipeline() {
  log("========================================================");
  log(">>> STARTING HOURLY HASH21 PIPELINE <<<");
  log(`r3s Address     : ${R3S_ADDRESS}`);
  log(`User Recipient  : ${USER_RECIPIENT} (80% profit)`);
  log(`Gas Reserve     : 20% remaining in r3s/Wallet 3`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const workers = loadAllWorkers();
  log(`Loaded ${workers.length} worker wallets.`);

  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  // ----------------------------------------------------
  // STEP 1 & 2: Multicall check -> Topup if needed -> Claim -> Sweep
  // ----------------------------------------------------
  log("Step 1 & 2: Checking pending HASH and worker BNB balances...");
  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    calls.push({ target: MULTICALL, allowFailure: true, callData: "0x4d2301cc" + pad });
    calls.push({ target: POOL, allowFailure: true, callData: "0xf44136a1" + pad });
  }

  const results = [];
  for (let i = 0; i < calls.length; i += 600) {
    results.push(...await mc.aggregate3(calls.slice(i, i + 600)));
  }

  const claimTargets = [];
  const needTopup = [];
  let totalPending = 0n;

  for (let i = 0; i < workers.length; i++) {
    const bnbBal = BigInt(results[i * 2].returnData);
    const pend = BigInt(results[i * 2 + 1].returnData);
    totalPending += pend;

    if (pend > 0n) {
      claimTargets.push({ ...workers[i], bnbBal, pend });
      if (bnbBal < GAS_NEEDED_PER_WORKER) {
        needTopup.push({ ...workers[i], deficit: GAS_NEEDED_PER_WORKER - bnbBal });
      }
    }
  }

  log(`Total Fleet Pending HASH: ${ethers.formatUnits(totalPending, 18)} HASH`);
  log(`Wallets with pending HASH: ${claimTargets.length}/${workers.length}`);
  log(`Wallets needing gas top-up: ${needTopup.length}`);

  // Top up gas if needed and wallet3 has sufficient balance
  if (needTopup.length > 0) {
    const w3Bal = await provider.getBalance(wallet3.address);
    let totalDeficit = 0n;
    for (const item of needTopup) totalDeficit += item.deficit;
    log(`Total gas deficit: ${ethers.formatEther(totalDeficit)} BNB | Wallet 3 Balance: ${ethers.formatEther(w3Bal)} BNB`);

    if (w3Bal >= totalDeficit) {
      log(`Funding ${needTopup.length} wallets from Wallet 3 in sub-batches of 20...`);
      for (let i = 0; i < needTopup.length; i += 20) {
        const sub = needTopup.slice(i, i + 20);
        let baseNonce = await provider.getTransactionCount(wallet3.address);
        const txs = await Promise.all(sub.map((item, idx) =>
          wallet3.sendTransaction({
            to: item.address,
            value: item.deficit,
            nonce: baseNonce + idx,
            gasLimit: 21000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          })
        ));
        await Promise.all(txs.map(t => t.wait()));
        log(`  Topped up ${Math.min(i + 20, needTopup.length)}/${needTopup.length} wallets...`);
      }
    } else {
      log("Wallet 3 has low gas buffer; top up from r3s or prior reserves needed for full fleet sweep.");
    }
  }

  // Claim all eligible in chunks of 25
  log(`Executing claim() for ${claimTargets.length} wallets...`);
  let claimSuccess = 0;
  for (let i = 0; i < claimTargets.length; i += 25) {
    const chunk = claimTargets.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: POOL,
          data: "0x4e71d92d",
          gasLimit: 145000n,
          gasPrice: GAS_PRICE,
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
    if ((i + 25) % 100 === 0 || i + 25 >= claimTargets.length) {
      log(`  Claim progress: ${Math.min(i + 25, claimTargets.length)}/${claimTargets.length} (Success: ${claimSuccess})`);
    }
  }

  // Sweep all claimed HASH to r3s
  log(`Sweeping HASH from worker wallets to r3s (${R3S_ADDRESS})...`);
  let grandTotalSwept = 0n;
  for (let i = 0; i < workers.length; i += 25) {
    const chunk = workers.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const tx = await c.transfer(R3S_ADDRESS, bal, {
            gasLimit: 60000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcpt = await tx.wait();
          if (rcpt.status === 1) return bal;
        }
      } catch (e) {}
      return 0n;
    });
    const r = await Promise.all(promises);
    for (const val of r) grandTotalSwept += val;
    if ((i + 25) % 250 === 0 || i + 25 >= workers.length) {
      log(`  Sweep progress: ${Math.min(i + 25, workers.length)}/${workers.length}...`);
    }
  }

  const r3sHashBal = await getR3sHashBalance(provider);
  log(`Total HASH swept this session: ${ethers.formatUnits(grandTotalSwept, 18)} HASH`);
  log(`Current r3s HASH balance: ${ethers.formatUnits(r3sHashBal, 18)} HASH`);

  // ----------------------------------------------------
  // STEP 3: Check if selling is enabled
  // POLICY: USER EXPLICITLY ORDERED "JANGAN DI JUAL TAPI SELURUH HASHNYA"
  // Keep 100% of HASH safe in r3s.ai!
  // ----------------------------------------------------
  const AUTO_SELL_ENABLED = false;
  if (!AUTO_SELL_ENABLED) {
    log("POLICY ACTIVE: Auto-sell is DISABLED per user request. Keeping 100% HASH safe in r3s.ai!");
    log(`Final r3s HASH balance: ${ethers.formatUnits(r3sHashBal, 18)} HASH`);
    log("========================================================");
    log(">>> HOURLY PIPELINE COMPLETED (HOLD HASH IN R3S) <<<");
    log("========================================================");
    return;
  }
  if (r3sHashBal === 0n) {
    log("No HASH balance in r3s to sell at this time. Pipeline cycle completed.");
    return;
  }

  const bnbBefore = await getR3sBnbBalance(provider);
  const qtyToSwap = ethers.formatUnits(r3sHashBal, 18);
  log(`Step 3: Selling ${qtyToSwap} HASH on DEX via BAW market-order swap...`);

  try {
    const swapCmd = `baw market-order swap --binanceChainId 56 --fromTokenQty ${qtyToSwap} --fromToken ${HASH_TOKEN} --toToken 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --json`;
    log(`Executing: ${swapCmd}`);
    const swapOut = execSync(swapCmd).toString();
    log(`Swap result: ${swapOut}`);
  } catch (err) {
    log(`Swap failed: ${err.message}`);
    return;
  }

  // Wait a few seconds for balance update
  await new Promise(r => setTimeout(r, 6000));
  const bnbAfter = await getR3sBnbBalance(provider);
  const bnbEarned = bnbAfter > bnbBefore ? bnbAfter - bnbBefore : 0n;
  log(`BNB balance before swap: ${ethers.formatEther(bnbBefore)} BNB`);
  log(`BNB balance after swap : ${ethers.formatEther(bnbAfter)} BNB`);
  log(`Net BNB earned from swap: ${ethers.formatEther(bnbEarned)} BNB`);

  if (bnbEarned === 0n) {
    log("Net BNB earned is 0, skipping transfer.");
    return;
  }

  // ----------------------------------------------------
  // STEP 4 & 5: Transfer 80% to user, 20% retained for gas
  // ----------------------------------------------------
  const userShareBnb = (bnbEarned * 80n) / 100n;
  const gasShareBnb = bnbEarned - userShareBnb;

  log(`Step 4: Sending 80% (${ethers.formatEther(userShareBnb)} BNB) to user recipient ${USER_RECIPIENT}...`);
  log(`Step 5: Retaining 20% (${ethers.formatEther(gasShareBnb)} BNB) in r3s/Wallet 3 for gas...`);

  try {
    const previewCmd = `baw contract-call preview --binanceChainId 56 --from ${R3S_ADDRESS} --to ${USER_RECIPIENT} --value ${userShareBnb.toString()} --inputData 0x --json`;
    const previewRes = JSON.parse(execSync(previewCmd).toString());

    if (previewRes.success && previewRes.data && previewRes.data.requestId) {
      const execCmd = `baw contract-call execute --requestId ${previewRes.data.requestId} --json`;
      const execRes = JSON.parse(execSync(execCmd).toString());
      log(`Transfer 80% successful! TxHash: ${execRes.data ? execRes.data.txHash : "done"}`);
    } else {
      log(`Preview failed: ${JSON.stringify(previewRes)}`);
    }
  } catch (err) {
    log(`Transfer to user failed: ${err.message}`);
  }

  log("========================================================");
  log(">>> HOURLY PIPELINE COMPLETED SUCCESSFULLY <<<");
  log("========================================================");
}

if (require.main === module) {
  executeHourlyPipeline().catch(console.error);
}

module.exports = { executeHourlyPipeline };
