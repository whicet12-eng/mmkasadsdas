const { ethers } = require("ethers");
const { execSync, spawn } = require("child_process");

const RPC_URL = "https://bsc-rpc.publicnode.com";
const TOKEN_ADDR = "0x7E2DA878217EB995F9e5d36eD32c9Cea52442681";
const WALLET_ADDR = "0xCF909F35B2aC8Ad7c36f30B1574263b3A49368a3";
const HANDLE = "bys";
const VAST_SSH = "ssh -o StrictHostKeyChecking=no -p 23735 root@85.221.192.171";

const ABI = [
  "function isLive() view returns (bool)",
  "function dailyRemaining() view returns (uint256)",
  "function miningDay() view returns (uint256)",
  "function currentTarget() view returns (uint256)",
  "function startsAt() view returns (uint256)",
  "function challenge(address,uint256) view returns (bytes32,uint256,uint256,bool,bool,uint256)",
  "function mineBatch(uint256 id, uint256[] nonces, uint256 minTotalReward)",
  "function balanceOf(address account) view returns (uint256)"
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function solveNoncesOnVast(seed, targetHigh64Hex, count) {
  console.log(`[SOLVER] Requesting ${count} nonces from Vast.ai GPU/CPU...`);
  const t0 = Date.now();
  const cmd = `${VAST_SSH} "/root/pearl_solver ${seed} ${targetHigh64Hex} ${count} 48"`;
  const output = execSync(cmd, { encoding: "utf8", timeout: 120000 });
  const lines = output.split("\n");
  const nonces = [];
  for (const line of lines) {
    if (line.includes("FOUND_NONCE:")) {
      const parts = line.split("FOUND_NONCE:");
      if (parts[1]) {
        nonces.push(parts[1].trim());
      }
    }
  }
  console.log(`[SOLVER] Found ${nonces.length} nonces in ${((Date.now() - t0)/1000).toFixed(1)}s:`, nonces);
  return nonces;
}

function broadcastMineBatch(idStr, nonces, minTotalRewardStr) {
  const iface = new ethers.Interface(ABI);
  const data = iface.encodeFunctionData("mineBatch", [
    BigInt(idStr),
    nonces.map(n => BigInt(n)),
    BigInt(minTotalRewardStr)
  ]);

  console.log(`[BAW] Generating preview for mineBatch (batch size: ${nonces.length})...`);
  const previewCmd = `baw contract-call preview --to ${TOKEN_ADDR} --data "${data}" --chain-id 56 --json`;
  const previewOut = execSync(previewCmd, { encoding: "utf8" });
  console.log("[BAW] Preview output:", previewOut.trim());

  let previewJson;
  try {
    previewJson = JSON.parse(previewOut);
  } catch (e) {
    console.error("[BAW] Failed to parse preview json:", e);
    return null;
  }

  const requestId = previewJson.requestId || previewJson.id || previewJson.data?.requestId;
  if (!requestId) {
    console.error("[BAW] No requestId in preview output!");
    return null;
  }

  console.log(`[BAW] Executing requestId: ${requestId}...`);
  const execCmd = `baw contract-call execute --request-id "${requestId}" --json`;
  const execOut = execSync(execCmd, { encoding: "utf8" });
  console.log("[BAW] Execute output:", execOut.trim());
  return execOut;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(TOKEN_ADDR, ABI, provider);
  const id = BigInt(ethers.keccak256(ethers.toUtf8Bytes(HANDLE)));

  console.log(`=== PEARL COIN AUTO-MINER INITIATED ===`);
  console.log(`Wallet : ${WALLET_ADDR} (${HANDLE})`);
  console.log(`Contract: ${TOKEN_ADDR}`);

  let lastClaimedBalance = 0n;
  try {
    lastClaimedBalance = await contract.balanceOf(WALLET_ADDR);
    console.log(`Initial PEARL Balance: ${ethers.formatUnits(lastClaimedBalance, 8)}`);
  } catch(e) {}

  while (true) {
    try {
      const block = await provider.getBlock("latest");
      const isLive = await contract.isLive();
      const rem = await contract.dailyRemaining();
      const day = await contract.miningDay();
      const chal = await contract.challenge(WALLET_ADDR, id);

      console.log(`[STATUS] Time: ${new Date(block.timestamp * 1000).toISOString().substr(11, 8)} | Day: ${day} | isLive: ${isLive} | Remaining: ${ethers.formatUnits(rem, 8)} PEARL | ChalLive: ${chal[4]}`);

      if (!isLive || !chal[4]) {
        console.log(`[WAIT] Mining is not live yet or challenge inactive. Retrying in 2 seconds...`);
        await sleep(2000);
        continue;
      }

      const seed = chal[0];
      const target = chal[1];
      const rewardPerShare = chal[2];

      // Top 64 bits of target for C solver
      const targetHex = target.toString(16).padStart(64, "0");
      const targetHigh64 = targetHex.substr(0, 16);

      const batchCount = 16;
      const nonces = solveNoncesOnVast(seed, targetHigh64, batchCount);

      if (nonces.length === 0) {
        console.log(`[WARN] No nonces returned, retrying...`);
        await sleep(1000);
        continue;
      }

      // Calculate minTotalReward (1% slippage buffer)
      const expectedTotalReward = rewardPerShare * BigInt(nonces.length);
      const minTotalReward = (expectedTotalReward * 99n) / 100n;

      console.log(`[MINING] Submitting batch of ${nonces.length} nonces | Expected reward: ${ethers.formatUnits(expectedTotalReward, 8)} PEARL...`);
      const res = broadcastMineBatch(id.toString(), nonces, minTotalReward.toString());

      await sleep(3000);
      try {
        const newBal = await contract.balanceOf(WALLET_ADDR);
        console.log(`[BALANCE] Current PEARL Balance: ${ethers.formatUnits(newBal, 8)}`);
      } catch(e) {}

    } catch (err) {
      console.error("[ERROR] Loop error:", err.message);
      await sleep(2000);
    }
  }
}

main();
