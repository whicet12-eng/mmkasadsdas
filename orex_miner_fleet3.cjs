const { ethers } = require('ethers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SERVER = 'https://orex.run';
const MASTER_WALLETS_FILE = path.resolve(__dirname, 'master_wallets_all.json');
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

// --- Worker Thread Hashing Logic ---
if (!isMainThread) {
  const { accountIndex } = workerData;
  let currentJob = null;
  let nonce = 0;

  parentPort.on('message', (msg) => {
    if (msg.type === 'job') {
      currentJob = msg.job;
      nonce = Math.floor(Math.random() * 1000000);
    } else if (msg.type === 'stop') {
      currentJob = null;
    }
  });

  const CHUNK_SIZE = 10000;
  function hashChunk() {
    if (!currentJob) {
      setTimeout(hashChunk, 20);
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
          accountIndex,
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

    parentPort.postMessage({ type: 'hashes', accountIndex, count: hashes });
    setImmediate(hashChunk);
  }

  hashChunk();
} else {
  // --- Main Controller Logic for 3 Accounts ---
  async function run() {
    console.log('='.repeat(65));
    console.log('       OREX MULTI-ACCOUNT FLEET (3 MAX LIMIT PER IP)');
    console.log('='.repeat(65));

    const allWallets = JSON.parse(fs.readFileSync(MASTER_WALLETS_FILE, 'utf8'));
    const fleet = allWallets.slice(0, 3);

    console.log(`[Fleet] Menginisialisasi 3 Akun:...`);
    const accounts = [];

    for (let i = 0; i < fleet.length; i++) {
      const wInfo = fleet[i];
      const wallet = new ethers.Wallet(wInfo.privateKey);

      // EIP-4361 auth
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
        index: i,
        name: wInfo.name,
        address: wallet.address,
        username: authData.user.username,
        apiKey: authData.user.apiKey,
        balance: authData.user.balance || 0,
        accepted: 0,
        rejected: 0,
        recentHashes: 0,
        hashrate: 0,
        job: null,
        worker: null,
        round: null,
        isFetching: false
      });

      console.log(`  [Akun #${i + 1}] ${wInfo.name} -> ${authData.user.username} (${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)})`);
    }

    // Spawn 1 worker per account
    accounts.forEach((acc, idx) => {
      const worker = new Worker(__filename, {
        workerData: { accountIndex: idx }
      });

      worker.on('message', (msg) => {
        if (msg.type === 'hashes') {
          acc.recentHashes += msg.count;
        } else if (msg.type === 'found') {
          handleFoundShare(acc, msg);
        }
      });

      worker.on('error', (err) => console.error(`Worker error [${acc.username}]: ${err.message}`));
      acc.worker = worker;
    });

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
      console.log(`\n[CAPTCHA - ${acc.username}] Pertanyaan: "${captcha.question}"`);
      const answer = solveArithmetic(captcha.question);
      const res = await apiRequest(acc, 'POST', '/api/cli/captcha', {
        captchaId: captcha.id,
        answer: Number(answer)
      });
      if (res.ok && res.data.solved) {
        console.log(`[CAPTCHA - ${acc.username}] ✔ Terpecahkan = ${answer}`);
        return true;
      }
      return false;
    }

    async function fetchNextJob(acc) {
      if (acc.isFetching) return;
      acc.isFetching = true;
      acc.worker.postMessage({ type: 'stop' });

      while (true) {
        const res = await apiRequest(acc, 'POST', '/api/cli/job');
        if (res.status === 428 && res.data.captcha) {
          const solved = await solveCaptcha(acc, res.data.captcha);
          if (solved) continue;
        } else if (res.ok) {
          const job = res.data;
          acc.job = { id: job.id, challenge: job.challenge, difficulty: job.difficulty };
          if (job.balance !== undefined) acc.balance = job.balance;
          if (job.round) acc.round = job.round;
          acc.worker.postMessage({ type: 'job', job: acc.job });
          break;
        } else {
          console.warn(`[Job - ${acc.username}] Gagal (${res.status}): ${res.data.error || 'Retry dalam 3s...'}`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      acc.isFetching = false;
    }

    async function handleFoundShare(acc, share) {
      if (!acc.job || acc.job.id !== share.jobId) return;
      acc.job = null;
      acc.worker.postMessage({ type: 'stop' });

      const submitRes = await apiRequest(acc, 'POST', '/api/cli/submit', {
        jobId: share.jobId,
        nonce: share.nonce
      });

      if (submitRes.ok) {
        acc.accepted++;
        if (submitRes.data.balance !== undefined) acc.balance = submitRes.data.balance;
        if (submitRes.data.round) acc.round = submitRes.data.round;
        const est = submitRes.data.round?.estimate ? `~${submitRes.data.round.estimate.toFixed(4)} OREX` : '';
        console.log(`\n[SHARE] ✔ [${acc.username}] DITERIMA! (Diff: ${share.zeros}) | Est: ${est}`);
      } else {
        acc.rejected++;
        console.log(`\n[SHARE] ✖ [${acc.username}] DITOLAK: ${submitRes.data.error || submitRes.status}`);
      }

      fetchNextJob(acc);
    }

    // Start all accounts
    for (const acc of accounts) {
      fetchNextJob(acc);
    }

    // Status sync interval
    let lastCheck = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = (now - lastCheck) / 1000;
      lastCheck = now;

      let totalHashrate = 0;
      const statusDump = {
        updatedAt: new Date().toISOString(),
        totalAccounts: accounts.length,
        accounts: accounts.map(a => {
          const hr = a.recentHashes / dt / 1000;
          a.hashrate = hr;
          a.recentHashes = 0;
          totalHashrate += hr;
          return {
            name: a.name,
            username: a.username,
            address: a.address,
            hashrateKhs: Number(hr.toFixed(1)),
            accepted: a.accepted,
            rejected: a.rejected,
            balance: Number(a.balance.toFixed(4)),
            roundId: a.round?.id || null,
            roundEst: a.round?.estimate ? Number(a.round.estimate.toFixed(4)) : 0
          };
        }),
        fleetHashrateKhs: Number(totalHashrate.toFixed(1))
      };

      try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify(statusDump, null, 2));
      } catch (e) {}

      const accSummary = accounts.map(a => `${a.username.slice(6)}: ${a.hashrate.toFixed(0)}kH [${a.accepted} ok]`).join(' | ');
      process.stdout.write(`\r[OREX 3-FLEET] Total: ${totalHashrate.toFixed(0)} kH/s | ${accSummary}    `);
    }, 3000);
  }

  run().catch(console.error);
}
