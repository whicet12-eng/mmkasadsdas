const { ethers } = require('ethers');
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require('https');
const fs = require('fs');

const deadProxies = new Set([
  '216.26.250.124:1081',
  '209.50.162.91:1081',
  '104.207.32.27:1081'
]);

const rawProxies = fs.readFileSync('proxy11.txt', 'utf8').trim().split('\n')
  .map(l => l.trim())
  .filter(l => l && !deadProxies.has(l.split('@')[1]));

console.log(`Loaded ${rawProxies.length} active SOCKS5 proxies.`);

const allWallets = JSON.parse(fs.readFileSync('wallets_300.json', 'utf8'));
console.log(`Loaded ${allWallets.length} target wallets.`);

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
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 12000
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

async function authWallet(w, index) {
  const proxyStr = rawProxies[index % rawProxies.length];
  const proxyUrl = `socks5://${proxyStr}`;
  const agent = new SocksProxyAgent(proxyUrl);
  const wallet = new ethers.Wallet(w.privateKey);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const chalRes = await postJson(agent, '/api/auth/wallet/challenge', { address: wallet.address });
      if (!chalRes.data || !chalRes.data.nonce) {
        throw new Error('No challenge nonce returned');
      }

      const signature = await wallet.signMessage(chalRes.data.message);
      const authRes = await postJson(agent, '/api/auth/wallet', { nonce: chalRes.data.nonce, signature });
      if (!authRes.data || !authRes.data.user) {
        throw new Error('No user object returned');
      }

      const user = authRes.data.user;
      return {
        index,
        name: `Worker #${index + 1}`,
        address: wallet.address,
        privateKey: w.privateKey,
        username: user.username,
        apiKey: user.apiKey,
        balance: user.balance || 0,
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
  console.log(`    AUTHENTICATING ${allWallets.length} WALLETS ACROSS ${rawProxies.length} PROXIES`);
  console.log('='.repeat(70));

  const fleet = [];
  const concurrency = 15;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allWallets.length; i += concurrency) {
    const chunk = allWallets.slice(i, i + concurrency);
    const promises = chunk.map((w, idx) => {
      const globalIdx = i + idx;
      return authWallet(w, globalIdx)
        .then(res => {
          successCount++;
          fleet.push(res);
          console.log(`[#${String(globalIdx + 1).padStart(3, '0')}/300] OK: ${res.address} | apiKey: ${res.apiKey.substr(0, 10)}... | Bal: ${res.balance}`);
        })
        .catch(err => {
          failCount++;
          console.error(`[#${String(globalIdx + 1).padStart(3, '0')}/300] FAIL: ${w.address} - ${err.message}`);
        });
    });

    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 200));
  }

  fleet.sort((a, b) => a.index - b.index);
  fs.writeFileSync('wallets_300_fleet.json', JSON.stringify(fleet, null, 2));

  console.log('='.repeat(70));
  console.log(`SELESAI! Sukses: ${successCount} | Gagal: ${failCount}`);
  console.log(`Disimpan di wallets_300_fleet.json`);
}

main().catch(console.error);
