// @ts-check
// Offline profiles: local player names with Mojang's v3 offline UUID (MD5 of "OfflinePlayer:<name>").
/** @typedef {import("../packages/plugin-api").TN} TN */

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

/** @param {Uint8Array} bytes */
function md5(bytes) {
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 8) >>> 6 << 6) + 64;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, bitLen >>> 0, true);
  view.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let off = 0; off < padLen; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

/**
 * Mojang's offline-mode UUID: md5("OfflinePlayer:" + name) as a v3 UUID, no dashes.
 * @param {string} name
 */
export function offlineUuid(name) {
  const b = md5(new TextEncoder().encode(`OfflinePlayer:${name}`));
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** @param {TN} tn */
export function activate(tn) {
  tn.accounts.register({
    async login({ username = "" }) {
      const name = username.trim();
      if (!USERNAME.test(name)) {
        throw new Error("Player name must be 3–16 letters, digits or underscores");
      }
      return { name, uuid: offlineUuid(name) };
    },

    async session(account) {
      return { name: account.name, uuid: account.uuid, token: "0", userType: "legacy" };
    },
  });
}
