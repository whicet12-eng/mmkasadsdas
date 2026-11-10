const { keccak_256 } = require("/home/codespace/nvm/current/lib/node_modules/@binance/agentic-wallet/node_modules/@noble/hashes/sha3");
const http = require("https");

function sel(sig) {
  return "0x" + Buffer.from(keccak_256(Buffer.from(sig))).toString("hex").slice(0, 8);
}

const calls = [
  "FREE_SUPPLY()",
  "PHASE1_END()",
  "PHASE1_FREE_PER_WALLET()",
  "LATER_FREE_PER_WALLET()",
  "totalFreeMinted()"
];

for (const c of calls) {
  console.log(c, sel(c));
}
