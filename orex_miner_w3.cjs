const { ethers } = require('ethers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SERVER = 'https://orex.run';
const WALLET_FILE = path.resolve(__dirname, 'wallet3.json');

// --- Helper Functions ---
function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    console.error('Failed to parse question:', question);
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

// --- Worker Thread Mining Logic ---
if (!isMainThread) {
  const { workerIndex, step } = workerData;
  let currentJob = null;
  let nonce = workerIndex;

  parentPort.on('message', (msg) => {
    if (msg.type === 'job') {
      currentJob = msg.job;
      nonce = workerIndex;
    } else if (msg.type === 'stop') {
      currentJob = null;
    }
  });

  const CHUNK_SIZE = 15000;
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
          jobId: id,
          nonce: String(nonce),
          hash: hash.toString('hex'),
          zeros
        });
        currentJob = null;
        break;
      }
      nonce += step;
    }

    parentPort.postMessage({ type: 'hashes', count: hashes });
    setImmediate(hashChunk);
  }

  hashChunk();
} else {
  // --- Main Controller Logic ---
  async function run() {
    console.log('='.repeat(60));
    console.log('       OREX AUTOMATED MINING RUNNER - WALLET W3');
    console.log('='.repeat(60));

    if (!fs.existsSync(WALLET_FILE)) {
      console.error(`File wallet tidak ditemukan: ${WALLET_FILE}`);
      process.exit(1);
    }

    const walletRaw = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    const wallet = new ethers.Wallet(walletRaw.privateKey);
    console.log(`[Wallet] Address: ${wallet.address}`);

    // 1. Authenticate with OREX
    console.log('[Auth] Mengambil challenge EIP-4361 dari orex.run...');
    const chalRes = await fetch(`${SERVER}/api/auth/wallet/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address })
    });
    if (!chalRes.ok) {
      throw new Error(`Gagal challenge: ${chalRes.statusText}`);
    }
    const chal = await chalRes.json();
    console.log(`[Auth] Menandatangani pesan (personal_sign)...`);
    const signature = await wallet.signMessage(chal.message);

    const authRes = await fetch(`${SERVER}/api/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: chal.nonce, signature })
    });
    if (!authRes.ok) {
      throw new Error(`Gagal login wallet: ${authRes.statusText}`);
    }
    const authData = await authRes.json();
    const apiKey = authData.user.apiKey;
    const username = authData.user.username;
    console.log(`[Auth] Sukses! Username: ${username} | Balance: ${authData.user.balance} OREX`);
    console.log(`[Auth] API Key: ${apiKey.slice(0, 10)}...${apiKey.slice(-6)}`);

    // Save to ~/.orex/config.json for official CLI compatibility
    try {
      const configDir = path.join(os.homedir(), '.orex');
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ server: SERVER, apiKey }, null, 2), { mode: 0o600 });
      console.log(`[Config] Tersimpan di ~/.orex/config.json (Kompatibel dengan perintah "orex status")`);
    } catch (e) {}

    // Number of threads: use 3 (leaves 1 core free for OS/tasks)
    const availableCores = os.availableParallelism?.() || os.cpus().length;
    const numThreads = Math.max(1, Math.min(3, availableCores - 1 || 1));
    console.log(`[Engine] CPU Cores: ${availableCores} | Mining Threads: ${numThreads}`);

    // State
    const state = {
      apiKey,
      job: null,
      balance: authData.user.balance || 0,
      totalShares: authData.user.totalShares || 0,
      sessionShares: 0,
      totalHashes: 0,
      accepted: 0,
      rejected: 0,
      currentRound: null,
      lastPayout: 0,
      startTime: Date.now(),
      recentHashes: 0,
      lastRateCheck: Date.now()
    };

    // Workers setup
    const workers = [];
    for (let i = 0; i < numThreads; i++) {
      const worker = new Worker(__filename, {
        workerData: { workerIndex: i, step: numThreads }
      });
      worker.on('message', (msg) => {
        if (msg.type === 'hashes') {
          state.totalHashes += msg.count;
          state.recentHashes += msg.count;
        } else if (msg.type === 'found') {
          handleFoundShare(msg);
        }
      });
      worker.on('error', (err) => console.error(`Worker error: ${err.message}`));
      workers.push(worker);
    }

    const broadcast = (msg) => workers.forEach(w => w.postMessage(msg));

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

    // Auto-solver for Captcha
    async function solveCaptcha(captcha) {
      console.log(`\n[CAPTCHA] Server meminta verifikasi anti-bot: "${captcha.question}"`);
      const answer = solveArithmetic(captcha.question);
      console.log(`[CAPTCHA] Jawaban dihitung: ${answer}`);
      const res = await apiRequest('POST', '/api/cli/captcha', {
        captchaId: captcha.id,
        answer: Number(answer)
      });
      if (res.ok && res.data.solved) {
        console.log(`[CAPTCHA] ✔ Verifikasi Berhasil! Mining dilanjutkan.\n`);
        return true;
      } else {
        console.error(`[CAPTCHA] ✖ Gagal menjawab:`, res.data);
        return false;
      }
    }

    // Fetch Job
    let isFetchingJob = false;
    async function fetchNextJob() {
      if (isFetchingJob) return;
      isFetchingJob = true;
      broadcast({ type: 'stop' });

      while (true) {
        const res = await apiRequest('POST', '/api/cli/job');
        if (res.status === 428 && res.data.captcha) {
          const solved = await solveCaptcha(res.data.captcha);
          if (solved) continue;
        } else if (res.ok) {
          const job = res.data;
          state.job = { id: job.id, challenge: job.challenge, difficulty: job.difficulty };
          if (job.balance !== undefined) state.balance = job.balance;
          if (job.round) state.currentRound = job.round;
          if (job.lastPayout) state.lastPayout = job.lastPayout.amount;
          broadcast({ type: 'job', job: state.job });
          break;
        } else {
          console.warn(`[Job] Gagal mengambil job (${res.status}): ${res.data.error || 'Unknown'}. Retry dalam 3s...`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      isFetchingJob = false;
    }

    // Handle Found Share
    async function handleFoundShare(share) {
      if (!state.job || state.job.id !== share.jobId) return;
      state.job = null;
      broadcast({ type: 'stop' });

      const submitRes = await apiRequest('POST', '/api/cli/submit', {
        jobId: share.jobId,
        nonce: share.nonce
      });

      if (submitRes.ok) {
        state.accepted++;
        state.sessionShares++;
        if (submitRes.data.balance !== undefined) state.balance = submitRes.data.balance;
        if (submitRes.data.round) state.currentRound = submitRes.data.round;
        const rewardEst = submitRes.data.round?.estimate ? `~${submitRes.data.round.estimate.toFixed(4)} OREX` : '';
        console.log(`[SHARE] ✔ Share DITERIMA! (Nonce: ${share.nonce}, Zeros: ${share.zeros}) | Est Round: ${rewardEst}`);
      } else {
        state.rejected++;
        console.log(`[SHARE] ✖ Share DITOLAK: ${submitRes.data.error || submitRes.status}`);
      }

      fetchNextJob();
    }

    // Status Dashboard ticker
    setInterval(() => {
      const now = Date.now();
      const elapsedSec = (now - state.lastRateCheck) / 1000;
      const khs = (state.recentHashes / elapsedSec / 1000).toFixed(1);
      state.recentHashes = 0;
      state.lastRateCheck = now;

      const roundInfo = state.currentRound;
      const timeLeftSec = roundInfo ? Math.max(0, Math.ceil((roundInfo.endsAt - now) / 1000)) : 0;
      const roundStr = roundInfo ? `Round #${roundInfo.id} [${timeLeftSec}s]` : 'Round: -';
      const roundMiners = roundInfo ? `${roundInfo.miners} miners` : '';
      const sharesStr = `${state.accepted} ok / ${state.rejected} err`;

      process.stdout.write(
        `\r[OREX W3] Hashrate: ${khs} kH/s | ${roundStr} (${roundMiners}) | Shares: ${sharesStr} | Saldo: ${state.balance.toFixed(4)} OREX    `
      );
    }, 3000);

    // Initial Job
    await fetchNextJob();
  }

  run().catch(console.error);
}
