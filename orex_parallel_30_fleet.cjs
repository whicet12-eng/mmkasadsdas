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

// Mutex / Queue for Native Solver to avoid overloading CPU
class SolverQueue {
  constructor(maxConcurrent = 2, threadsPerJob = 2) {
    this.maxConcurrent = maxConcurrent;
    this.threadsPerJob = threadsPerJob;
    this.running = 0;
    this.queue = [];
  }

  solve(challenge, difficulty) {
    return new Promise((resolve) => {
      this.queue.push({ challenge, difficulty, resolve });
      this.drain();
    });
  }

  drain() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;
    this.running++;
    const { challenge, difficulty, resolve } = this.queue.shift();

    const startNonce = Math.floor(Math.random() * 50000000);
    const maxHashes = 15000000;

    execFile(SOLVER_BIN, [challenge, String(difficulty), String(startNonce), String(maxHashes), String(this.threadsPerJob)], (error, stdout) => {
      this.running--;
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

const solverQueue = new SolverQueue(2, 2); // 2 solvers in parallel, 2 threads each = 4 threads total!

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

async function processWalletForRound(w, targetRoundId, updateCallback) {
  if (w.servedRound === targetRoundId) return true;

  const job = await fetchJob(w);
  if (!job) return false;

  // Check if round shifted
  if (job.round && job.round.id !== targetRoundId) {
    return { roundShift: job.round };
  }

  // Submit to solver queue
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
      updateCallback(w, result.zeros);
      return true;
    } else {
      w.rejected++;
    }
  }
  return false;
}

async function main() {
  console.log('='.repeat(75));
  console.log('   OREX 30-WALLET PARALLEL FLEET (CONCURRENT PIPELINE + TURBO SOLVER)');
  console.log('='.repeat(75));

  const fleetRaw = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
  const fleet = fleetRaw.map(w => ({
    ...w,
    agent: w.proxyUrl && w.proxyUrl !== 'direct' ? new HttpsProxyAgent(w.proxyUrl) : null,
    servedRound: null,
    accepted: 0,
    rejected: 0
  }));

  console.log(`[Init] ${fleet.length} Wallets ready. Parallel pipeline with 6 concurrent workers.`);

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
    // 1. Initial round sync if needed
    if (!activeRoundId || Date.now() >= roundEndsAt) {
      console.log(`[Sync] Menunggu / mengecek ronde baru...`);
      const syncW = fleet[0];
      const job = await fetchJob(syncW);
      if (job && job.round) {
        if (job.round.id !== activeRoundId) {
          activeRoundId = job.round.id;
          roundEndsAt = job.round.endsAt;
          fleet.forEach(item => { item.servedRound = null; });
          console.log(`\n============================================================`);
          console.log(`>>> RONDE BARU #${activeRoundId} DIMULAI! (Berakhir dalam: ${Math.round((roundEndsAt - Date.now())/1000)}s) <<<`);
          console.log(`============================================================`);
        }
      } else {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
    }

    writeStatus();

    // 2. Parallel processing of unserved wallets
    const unserved = fleet.filter(w => w.servedRound !== activeRoundId);
    if (unserved.length === 0) {
      const waitMs = Math.max(1000, roundEndsAt - Date.now() + 500);
      console.log(`\n🎉 [100% SUKSES] SEMUA 30 WALLET TELAH MENYELESAIKAN 1 SHARE PADA RONDE #${activeRoundId}!`);
      console.log(`Waktu tersisa ronde: ${(waitMs/1000).toFixed(1)}s -> CPU bersantai (0% load) sampai ronde berikutnya.\n`);
      writeStatus();
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    // Run parallel batches (concurrency of 6)
    const CONCURRENCY = 6;
    for (let i = 0; i < unserved.length; i += CONCURRENCY) {
      if (Date.now() >= roundEndsAt) break;

      const batch = unserved.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (w) => {
        const res = await processWalletForRound(w, activeRoundId, (wallet, diff) => {
          const servedCount = fleet.filter(x => x.servedRound === activeRoundId).length;
          console.log(`[SHARE] ✔ [${wallet.name}] (${servedCount}/30) SETOR OK! Diff: ${diff} | Bal: ${wallet.balance.toFixed(2)} OREX`);
          writeStatus();
        });

        if (res && res.roundShift) {
          activeRoundId = res.roundShift.id;
          roundEndsAt = res.roundShift.endsAt;
          fleet.forEach(item => { item.servedRound = null; });
        }
      }));
    }

    await new Promise(r => setTimeout(r, 200));
  }
}

main().catch(console.error);
