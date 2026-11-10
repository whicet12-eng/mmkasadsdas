const { keccak_256 } = require("/home/codespace/nvm/current/lib/node_modules/@binance/agentic-wallet/node_modules/@noble/hashes/sha3");

function sel(sig) {
  return "0x" + Buffer.from(keccak_256(Buffer.from(sig))).toString("hex").slice(0, 8);
}

console.log("isAgentHolder:", sel("isAgentHolder(address)"));
console.log("challengeOf:", sel("challengeOf(address)"));
console.log("status:", sel("status(address)"));
console.log("mine:", sel("mine(uint256)"));
console.log("mintPaid:", sel("mintPaid(uint256)"));
