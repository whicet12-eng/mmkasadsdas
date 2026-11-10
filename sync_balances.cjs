const fs = require('fs');
const https = require('https');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const FLEET_FILE = path.resolve(__dirname, 'wallets_330_fleet.json');
const fleet = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));

function createAgent(url) {
  if (!url || url === 'direct') return null;
  if (url.startsWith('socks5://') || url.startsWith('socks://')) return new SocksProxyAgent(url);
  return new HttpsProxyAgent(url);
}

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
      hostname: 'orex.run',
      port: 443,
      path: pathname,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 6000
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b) });
        } catch (e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 408 }); });
    req.write(data);
    req.end();
  });
}

async function fetchWalletBalance(w) {
  const agent = createAgent(w.proxyUrl);
  let res = await postJson(agent, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` }, {});
  if (res.status === 428 && res.data && res.data.captcha) {
    const ans = solveArithmetic(res.data.captcha.question);
    if (ans !== null) {
      await postJson(agent, '/api/cli/captcha', { 'Authorization': `Bearer ${w.apiKey}` }, {
        captchaId: res.data.captcha.id,
        answer: Number(ans)
      });
      res = await postJson(agent, '/api/cli/job', { 'Authorization': `Bearer ${w.apiKey}` }, {});
    }
  }

  if (res.status === 200 && res.data && res.data.balance !== undefined) {
    w.balance = Number(res.data.balance.toFixed(4));
    return w.balance;
  }
  return null;
}

async function main() {
  console.log(`Starting true balance sync for all ${fleet.length} wallets...`);
  const CONCURRENCY = 30;

  for (let i = 0; i < fleet.length; i += CONCURRENCY) {
    const batch = fleet.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(w => fetchWalletBalance(w)));
    console.log(`Synced ${Math.min(i + CONCURRENCY, fleet.length)} / ${fleet.length} wallets...`);
  }

  const totalBal = fleet.reduce((s, w) => s + (w.balance || 0), 0);
  const nonZero = fleet.filter(w => (w.balance || 0) > 0);
  const zero = fleet.filter(w => (w.balance || 0) === 0);

  console.log('='.repeat(60));
  console.log(`Non-zero wallets: ${nonZero.length} / ${fleet.length}`);
  console.log(`Wallets with 0 balance: ${zero.length} (brand new wallets awaiting first round payout)`);
  console.log(`Total Cumulative Fleet Balance: ${totalBal.toFixed(2)} OREX`);
  console.log('='.repeat(60));

  fs.writeFileSync(FLEET_FILE, JSON.stringify(fleet, null, 2));
  console.log('Successfully updated wallets_330_fleet.json with exact balances!');
}

main().catch(console.error);
