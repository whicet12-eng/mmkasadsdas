const { fork } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOTAL_WALLETS = 630;
const NUM_WORKERS = 6;
const FLEET_FILE = path.resolve(__dirname, 'wallets_630_fleet.json');
const AGGREGATED_STATUS = path.resolve(__dirname, 'fleet_630_status.json');
const LOG_FILE = path.resolve(__dirname, 'orex_630.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] [Master] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

const fleetRaw = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
const syncApiKey = fleetRaw[0].apiKey;

function getActiveRoundDirect() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'orex.run',
      port: 443,
      path: '/api/cli/round',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncApiKey}`
      },
      timeout: 3500
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (d && d.round) resolve(d.round);
          else resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const partitions = [];
const chunkSize = Math.floor(TOTAL_WALLETS / NUM_WORKERS);
let cur = 0;
for (let i = 0; i < NUM_WORKERS; i++) {
  const next = i === NUM_WORKERS - 1 ? TOTAL_WALLETS : cur + chunkSize;
  partitions.push({ id: i, start: cur, end: next, count: next - cur });
  cur = next;
}

log(`========================================================================================`);
log(`   OREX 6-WORKER CLUSTER CONTROLLER (IPC SYNC + PROXY DISTRIBUTED 630 WALLETS)`);
log(`========================================================================================`);
partitions.forEach(p => {
  log(`  -> Worker #${p.id}: Wallets ${p.start} .. ${p.end - 1} (${p.count} Wallets)`);
});

const workers = {};
const workerStatuses = {};

function startWorker(p) {
  log(`Spawning Worker #${p.id} (indices ${p.start}..${p.end - 1})...`);
  const cp = fork(path.resolve(__dirname, 'orex_cluster_worker.cjs'), [String(p.id), String(p.start), String(p.end)], {
    stdio: 'inherit',
    env: { ...process.env, FLEET_FILE, LOG_FILE }
  });

  workers[p.id] = cp;

  cp.on('message', (msg) => {
    if (msg && msg.type === 'STATUS') {
      workerStatuses[msg.workerId] = msg;
      writeAggregatedStatus();
    }
  });

  cp.on('exit', (code, signal) => {
    log(`Worker #${p.id} exited with code ${code} / signal ${signal}. Respawning in 2s...`);
    setTimeout(() => startWorker(p), 2000);
  });
}

// Start all workers
partitions.forEach(p => startWorker(p));

let activeRoundId = null;
let roundEndsAt = 0;

function writeAggregatedStatus() {
  const statuses = Object.values(workerStatuses);
  if (statuses.length === 0) return;

  const totalFleetBalance = Number(statuses.reduce((sum, s) => sum + (s.totalFleetBalance || 0), 0).toFixed(4));
  const totalAccepted = statuses.reduce((sum, s) => sum + (s.totalAccepted || 0), 0);
  const totalRejected = statuses.reduce((sum, s) => sum + (s.totalRejected || 0), 0);
  const servedInRound = statuses.reduce((sum, s) => sum + (s.servedInRound || 0), 0);

  let allWallets = [];
  partitions.forEach(p => {
    const s = workerStatuses[p.id];
    if (s && s.wallets) {
      allWallets = allWallets.concat(s.wallets);
    }
  });

  const aggregated = {
    updatedAt: new Date().toISOString(),
    activeRoundId,
    timeLeftSec: Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)),
    servedInRound,
    totalWallets: allWallets.length || TOTAL_WALLETS,
    totalFleetBalance,
    totalAccepted,
    totalRejected,
    wallets: allWallets
  };

  try {
    fs.writeFileSync(AGGREGATED_STATUS, JSON.stringify(aggregated, null, 2));
    // Also write to legacy path so any old listener doesn't break
    fs.writeFileSync(path.resolve(__dirname, 'fleet_330_status.json'), JSON.stringify(aggregated, null, 2));
  } catch (e) {}
}

setInterval(writeAggregatedStatus, 2000);

// Master round poller
async function masterLoop() {
  while (true) {
    const round = await getActiveRoundDirect();
    if (round && round.id) {
      if (round.id !== activeRoundId) {
        activeRoundId = round.id;
        roundEndsAt = round.endsAt;
        const timeSec = Math.round((roundEndsAt - Date.now()) / 1000);

        log(`\n========================================================================================`);
        log(`>>> [MASTER BROADCAST] RONDE BARU #${activeRoundId} DIMULAI! (Target: 630 Wallets | ${timeSec}s) <<<`);
        log(`========================================================================================`);

        Object.values(workers).forEach(cp => {
          if (cp && cp.connected) {
            cp.send({ type: 'NEW_ROUND', roundId: activeRoundId, endsAt: roundEndsAt });
          }
        });
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

masterLoop().catch(console.error);

process.on('SIGINT', () => {
  log('Shutting down cluster workers...');
  Object.values(workers).forEach(cp => cp.kill('SIGINT'));
  process.exit(0);
});
