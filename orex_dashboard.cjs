const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3333;

let fleetStatus = {
  updatedAt: new Date().toISOString(),
  activeRoundId: 0,
  timeLeftSec: 0,
  servedInRound: 0,
  totalWallets: 330,
  totalFleetBalance: 0,
  totalAccepted: 0,
  totalRejected: 0,
  wallets: []
};

let balanceHistory = [];

function syncVastStatus() {
  const cmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=6 -p 41829 root@1.193.138.36 "cat /root/orex_300/fleet_330_status.json 2>/dev/null"`;
  exec(cmd, { timeout: 12000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
    if (!err && stdout && stdout.includes("totalWallets")) {
      try {
        const jsonStart = stdout.indexOf("{");
        const jsonEnd = stdout.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const data = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1));
          fleetStatus = data;

          const now = Date.now();
          const bal = Number(data.totalFleetBalance) || 0;
          balanceHistory.push({ time: now, balance: bal });
          if (balanceHistory.length > 360) balanceHistory.shift();

          let ratePerMin = 0;
          if (balanceHistory.length > 2) {
            const first = balanceHistory[0];
            const diffSec = (now - first.time) / 1000;
            if (diffSec > 10) {
              ratePerMin = ((bal - first.balance) / diffSec) * 60;
            }
          }
          fleetStatus.ratePerMin = Math.max(0, ratePerMin);
          fleetStatus.ratePerHour = Math.max(0, ratePerMin * 60);
        }
      } catch (e) {}
    }
  });
}

// Background sync every 4 seconds
setInterval(syncVastStatus, 4000);
syncVastStatus();

app.get('/api/status', (req, res) => {
  res.json(fleetStatus);
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OREX Unified Mega Fleet (330 Wallets)</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(18, 24, 38, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #6366f1;
      --accent: #10b981;
      --warning: #f59e0b;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      padding: 24px;
      background-image: radial-gradient(circle at 10% 10%, rgba(99, 102, 241, 0.2) 0%, transparent 45%),
                        radial-gradient(circle at 90% 90%, rgba(16, 185, 129, 0.15) 0%, transparent 45%);
    }
    .container { max-width: 1300px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-icon {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #6366f1, #10b981);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: bold;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
    }
    .badge-live {
      display: inline-flex; align-items: center; gap: 7px;
      background: rgba(16, 185, 129, 0.18);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399; padding: 6px 14px; border-radius: 20px;
      font-size: 13px; font-weight: 700;
    }
    .pulse-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #10b981;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 0.7; }
      50% { transform: scale(1.3); opacity: 1; box-shadow: 0 0 10px #10b981; }
      100% { transform: scale(0.9); opacity: 0.7; }
    }
    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 22px;
      backdrop-filter: blur(12px);
      transition: transform 0.2s, border-color 0.2s;
    }
    .card:hover { transform: translateY(-2px); border-color: rgba(99, 102, 241, 0.45); }
    .card-label { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-val { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 800; }
    .val-primary { color: #818cf8; }
    .val-accent { color: #34d399; }
    .val-warning { color: #fbbf24; }
    .card-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; }

    .banner-hardware {
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(16, 185, 129, 0.12));
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 14px;
      padding: 14px 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    .table-header {
      padding: 18px 24px;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap; gap: 12px;
    }
    .search-input {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 8px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
      min-width: 260px;
    }
    .search-input:focus { border-color: #6366f1; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th {
      text-align: left; padding: 14px 20px;
      color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase;
      border-bottom: 1px solid var(--card-border);
      letter-spacing: 0.5px;
    }
    td { padding: 14px 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700;
    }
    .status-ok { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .status-wait { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div>
          <h2 style="font-weight: 800; letter-spacing: -0.5px; font-size: 22px;">OREX UNIFIED MEGA FLEET</h2>
          <p style="font-size: 13px; color: var(--text-muted);">330 Concurrent Wallets | RTX 5060 Ti GPU + 32 vCPU OpenMP + 97 SOCKS5 Proxies</p>
        </div>
      </div>
      <div>
        <div class="badge-live">
          <span class="pulse-dot"></span>
          <span>HYBRID GPU+CPU ONLINE</span>
        </div>
      </div>
    </header>

    <div class="banner-hardware">
      <div style="display: flex; gap: 20px; align-items: center;">
        <div>
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">AKSELERASI GPU</span>
          <div style="font-weight: 700; color: #818cf8;">NVIDIA RTX 5060 Ti 16GB (CUDA)</div>
        </div>
        <div style="height: 30px; width: 1px; background: rgba(255,255,255,0.1);"></div>
        <div>
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">AKSELERASI CPU</span>
          <div style="font-weight: 700; color: #34d399;">AMD EPYC 7V12 (32 vCPUs OpenMP)</div>
        </div>
        <div style="height: 30px; width: 1px; background: rgba(255,255,255,0.1);"></div>
        <div>
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">JARINGAN PROXY</span>
          <div style="font-weight: 700; color: #fbbf24;">97 SOCKS5 Proxies Aktif</div>
        </div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);" id="lastSync">Sinkronisasi...</div>
    </div>

    <div class="grid-stats">
      <div class="card">
        <div class="card-label">TOTAL PENDAPATAN 330 WALLET</div>
        <div class="card-val val-primary" id="totalBal">0.00 <span style="font-size: 16px;">OREX</span></div>
        <div class="card-sub" id="totalAcceptedDisplay">0 Saham Berhasil Diterima</div>
      </div>

      <div class="card">
        <div class="card-label">KECEPATAN MINING (RATE)</div>
        <div class="card-val val-accent" id="rateMin">+0.00 <span style="font-size: 16px;">/mnt</span></div>
        <div class="card-sub" id="rateHour">Est. ~0.00 OREX / jam</div>
      </div>

      <div class="card">
        <div class="card-label">RONDE AKTIF</div>
        <div class="card-val val-warning" id="roundId">#00000000</div>
        <div class="card-sub" id="roundTime">Sisa Waktu: 0s</div>
      </div>

      <div class="card">
        <div class="card-label">SETORAN RONDE INI</div>
        <div class="card-val" id="servedCount" style="color: #38bdf8;">0 / 330</div>
        <div class="card-sub" id="servedPercent">0% Selesai Ronde Ini</div>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h3 style="font-size: 16px; font-weight: 700;">Daftar 330 Worker Wallet OREX</h3>
        <input type="text" class="search-input" id="searchInput" placeholder="Cari nama worker atau address..." oninput="renderTable()">
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nama Worker</th>
            <th>Address</th>
            <th>Total Saham</th>
            <th>Saldo (OREX)</th>
            <th>Status Ronde Ini</th>
          </tr>
        </thead>
        <tbody id="walletList">
          <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">Memuat data worker...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let currentWallets = [];

    function renderTable() {
      const tbody = document.getElementById('walletList');
      const search = (document.getElementById('searchInput').value || '').toLowerCase();

      let filtered = currentWallets.filter(w => {
        if (!search) return true;
        const matchName = (w.name || '').toLowerCase().includes(search);
        const matchAddr = (w.address || '').toLowerCase().includes(search);
        return matchName || matchAddr;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">Tidak ada worker yang sesuai dengan pencarian.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map((w, idx) => {
        const shortAddr = w.address ? (w.address.substr(0, 6) + '...' + w.address.substr(-4)) : '-';
        const statusHtml = w.servedThisRound 
          ? '<span class="status-badge status-ok">✔ SETOR OK</span>'
          : '<span class="status-badge status-wait">⏳ MINING</span>';

        return '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td style="font-weight: 600;">' + w.name + '</td>' +
          '<td class="mono" style="color: var(--text-muted);">' + shortAddr + '</td>' +
          '<td class="mono">' + (w.accepted || 0) + '</td>' +
          '<td class="mono" style="font-weight: 700; color: #34d399;">' + Number(w.balance || 0).toFixed(2) + '</td>' +
          '<td>' + statusHtml + '</td>' +
        '</tr>';
      }).join('');
    }

    async function updateDashboard() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        document.getElementById('totalBal').innerHTML = Number(data.totalFleetBalance || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' <span style="font-size: 16px;">OREX</span>';
        document.getElementById('totalAcceptedDisplay').innerText = (data.totalAccepted || 0) + ' Saham Diterima Server';

        const rateM = data.ratePerMin || 0;
        document.getElementById('rateMin').innerHTML = '+' + rateM.toFixed(2) + ' <span style="font-size: 16px;">/mnt</span>';
        document.getElementById('rateHour').innerText = 'Est. ~' + (rateM * 60).toFixed(0) + ' OREX / jam';

        document.getElementById('roundId').innerText = '#' + (data.activeRoundId || 0);
        document.getElementById('roundTime').innerText = 'Sisa Waktu Ronde: ' + (data.timeLeftSec || 0) + 's';

        const totalW = data.totalWallets || 330;
        const served = data.servedInRound || 0;
        document.getElementById('servedCount').innerText = served + ' / ' + totalW;
        document.getElementById('servedPercent').innerText = ((served / totalW) * 100).toFixed(0) + '% Selesai Ronde Ini';

        document.getElementById('lastSync').innerText = 'Sinkron: ' + new Date(data.updatedAt).toLocaleTimeString();

        currentWallets = data.wallets || [];
        renderTable();
      } catch (e) {
        console.error(e);
      }
    }

    setInterval(updateDashboard, 2000);
    updateDashboard();
  </script>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OREX Monitor Web Server running at http://localhost:${PORT}`);
});
