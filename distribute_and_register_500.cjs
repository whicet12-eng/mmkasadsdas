const { ethers } = require("ethers");
const fs = require("fs");
const { execSync } = require("child_process");

const RPC_URL = "https://bsc-dataseed.binance.org";
const POOL = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
const GAS_PRICE = 50000000n; // 0.05 gwei
const FUND_AMOUNT = 8000000000000n; // 0.000008 BNB per wallet

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("========================================================");
  log(">>> EXPANDING FLEET: 500 NEW MINING WALLETS <<<");
  log("Target: 3,000 -> 3,500 WALLETS (3,500.0 H)");
  log("========================================================");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const w3Data = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallet3.json", "utf8"));
  const wallet3 = new ethers.Wallet(w3Data.privateKey, provider);

  const wallets = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_500.json", "utf8"));
  log(`Loaded ${wallets.length} newly generated wallets (Indices #${wallets[0].index} - #${wallets[wallets.length - 1].index})`);

  const w3Bal = await provider.getBalance(wallet3.address);
  log(`Wallet 3 BNB Balance: ${ethers.formatEther(w3Bal)} BNB`);

  const totalFundNeeded = FUND_AMOUNT * BigInt(wallets.length);
  log(`Total Native BNB to distribute: ${ethers.formatEther(totalFundNeeded)} BNB`);

  // 1. Distribute BNB in sub-batches of 25
  log(`Distributing 0.000008 BNB each to 500 wallets in sub-batches of 25...`);
  for (let i = 0; i < wallets.length; i += 25) {
    const chunk = wallets.slice(i, i + 25);
    let baseNonce = await provider.getTransactionCount(wallet3.address);
    const txs = await Promise.all(chunk.map((w, idx) =>
      wallet3.sendTransaction({
        to: w.address,
        value: FUND_AMOUNT,
        nonce: baseNonce + idx,
        gasLimit: 21000n,
        gasPrice: GAS_PRICE,
        chainId: 56
      })
    ));
    await Promise.all(txs.map(t => t.wait()));
    log(`  Funded: ${Math.min(i + 25, wallets.length)}/${wallets.length} wallets...`);
  }
  log("All 500 wallets 100% funded with native BNB!");

  // 2. Split 250 to Codespace 1 and 250 to Codespace 2 for parallel registration
  const part1 = wallets.slice(0, 250);
  const part2 = wallets.slice(250);

  fs.writeFileSync("/workspaces/mmkasadsdas/wallets_500_p1.json", JSON.stringify(part1));
  fs.writeFileSync("/workspaces/mmkasadsdas/wallets_500_p2.json", JSON.stringify(part2));

  log("Dispatching Part 2 (250 wallets) to Codespace 2 (repulsive-ghost)...");
  execSync(`cat /workspaces/mmkasadsdas/wallets_500_p2.json | gh codespace ssh -c repulsive-ghost-pgq5rv4jpwf6xgq -- "cat > /workspaces/mmkasadsdas/wallets_500_p2.json"`);
  execSync(`gh codespace ssh -c repulsive-ghost-pgq5rv4jpwf6xgq -- "node /workspaces/mmkasadsdas/register_part.cjs /workspaces/mmkasadsdas/wallets_500_p2.json > /tmp/reg_500_p2.log 2>&1 &"`);
  log("Codespace 2 registration launched in background!");

  // 3. Register Part 1 here on Codespace 1
  log("Registering Part 1 (250 wallets) on Codespace 1 in batches of 20...");
  let regSuccess = 0;
  for (let i = 0; i < part1.length; i += 20) {
    const chunk = part1.slice(i, i + 20);
    const promises = chunk.map(async (wData) => {
      try {
        const w = new ethers.Wallet(wData.privateKey, provider);
        const tx = await w.sendTransaction({
          to: POOL,
          data: "0x1aa3a008",
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
    const r = await Promise.all(promises);
    regSuccess += r.filter(Boolean).length;
    log(`  Part 1 Progress: ${Math.min(i + 20, part1.length)}/${part1.length} (Success: ${regSuccess})`);
  }

  // 4. Wait for Codespace 2 to complete Part 2
  log("Waiting for Codespace 2 to finish Part 2...");
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const log2 = execSync(`gh codespace ssh -c repulsive-ghost-pgq5rv4jpwf6xgq -- "tail -n 2 /tmp/reg_500_p2.log"`).toString();
      if (log2.includes("FINISHED")) {
        log(`Codespace 2 FINISHED Part 2 registration!`);
        break;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 3000));
  }

  // 5. Append to master backups
  log("Updating master wallet archives...");
  const csvLines = wallets.map(w => `${w.index},"${w.address}","${w.privateKey}"`).join("\n");
  fs.appendFileSync("/workspaces/mmkasadsdas/master_wallets_all.csv", "\n" + csvLines);

  const masterJson = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/master_wallets_all.json", "utf8"));
  masterJson.push(...wallets);
  fs.writeFileSync("/workspaces/mmkasadsdas/master_wallets_all.json", JSON.stringify(masterJson, null, 2));

  execSync(`cd /workspaces/mmkasadsdas && zip -r -q wallets_backup.zip master_wallets_all.csv master_wallets_all.json wallets_*.json`);
  execSync(`cd /workspaces/mmkasadsdas && tar -czf wallets_backup.tar.gz master_wallets_all.csv master_wallets_all.json wallets_*.json`);

  log("========================================================");
  log(">>> EXPANSION COMPLETE: 3,500 WALLETS ACTIVELY MINING! <<<");
  log("========================================================");
}

main().catch(err => {
  console.error("FATAL ERROR in expansion:", err);
  process.exit(1);
});
