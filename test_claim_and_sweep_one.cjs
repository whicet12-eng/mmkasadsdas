const { ethers } = require("ethers");
const fs = require("fs");

async function testOne() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const poolAddress = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const hashAddress = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";
  const r3sAddress = "0xd59878Bc7D16e2A9D777256def9239E4441848A3";

  const w50 = JSON.parse(fs.readFileSync("/workspaces/mmkasadsdas/wallets_50.json", "utf8"));
  const workerData = w50[0];
  const wallet = new ethers.Wallet(workerData.privateKey, provider);

  const hashToken = new ethers.Contract(hashAddress, [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)"
  ], wallet);

  const pool = new ethers.Contract(poolAddress, [
    "function pendingOf(address) view returns (uint256)"
  ], provider);

  console.log(`=== TEST CLAIM & SWEEP 1 WORKER ===`);
  console.log(`Worker Address: ${wallet.address}`);
  console.log(`Target r3s.ai:  ${r3sAddress}`);

  const initBnb = await provider.getBalance(wallet.address);
  const pendingHash = await pool.pendingOf(wallet.address);
  const initHash = await hashToken.balanceOf(wallet.address);
  const initR3sHash = await hashToken.balanceOf(r3sAddress);

  console.log(`Saldo Awal BNB Worker:   ${ethers.formatEther(initBnb)} BNB`);
  console.log(`Pending HASH di Pool:    ${ethers.formatUnits(pendingHash, 18)} HASH`);
  console.log(`Saldo Awal HASH Worker:  ${ethers.formatUnits(initHash, 18)} HASH`);
  console.log(`Saldo Awal HASH r3s.ai:  ${ethers.formatUnits(initR3sHash, 18)} HASH`);

  const gasPrice = 50000000n; // 0.05 gwei

  // STEP 1: CLAIM
  console.log("\n[1/2] Mengirim transaksi claim()...");
  const claimTx = await wallet.sendTransaction({
    to: poolAddress,
    data: "0x4e71d92d", // claim()
    gasLimit: 140000n,
    gasPrice: gasPrice,
    chainId: 56
  });
  console.log(`TX Claim Hash: ${claimTx.hash}`);
  const claimReceipt = await claimTx.wait();
  const claimGasUsed = claimReceipt.gasUsed;
  const claimFeeBnb = claimGasUsed * claimReceipt.gasPrice;
  console.log(`Status Claim: ${claimReceipt.status === 1 ? "SUKSES" : "GAGAL"}`);
  console.log(`Gas Used (Claim): ${claimGasUsed.toString()}`);
  console.log(`Fee Claim: ${ethers.formatEther(claimFeeBnb)} BNB`);

  // STEP 2: CHECK TOKEN & SWEEP
  const balanceAfterClaim = await hashToken.balanceOf(wallet.address);
  console.log(`\nSaldo HASH Worker setelah claim: ${ethers.formatUnits(balanceAfterClaim, 18)} HASH`);

  if (balanceAfterClaim === 0n) {
    console.log("Tidak ada HASH untuk ditransfer.");
    return;
  }

  console.log("\n[2/2] Mengirim transfer HASH ke r3s.ai...");
  const transferTx = await hashToken.transfer(r3sAddress, balanceAfterClaim, {
    gasLimit: 50000n,
    gasPrice: gasPrice,
    chainId: 56
  });
  console.log(`TX Transfer Hash: ${transferTx.hash}`);
  const transferReceipt = await transferTx.wait();
  const transferGasUsed = transferReceipt.gasUsed;
  const transferFeeBnb = transferGasUsed * transferReceipt.gasPrice;
  console.log(`Status Transfer: ${transferReceipt.status === 1 ? "SUKSES" : "GAGAL"}`);
  console.log(`Gas Used (Transfer): ${transferGasUsed.toString()}`);
  console.log(`Fee Transfer: ${ethers.formatEther(transferFeeBnb)} BNB`);

  // SUMMARY
  const finalBnb = await provider.getBalance(wallet.address);
  const finalR3sHash = await hashToken.balanceOf(r3sAddress);
  const totalGasUsed = claimGasUsed + transferGasUsed;
  const totalFeeBnb = claimFeeBnb + transferFeeBnb;

  console.log("\n================ RINGKASAN TEST ================");
  console.log(`Total Gas Used:        ${totalGasUsed.toString()} gas`);
  console.log(`Total Fee BNB:         ${ethers.formatEther(totalFeeBnb)} BNB`);
  console.log(`HASH Berhasil Dikirim: ${ethers.formatUnits(balanceAfterClaim, 18)} HASH`);
  console.log(`Saldo Akhir HASH r3s:  ${ethers.formatUnits(finalR3sHash, 18)} HASH`);
  console.log(`Sisa BNB di Worker:    ${ethers.formatEther(finalBnb)} BNB`);
  console.log("================================================");
}

testOne().catch(console.error);
