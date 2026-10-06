import { unzlibSync } from 'fflate';

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(() => {
  const mul = (a: number, b: number): number => {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  };
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x = mul(x, 3);
  }
  const inv = (a: number): number => (a === 0 ? 0 : exp[(255 - log[a]) % 255]);
  for (let i = 0; i < 256; i++) {
    let s = inv(i);
    let xf = s;
    for (let k = 0; k < 4; k++) {
      xf = ((xf << 1) | (xf >> 7)) & 0xff;
      s ^= xf;
    }
    s ^= 0x63;
    SBOX[i] = s;
    INV_SBOX[s] = i;
  }
})();

function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}
function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return p & 0xff;
}

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function expandKey(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(176);
  w.set(key.subarray(0, 16));
  for (let i = 16, r = 0; i < 176; i += 4) {
    let a = w[i - 4], b = w[i - 3], c = w[i - 2], d = w[i - 1];
    if (i % 16 === 0) {
      [a, b, c, d] = [SBOX[b] ^ RCON[r++], SBOX[c], SBOX[d], SBOX[a]];
    }
    w[i] = w[i - 16] ^ a;
    w[i + 1] = w[i - 15] ^ b;
    w[i + 2] = w[i - 14] ^ c;
    w[i + 3] = w[i - 13] ^ d;
  }
  return w;
}

function encryptBlock(rk: Uint8Array, input: Uint8Array, inOff = 0): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[inOff + i] ^ rk[i];
  for (let round = 1; round < 10; round++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    shiftRows(s);
    mixColumns(s);
    for (let i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
  }
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
  shiftRows(s);
  for (let i = 0; i < 16; i++) s[i] ^= rk[160 + i];
  return s;
}

function decryptBlock(rk: Uint8Array, input: Uint8Array, inOff = 0): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[inOff + i] ^ rk[160 + i];
  for (let round = 9; round > 0; round--) {
    invShiftRows(s);
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    for (let i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
    invMixColumns(s);
  }
  invShiftRows(s);
  for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
  for (let i = 0; i < 16; i++) s[i] ^= rk[i];
  return s;
}

function shiftRows(s: Uint8Array): void {
  const t = s.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) s[c * 4 + r] = t[((c + r) % 4) * 4 + r];
  }
}
function invShiftRows(s: Uint8Array): void {
  const t = s.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) s[c * 4 + r] = t[((c - r + 4) % 4) * 4 + r];
  }
}
function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const o = c * 4;
    const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
    s[o] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
    s[o + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
    s[o + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
    s[o + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
  }
}
function invMixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const o = c * 4;
    const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
    s[o] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    s[o + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    s[o + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    s[o + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

const rol = (v: number, n: number): number => ((v << n) | (v >>> (32 - n))) >>> 0;
const F1 = (x: number, y: number, z: number) => (x ^ y ^ z) >>> 0;
const F2 = (x: number, y: number, z: number) => ((x & y) | (~x & z)) >>> 0;
const F3 = (x: number, y: number, z: number) => ((x | ~y) ^ z) >>> 0;
const F4 = (x: number, y: number, z: number) => ((x & z) | (y & ~z)) >>> 0;

const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x00000000];
const WL = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2];
const WR = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14];
const SL = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12];
const SR = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8];

export function ripemd128(data: Uint8Array): Uint8Array {
  const ml = data.length * 8;
  const padLen = ((56 - (data.length + 1) % 64) + 64) % 64;
  const total = data.length + 1 + padLen + 8;
  const p = new Uint8Array(total);
  p.set(data);
  p[data.length] = 0x80;
  const dv = new DataView(p.buffer);
  dv.setUint32(total - 8, ml >>> 0, true);
  dv.setUint32(total - 4, Math.floor(ml / 0x100000000), true);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  const X = new Uint32Array(16);
  const fns = [F1, F2, F3, F4];
  const fnsR = [F4, F3, F2, F1];

  for (let i = 0; i < total; i += 64) {
    for (let k = 0; k < 16; k++) X[k] = dv.getUint32(i + k * 4, true);
    let al = h0, bl = h1, cl = h2, dl = h3;
    let ar = h0, br = h1, cr = h2, dr = h3;
    for (let j = 0; j < 64; j++) {
      const round = j >> 4;
      let t = (al + fns[round](bl, cl, dl) + X[WL[j]] + KL[round]) >>> 0;
      t = rol(t, SL[j]);
      al = dl; dl = cl; cl = bl; bl = t;
      t = (ar + fnsR[round](br, cr, dr) + X[WR[j]] + KR[round]) >>> 0;
      t = rol(t, SR[j]);
      ar = dr; dr = cr; cr = br; br = t;
    }
    const tmp = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + ar) >>> 0;
    h2 = (h3 + al + br) >>> 0;
    h3 = (h0 + bl + cr) >>> 0;
    h0 = tmp;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0, true);
  odv.setUint32(4, h1, true);
  odv.setUint32(8, h2, true);
  odv.setUint32(12, h3, true);
  return out;
}

const u32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

const CRC_SLICE = ((): Uint32Array[] => {
  const tables = [CRC_TABLE];
  for (let k = 1; k < 8; k++) {
    const prev = tables[k - 1];
    const next = new Uint32Array(256);
    for (let n = 0; n < 256; n++) next[n] = (prev[n] >>> 8) ^ CRC_TABLE[prev[n] & 255];
    tables.push(next);
  }
  return tables;
})();

export function chunkCrc32(d: Uint8Array): number {
  let c = 0;
  let i = 0;
  const n = d.length;
  const end = n - (n % 8);
  const [t0, t1, t2, t3, t4, t5, t6, t7] = CRC_SLICE;
  for (; i < end; i += 8) {
    c ^= d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24);
    c = t7[c & 255] ^ t6[(c >>> 8) & 255] ^ t5[(c >>> 16) & 255] ^ t4[(c >>> 24) & 255]
      ^ t3[d[i + 4]] ^ t2[d[i + 5]] ^ t1[d[i + 6]] ^ t0[d[i + 7]];
  }
  for (; i < n; i++) c = CRC_TABLE[(c ^ d[i]) & 255] ^ (c >>> 8);
  return c >>> 0;
}

const PHASE1_PASSWORD = 'b67de657';

function mix(last4: number): number {
  let result = last4 >>> 0;
  const addr = 0x00c59a00;
  for (let i = 0; i < 100; i++) {
    const x = (addr ^ result) >>> 0;
    const v4 = (((x >>> 24) | (x << 24)) | (x & 0x00ffff00)) >>> 0;
    result = ((v4 << 3) | (v4 >>> 29)) >>> 0;
  }
  return result >>> 0;
}

function lastNextHeaderOffset(b: Uint8Array): number {
  let pos = 128;
  let last = 0;
  for (let guard = 0; guard < 10000 && pos + 16 <= b.length; guard++) {
    const next = u32(b, pos + 12);
    last = next;
    if (next >= b.length || next <= pos || next + 16 > b.length) break;
    pos = next;
  }
  return last;
}

function derivePassword(b: Uint8Array): string {
  const last = lastNextHeaderOffset(b);
  if (last === b.length) return PHASE1_PASSWORD;
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, '0');
  if (last === b.length - 4) return hex(mix(u32(b, b.length - 4)));
  return hex(mix(u32(b, b.length - 4)));
}

const MUL9 = new Uint8Array(256);
const MUL11 = new Uint8Array(256);
const MUL13 = new Uint8Array(256);
const MUL14 = new Uint8Array(256);
const TD0 = new Uint32Array(256);
const TD1 = new Uint32Array(256);
const TD2 = new Uint32Array(256);
const TD3 = new Uint32Array(256);
(() => {
  for (let x = 0; x < 256; x++) {
    MUL9[x] = gmul(x, 9);
    MUL11[x] = gmul(x, 11);
    MUL13[x] = gmul(x, 13);
    MUL14[x] = gmul(x, 14);
  }
  for (let x = 0; x < 256; x++) {
    const is = INV_SBOX[x];
    const w = ((MUL14[is] << 24) | (MUL9[is] << 16) | (MUL13[is] << 8) | MUL11[is]) >>> 0;
    TD0[x] = w;
    TD1[x] = ((w >>> 8) | (w << 24)) >>> 0;
    TD2[x] = ((w >>> 16) | (w << 16)) >>> 0;
    TD3[x] = ((w >>> 24) | (w << 8)) >>> 0;
  }
})();

function beWord(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function decSchedule(rk: Uint8Array): Uint32Array {
  const dk = new Uint32Array(44);
  for (let i = 0; i < 44; i++) dk[i] = beWord(rk, i * 4);
  for (let i = 4; i < 40; i++) {
    const w = dk[i];
    const b0 = w >>> 24, b1 = (w >>> 16) & 255, b2 = (w >>> 8) & 255, b3 = w & 255;
    dk[i] = (((MUL14[b0] ^ MUL11[b1] ^ MUL13[b2] ^ MUL9[b3]) << 24)
      | ((MUL9[b0] ^ MUL14[b1] ^ MUL11[b2] ^ MUL13[b3]) << 16)
      | ((MUL13[b0] ^ MUL9[b1] ^ MUL14[b2] ^ MUL11[b3]) << 8)
      | (MUL11[b0] ^ MUL13[b1] ^ MUL9[b2] ^ MUL14[b3])) >>> 0;
  }
  return dk;
}

function eclDecrypt(src: Uint8Array, off: number, len: number, rk: Uint8Array, iv: Uint8Array, out: Uint8Array): void {
  const dk = decSchedule(rk);
  let f0 = beWord(iv, 0), f1 = beWord(iv, 4), f2 = beWord(iv, 8), f3 = beWord(iv, 12);
  const full = len - (len % 16);
  let w = 0;
  for (let i = 0; i < full; i += 16) {
    const si = off + i;
    const c0 = beWord(src, si), c1 = beWord(src, si + 4);
    const c2 = beWord(src, si + 8), c3 = beWord(src, si + 12);
    let s0 = (c0 ^ dk[40]) >>> 0, s1 = (c1 ^ dk[41]) >>> 0;
    let s2 = (c2 ^ dk[42]) >>> 0, s3 = (c3 ^ dk[43]) >>> 0;
    for (let r = 9; r >= 1; r--) {
      const o = r * 4;
      const t0 = TD0[s0 >>> 24] ^ TD1[(s3 >>> 16) & 255] ^ TD2[(s2 >>> 8) & 255] ^ TD3[s1 & 255] ^ dk[o];
      const t1 = TD0[s1 >>> 24] ^ TD1[(s0 >>> 16) & 255] ^ TD2[(s3 >>> 8) & 255] ^ TD3[s2 & 255] ^ dk[o + 1];
      const t2 = TD0[s2 >>> 24] ^ TD1[(s1 >>> 16) & 255] ^ TD2[(s0 >>> 8) & 255] ^ TD3[s3 & 255] ^ dk[o + 2];
      const t3 = TD0[s3 >>> 24] ^ TD1[(s2 >>> 16) & 255] ^ TD2[(s1 >>> 8) & 255] ^ TD3[s0 & 255] ^ dk[o + 3];
      s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
    }
    const p0 = (((INV_SBOX[s0 >>> 24] << 24) | (INV_SBOX[(s3 >>> 16) & 255] << 16)
      | (INV_SBOX[(s2 >>> 8) & 255] << 8) | INV_SBOX[s1 & 255]) ^ dk[0]) >>> 0;
    const p1 = (((INV_SBOX[s1 >>> 24] << 24) | (INV_SBOX[(s0 >>> 16) & 255] << 16)
      | (INV_SBOX[(s3 >>> 8) & 255] << 8) | INV_SBOX[s2 & 255]) ^ dk[1]) >>> 0;
    const p2 = (((INV_SBOX[s2 >>> 24] << 24) | (INV_SBOX[(s1 >>> 16) & 255] << 16)
      | (INV_SBOX[(s0 >>> 8) & 255] << 8) | INV_SBOX[s3 & 255]) ^ dk[2]) >>> 0;
    const p3 = (((INV_SBOX[s3 >>> 24] << 24) | (INV_SBOX[(s2 >>> 16) & 255] << 16)
      | (INV_SBOX[(s1 >>> 8) & 255] << 8) | INV_SBOX[s0 & 255]) ^ dk[3]) >>> 0;
    const o0 = (p0 ^ f0) >>> 0, o1 = (p1 ^ f1) >>> 0, o2 = (p2 ^ f2) >>> 0, o3 = (p3 ^ f3) >>> 0;
    out[w++] = o0 >>> 24; out[w++] = (o0 >>> 16) & 255; out[w++] = (o0 >>> 8) & 255; out[w++] = o0 & 255;
    out[w++] = o1 >>> 24; out[w++] = (o1 >>> 16) & 255; out[w++] = (o1 >>> 8) & 255; out[w++] = o1 & 255;
    out[w++] = o2 >>> 24; out[w++] = (o2 >>> 16) & 255; out[w++] = (o2 >>> 8) & 255; out[w++] = o2 & 255;
    out[w++] = o3 >>> 24; out[w++] = (o3 >>> 16) & 255; out[w++] = (o3 >>> 8) & 255; out[w++] = o3 & 255;
    f0 = (c0 ^ f0) >>> 0; f1 = (c1 ^ f1) >>> 0; f2 = (c2 ^ f2) >>> 0; f3 = (c3 ^ f3) >>> 0;
  }
  const rem = len % 16;
  if (rem > 0) {
    const fb = new Uint8Array(16);
    fb[0] = f0 >>> 24; fb[1] = (f0 >>> 16) & 255; fb[2] = (f0 >>> 8) & 255; fb[3] = f0 & 255;
    fb[4] = f1 >>> 24; fb[5] = (f1 >>> 16) & 255; fb[6] = (f1 >>> 8) & 255; fb[7] = f1 & 255;
    fb[8] = f2 >>> 24; fb[9] = (f2 >>> 16) & 255; fb[10] = (f2 >>> 8) & 255; fb[11] = f2 & 255;
    fb[12] = f3 >>> 24; fb[13] = (f3 >>> 16) & 255; fb[14] = (f3 >>> 8) & 255; fb[15] = f3 & 255;
    const ks = encryptBlock(rk, fb);
    const tail = off + full;
    for (let j = 0; j < rem; j++) out[w++] = src[tail + j] ^ ks[j];
  }
}

function eclDecryptReference(src: Uint8Array, off: number, len: number, rk: Uint8Array, iv: Uint8Array, out: Uint8Array): void {
  let fbD = iv.slice();
  let fbB = new Uint8Array(16);
  const full = len - (len % 16);
  let w = 0;
  for (let i = 0; i < full; i += 16) {
    const si = off + i;
    for (let j = 0; j < 16; j++) fbB[j] = src[si + j] ^ fbD[j];
    const dec = decryptBlock(rk, src, si);
    for (let j = 0; j < 16; j++) out[w++] = dec[j] ^ fbD[j];
    const t = fbD; fbD = fbB; fbB = t;
  }
  const rem = len % 16;
  if (rem > 0) {
    const ks = encryptBlock(rk, fbD);
    const tail = off + full;
    for (let j = 0; j < rem; j++) out[w++] = src[tail + j] ^ ks[j];
  }
}

(() => {
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = i;
  const rk = expandKey(key);
  const ct = new Uint8Array([
    0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 0x04, 0x30,
    0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4, 0xc5, 0x5a,
  ]);
  const zeroIv = new Uint8Array(16);
  const one = new Uint8Array(16);
  eclDecrypt(ct, 0, 16, rk, zeroIv, one);
  for (let i = 0; i < 16; i++) {
    if (one[i] !== i * 0x11) throw new Error('fml: AES T-table self-check failed');
  }
  const buf = new Uint8Array(77);
  let x = 7;
  for (let i = 0; i < buf.length; i++) { x = (x * 133 + 41) & 0xff; buf[i] = x; }
  const iv = encryptBlock(rk, new Uint8Array(16).fill(0xff));
  const fast = new Uint8Array(buf.length);
  const ref = new Uint8Array(buf.length);
  eclDecrypt(buf, 0, buf.length, rk, iv, fast);
  eclDecryptReference(buf, 0, buf.length, rk, iv, ref);
  for (let i = 0; i < buf.length; i++) {
    if (fast[i] !== ref[i]) throw new Error('fml: ECL mode self-check failed');
  }
})();

export function isAacsContainer(b: Uint8Array): boolean {
  return b.length > 32 && b[0] === 0x41 && b[1] === 0x41 && b[2] === 0x43 && b[3] === 0x53;
}

export function isEncryptedFml(b: Uint8Array): boolean {
  return isAacsContainer(b) && b[22] === 0x01;
}

export interface AacsResult {
  payload: Uint8Array;
  encrypted: boolean;
  declaredChunks: number;
  readChunks: number;
  verified: boolean;
}

type ChunkDecrypt = ((src: Uint8Array, off: number, len: number, out: Uint8Array) => void) | null;

function walkChunks(b: Uint8Array, decrypt: ChunkDecrypt): { payload: Uint8Array; chunks: number; verified: boolean } {
  const parts: Uint8Array[] = [];
  let csize = u32(b, 128);
  let dsize = u32(b, 132);
  let crc = u32(b, 136);
  let pos = 144;
  let verified = true;
  const limit = decrypt ? b.length - 4 : b.length;
  while (pos < limit) {
    const ctLen = Math.min(csize, b.length - pos);
    if (ctLen === 0) break;
    let compressed: Uint8Array;
    if (decrypt) {
      compressed = new Uint8Array(ctLen);
      decrypt(b, pos, ctLen, compressed);
    } else {
      compressed = b.subarray(pos, pos + ctLen);
    }
    let inflated = unzlibSync(compressed);
    if (dsize > 0 && inflated.length > dsize) inflated = inflated.subarray(0, dsize);
    if (chunkCrc32(inflated) !== crc) {
      verified = false;
      throw new Error('AACS chunk CRC mismatch');
    }
    parts.push(inflated);
    pos += ctLen;
    if (pos + 16 > limit) break;
    csize = u32(b, pos);
    dsize = u32(b, pos + 4);
    crc = u32(b, pos + 8);
    pos += 16;
  }
  let len = 0;
  for (const p of parts) len += p.length;
  const payload = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { payload.set(p, o); o += p.length; }
  return { payload, chunks: parts.length, verified };
}

function keyMaterial(password: string): { rk: Uint8Array; iv: Uint8Array } {
  const key = ripemd128(new TextEncoder().encode(password));
  const rk = expandKey(key);
  const iv = encryptBlock(rk, new Uint8Array(16).fill(0xff));
  return { rk, iv };
}

const decoded = new WeakMap<Uint8Array, AacsResult | Error>();

export function readAacsContainer(b: Uint8Array): AacsResult {
  if (!isAacsContainer(b)) throw new Error('not an AACS layout container');
  const known = decoded.get(b);
  if (known instanceof Error) throw known;
  if (known) return known;
  try {
    const r = decodeAacs(b);
    decoded.set(b, r);
    return r;
  } catch (e) {
    decoded.set(b, e as Error);
    throw e;
  }
}

function decodeAacs(b: Uint8Array): AacsResult {
  const encrypted = b[22] === 0x01;
  const declaredChunks = u32(b, 12);

  if (!encrypted) {
    const { payload, chunks, verified } = walkChunks(b, null);
    return { payload, encrypted, declaredChunks, readChunks: chunks, verified };
  }

  const passwords = [derivePassword(b), PHASE1_PASSWORD];
  let lastErr: unknown;
  for (const password of passwords) {
    try {
      const { rk, iv } = keyMaterial(password);
      const { payload, chunks, verified } = walkChunks(
        b,
        (src, off, len, out) => eclDecrypt(src, off, len, rk, iv, out),
      );
      return { payload, encrypted, declaredChunks, readChunks: chunks, verified };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`FML decryption failed: ${(lastErr as Error)?.message ?? 'unknown'}`);
}

export function decryptFml(b: Uint8Array): Uint8Array {
  return readAacsContainer(b).payload;
}
