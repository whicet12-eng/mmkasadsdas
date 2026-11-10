import os, sys, re, time, threading, subprocess, json
from http.server import HTTPServer, BaseHTTPRequestHandler

# Multi-worker state
workers_config = [
    {
        "id": "uppcoder2",
        "name": "Node 1 (memek)",
        "user_host": "hg7v3umq@hg7v3umq-c-c-memek.uc-fsn1-002.uppcoder.com",
        "port": "2222"
    },
    {
        "id": "uppcoder3",
        "name": "Node 2 (kaank)",
        "user_host": "aggz31kc@aggz31kc-c-c-kaank.uc-fsn1-002.uppcoder.com",
        "port": "2222"
    },
    {
        "id": "uppcoder4",
        "name": "Node 3 (mmmmmmmmm)",
        "user_host": "iwsdhiz5@iwsdhiz5-c-c-mmmmmmmmm.apps-2.websson.cloud",
        "port": "2222"
    },
    {
        "id": "uppcoder5",
        "name": "Node 4 (asda)",
        "user_host": "i6qpmi1e@i6qpmi1e-c-c-asda.apps-2.websson.cloud",
        "port": "2222"
    },
    {
        "id": "uppcoder6",
        "name": "Node 5 (Intel Xeon)",
        "user_host": "po1nctdq@po1nctdq-c-c-https-portal-uppcode.apps-2.websson.cloud",
        "port": "2222"
    }
]

state = {
    "total_hashrate": "0 H/s",
    "total_shares": 0,
    "last_updated": "Never",
    "workers": {
        "uppcoder2": {
            "name": "Node 1 (memek)",
            "status": "Initializing",
            "hashrate": "0 H/s",
            "hashrate_num": 0.0,
            "shares_accepted": 0,
            "shares_rejected": 0,
            "uptime": "0s",
            "ping": "24ms",
            "threads": 4,
            "recent_logs": []
        },
        "uppcoder3": {
            "name": "Node 2 (kaank)",
            "status": "Initializing",
            "hashrate": "0 H/s",
            "hashrate_num": 0.0,
            "shares_accepted": 0,
            "shares_rejected": 0,
            "uptime": "0s",
            "ping": "24ms",
            "threads": 4,
            "recent_logs": []
        },
        "uppcoder4": {
            "name": "Node 3 (mmmmmmmmm)",
            "status": "Initializing",
            "hashrate": "0 H/s",
            "hashrate_num": 0.0,
            "shares_accepted": 0,
            "shares_rejected": 0,
            "uptime": "0s",
            "ping": "24ms",
            "threads": 4,
            "recent_logs": []
        },
        "uppcoder5": {
            "name": "Node 4 (asda)",
            "status": "Initializing",
            "hashrate": "0 H/s",
            "hashrate_num": 0.0,
            "shares_accepted": 0,
            "shares_rejected": 0,
            "uptime": "0s",
            "ping": "24ms",
            "threads": 4,
            "recent_logs": []
        },
        "uppcoder6": {
            "name": "Node 5 (Intel Xeon)",
            "status": "Initializing",
            "hashrate": "0 H/s",
            "hashrate_num": 0.0,
            "shares_accepted": 0,
            "shares_rejected": 0,
            "uptime": "0s",
            "ping": "24ms",
            "threads": 4,
            "recent_logs": []
        }
    }
}

def poll_worker(w_cfg):
    global state
    w_id = w_cfg["id"]
    ssh_cmd = [
        "ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes",
        "-i", "/home/codespace/.ssh/id_ed25519",
        "-p", w_cfg["port"],
        w_cfg["user_host"],
        "tail -n 30 ~/miner.log 2>/dev/null"
    ]
    try:
        res = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=7)
        out = res.stdout
        w_data = state["workers"][w_id]
        if out:
            w_data["status"] = "Active"
            hr_m = re.findall(r'CPU\s+:\s+([\d\.]+)\s+H/s', out)
            if hr_m:
                val = float(hr_m[-1])
                w_data["hashrate_num"] = val
                w_data["hashrate"] = f"{val:.1f} H/s"
            
            sh_m = re.findall(r'\[\s*(\d+)\|\s*(\d+)\|\s*(\d+)\]', out)
            if sh_m:
                w_data["shares_accepted"] = int(sh_m[-1][0])
                w_data["shares_rejected"] = int(sh_m[-1][1])

            up_m = re.findall(r'uptime\s+([\w\d]+)', out)
            if up_m:
                w_data["uptime"] = up_m[-1]

            p_m = re.findall(r'(\d+ms)', out)
            if p_m:
                w_data["ping"] = p_m[-1]

            lines = [l for l in out.strip().splitlines() if not l.startswith('====') and l.strip()]
            w_data["recent_logs"] = lines[-6:]
    except Exception as e:
        pass

def poller_loop():
    global state
    while True:
        # Dynamically reload workers from workers.json if present
        current_configs = workers_config
        try:
            if os.path.exists("/workspaces/mmkasadsdas/workers.json"):
                with open("/workspaces/mmkasadsdas/workers.json", "r") as f:
                    current_configs = json.load(f)
        except Exception as e:
            pass

        for w in current_configs:
            w_id = w["id"]
            if w_id not in state["workers"]:
                state["workers"][w_id] = {
                    "name": w.get("name", w_id),
                    "status": "Initializing",
                    "hashrate": "0 H/s",
                    "hashrate_num": 0.0,
                    "shares_accepted": 0,
                    "shares_rejected": 0,
                    "uptime": "0s",
                    "ping": "0ms",
                    "threads": 4,
                    "recent_logs": []
                }

        threads = []
        for w in current_configs:
            t = threading.Thread(target=poll_worker, args=(w,))
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        
        # Calculate totals
        tot_hr = sum(w["hashrate_num"] for w in state["workers"].values())
        tot_sh = sum(w["shares_accepted"] for w in state["workers"].values())
        state["total_hashrate"] = f"{tot_hr:.1f} H/s"
        state["total_shares"] = tot_sh
        state["last_updated"] = time.strftime("%H:%M:%S")
        time.sleep(5)

HTML_PAGE = """<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Discrete (XDS) Fleet Monitor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090d16;
      color: #e2e8f0;
      font-family: 'Plus Jakarta Sans', sans-serif;
      padding: 16px;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 14px;
      border-bottom: 1px solid #1e293b;
    }
    .logo-box { display: flex; align-items: center; gap: 10px; }
    .coin-badge {
      background: linear-gradient(135deg, #6366f1, #a855f7);
      width: 42px; height: 42px;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 18px; color: #fff;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .header h1 { font-size: 19px; font-weight: 700; color: #fff; line-height: 1.2; }
    .header p { font-size: 12px; color: #94a3b8; }
    
    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10b981;
      font-size: 11px; font-weight: 700;
      padding: 6px 12px; border-radius: 20px;
    }
    .pulse-dot {
      width: 8px; height: 8px;
      background: #10b981;
      border-radius: 50%;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 0.7; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.7; }
    }

    .main-card {
      background: linear-gradient(145deg, #131b2e, #0f172a);
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 22px;
      margin-bottom: 20px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      position: relative;
      overflow: hidden;
    }
    .main-card::before {
      content: '';
      position: absolute; top: -50px; right: -50px;
      width: 150px; height: 150px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, transparent 70%);
      pointer-events: none;
    }
    .main-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: 700; margin-bottom: 6px; }
    .hashrate-val {
      font-size: 44px; font-weight: 800;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1.1;
      margin-bottom: 12px;
      font-family: 'JetBrains Mono', monospace;
    }
    .summary-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      background: #1e293b; color: #cbd5e1;
      font-size: 12px; font-weight: 600;
      padding: 4px 10px; border-radius: 8px;
    }

    .section-title { font-size: 14px; font-weight: 700; color: #94a3b8; margin: 16px 0 10px 4px; }
    
    .worker-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 18px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .worker-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px; padding-bottom: 10px;
      border-bottom: 1px solid #1e293b;
    }
    .worker-title { font-size: 15px; font-weight: 700; color: #f8fafc; }
    .worker-id { font-size: 11px; color: #64748b; font-family: 'JetBrains Mono', monospace; }
    .worker-speed {
      font-size: 26px; font-weight: 800; color: #38bdf8;
      font-family: 'JetBrains Mono', monospace;
    }
    .stats-row {
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 10px;
    }
    .stat-item {
      background: #090d16; padding: 8px 10px; border-radius: 10px; border: 1px solid #1e293b;
    }
    .stat-label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .stat-val { font-size: 13px; font-weight: 700; color: #f1f5f9; font-family: 'JetBrains Mono', monospace; }

    .log-box {
      background: #050811;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      line-height: 1.6;
      color: #94a3b8;
      max-height: 160px;
      overflow-y: auto;
      margin-top: 10px;
    }
    .log-line { white-space: pre; margin-bottom: 2px; }
    .log-accepted { color: #34d399; font-weight: 600; }
    .log-job { color: #60a5fa; }
    
    .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #475569; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">
      <div class="coin-badge">X</div>
      <div>
        <h1>Discrete (XDS)</h1>
        <p>Armada 4 Node Uppcoder</p>
      </div>
    </div>
    <div class="status-badge">
      <div class="pulse-dot"></div>
      <span id="fleet-status">4 Node Online</span>
    </div>
  </div>

  <div class="main-card">
    <div class="main-label">Total Combined Hashrate</div>
    <div class="hashrate-val" id="total-hashrate">-- H/s</div>
    <div class="summary-pills">
      <div class="pill">🚀 Total Shares: <span id="total-shares">0</span></div>
      <div class="pill">⚙️ 16 vCPU Total</div>
      <div class="pill">⏱️ Update: <span id="last-updated">--</span></div>
    </div>
  </div>

  <div class="section-title">Detail Mesin / Worker</div>
  <div id="workers-container"></div>

  <div class="footer">
    Monitoring Discrete (XDS) &bull; Auto Refresh 5s
  </div>

  <script>
    async function updateFleet() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('total-hashrate').textContent = data.total_hashrate;
        document.getElementById('total-shares').textContent = data.total_shares;
        document.getElementById('last-updated').textContent = data.last_updated;

        const container = document.getElementById('workers-container');
        container.innerHTML = '';

        for (const [wid, w] of Object.entries(data.workers)) {
          const card = document.createElement('div');
          card.className = 'worker-card';
          
          let logsHtml = '';
          if (w.recent_logs && w.recent_logs.length > 0) {
            logsHtml = '<div class="log-box">' + w.recent_logs.map(l => {
              let cls = 'log-line';
              if (l.includes('accepted')) cls += ' log-accepted';
              if (l.includes('Job received')) cls += ' log-job';
              return `<div class="${cls}">${l}</div>`;
            }).join('') + '</div>';
          }

          card.innerHTML = `
            <div class="worker-header">
              <div>
                <div class="worker-title">${w.name}</div>
                <div class="worker-id">ID: ${wid} &bull; 4 Thread</div>
              </div>
              <div class="worker-speed">${w.hashrate}</div>
            </div>
            <div class="stats-row">
              <div class="stat-item">
                <div class="stat-label">Shares</div>
                <div class="stat-val" style="color: #34d399;">${w.shares_accepted} acc</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Ping</div>
                <div class="stat-val">${w.ping}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Uptime</div>
                <div class="stat-val">${w.uptime}</div>
              </div>
            </div>
            ${logsHtml}
          `;
          container.appendChild(card);
        }
      } catch (err) {
        console.error(err);
      }
    }
    setInterval(updateFleet, 4000);
    updateFleet();
  </script>
</body>
</html>
"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/stats':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(state).encode())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode())

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    t = threading.Thread(target=poller_loop, daemon=True)
    t.start()
    server = HTTPServer(('0.0.0.0', 8080), Handler)
    server.serve_forever()
