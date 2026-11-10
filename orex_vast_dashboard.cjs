const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const STATUS_FILE = fs.existsSync(path.resolve(__dirname, 'fleet_630_status.json'))
  ? path.resolve(__dirname, 'fleet_630_status.json')
  : path.resolve(__dirname, 'fleet_330_status.json');

let balanceHistory = [];

function getStatusData() {
  let data = {
    updatedAt: new Date().toISOString(),
    activeRoundId: 0,
    timeLeftSec: 0,
    servedInRound: 0,
    totalWallets: 630,
    totalFleetBalance: 0,
    totalAccepted: 0,
    totalRejected: 0,
    wallets: []
  };

  if (fs.existsSync(STATUS_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    } catch (e) {}
  }

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

  data.ratePerMin = Math.max(0, ratePerMin);
  data.ratePerHour = Math.max(0, ratePerMin * 60);

  return data;
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>OREX Fleet Live Monitor</title>
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
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      padding: 16px;
      background-image: radial-gradient(circle at 10% 10%, rgba(99, 102, 241, 0.2) 0%, transparent 45%),
                        radial-gradient(circle at 90% 90%, rgba(16, 185, 129, 0.15) 0%, transparent 45%);
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon {
      width: 42px; height: 42px;
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
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 18px;
      backdrop-filter: blur(12px);
    }
    .card-label { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-val { font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 800; word-break: break-all; }
    .val-primary { color: #818cf8; }
    .val-accent { color: #34d399; }
    .val-warning { color: #fbbf24; }
    .card-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; }

    .banner-hardware {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 12px 16px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 13px;
    }

    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      overflow: hidden;
      backdrop-filter: blur(12px);
    }
    .table-header {
      padding: 16px 20px;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap; gap: 10px;
    }
    .search-input {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 8px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
      width: 100%;
      max-width: 280px;
    }
    .search-input:focus { border-color: #6366f1; }
    .table-scroll { overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 550px; }
    th {
      text-align: left; padding: 12px 16px;
      color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase;
      border-bottom: 1px solid var(--card-border);
      letter-spacing: 0.5px;
    }
    td { padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;
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
          <h2 style="font-weight: 800; letter-spacing: -0.5px; font-size: 20px;">OREX MEGA FLEET</h2>
          <p style="font-size: 12px; color: var(--text-muted);">630 Wallets | Vast.ai RTX 5060 Ti GPU</p>
        </div>
      </div>
      <div>
        <div class="badge-live">
          <span class="pulse-dot"></span>
          <span>ONLINE 24/7</span>
        </div>
      </div>
    </header>

    <div class="banner-hardware">
      <div style="display: flex; gap: 14px; flex-wrap: wrap;">
        <div>🎮 <span style="font-weight: 700; color: #818cf8;">RTX 5060 Ti (CUDA)</span></div>
        <div>⚙️ <span style="font-weight: 700; color: #34d399;">32 vCPUs OpenMP</span></div>
        <div>🌐 <span style="font-weight: 700; color: #fbbf24;">210 Dedicated Proxies</span></div>
      </div>
      <div style="color: var(--text-muted); font-size: 11px;" id="lastSync">Sinkron: Memuat...</div>
    </div>

    <div class="grid-stats">
      <div class="card">
        <div class="card-label">TOTAL PENDAPATAN FLEET</div>
        <div class="card-val val-primary" id="totalBal">0.00 <span style="font-size: 15px;">OREX</span></div>
        <div class="card-sub" id="totalAcceptedDisplay">0 Saham Berhasil Disetor</div>
      </div>

      <div class="card">
        <div class="card-label">LAJU MINING (RATE)</div>
        <div class="card-val val-accent" id="rateMin">+0.00 <span style="font-size: 15px;">/mnt</span></div>
        <div class="card-sub" id="rateHour">Est. ~0.00 OREX / jam</div>
      </div>

      <div class="card">
        <div class="card-label">RONDE AKTIF</div>
        <div class="card-val val-warning" id="roundId">#00000000</div>
        <div class="card-sub" id="roundTime">Sisa Waktu: 0s</div>
      </div>

      <div class="card">
        <div class="card-label">SETORAN RONDE INI</div>
        <div class="card-val" id="servedCount" style="color: #38bdf8;">0 / 630</div>
        <div class="card-sub" id="servedPercent">0% Berhasil Disetor</div>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h3 style="font-size: 15px; font-weight: 700;">Daftar 630 Worker Wallet OREX</h3>
        <input type="text" class="search-input" id="searchInput" placeholder="Cari nama worker atau address..." oninput="renderTable()">
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nama Worker</th>
              <th>Address</th>
              <th>Total Saham</th>
              <th>Saldo (OREX)</th>
              <th>Status Ronde</th>
            </tr>
          </thead>
          <tbody id="walletList">
            <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">Memuat data worker...</td></tr>
          </tbody>
        </table>
      </div>
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

        document.getElementById('totalBal').innerHTML = Number(data.totalFleetBalance || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' <span style="font-size: 15px;">OREX</span>';
        document.getElementById('totalAcceptedDisplay').innerText = (data.totalAccepted || 0) + ' Saham Diterima Server';

        const rateM = data.ratePerMin || 0;
        document.getElementById('rateMin').innerHTML = '+' + rateM.toFixed(2) + ' <span style="font-size: 15px;">/mnt</span>';
        document.getElementById('rateHour').innerText = 'Est. ~' + (rateM * 60).toFixed(0) + ' OREX / jam';

        document.getElementById('roundId').innerText = '#' + (data.activeRoundId || 0);
        document.getElementById('roundTime').innerText = 'Sisa Waktu: ' + (data.timeLeftSec || 0) + 's';

        const totalW = data.totalWallets || 330;
        const served = data.servedInRound || 0;
        document.getElementById('servedCount').innerText = served + ' / ' + totalW;
        document.getElementById('servedPercent').innerText = ((served / totalW) * 100).toFixed(0) + '% Sukses Ronde Ini';

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
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(getStatusData()));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML_PAGE);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OREX Monitor Web Server running at http://0.0.0.0:${PORT}`);
});
