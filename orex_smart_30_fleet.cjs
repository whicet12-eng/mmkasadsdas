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
    const req = https.request({
      hostname: SERVER_HOST,
      port: 443,
      path: pathname,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 10000
    }, (res) => {
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

function runNativeChunk(challenge, difficulty, startNonce, maxHashes, threads = 4) {
  return new Promise((resolve) => {
    execFile(SOLVER_BIN, [challenge, String(difficulty), String(startNonce), String(maxHashes), String(threads)], (error, stdout) => {
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
  });
}

async function main() {
  console.log('='.repeat(75));
  console.log('       OREX 30-WALLET SMART SHIFT FLEET (1 SHARE PER ROUND STRATEGY)');
  console.log('='.repeat(75));

  const fleetRaw = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
  const fleet = fleetRaw.map(w => ({
    ...w,
    agent: new HttpsProxyAgent(w.proxyUrl),
    servedRound: null,
    totalRoundShares: 0,
    accepted: 0,
    rejected: 0,
    currentJob: null
  }));

  console.log(`[Init] ${fleet.length} Wallets terhubung ke 10 Dedicated Webshare Proxies.`);

  let activeRoundId = null;
  let roundEndsAt = 0;

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
      w.currentJob = res.data;
      if (res.data.balance !== undefined) w.balance = res.data.balance;
      if (res.data.round) {
        activeRoundId = res.data.round.id;
        roundEndsAt = res.data.round.endsAt;
      }
      return res.data;
    }
    return null;
  }

  // Master Loop
  while (true) {
    const now = Date.now();
    let servedCountInThisRound = fleet.filter(w => w.servedRound === activeRoundId).length;

    // Check if we need to process wallets for the current round
    for (let i = 0; i < fleet.length; i++) {
      const w = fleet[i];

      // If already submitted in this round, skip to next wallet
      if (activeRoundId && w.servedRound === activeRoundId) {
        continue;
      }

      // 1. Fetch job for wallet
      const job = await fetchJob(w);
      if (!job) {
        continue;
      }

      // Check round synchronization
      if (job.round && job.round.id !== activeRoundId) {
        activeRoundId = job.round.id;
        roundEndsAt = job.round.endsAt;
        console.log(`\n>>> RONDE BARU #${activeRoundId} DIMULAI! Reset tiket antrean 30 wallet. <<<`);
        // Reset served status for new round
        fleet.forEach(item => { item.servedRound = null; });
      }

      // 2. Mine 1 share with 4 threads Turbo C Engine
      const startNonce = Math.floor(Math.random() * 50000000);
      const MAX_SEARCH = 15000000; // Search up to 15M hashes (~2 seconds)
      const result = await runNativeChunk(job.challenge, job.difficulty, startNonce, MAX_SEARCH, 4);

      if (result.type === 'found') {
        // 3. Submit winning share via proxy
        const subRes = await postJson(w.agent, '/api/cli/submit', { 'Authorization': `Bearer ${w.apiKey}` }, {
          jobId: job.id,
          nonce: result.nonce
        });

        if (subRes.ok) {
          w.servedRound = activeRoundId;
          w.accepted++;
          if (subRes.data.balance !== undefined) w.balance = subRes.data.balance;
          const servedNow = fleet.filter(x => x.servedRound === activeRoundId).length;
          console.log(`[SHARE] ✔ [${w.name}] (${servedNow}/30) SETOR OK! Diff: ${result.zeros} | Bal: ${w.balance.toFixed(2)} OREX`);
        } else {
          w.rejected++;
        }
      } else {
        // Did not find within budget, will retry next turn
      }

      // Update status file
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

      // If all 30 wallets are served for this round:
      const allServed = fleet.filter(x => x.servedRound === activeRoundId).length;
      if (allServed === fleet.length) {
        const waitMs = Math.max(1000, roundEndsAt - Date.now() + 500);
        console.log(`\n🎉 SEMUA 30 WALLET SUDAH SUKSES ABSEN DI RONDE #${activeRoundId}!`);
        console.log(`CPU istirahat ${(waitMs / 1000).toFixed(1)} detik sampai ronde berikutnya...\n`);
        await new Promise(r => setTimeout(r, waitMs));
        break; // break to fetch fresh round
      }
    }

    // Small breathe delay
    await new Promise(r => setTimeout(r, 200));
  }
}

main().catch(console.error);
