const { ethers } = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVER_HOST = 'orex.run';
const FLEET_FILE = path.resolve(__dirname, 'wallets_30_fleet.json');
const SOLVER_BIN = path.resolve(__dirname, 'orex_solver_turbo');
const STATUS_FILE = path.resolve(__dirname, 'fleet_30_status.json');
const LOG_FILE = '/tmp/orex_fleet.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
}

// Single-thread solver queue with lowest CPU priority (nice -n 19)
class SolverQueue {
  constructor() {
    this.running = false;
    this.queue = [];
  }

  solve(challenge, difficulty) {
    return new Promise((resolve) => {
      this.queue.push({ challenge, difficulty, resolve });
      this.drain();
    });
  }

  drain() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const { challenge, difficulty, resolve } = this.queue.shift();

    const startNonce = Math.floor(Math.random() * 50000000);
    const maxHashes = 15000000;

    // Use nice -n 19 and strictly 1 CPU thread
    execFile('nice', ['-n', '19', SOLVER_BIN, challenge, String(difficulty), String(startNonce), String(maxHashes), '1'], (error, stdout) => {
      this.running = false;
      this.drain();

      if (error) {
        return resolve({ type: 'error', error });
      }
      const line = stdout.trim();
      if (line.startsWith('FOUND')) {
        const parts = line.split(' ');
        resolve({
          type: 'found',
          nonce: parts[1],
          zeros: parseInt(parts[2], 10),
          hash: parts[3]
        });
      } else {
        const parts = line.split(' ');
        const count = parseInt(parts[1], 10) || maxHashes;
        resolve({ type: 'done', count });
      }
    });
  }
}

const solverQueue = new SolverQueue();

function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    return null;
  }
}

function postJson(agent, pathname, headers, body) {
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
      timeout: 10000
    };
    if (agent) {
      reqOptions.agent = agent;
    }
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
  const res = await postJson(w.agent, '/api/cli/captcha', { 'Authorization': `Bearer ${w.apiKey}` }, {
    captchaId: captcha.id,
    answer: Number(ans)
  });
  return res.ok && res.data.solved;
}

async function fetchJob(w) {
  let res = await postJson(w.agent, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` });
  if (res.status === 428 && res.data.captcha) {
    const solved = await solveCaptcha(w, res.data.captcha);
    if (solved) {
      res = await postJson(w.agent, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` });
    }
  }
  if (res.ok) {
    if (res.data.balance !== undefined) w.balance = res.data.balance;
    return res.data;
  }
  return null;
}

async function processWalletForRound(w, targetRoundId) {
  if (w.servedRound === targetRoundId) return true;

  const job = await fetchJob(w);
  if (!job) return false;

  if (job.round && job.round.id !== targetRoundId) {
    return { roundShift: job.round };
  }

  const result = await solverQueue.solve(job.challenge, job.difficulty);
  if (result.type === 'found') {
    const subRes = await postJson(w.agent, '/api/cli/submit', { 'Authorization': `Bearer ${w.apiKey}` }, {
      jobId: job.id,
      nonce: result.nonce
    });

    if (subRes.ok) {
      w.servedRound = targetRoundId;
      w.accepted++;
      if (subRes.data.balance !== undefined) w.balance = subRes.data.balance;
      log(`[SHARE] ${w.name} SETOR OK (Diff: ${result.zeros}, Bal: ${w.balance.toFixed(2)})`);
      return true;
    } else {
      w.rejected++;
    }
  }
  return false;
}

async function main() {
  fs.writeFileSync(LOG_FILE, `=== OREX LIGHTWEIGHT FLEET STARTED [${new Date().toISOString()}] ===\n`);
  console.log('[OREX Lightweight] Berjalan dalam mode ultra-ringan (1 Core Idle Priority, Zero Terminal Spam).');

  const fleetRaw = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
  const fleet = fleetRaw.map(w => ({
    ...w,
    agent: w.proxyUrl && w.proxyUrl !== 'direct' ? new HttpsProxyAgent(w.proxyUrl) : null,
    servedRound: null,
    accepted: 0,
    rejected: 0
  }));

  let activeRoundId = null;
  let roundEndsAt = 0;

  function writeStatus() {
    try {
      const totalBal = fleet.reduce((s, x) => s + x.balance, 0);
      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        updatedAt: new Date().toISOString(),
        activeRoundId,
        timeLeftSec: Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)),
        servedInRound: fleet.filter(x => x.servedRound === activeRoundId).length,
        totalWallets: fleet.length,
        totalFleetBalance: Number(totalBal.toFixed(4)),
        wallets: fleet.map(x => ({
          name: x.name,
          address: x.address,
          balance: Number(x.balance.toFixed(4)),
          accepted: x.accepted,
          servedThisRound: x.servedRound === activeRoundId
        }))
      }, null, 2));
    } catch (e) {}
  }

  while (true) {
    if (!activeRoundId || Date.now() >= roundEndsAt) {
      const syncW = fleet[0];
      const job = await fetchJob(syncW);
      if (job && job.round) {
        if (job.round.id !== activeRoundId) {
          activeRoundId = job.round.id;
          roundEndsAt = job.round.endsAt;
          fleet.forEach(item => { item.servedRound = null; });
          log(`>>> RONDE BARU #${activeRoundId} DIMULAI <<<`);
        }
      } else {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
    }

    writeStatus();

    const unserved = fleet.filter(w => w.servedRound !== activeRoundId);
    if (unserved.length === 0) {
      const waitMs = Math.max(1000, roundEndsAt - Date.now() + 500);
      log(`SEMUA 30 WALLET SELESAI. Istirahat ${(waitMs/1000).toFixed(1)}s.`);
      writeStatus();
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    // Process in gentle batches of 4
    const BATCH_SIZE = 4;
    for (let i = 0; i < unserved.length; i += BATCH_SIZE) {
      if (Date.now() >= roundEndsAt) break;

      const batch = unserved.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (w) => {
        const res = await processWalletForRound(w, activeRoundId);
        if (res && res.roundShift) {
          activeRoundId = res.roundShift.id;
          roundEndsAt = res.roundShift.endsAt;
          fleet.forEach(item => { item.servedRound = null; });
        }
      }));
      writeStatus();
    }

    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  console.error(err);
});
