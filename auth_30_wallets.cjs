const { ethers } = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');
const fs = require('fs');

const allWallets = JSON.parse(fs.readFileSync('master_wallets_all.json', 'utf8')).slice(0, 30);
const proxyLines = fs.readFileSync('proxies.txt', 'utf8').trim().split('\n');

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
      timeout: 10000
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

async function main() {
  console.log('='.repeat(70));
  console.log('       AUTHENTICATING 30 WALLETS ACROSS 10 PROXIES');
  console.log('='.repeat(70));

  const fleet = [];

  for (let i = 0; i < allWallets.length; i++) {
    const w = allWallets[i];
    const proxyIdx = Math.floor(i / 3);
    const [ip, port, user, pass] = proxyLines[proxyIdx].split(':');
    const proxyUrl = `http://${user}:${pass}@${ip}:${port}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    const wallet = new ethers.Wallet(w.privateKey);

    try {
      const chalRes = await postJson(agent, '/api/auth/wallet/challenge', { address: wallet.address });
      if (!chalRes.data || !chalRes.data.nonce) {
        console.error(`[Error chal #${i + 1}]`, chalRes);
        continue;
      }

      const signature = await wallet.signMessage(chalRes.data.message);
      const authRes = await postJson(agent, '/api/auth/wallet', { nonce: chalRes.data.nonce, signature });
      if (!authRes.data || !authRes.data.user) {
        console.error(`[Error auth #${i + 1}]`, authRes);
        continue;
      }

      fleet.push({
        index: i,
        name: w.name,
        address: wallet.address,
        username: authRes.data.user.username,
        apiKey: authRes.data.user.apiKey,
        balance: authRes.data.user.balance || 0,
        proxyIdx,
        proxyUrl
      });

      console.log(`[#${String(i + 1).padStart(2, '0')}/30] ${w.name.padEnd(20)} -> ${authRes.data.user.username} | Proxy #${proxyIdx + 1} (${ip}) OK`);
    } catch (err) {
      console.error(`[Error #${i + 1}]`, err.message);
    }
  }

  fs.writeFileSync('wallets_30_fleet.json', JSON.stringify(fleet, null, 2));
  console.log(`\nSukses mengautentikasi ${fleet.length} dompet armada! Tersimpan di wallets_30_fleet.json`);
}

main().catch(console.error);
