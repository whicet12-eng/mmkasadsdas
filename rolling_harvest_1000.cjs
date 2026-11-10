const { ethers } = require("ethers");
const fs = require("fs");
const { execSync } = require("child_process");

const RPC_URL = "https://bsc-dataseed.binance.org";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S_ADDRESS = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
const WALLET3_ADDRESS = "0x5e9e7e37e553d6cc79eD671E8B861b1693cFA5fF";

const GAS_PRICE = 50000000n; // 0.05 gwei
const TARGET_WORKER_BNB = 7800000000000n; // 0.0000078 BNB (enough for 114k claim + 40k transfer)
const TOPUP_AMOUNT = 6000000000000n; // 0.000006 BNB

const POOL_ABI = ["function claim() external"];
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function swapHashOnR3s(qty) {
  log(`Swapping ${qty} HASH on PancakeSwap via BAW CLI...`);
  try {
    const cmd = `baw market-order swap --binanceChainId 56 --fromTokenQty ${qty} --fromToken ${HASH_TOKEN} --toToken 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --json`;
    const out = execSync(cmd, { timeout: 45000 }).toString();
    const j = JSON.parse(out);
    log(`Swap result: ${JSON.stringify(j)}`);
    return j.success;
  } catch (e) {
    log(`Swap failed: ${e.message}`);
    return false;
  }
}

function transferBnbToWallet3(bnbAmountEther) {
  const wei = ethers.parseEther(bnbAmountEther.toString()).toString();
  log(`Transferring ${bnbAmountEther} BNB (${wei} wei) from r3s.ai to Wallet 3...`);
  try {
    const prevCmd = `baw contract-call preview --binanceChainId 56 --from ${R3S_ADDRESS} --to ${WALLET3_ADDRESS} --value ${wei} --inputData 0x --json`;
    const prevOut = execSync(prevCmd, { timeout: 30000 }).toString();
    const prevJson = JSON.parse(prevOut);
    if (!prevJson.success || !prevJson.data.requestId) {
      log(`Preview failed: ${prevOut}`);
      return false;
    }
    const reqId = prevJson.data.requestId;
    const execCmd = `baw contract-call execute --requestId ${reqId} --json`;
    const execOut = execSync(execCmd, { timeout: 30000 }).toString();
    const execJson = JSON.parse(execOut);
    log(`Execute transfer tx: ${execJson.data ? execJson.data.txHash : execOut}`);
    return true;
  } catch (e) {
    log(`Transfer to Wallet 3 failed: ${e.message}`);
    return false;
  }
}

async function fundWorkersIfNeeded(provider, wallet3, workers) {
  const mc = new ethers.Contract(MULTICALL, MULTICALL_ABI, provider);
  const calls = workers.map(w => ({
    target: MULTICALL,
    allowFailure: true,
    callData: "0x4d2301cc" + w.address.slice(2).toLowerCase().padStart(64, "0")
  }));

  const balances = [];
  for (let i = 0; i < calls.length; i += 300) {
    const chunk = calls.slice(i, i + 300);
    const res = await mc.aggregate3(chunk);
    for (const r of res) {
      balances.push(BigInt(r.returnData));
    }
  }

  const needFund = [];
  for (let i = 0; i < workers.length; i++) {
    if (balances[i] < TARGET_WORKER_BNB) {
      needFund.push(workers[i]);
    }
  }

  log(`  Wallets needing BNB top-up: ${needFund.length}/${workers.length}`);
  if (needFund.length === 0) return true;

  // Send top-ups in sub-batches of 25
  for (let i = 0; i < needFund.length; i += 25) {
    const chunk = needFund.slice(i, i + 25);
    let baseNonce = await provider.getTransactionCount(wallet3.address);
    const txs = await Promise.all(chunk.map((w, idx) =>
      wallet3.sendTransaction({
        to: w.address,
        value: TOPUP_AMOUNT,
        nonce: baseNonce + idx,
        gasLimit: 21000n,
        gasPrice: GAS_PRICE,
        chainId: 56
      }).catch(e => {
        log(`    Top-up send error for ${w.address}: ${e.message}`);
        return null;
      })
    ));

    const validTxs = txs.filter(Boolean);
    await Promise.all(validTxs.map(t => t.wait().catch(() => null)));
    log(`  Funded ${Math.min(i + 25, needFund.length)}/${needFund.length} wallets`);
  }
  return true;
}

async function claimAndSweepChunk(provider, chunk) {
  let claimSuccess = 0;
  let totalSwept = 0n;

  // 1. Claim in parallel sub-batches of 25
  for (let i = 0; i < chunk.length; i += 25) {
    const sub = chunk.slice(i, i + 25);
    const promises = sub.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const p = new ethers.Contract(POOL, POOL_ABI, w);
        const tx = await p.claim({
          gasLimit: 140000n,
          gasPrice: GAS_PRICE,
          chainId: 56
        });
        const rcpt = await tx.wait();
        return rcpt.status === 1;
      } catch (e) {
        return false;
      }
    });
    const res = await Promise.all(promises);
    claimSuccess += res.filter(Boolean).length;
  }

  // 2. Sweep in parallel sub-batches of 25
  for (let i = 0; i < chunk.length; i += 25) {
    const sub = chunk.slice(i, i + 25);
    const promises = sub.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const tx = await c.transfer(R3S_ADDRESS, bal, {
            gasLimit: 55000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcpt = await tx.wait();
          if (rcpt.status === 1) return bal;
        }
      } catch (e) {}
      return 0n;
    });
    const res = await Promise.all(promises);
    for (const val of res) totalSwept += val;
  }

  return { claimSuccess, totalSwept };
}

async function main() {
  log("========================================================");
  log(">>> STARTING ROLLING HARVEST FOR 1,000+ HASH <<<");
  log(`Destination: ${R3S_ADDRESS}`);
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const master = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/master_wallets_all.json", "utf8"));
  const workers = master.filter(w => w.privateKey);
  log(`Total active workers loaded: ${workers.length}`);

  let totalHarvested = 0n;
  let totalSuccessfulClaims = 0;

  // Process in chunks of 250 wallets
  const CHUNK_SIZE = 250;
  for (let cIdx = 0; cIdx < workers.length; cIdx += CHUNK_SIZE) {
    const chunk = workers.slice(cIdx, cIdx + CHUNK_SIZE);
    const chunkNum = Math.floor(cIdx / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(workers.length / CHUNK_SIZE);
    log(`\n--- PROCESSING CHUNK ${chunkNum}/${totalChunks} (${chunk.length} wallets) ---`);

    // Check Wallet 3 BNB balance
    let w3Bal = await provider.getBalance(wallet3.address);
    log(`Wallet 3 BNB Balance: ${ethers.formatEther(w3Bal)} BNB`);

    // If Wallet 3 is low (< 0.0018 BNB), check if r3s has HASH to swap
    if (w3Bal < ethers.parseEther("0.0018") && cIdx > 0) {
      log("Wallet 3 BNB is low. Checking HASH on r3s.ai to swap...");
      const token = new ethers.Contract(HASH_TOKEN, ERC20_ABI, provider);
      const r3sHashBal = await token.balanceOf(R3S_ADDRESS);
      const r3sHashEther = Number(ethers.formatEther(r3sHashBal));
      log(`r3s.ai HASH Balance: ${r3sHashEther.toFixed(2)} HASH`);

      if (r3sHashEther >= 50) {
        const swapQty = Math.min(Math.floor(r3sHashEther * 0.7), 65);
        log(`Swapping ${swapQty} HASH for gas fee...`);
        const okSwap = swapHashOnR3s(swapQty);
        if (okSwap) {
          await sleep(5000);
          transferBnbToWallet3(0.0025);
          await sleep(5000);
          w3Bal = await provider.getBalance(wallet3.address);
          log(`New Wallet 3 BNB Balance after swap: ${ethers.formatEther(w3Bal)} BNB`);
        }
      }
    }

    // Fund workers in chunk if needed
    log(`Step 1: Checking and topping up BNB for Chunk ${chunkNum}...`);
    await fundWorkersIfNeeded(provider, wallet3, chunk);

    // Claim and sweep chunk
    log(`Step 2: Executing Claim and Sweep for Chunk ${chunkNum}...`);
    const { claimSuccess, totalSwept } = await claimAndSweepChunk(provider, chunk);
    totalSuccessfulClaims += claimSuccess;
    totalHarvested += totalSwept;
    log(`Chunk ${chunkNum} Completed: ${claimSuccess}/${chunk.length} claimed, swept ${ethers.formatEther(totalSwept)} HASH`);
    log(`Cumulative Harvested So Far: ${ethers.formatEther(totalHarvested)} HASH`);
  }

  log("\n========================================================");
  log(">>> ALL CHUNKS FINISHED! <<<");
  log(`Total Successful Claims: ${totalSuccessfulClaims}/${workers.length}`);
  log(`Total HASH Swept to r3s.ai: ${ethers.formatEther(totalHarvested)} HASH`);
  log("========================================================");
}

main().catch(err => {
  console.error("FATAL ERROR in rolling harvest:", err);
  process.exit(1);
});
