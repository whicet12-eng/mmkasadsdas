const { ethers } = require('ethers');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER = 'https://orex.run';
const MASTER_FILE = path.resolve(__dirname, 'wallets_3.json');
const SOLVER_BIN = path.resolve(__dirname, 'orex_solver_turbo');

function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    return null;
  }
}

async function runFleet() {
  console.log('='.repeat(70));
  console.log('       OREX 3-WALLET TURBO FLEET (NATIVE C MIDSTATE ENGINE)');
  console.log('='.repeat(70));

  const allWallets = JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8')).slice(0, 3);
  const accounts = [];

  for (let i = 0; i < allWallets.length; i++) {
    const wInfo = allWallets[i];
    const wallet = new ethers.Wallet(wInfo.privateKey);

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

    accounts.push({
      index: i + 1,
      name: wInfo.name,
      address: wallet.address,
      username: authData.user.username,
      apiKey: authData.user.apiKey,
      balance: authData.user.balance || 0,
      accepted: 0,
      rejected: 0,
      job: null,
      nonceCursor: Math.floor(Math.random() * 50000000),
      isFetching: false
    });

    console.log(`[Akun #${i + 1}] ${wInfo.name} -> ${authData.user.username} | Saldo: ${authData.user.balance.toFixed(4)} OREX`);
  }

  async function apiRequest(acc, method, pathname, body) {
    const res = await fetch(`${SERVER}${pathname}`, {
      method,
      headers: {
        'Authorization': `Bearer ${acc.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async function solveCaptcha(acc, captcha) {
    console.log(`\n[CAPTCHA - ${acc.name}] Pertanyaan: "${captcha.question}"`);
    const answer = solveArithmetic(captcha.question);
    const res = await apiRequest(acc, 'POST', '/api/cli/captcha', {
      captchaId: captcha.id,
      answer: Number(answer)
    });
    if (res.ok && res.data.solved) {
      console.log(`[CAPTCHA - ${acc.name}] ✔ Terpecahkan: ${answer}`);
      return true;
    }
    return false;
  }

  async function fetchJob(acc) {
    if (acc.isFetching) return;
    acc.isFetching = true;
    acc.job = null;

    while (true) {
      const res = await apiRequest(acc, 'POST', '/api/cli/job');
      if (res.status === 428 && res.data.captcha) {
        const solved = await solveCaptcha(acc, res.data.captcha);
        if (solved) continue;
      } else if (res.ok) {
        const job = res.data;
        acc.job = { id: job.id, challenge: job.challenge, difficulty: job.difficulty };
        if (job.balance !== undefined) acc.balance = job.balance;
        acc.nonceCursor = Math.floor(Math.random() * 50000000);
        break;
      } else {
        console.warn(`[Job - ${acc.name}] Gagal (${res.status}): ${res.data.error || 'Retry dalam 3s...'}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    acc.isFetching = false;
  }

  function runNativeChunk(challenge, difficulty, startNonce, chunkSize) {
    return new Promise((resolve) => {
      // 1 thread per wallet so 3 wallets = 3 threads (1 core free)
      execFile(SOLVER_BIN, [challenge, String(difficulty), String(startNonce), String(chunkSize), "1"], (error, stdout) => {
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

  // Start mining loop for an account
  const CHUNK_SIZE = 3000000;
  async function startMiner(acc) {
    await fetchJob(acc);
    while (true) {
      if (!acc.job) {
        await fetchJob(acc);
        continue;
      }

      const { id, challenge, difficulty } = acc.job;
      const result = await runNativeChunk(challenge, difficulty, acc.nonceCursor, CHUNK_SIZE);

      if (result.type === 'found') {
        const submitRes = await apiRequest(acc, 'POST', '/api/cli/submit', {
          jobId: id,
          nonce: result.nonce
        });

        if (submitRes.ok) {
          acc.accepted++;
          if (submitRes.data.balance !== undefined) acc.balance = submitRes.data.balance;
          const est = submitRes.data.round?.estimate ? `~${submitRes.data.round.estimate.toFixed(4)} OREX` : '';
          console.log(`\n[SHARE] ✔ [${acc.name}] DITERIMA! Nonce: ${result.nonce} (Diff: ${result.zeros}) | Est: ${est} | Total Ok: ${acc.accepted}`);
        } else {
          acc.rejected++;
          console.log(`\n[SHARE] ✖ [${acc.name}] Ditolak: ${submitRes.data.error || submitRes.status}`);
        }

        await fetchJob(acc);
      } else if (result.type === 'done') {
        acc.nonceCursor += result.count;
      }
    }
  }

  // Launch all 3 miners concurrently
  accounts.forEach(acc => startMiner(acc));

  // Status reporter ticker
  setInterval(() => {
    const summary = accounts.map(a => `${a.name.slice(0, 8)}: ${a.accepted} ok | ${a.balance.toFixed(2)} OREX`).join('  |  ');
    process.stdout.write(`\r[3-FLEET TURBO] ${summary}    `);
  }, 4000);
}

runFleet().catch(console.error);
