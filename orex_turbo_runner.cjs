const { ethers } = require('ethers');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER = 'https://orex.run';
const WALLET_FILE = path.resolve(__dirname, 'wallet3.json');
const SOLVER_BIN = path.resolve(__dirname, 'orex_solver_turbo');
const NUM_THREADS = 4;

function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    return null;
  }
}

async function run() {
  console.log('='.repeat(65));
  console.log('       OREX TURBO NATIVE MINER (C ENGINE + PRECOMPUTED MIDSTATE)');
  console.log('='.repeat(65));

  if (!fs.existsSync(WALLET_FILE) || !fs.existsSync(SOLVER_BIN)) {
    console.error('File wallet3.json atau orex_solver tidak ditemukan!');
    process.exit(1);
  }

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
  console.log(`[Engine] Native C Midstate Solver Ready!`);

  let currentJob = null;
  let isFetching = false;
  let nonceCursor = Math.floor(Math.random() * 50000000);
  let accepted = 0;
  let rejected = 0;
  let totalHashes = 0;
  let balance = authData.user.balance || 0;
  let currentRound = null;
  let startTime = Date.now();

  async function apiRequest(method, pathname, body) {
    const res = await fetch(`${SERVER}${pathname}`, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async function solveCaptcha(captcha) {
    console.log(`\n[CAPTCHA] Server meminta verifikasi: "${captcha.question}"`);
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

  async function fetchJob() {
    if (isFetching) return;
    isFetching = true;
    currentJob = null;

    while (true) {
      const res = await apiRequest('POST', '/api/cli/job');
      if (res.status === 428 && res.data.captcha) {
        const solved = await solveCaptcha(res.data.captcha);
        if (solved) continue;
      } else if (res.ok) {
        const job = res.data;
        currentJob = { id: job.id, challenge: job.challenge, difficulty: job.difficulty };
        if (job.balance !== undefined) balance = job.balance;
        if (job.round) currentRound = job.round;
        nonceCursor = Math.floor(Math.random() * 50000000);
        console.log(`\n[JOB] Baru: Diff ${job.difficulty} | Round #${job.round?.id || '-'}`);
        break;
      } else {
        console.warn(`[Job] Gagal (${res.status}): ${res.data.error || 'Retry dalam 3s...'}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    isFetching = false;
  }

  function runNativeChunk(challenge, difficulty, startNonce, chunkSize) {
    return new Promise((resolve) => {
      execFile(SOLVER_BIN, [challenge, String(difficulty), String(startNonce), String(chunkSize), String(NUM_THREADS)], (error, stdout) => {
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
          const count = parseInt(parts[1], 10) || chunkSize;
          resolve({ type: 'done', count });
        }
      });
    });
  }

  await fetchJob();

  // Mining loop
  const CHUNK_SIZE = 8000000; // 8 Million hashes per chunk (~1s in 4 threads)
  while (true) {
    if (!currentJob) {
      await fetchJob();
      continue;
    }

    const { id, challenge, difficulty } = currentJob;
    const result = await runNativeChunk(challenge, difficulty, nonceCursor, CHUNK_SIZE);

    if (result.type === 'found') {
      totalHashes += (parseInt(result.nonce, 10) - nonceCursor);
      console.log(`[SOLVED] 🚀 Nonce Ditemukan: ${result.nonce} (Diff: ${result.zeros})`);
      
      const submitRes = await apiRequest('POST', '/api/cli/submit', {
        jobId: id,
        nonce: result.nonce
      });

      if (submitRes.ok) {
        accepted++;
        if (submitRes.data.balance !== undefined) balance = submitRes.data.balance;
        if (submitRes.data.round) currentRound = submitRes.data.round;
        const est = submitRes.data.round?.estimate ? `~${submitRes.data.round.estimate.toFixed(4)} OREX` : '';
        console.log(`[SHARE] ✔ DITERIMA OLEH SERVER! | Est Reward: ${est} | Total Ok: ${accepted}`);
      } else {
        rejected++;
        console.log(`[SHARE] ✖ Ditolak: ${submitRes.data.error || submitRes.status}`);
      }

      await fetchJob();
    } else if (result.type === 'done') {
      totalHashes += result.count;
      nonceCursor += result.count;
      const elapsed = (Date.now() - startTime) / 1000;
      const mhs = (totalHashes / elapsed / 1000000).toFixed(2);
      process.stdout.write(
        `\r[OREX TURBO] Kecepatan: ${mhs} MH/s | Shares: ${accepted} ok / ${rejected} err | Saldo: ${balance.toFixed(4)} OREX    `
      );
    }
  }
}

run().catch(console.error);
