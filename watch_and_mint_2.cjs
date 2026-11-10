const https = require("https");

const TOKEN = "E1v8PD5w5kpk9fArOVzcnEcxCKFBSivOasb1fnLfoDY";
const MCP_URL = "https://mcp.credit/mcp";

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function mcpCall(id, toolName, args = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: id,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    });

    const req = https.request(MCP_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error("JSON parse error: " + data));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  log("Starting automated watcher for Solana deposit & minting 2 NFTs...");
  log("Target Account: @0xj4en (mcp_Here63LTE7b6)");
  log("Destination Solana Address: 5eb8hRwac7ejD7pKGfgvwejPsR4Qt5XKsaauzBRNEg2b");

  let balance = 0;
  let attempts = 0;

  // Poll for deposit up to 15 minutes (90 attempts @ 10s)
  while (attempts < 90) {
    attempts++;
    try {
      const res = await mcpCall(attempts, "account");
      const text = res?.result?.content?.[0]?.text || "";
      const match = text.match(/Balance:\s*([0-9.]+)\s*\$MCP/i);
      if (match) {
        balance = parseFloat(match[1]);
        log(`Check #${attempts}: Current Balance = ${balance} $MCP`);
      } else {
        log(`Check #${attempts}: text = ${text.replace(/\n/g, " | ")}`);
      }

      if (balance >= 10) {
        log("🎉 Sufficient balance detected (>= 10 $MCP)! Executing MINT 2 NFTs...");
        break;
      } else if (balance >= 5) {
        log("🎉 Partial balance detected (>= 5 $MCP)! Executing first MINT...");
        break;
      }
    } catch (e) {
      log(`Error checking account: ${e.message}`);
    }
    await sleep(10000);
  }

  if (balance < 5) {
    log("Timed out waiting for deposit. Please check ChangeNOW status.");
    return;
  }

  // Mint NFT #1
  log(">>> MINTING NFT #1 <<<");
  const mint1 = await mcpCall(901, "mint", { collection: "mcp" });
  log(`Mint #1 Result: ${JSON.stringify(mint1)}`);

  await sleep(3000);

  // Mint NFT #2 if balance >= 10
  if (balance >= 10) {
    log(">>> MINTING NFT #2 <<<");
    const mint2 = await mcpCall(902, "mint", { collection: "mcp" });
    log(`Mint #2 Result: ${JSON.stringify(mint2)}`);
  } else {
    // Check if remaining balance allows mint 2
    await sleep(5000);
    const acc = await mcpCall(903, "account");
    const text2 = acc?.result?.content?.[0]?.text || "";
    const m2 = text2.match(/Balance:\s*([0-9.]+)\s*\$MCP/i);
    const b2 = m2 ? parseFloat(m2[1]) : 0;
    if (b2 >= 5) {
      log(">>> MINTING NFT #2 <<<");
      const mint2 = await mcpCall(904, "mint", { collection: "mcp" });
      log(`Mint #2 Result: ${JSON.stringify(mint2)}`);
    }
  }

  // Final account check
  await sleep(3000);
  const finalAcc = await mcpCall(999, "account");
  log("\n========================================================");
  log(">>> FINAL ACCOUNT STATUS <<<");
  log(finalAcc?.result?.content?.[0]?.text || JSON.stringify(finalAcc));
  log("========================================================");
}

main().catch(console.error);
