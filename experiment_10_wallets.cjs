const fs = require('fs');
const path = require('path');

const SERVER = 'https://orex.run';
const WALLETS_FILE = path.resolve(__dirname, 'wallets_10_test.json');

function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9+\-* /]/g, '').trim();
  try {
    return Function(`'use strict'; return (${cleaned})`)();
  } catch (err) {
    return null;
  }
}

async function runExperiment() {
  console.log('='.repeat(70));
  console.log('       EXPERIMENT: 10 WALLETS MINING CONCURRENTLY FROM 1 IP');
  console.log('='.repeat(70));

  const wallets = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));

  async function apiRequest(apiKey, method, pathname, body) {
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

  async function answerCaptchaIfAny(w, jobRes) {
    if (jobRes.status === 428 && jobRes.data.captcha) {
      console.log(`[CAPTCHA - ${w.name}] "${jobRes.data.captcha.question}"`);
      const ans = solveArithmetic(jobRes.data.captcha.question);
      const capRes = await apiRequest(w.apiKey, 'POST', '/api/cli/captcha', {
        captchaId: jobRes.data.captcha.id,
        answer: Number(ans)
      });
      if (capRes.ok && capRes.data.solved) {
        console.log(`[CAPTCHA - ${w.name}] ✔ Solved!`);
        return true;
      }
    }
    return false;
  }

  console.log('Menguji request job (POST /api/cli/job) secara serentak untuk ke-10 wallet...\n');

  const results = [];
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    let res = await apiRequest(w.apiKey, 'POST', '/api/cli/job');
    
    // If captcha required, answer it and retry
    if (res.status === 428) {
      const solved = await answerCaptchaIfAny(w, res);
      if (solved) {
        res = await apiRequest(w.apiKey, 'POST', '/api/cli/job');
      }
    }

    if (res.ok) {
      console.log(`[${i + 1}/10] ✔ BERHASIL: ${w.name} (${w.username}) -> Job ID: ${res.data.id.slice(0, 8)}... | Diff: ${res.data.difficulty}`);
      results.push({ name: w.name, username: w.username, status: 'OK', detail: `Diff ${res.data.difficulty}` });
    } else {
      console.log(`[${i + 1}/10] ✖ DITOLAK (${res.status}): ${w.name} (${w.username}) -> Pesan: "${res.data.error || 'Unknown'}"`);
      results.push({ name: w.name, username: w.username, status: `DITOLAK (${res.status})`, detail: res.data.error });
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('                     HASIL REKAP EXPERIMEN 10 WALLET');
  console.log('='.repeat(70));
  console.table(results);
}

runExperiment().catch(console.error);
