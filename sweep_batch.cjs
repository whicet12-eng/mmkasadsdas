const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://bsc-dataseed.binance.org";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const HASH_TOKEN = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
const R3S = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";
const GAS_PRICE = 50000000n; // 0.05 gwei

const ERC20_ABI = [
  "function transfer(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

async function main() {
  const filePath = process.argv[2];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error("Usage: node sweep_batch.cjs <wallet_json_file>");
    process.exit(1);
  }

  const wallets = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`[${filePath}] Starting claim & sweep for ${wallets.length} wallets in batches of 25...`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  let successClaim = 0;
  let totalSwept = 0n;

  for (let i = 0; i < wallets.length; i += 25) {
    const chunk = wallets.slice(i, i + 25);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        // 1. claim
        try {
          const txClaim = await w.sendTransaction({
            to: POOL,
            data: "0x4e71d92d",
            gasLimit: 145000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcptClaim = await txClaim.wait();
          if (rcptClaim.status === 1) successClaim++;
        } catch (e) {
          // already claimed or low gas
        }

        // 2. sweep
        const c = new ethers.Contract(HASH_TOKEN, ERC20_ABI, w);
        const bal = await c.balanceOf(w.address);
        if (bal > 0n) {
          const txSweep = await c.transfer(R3S, bal, {
            gasLimit: 60000n,
            gasPrice: GAS_PRICE,
            chainId: 56
          });
          const rcptSweep = await txSweep.wait();
          if (rcptSweep.status === 1) return bal;
        }
      } catch (err) {}
      return 0n;
    });

    const r = await Promise.all(promises);
    for (const val of r) totalSwept += val;

    console.log(`[${filePath}] Progress: ${Math.min(i + 25, wallets.length)}/${wallets.length} (Claimed: ${successClaim}, Swept: ${ethers.formatUnits(totalSwept, 18)} HASH)`);
  }

  console.log(`[${filePath}] FINISHED! Total HASH swept: ${ethers.formatUnits(totalSwept, 18)} HASH`);
}

main().catch(console.error);
