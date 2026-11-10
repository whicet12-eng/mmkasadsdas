const { ethers } = require("ethers");
const { execSync } = require("child_process");

const RPC_URL = "https://bsc-dataseed.binance.org";
const W3 = "0x5e9e7e37e553d6cc79eD671E8B861b1693cFA5fF";
const MIN_BALANCE = ethers.parseEther("0.01"); // Minimal 0.01 BNB

async function watch() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  console.log(`[${new Date().toISOString()}] Memulai monitoring saldo Wallet 3 (${W3})...`);

  while (true) {
    try {
      const bal = await provider.getBalance(W3);
      if (bal >= MIN_BALANCE) {
        console.log(`[${new Date().toISOString()}] 🚀 BNB terdeteksi masuk! Saldo: ${ethers.formatEther(bal)} BNB. Menjalankan pipeline...`);
        execSync("node /workspaces/mmkasadsdas/claim_and_sweep_tier15.cjs", { stdio: "inherit" });
        break;
      }
    } catch (e) {
      console.error("Error cek saldo:", e.message);
    }
    await new Promise(r => setTimeout(r, 6000)); // Cek tiap 6 detik
  }
}

watch();
