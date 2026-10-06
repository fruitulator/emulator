
export type BnvKey = readonly number[];

export const BNV_NO_KEY: BnvKey = [0, 0, 0, 0, 0, 0];

const ROTATE_PLACES = 12;
const FEED_MASTER = 99;
const TAPS = [7, 4, 5, 3, 1, 2, 3, 2, 6, 1];

const reverse = (t: number): number =>
  (((t & 0x01) << 7) | ((t & 0x02) << 5) | ((t & 0x04) << 3) | ((t & 0x08) << 1) |
   ((t & 0x10) >> 1) | ((t & 0x20) >> 3) | ((t & 0x40) >> 5) | ((t & 0x80) >> 7)) & 0xff;

export function bnvEncrypt(key: BnvKey, data: number[]): void {
  const initXor = ~((key[0] << 4) | key[4]) & 0xff;
  for (let i = 0; i < data.length; i++) data[i] ^= initXor;

  for (let i = 0; i < data.length; i++) {
    if (key[3] & (1 << (i & 3))) data[i] = reverse(data[i]);
  }

  for (let i = 0; i < ROTATE_PLACES; i++) {
    let c1 = data[data.length - 1] & 0x01 ? 0x80 : 0;
    for (let j = 0; j < data.length; j++) {
      if (data[j] & (1 << TAPS[(key[1] + j) % 10])) c1 ^= 0x80;
    }
    for (let j = 0; j < data.length; j++) {
      let c = data[j] & 0x01 ? 0x80 : 0;
      if ((key[5] ^ FEED_MASTER) & (1 << ((i + j) % 8))) c ^= 0x80;
      data[j] = ((data[j] >>> 1) + c1) & 0xff;
      c1 = c;
    }
  }

  const finalXor = ((key[2] << 4) | key[2]) & 0xff;
  for (let i = 0; i < data.length; i++) data[i] ^= finalXor;
}

export function bnvDecrypt(key: BnvKey, data: number[]): void {
  const initXor = ((key[2] << 4) | key[2]) & 0xff;
  for (let i = 0; i < data.length; i++) data[i] ^= initXor;

  for (let i = ROTATE_PLACES - 1; i >= 0; i--) {
    let c1 = data[0] & 0x80 ? 1 : 0;
    for (let j = 0; j < data.length; j++) {
      if (data[j] & (1 << (TAPS[(key[1] + j) % 10] - 1))) c1 ^= 1;
    }
    for (let j = data.length - 1; j >= 0; j--) {
      let c = data[j] & 0x80 ? 1 : 0;
      if ((key[5] ^ FEED_MASTER) & (1 << ((i + j - 1) % 8))) c ^= 1;
      data[j] = ((data[j] << 1) + c1) & 0xff;
      c1 = c;
    }
  }

  for (let i = 0; i < data.length; i++) {
    if (key[3] & (1 << (i & 3))) data[i] = reverse(data[i]);
  }

  const finalXor = ~((key[0] << 4) | key[4]) & 0xff;
  for (let i = 0; i < data.length; i++) data[i] ^= finalXor;
}

export function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) {
      const bit = (b >> i) & 1;
      const top = (crc >> 15) & 1;
      crc = (crc << 1) & 0xffff;
      if (top ^ bit) crc ^= 0x1021;
    }
  }
  return crc;
}

export interface CcTalkMessage {
  header: number;
  data: number[];
}

export function bnvDecodeFrame(key: BnvKey, raw: readonly number[]): CcTalkMessage | null {
  if (raw.length < 5) return null;
  const dest = raw[0];
  const len = raw[1];
  if (raw.length !== len + 5) return null;

  const body = raw.slice(2);
  bnvDecrypt(key, body);

  const header = body[1];
  const data = body.slice(2, 2 + len);
  const sum = (body[body.length - 1] << 8) | body[0];
  if (crc16([dest, len, header, ...data]) !== sum) return null;
  return { header, data };
}

export function bnvEncodeFrame(
  key: BnvKey, dest: number, header: number, data: readonly number[],
): number[] {
  const sum = crc16([dest, data.length, header, ...data]);
  const body = [sum & 0xff, header, ...data, (sum >> 8) & 0xff];
  bnvEncrypt(key, body);
  return [dest, data.length, ...body];
}

export function bnvRecoverKey(raw: readonly number[]): BnvKey | null {
  const key = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 1_000_000; n++) {
    let v = n;
    for (let d = 5; d >= 0; d--) { key[d] = v % 10; v = (v / 10) | 0; }
    if (bnvDecodeFrame(key, raw)) return [...key];
  }
  return null;
}
