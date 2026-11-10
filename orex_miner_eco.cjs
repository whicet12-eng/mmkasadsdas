const { ethers } = require('ethers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SERVER = 'https://orex.run';
const WALLET_FILE = path.resolve(__dirname, 'wallet3.json');
const STATUS_FILE = path.resolve(__dirname, 'orex_fleet_status.json');

function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    return null;
  }
}

function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte !== 0) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

// --- Worker Thread: 1 Core Eco-Mode Hashing ---
if (!isMainThread) {
  let currentJob = null;
  let nonce = Math.floor(Math.random() * 1000000);

  parentPort.on('message', (msg) => {
    if (msg.type === 'job') {
      currentJob = msg.job;
      nonce = Math.floor(Math.random() * 1000000);
    } else if (msg.type === 'stop') {
      currentJob = null;
    }
  });

  const CHUNK_SIZE = 8000;
  function hashChunk() {
    if (!currentJob) {
      setTimeout(hashChunk, 50);
      return;
    }

    const { id, challenge, difficulty } = currentJob;
    let hashes = 0;
    while (hashes < CHUNK_SIZE && currentJob && currentJob.id === id) {
      const hash = crypto.createHash('sha256').update(challenge + nonce).digest();
      hashes++;
      const zeros = leadingZeroBits(hash);
      if (zeros >= difficulty) {
        parentPort.postMessage({
          type: 'found',
          jobId: id,
          nonce: String(nonce),
          hash: hash.toString('hex'),
          zeros
        });
        currentJob = null;
        break;
      }
      nonce++;
    }

    parentPort.postMessage({ type: 'hashes', count: hashes });
    // Yield CPU with a tiny 2ms breathing pause so the core never stays pegged at 100%
    setTimeout(hashChunk, 2);
  }

  hashChunk();
} else {
  // --- Controller Logic ---
  async function run() {
    console.log('='.repeat(60));
    console.log('    OREX ECO MINER - 1 CPU CORE (SMOOTH & LIGHTWEIGHT)');
    console.log('='.repeat(60));

    const walletRaw = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    const wallet = new ethers.Wallet(walletRaw.privateKey);
    console.log(`[Wallet] Address: ${wallet.address}`);

    // Auth
    console.log('[Auth] Mengambil challenge EIP-4361 dari orex.run...');
    const chalRes = await fetch(`${SERVER}/api/auth/wallet/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address })
    });
    const chal = await chalRes.json();
    const signature = await wallet.signMessage(chal.message);

    const authRes = await fetch(`${SERVER}/api/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: chal.nonce, signature })
    });
    const authData = await authRes.json();
    const apiKey = authData.user.apiKey;
    const username = authData.user.username;
    console.log(`[Auth] Sukses! Username: ${username} | Balance: ${authData.user.balance} OREX`);
    console.log(`[Engine] Mode: 1 CPU Thread (3 Cores lainnya 100% Bebas untuk Anda)`);

    const state = {
      apiKey,
      job: null,
      balance: authData.user.balance || 0,
      totalShares: authData.user.totalShares || 0,
      sessionAccepted: 0,
      sessionRejected: 0,
      round: null,
      recentHashes: 0,
      hashrate: 0,
      isFetching: false
    };

    const worker = new Worker(__filename);
    worker.on('message', (msg) => {
      if (msg.type === 'hashes') {
        state.recentHashes += msg.count;
      } else if (msg.type === 'found') {
        handleFound(msg);
      }
    });
    worker.on('error', (err) => console.error('Worker error:', err));

    async function apiRequest(method, pathname, body) {
      const res = await fetch(`${SERVER}${pathname}`, {
        method,
        headers: {
          'Authorization': `Bearer ${state.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: method === 'GET' ? undefined : JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, data };
    }

    async function solveCaptcha(captcha) {
      console.log(`\n[CAPTCHA] Verifikasi: "${captcha.question}"`);
      const answer = solveArithmetic(captcha.question);
      const res = await apiRequest('POST', '/api/cli/captcha', {
        captchaId: captcha.id,
        answer: Number(answer)
      });
      if (res.ok && res.data.solved) {
        console.log(`[CAPTCHA] ✔ Terpecahkan: ${answer}`);
        return true;
      }
      return false;
    }

    async function fetchNextJob() {
      if (state.isFetching) return;
      state.isFetching = true;
      worker.postMessage({ type: 'stop' });

      while (true) {
        const res = await apiRequest('POST', '/api/cli/job');
        if (res.status === 428 && res.data.captcha) {
          const solved = await solveCaptcha(res.data.captcha);
          if (solved) continue;
        } else if (res.ok) {
          const job = res.data;
          state.job = { id: job.id, challenge: job.challenge, difficulty: job.difficulty };
          if (job.balance !== undefined) state.balance = job.balance;
          if (job.round) state.round = job.round;
          worker.postMessage({ type: 'job', job: state.job });
          break;
        } else {
          console.warn(`[Job] Gagal (${res.status}): ${res.data.error || 'Retry dalam 3s...'}`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      state.isFetching = false;
    }

    async function handleFound(share) {
      if (!state.job || state.job.id !== share.jobId) return;
      state.job = null;
      worker.postMessage({ type: 'stop' });

      const submitRes = await apiRequest('POST', '/api/cli/submit', {
        jobId: share.jobId,
        nonce: share.nonce
      });

      if (submitRes.ok) {
        state.sessionAccepted++;
        if (submitRes.data.balance !== undefined) state.balance = submitRes.data.balance;
        if (submitRes.data.round) state.round = submitRes.data.round;
        const est = submitRes.data.round?.estimate ? `~${submitRes.data.round.estimate.toFixed(4)} OREX` : '';
        console.log(`\n[SHARE] ✔ DITERIMA! Nonce: ${share.nonce} (Diff: ${share.zeros}) | Est: ${est}`);
      } else {
        state.sessionRejected++;
        console.log(`\n[SHARE] ✖ DITOLAK: ${submitRes.data.error || submitRes.status}`);
      }

      fetchNextJob();
    }

    await fetchNextJob();

    // Lightweight status ticker
    let lastCheck = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = (now - lastCheck) / 1000;
      lastCheck = now;

      const hr = (state.recentHashes / dt / 1000).toFixed(1);
      state.hashrate = Number(hr);
      state.recentHashes = 0;

      const roundInfo = state.round;
      const timeLeftSec = roundInfo ? Math.max(0, Math.ceil((roundInfo.endsAt - now) / 1000)) : 0;
      const roundStr = roundInfo ? `#${roundInfo.id} [${timeLeftSec}s]` : '-';

      process.stdout.write(
        `\r[OREX ECO] Hash: ${hr} kH/s | Round: ${roundStr} | Shares: ${state.sessionAccepted} ok | Saldo: ${state.balance.toFixed(4)} OREX    `
      );

      // Save status for inspection
      try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify({
          updatedAt: new Date().toISOString(),
          mode: '1-CPU Eco Mode',
          wallet: wallet.address,
          hashrateKhs: Number(hr),
          accepted: state.sessionAccepted,
          rejected: state.sessionRejected,
          balance: Number(state.balance.toFixed(4)),
          roundId: state.round?.id || null
        }, null, 2));
      } catch (e) {}
    }, 4000);
  }

  run().catch(console.error);
}
