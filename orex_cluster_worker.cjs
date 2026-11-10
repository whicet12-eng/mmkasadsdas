const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const workerId = parseInt(process.argv[2], 10) || 0;
const startIdx = parseInt(process.argv[3], 10) || 0;
const endIdx = parseInt(process.argv[4], 10) || 0;

const SERVER_HOST = 'orex.run';
const FLEET_FILE = process.env.FLEET_FILE || path.resolve(__dirname, 'wallets_630_fleet.json');
const GPU_SOLVER = path.resolve(__dirname, 'orex_cuda_solver');
const CPU_SOLVER = path.resolve(__dirname, 'orex_solver_turbo');
const LOG_FILE = process.env.LOG_FILE || path.resolve(__dirname, 'orex_630.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] [Worker-${workerId}] ${msg}`;
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

class HybridSolver {
  constructor(maxCpu = 8, cpuThreads = 2) {
    this.maxCpu = maxCpu;
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

    // 1. Prioritize GPU
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

    // 2. Dispatch to ALL available CPU workers
    while (this.cpuRunning < this.maxCpu && this.queue.length > 0) {
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

const solver = new HybridSolver(4, 1);

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

  // If 429 on proxy, retry once without proxy agent as fallback
  if (res.status === 429 && w.agent) {
    res = await postJson(null, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` }, {}, 4000);
  }

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

async function processWalletForRound(w, targetRoundId, onAccepted) {
  if (w.servedRound === targetRoundId) return true;

  const job = await fetchJob(w);
  if (!job) return false;

  if (job.round && job.round.id !== targetRoundId) {
    if (job.round.id > targetRoundId) {
      targetRoundId = job.round.id;
    } else {
      return false;
    }
  }

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
      onAccepted(w, result.zeros, result.device);
      return true;
    } else {
      w.rejected++;
    }
  }
  return false;
}

const allFleet = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
const mySlice = allFleet.slice(startIdx, endIdx);

const fleet = mySlice.map(w => ({
  ...w,
  agent: createAgent(w.proxyUrl),
  servedRound: null,
  accepted: 0,
  rejected: 0,
  balance: w.balance || 0
}));

log(`Ready. Partition: ${fleet.length} wallets (indices ${startIdx}..${endIdx - 1})`);

function sendStatusToMaster(activeRoundId) {
  if (process.send) {
    const totalBal = fleet.reduce((s, x) => s + (x.balance || 0), 0);
    const servedCount = fleet.filter(x => x.servedRound === activeRoundId).length;
    const totalAccepted = fleet.reduce((s, x) => s + (x.accepted || 0), 0);
    const totalRejected = fleet.reduce((s, x) => s + (x.rejected || 0), 0);

    process.send({
      type: 'STATUS',
      workerId,
      servedInRound: servedCount,
      totalWallets: fleet.length,
      totalFleetBalance: totalBal,
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
    });
  }
}

// Listen to Master for round notifications
process.on('message', async (msg) => {
  if (msg && msg.type === 'NEW_ROUND') {
    const { roundId, endsAt } = msg;
    fleet.forEach(item => { item.servedRound = null; item.retried = false; });
    log(`Round #${roundId} received from Master. Mining ${fleet.length} wallets...`);
    sendStatusToMaster(roundId);

    const queue = [...fleet];
    const CONCURRENCY = 25;

    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push((async () => {
        while (queue.length > 0 && Date.now() < endsAt) {
          const w = queue.shift();
          if (!w) break;

          const res = await processWalletForRound(w, roundId, (wallet, diff, device) => {
            const served = fleet.filter(x => x.servedRound === roundId).length;
            log(`✔ [${wallet.name}] (${served}/${fleet.length}) [${device}] Diff: ${diff} | Bal: ${wallet.balance.toFixed(2)} OREX`);
            sendStatusToMaster(roundId);
          });

          if (!res && !w.retried && Date.now() < endsAt - 5000) {
            w.retried = true;
            queue.push(w);
          }
        }
      })());
    }

    await Promise.all(workers);
    sendStatusToMaster(roundId);
    const finalServed = fleet.filter(x => x.servedRound === roundId).length;
    log(`Round #${roundId} complete! (${finalServed}/${fleet.length} wallets submitted)`);
  }
});
