#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BECH32_HRP = "lmt";
const WIF_PREFIX = 177; // 0xB1 (Lumenite Mainnet)
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function ripemd160(buf) {
  return crypto.createHash("ripemd160").update(buf).digest();
}

function hash160(buf) {
  return ripemd160(sha256(buf));
}

function bech32Polymod(values) {
  const generators = [996825010, 642813549, 513874426, 1027748829, 705979059];
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 33554431) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= generators[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const result = [];
  for (const char of hrp) result.push(char.charCodeAt(0) >>> 5);
  result.push(0);
  for (const char of hrp) result.push(char.charCodeAt(0) & 31);
  return result;
}

function createBech32Checksum(hrp, data) {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const result = [];
  for (let i = 0; i < 6; i++) {
    result.push((polymod >>> (5 * (5 - i))) & 31);
  }
  return result;
}

function bech32Encode(hrp, data) {
  const combined = data.concat(createBech32Checksum(hrp, data));
  return hrp + "1" + combined.map((v) => BECH32_CHARSET[v]).join("");
}

function convertBits(data, fromBits, toBits, pad = true) {
  let acc = 0;
  let bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  }
  return result;
}

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = BASE58[remainder] + encoded;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded || "1";
}

function createWIF(privateKey) {
  const payload = Buffer.concat([
    Buffer.from([WIF_PREFIX]),
    privateKey,
    Buffer.from([1]), // compressed flag
  ]);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

function createP2WPKHAddress(compressedPubKey) {
  const witnessProgram = hash160(compressedPubKey);
  const words = [0, ...convertBits(witnessProgram, 8, 5, true)];
  return bech32Encode(BECH32_HRP, words);
}

function generateLumeniteWallet() {
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  const publicKey = ecdh.getPublicKey(null, "compressed");
  const address = createP2WPKHAddress(publicKey);
  const wif = createWIF(privateKey);

  return {
    network: "Lumenite Mainnet",
    address,
    wif,
    privateKeyHex: privateKey.toString("hex"),
    publicKeyHex: publicKey.toString("hex"),
    createdAt: new Date().toISOString(),
  };
}

if (require.main === module) {
  const wallet = generateLumeniteWallet();
  const outPath = path.join(__dirname, "lumenite_wallet.json");
  fs.writeFileSync(outPath, JSON.stringify(wallet, null, 2), { mode: 0o600 });
  console.log("Lumenite Mainnet Wallet Generated Successfully:");
  console.log("Address (P2WPKH):", wallet.address);
  console.log("Private Key (WIF):", wallet.wif);
  console.log("Private Key (Hex):", wallet.privateKeyHex);
  console.log("Saved to:", outPath);
}

module.exports = { generateLumeniteWallet, createWIF, createP2WPKHAddress };
