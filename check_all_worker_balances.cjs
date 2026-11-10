const { ethers } = require("ethers");
const fs = require("fs");

async function checkFleetBalances() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const multicallAddress = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const poolAddress = "0x6884D40B10c55A6c2faB2D3c829d41c3C798279D";
  const hashAddress = "0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90";

  const abi = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])"
  ];
  const mc = new ethers.Contract(multicallAddress, abi, provider);

  const filenames = [
    "wallets_50.json", "wallets_35.json", "wallets_60.json", "wallets_150.json",
    "wallets_200.json", "wallets_300.json", "wallets_202.json", "wallets_2000.json",
    "wallets_500.json"
  ];

  const workers = [];
  for (const f of filenames) {
    const p = `/workspaces/mmkasadsdas/${f}`;
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      workers.push(...arr);
    }
  }

  console.log(`Total worker dimuat dari file: ${workers.length}`);

  const calls = [];
  for (const w of workers) {
    const pad = w.address.slice(2).toLowerCase().padStart(64, "0");
    // 1. BNB balance via Multicall3.getEthBalance(address)
    calls.push({
      target: multicallAddress,
      allowFailure: true,
      callData: "0x4d2301cc" + pad
    });
    // 2. HASH token balance via balanceOf(address)
    calls.push({
      target: hashAddress,
      allowFailure: true,
      callData: "0x70a08231" + pad
    });
    // 3. Pending HASH via pool.pendingOf(address)
    calls.push({
      target: poolAddress,
      allowFailure: true,
      callData: "0xf44136a1" + pad
    });
  }

  console.log(`Menjalankan multicall untuk ${calls.length} queries...`);

  const chunkSize = 600; // 200 worker per request
  const results = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    const chunk = calls.slice(i, i + chunkSize);
    const res = await mc.aggregate3(chunk);
    results.push(...res);
  }

  let totalBnb = 0n;
  let totalWalletHash = 0n;
  let totalPendingHash = 0n;

  let countWithBnbForClaim = 0; // >= 0.00000665 BNB
  let countWithPartialBnb = 0;  // > 0 tapi < 0.00000665 BNB
  let countZeroBnb = 0;

  let countHasWalletHash = 0;
  let countHasPendingHash = 0;

  const MIN_GAS = 6650000000000n; // 0.00000665 BNB

  for (let i = 0; i < workers.length; i++) {
    const bnbRes = results[i * 3];
    const hashRes = results[i * 3 + 1];
    const pendRes = results[i * 3 + 2];

    const bnbBal = bnbRes.success && bnbRes.returnData !== "0x" ? BigInt(bnbRes.returnData) : 0n;
    const hashBal = hashRes.success && hashRes.returnData !== "0x" ? BigInt(hashRes.returnData) : 0n;
    const pendBal = pendRes.success && pendRes.returnData !== "0x" ? BigInt(pendRes.returnData) : 0n;

    totalBnb += bnbBal;
    totalWalletHash += hashBal;
    totalPendingHash += pendBal;

    if (bnbBal >= MIN_GAS) {
      countWithBnbForClaim++;
    } else if (bnbBal > 0n) {
      countWithPartialBnb++;
    } else {
      countZeroBnb++;
    }

    if (hashBal > 0n) countHasWalletHash++;
    if (pendBal > 0n) countHasPendingHash++;
  }

  const summary = {
    timestamp: new Date().toISOString(),
    total_workers: workers.length,
    bnb: {
      total_bnb: ethers.formatEther(totalBnb),
      workers_ready_gas: countWithBnbForClaim,
      workers_partial_gas: countWithPartialBnb,
      workers_zero_gas: countZeroBnb
    },
    hash: {
      wallet_hash_total: ethers.formatUnits(totalWalletHash, 18),
      workers_with_wallet_hash: countHasWalletHash,
      pending_hash_total: ethers.formatUnits(totalPendingHash, 18),
      workers_with_pending_hash: countHasPendingHash,
      grand_total_hash: ethers.formatUnits(totalWalletHash + totalPendingHash, 18)
    }
  };

  console.log("\n=== HASIL SALDO SELURUH WORKER ===");
  console.log(JSON.stringify(summary, null, 2));
}

checkFleetBalances().catch(console.error);
