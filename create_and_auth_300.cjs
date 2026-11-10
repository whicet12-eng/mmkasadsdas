const { ethers } = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');
const fs = require('fs');

const rawProxies = fs.readFileSync('proxy12.txt', 'utf8')
  .trim()
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

console.log(`Loaded ${rawProxies.length} proxies from proxy12.txt`);

function postJson(agent, pathname, body) {
  return new Promise((resolve, reject) => {
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
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 15000
    }, (res) => {
      let bodyData = '';
      res.on('data', chunk => bodyData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(bodyData) });
        } catch (e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

async function authWallet(wObj, proxyStr, name) {
  const proxyUrl = `http://${proxyStr}`;
  const agent = new HttpsProxyAgent(proxyUrl);
  const wallet = new ethers.Wallet(wObj.privateKey);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const chalRes = await postJson(agent, '/api/auth/wallet/challenge', { address: wallet.address });
      if (!chalRes.data || !chalRes.data.nonce) {
        throw new Error('No challenge nonce returned: ' + JSON.stringify(chalRes.data));
      }

      const signature = await wallet.signMessage(chalRes.data.message);
      const authRes = await postJson(agent, '/api/auth/wallet', { nonce: chalRes.data.nonce, signature });
      if (!authRes.data || !authRes.data.user) {
        throw new Error('No user object returned: ' + JSON.stringify(authRes.data));
      }

      const user = authRes.data.user;
      return {
        name,
        address: wallet.address,
        apiKey: user.apiKey,
        balance: user.balance || 0,
        accepted: 0,
        rejected: 0,
        proxyUrl
      };
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('    GENERATING AND AUTHENTICATING 300 NEW WALLETS (WORKER #301 - #600)');
  console.log('='.repeat(70));

  // 1. Generate 300 fresh wallets
  const newWallets = [];
  for (let i = 0; i < 300; i++) {
    const w = ethers.Wallet.createRandom();
    const workerNum = 301 + i;
    const proxyStr = rawProxies[i % rawProxies.length];
    newWallets.push({
      workerNum,
      name: `Worker #${workerNum}`,
      address: w.address,
      privateKey: w.privateKey,
      proxyStr
    });
  }

  // Backup keys
  fs.writeFileSync('wallets_301_600_keys.json', JSON.stringify(newWallets, null, 2));
  console.log('Saved 300 private keys to wallets_301_600_keys.json');

  // 2. Authenticate with OREX
  const fleetNew = [];
  const concurrency = 20;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < newWallets.length; i += concurrency) {
    const chunk = newWallets.slice(i, i + concurrency);
    const promises = chunk.map((item, idx) => {
      const globalIdx = i + idx;
      return authWallet(item, item.proxyStr, item.name)
        .then(res => {
          successCount++;
          fleetNew.push(res);
          console.log(`[#${String(item.workerNum).padStart(3, '0')}] OK: ${res.address} | apiKey: ${res.apiKey.slice(0, 10)}... | Proxy: ${item.proxyStr.split('@')[1]}`);
        })
        .catch(err => {
          failCount++;
          console.error(`[#${String(item.workerNum).padStart(3, '0')}] FAIL: ${item.address} - ${err.message}`);
        });
    });

    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 300));
  }

  // Sort by worker number
  fleetNew.sort((a, b) => {
    const numA = parseInt(a.name.replace('Worker #', ''));
    const numB = parseInt(b.name.replace('Worker #', ''));
    return numA - numB;
  });

  console.log(`\nAuth Complete! Success: ${successCount}, Fail: ${failCount}`);
  fs.writeFileSync('wallets_new_300.json', JSON.stringify(fleetNew, null, 2));

  // 3. Merge with existing 330 fleet
  const fleet330 = JSON.parse(fs.readFileSync('wallets_330_fleet.json', 'utf8'));
  const fleet630 = [...fleet330, ...fleetNew];
  fs.writeFileSync('wallets_630_fleet.json', JSON.stringify(fleet630, null, 2));

  console.log(`Successfully merged into wallets_630_fleet.json! Total wallets: ${fleet630.length}`);
}

main().catch(console.error);
