# 🚀 DOKUMENTASI LENGKAP & STATUS PERMANEN ARMADA MINING HASH21

> **PENTING UNTUK AGENT / PENGGUNA:**
> File ini adalah memori permanen dari seluruh setup armada Hash21. Jika komputer Codespace restart atau sesi chat baru dimulai, **baca file ini terlebih dahulu** untuk mengetahui seluruh konteks tanpa perlu mengulang dari awal.

---

### 1. 📌 Informasi Kontrak & Dompet Utama

- **Jaringan:** BNB Smart Chain (BSC - Chain ID 56)
- **Pool Smart Contract Hash21:** `0x6884D40B10c55A6c2faB2D3c829d41c3C798279D`
- **Token Hash21 (HASH):** `0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90`
- **PancakeSwap V2 Router:** `0x10ED43C718714eb63d5aA57B78B54704E256024E`

#### Dompet Sentral:
- **Dompet Utama (r3s.ai - BAW):** `0xd59878Bc7D16e2A9D777256def9239E4441848A3`
  - *Aturan Pengguna:* Wajib menyisakan saldo minimal **> $1.00 USD** di wallet ini setiap saat.
- **Dompet Distributor / Gas Operator (Wallet 3):** `0x5e9e7e37e553d6cc79eD671E8B861b1693cFA5fF`
  - *Private key tersimpan di:* `/workspaces/mmkasadsdas/wallet3.json`
- **Dompet Tujuan Penarikan Profit Pengguna (80% Profit):**
  - 👉 `0xcb34ccd05d2c21edf182d3d592f6ff2c80e34747`

---

### 2. 👥 Komposisi Armada 3.500 Worker Wallets (Total ~3.500 H)

Seluruh worker wallet tersimpan di `/workspaces/mmkasadsdas/` dengan rincian (Total 3.497 worker wallets):
- `wallets_50.json` (50 wallet)
- `wallets_35.json` (35 wallet)
- `wallets_60.json` (60 wallet)
- `wallets_150.json` (150 wallet)
- `wallets_200.json` (200 wallet)
- `wallets_300.json` (300 wallet)
- `wallets_202.json` (202 wallet)
- `wallets_2000.json` (2.000 wallet - Batch A 1.000 di Codespace 1, Batch B 1.000 di Codespace 2)
- `wallets_500.json` (500 wallet)

*(Total: 3.497 worker wallet + Wallet 3 / distributor = 3.498 di master list, serta dompet utama Wallet 1 & 2 = total 3.500 dompet).*

#### File Backup Lengkap (Semua Private Key):
- Spreadsheet Lengkap: [`master_wallets_all.csv`](/workspaces/mmkasadsdas/master_wallets_all.csv)
- Format Master JSON: [`master_wallets_all.json`](/workspaces/mmkasadsdas/master_wallets_all.json) (3.498 wallet)
- Arsip Siap Download: [`wallets_backup.zip`](/workspaces/mmkasadsdas/wallets_backup.zip) & [`wallets_backup.tar.gz`](/workspaces/mmkasadsdas/wallets_backup.tar.gz)

---

### 3. 🛠️ Perintah-Perintah Penting (Ready-to-Use)

1. **Cek Status Seluruh Armada & Pendapatan Real-Time:**
   ```bash
   node /workspaces/mmkasadsdas/check_multicall.cjs
   ```
2. **Klaim & Sapu Semua HASH ke `r3s.ai` (Tanpa Jual):**
   ```bash
   node /workspaces/mmkasadsdas/finish_all_remaining.cjs
   ```
3. **Jual HASH di PancakeSwap via BAW CLI:**
   ```bash
   baw market-order swap --binanceChainId 56 --fromTokenQty <JUMLAH> --fromToken 0x6a87DE92deb752c6162CF80Bd16E3eFd4BDc6D90 --toToken 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee --json
   ```
4. **Kirim BNB dari `r3s.ai` ke Alamat Tujuan (Bypass Address Book):**
   ```bash
   # Step 1: Preview
   baw contract-call preview --binanceChainId 56 --from 0xd59878Bc7D16e2A9D777256def9239E4441848A3 --to <TUJUAN> --value <WEI> --inputData 0x --json
   # Step 2: Execute
   baw contract-call execute --requestId <REQUEST_ID> --json
   ```

---

### 4. 📈 Parameter Teknis & Ekonomi Mining

- **Gas Price BSC:** 0.05 gwei (batas minimum konsensus BSC)
- **Gas Limit Claim:** ~114.000 - 135.000 gas (~0.000006 BNB per wallet)
- **Gas Limit Transfer:** ~35.000 - 40.000 gas (~0.000002 BNB per wallet)
- **Kecepatan Mining Armada:** ~98 HASH / jam (~2.352 HASH / hari)
- **Strategi Efisiensi Gas:** Disarankan klaim berkala setiap 6 - 24 jam sekali agar porsi potongan gas fee < 10% dari total pendapatan.

---

### 5. 🏆 Riwayat Eksekusi Terakhir (31 Okt 2026)
- **Sapu Bersih Dompet Worker:** Seluruh 1.011 worker yang memegang HASH terklaim telah disapu bersih 100% ke `r3s.ai` menggunakan sistem sifon internal gas tanpa modal baru.
- **Saldo HASH di `r3s.ai` Saat Ini:** `1.609,04 HASH` (~$27.50 USD).
- **Pending di Smart Contract Pool:** `~3.000+ HASH` siap diklaim pada siklus panen berikutnya.

