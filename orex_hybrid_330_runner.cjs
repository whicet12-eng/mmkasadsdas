const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVER_HOST = 'orex.run';
const FLEET_FILE = path.resolve(__dirname, 'wallets_330_fleet.json');
const GPU_SOLVER = path.resolve(__dirname, 'orex_cuda_solver');
const CPU_SOLVER = path.resolve(__dirname, 'orex_solver_turbo');
const STATUS_FILE = path.resolve(__dirname, 'fleet_330_status.json');
const LOG_FILE = path.resolve(__dirname, 'orex_330.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

function createAgent(proxyUrl) {
  if (!proxyUrl || proxyUrl === 'direct') return null;
  if (proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks://')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}

// HYBRID SOLVER: DUAL GPU ACCELERATION + 16-WAY CPU OPENMP
class HybridSolver {
  constructor(maxCpuConcurrent = 16, cpuThreads = 2) {
    this.maxCpuConcurrent = maxCpuConcurrent;
    this.cpuThreads = cpuThreads;
    this.gpuBusy = false;
    this.cpuRunning = 0;
    this.queue = [];
  }

  solve(challenge, difficulty) {
    return new Promise((resolve) => {
      this.queue.push({ challenge, difficulty, resolve });
      this.drain();
    });
  }

  drain() {
    if (this.queue.length === 0) return;

    // 1. Dispatch to GPU RTX 5060 Ti
    if (!this.gpuBusy && fs.existsSync(GPU_SOLVER) && this.queue.length > 0) {
      this.gpuBusy = true;
      const { challenge, difficulty, resolve } = this.queue.shift();
      const startNonce = Math.floor(Math.random() * 50000000);
      const maxHashes = 25000000;

      execFile(GPU_SOLVER, [challenge, String(difficulty), String(startNonce), String(maxHashes)], (err, stdout) => {
        this.gpuBusy = false;
        this.drain();

        const line = (stdout || '').trim();
        if (line.startsWith('FOUND')) {
          const parts = line.split(' ');
          resolve({ type: 'found', nonce: parts[1], zeros: parseInt(parts[2], 10), device: 'GPU' });
        } else {
          this.solveCpu(challenge, difficulty, resolve);
        }
      });
    }

    // 2. Dispatch to ALL available CPU workers (up to 16 concurrent workers x 2 threads = 32 vCPUs)
    while (this.cpuRunning < this.maxCpuConcurrent && this.queue.length > 0) {
      this.cpuRunning++;
      const { challenge, difficulty, resolve } = this.queue.shift();
      this.solveCpu(challenge, difficulty, (res) => {
        this.cpuRunning--;
        this.drain();
        resolve(res);
      });
    }
  }

  solveCpu(challenge, difficulty, resolve) {
    const startNonce = Math.floor(Math.random() * 50000000);
    const maxHashes = 15000000;

    execFile(CPU_SOLVER, [challenge, String(difficulty), String(startNonce), String(maxHashes), String(this.cpuThreads)], (err, stdout) => {
      const line = (stdout || '').trim();
      if (line.startsWith('FOUND')) {
        const parts = line.split(' ');
        resolve({ type: 'found', nonce: parts[1], zeros: parseInt(parts[2], 10), device: 'CPU' });
      } else {
        resolve({ type: 'done' });
      }
    });
  }
}

const solver = new HybridSolver(16, 2);

function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    return null;
  }
}

function postJson(agent, pathname, headers, body, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const reqOptions = {
      hostname: SERVER_HOST,
      port: 443,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: timeoutMs
    };
    if (agent) reqOptions.agent = agent;

    const req = https.request(reqOptions, (res) => {
      let bodyData = '';
      res.on('data', chunk => bodyData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(bodyData) });
        } catch (e) {
          resolve({ status: res.statusCode, ok: false, data: {} });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, ok: false, data: { error: err.message } }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 408, ok: false, data: { error: 'Timeout' } }); });
    req.write(data);
    req.end();
  });
}

async function solveCaptcha(w, captcha) {
  const ans = solveArithmetic(captcha.question);
  if (ans === null) return false;
  const res = await postJson(w.agent, '/api/cli/captcha', { 'Authorization': `Bearer ${w.apiKey}` }, {
    captchaId: captcha.id,
    answer: Number(ans)
  }, 4000);
  return res.ok && res.data.solved;
}

async function fetchJob(w) {
  let res = await postJson(w.agent, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` }, {}, 4500);
  if (res.status === 428 && res.data && res.data.captcha) {
    const solved = await solveCaptcha(w, res.data.captcha);
    if (solved) {
      res = await postJson(w.agent, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` }, {}, 4500);
    }
  }
  if (res.ok) {
    if (res.data.balance !== undefined) w.balance = res.data.balance;
    return res.data;
  }
  return null;
}

async function processWalletForRound(w, targetRoundId, onShareAccepted) {
  if (w.servedRound === targetRoundId) return true;

  const job = await fetchJob(w);
  if (!job) return false;

  // Check if round shifted
  if (job.round && job.round.id !== targetRoundId) {
    return { roundShift: job.round };
  }

  // Solve with Hybrid GPU + CPU
  const result = await solver.solve(job.challenge, job.difficulty);
  if (result.type === 'found') {
    const subRes = await postJson(w.agent, '/api/cli/submit', { 'Authorization': `Bearer ${w.apiKey}` }, {
      jobId: job.id,
      nonce: result.nonce
    }, 4500);

    if (subRes.ok) {
      w.servedRound = targetRoundId;
      w.accepted++;
      if (subRes.data && subRes.data.balance !== undefined) w.balance = subRes.data.balance;
      onShareAccepted(w, result.zeros, result.device);
      return true;
    } else {
      w.rejected++;
    }
  }
  return false;
}

async function main() {
  log('========================================================================================');
  log('   OREX 330-WALLET MEGA FLEET (30 ALPHA + 300 WORKERS | 110 PROXIES | DUAL GPU+CPU)');
  log('========================================================================================');

  if (!fs.existsSync(FLEET_FILE)) {
    log(`[Error] Fleet file not found: ${FLEET_FILE}`);
    process.exit(1);
  }

  const fleetRaw = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
  const fleet = fleetRaw.map(w => ({
    ...w,
    agent: createAgent(w.proxyUrl),
    servedRound: null,
    accepted: 0,
    rejected: 0,
    balance: w.balance || 0
  }));

  log(`[Init] ${fleet.length} Wallets ready. Strict 3 wallets per proxy across 110 proxies.`);

  let activeRoundId = null;
  let roundEndsAt = 0;

  function writeStatus() {
    try {
      const totalBal = fleet.reduce((s, x) => s + (x.balance || 0), 0);
      const servedCount = fleet.filter(x => x.servedRound === activeRoundId).length;
      const totalAccepted = fleet.reduce((s, x) => s + (x.accepted || 0), 0);
      const totalRejected = fleet.reduce((s, x) => s + (x.rejected || 0), 0);

      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        updatedAt: new Date().toISOString(),
        activeRoundId,
        timeLeftSec: Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)),
        servedInRound: servedCount,
        totalWallets: fleet.length,
        totalFleetBalance: Number(totalBal.toFixed(4)),
        totalAccepted,
        totalRejected,
        wallets: fleet.map(x => ({
          name: x.name,
          address: x.address,
          balance: Number((x.balance || 0).toFixed(4)),
          accepted: x.accepted,
          rejected: x.rejected,
          servedThisRound: x.servedRound === activeRoundId
        }))
      }, null, 2));
    } catch (e) {}
  }

  while (true) {
    // 1. Synchronize round
    if (!activeRoundId || Date.now() >= roundEndsAt) {
      log(`[Sync] Menunggu sinkronisasi ronde baru dari OREX server...`);
      const syncW = fleet[0];
      const job = await fetchJob(syncW);
      if (job && job.round) {
        if (job.round.id !== activeRoundId) {
          activeRoundId = job.round.id;
          roundEndsAt = job.round.endsAt;
          fleet.forEach(item => { item.servedRound = null; item.retried = false; });
          log(`\n========================================================================================`);
          log(`>>> RONDE BARU #${activeRoundId} DIMULAI! Target: 330 Wallets | Waktu: ${Math.round((roundEndsAt - Date.now())/1000)}s <<<`);
          log(`========================================================================================`);
        }
      } else {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }

    writeStatus();

    // 2. High-speed continuous worker pool (concurrency: 75)
    const unserved = fleet.filter(w => w.servedRound !== activeRoundId);
    if (unserved.length === 0) {
      const waitMs = Math.max(1000, roundEndsAt - Date.now() + 500);
      log(`🎉 [100% SUKSES TUNTAS] SEMUA 330/330 WALLET TELAH MENYETOR PADA RONDE #${activeRoundId}!`);
      log(`Waktu tersisa: ${(waitMs/1000).toFixed(1)}s -> CPU & GPU beristirahat menunggu ronde berikutnya.\n`);
      writeStatus();
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    // Dynamic queue of unserved wallets
    const queue = [...unserved];
    const POOL_CONCURRENCY = 75;

    const workers = [];
    for (let i = 0; i < POOL_CONCURRENCY; i++) {
      workers.push((async () => {
        while (queue.length > 0 && Date.now() < roundEndsAt) {
          const w = queue.shift();
          if (!w) break;

          const res = await processWalletForRound(w, activeRoundId, (wallet, diff, device) => {
            const servedCount = fleet.filter(x => x.servedRound === activeRoundId).length;
            log(`[SHARE] ✔ [${wallet.name}] (${servedCount}/330) [${device}] Diff: ${diff} | Bal: ${wallet.balance.toFixed(2)} OREX`);
            writeStatus();
          });

          if (res && res.roundShift) {
            activeRoundId = res.roundShift.id;
            roundEndsAt = res.roundShift.endsAt;
            fleet.forEach(item => { item.servedRound = null; item.retried = false; });
            break;
          }

          // If failed and time permits, retry once
          if (!res && !w.retried && Date.now() < roundEndsAt - 5000) {
            w.retried = true;
            queue.push(w);
          }
        }
      })());
    }

    await Promise.all(workers);
    writeStatus();
    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(err => {
  log(`[Fatal Error] ${err.stack || err.message}`);
});
