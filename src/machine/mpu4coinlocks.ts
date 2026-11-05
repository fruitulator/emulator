
export interface Mpu4CoinLocks {
  form: 'offset4' | 'offset5' | 'shifted' | 'enableFlag' | 'whole' | 'slots' | 'creditLimit';
  at: number;
  records: readonly { input: number; lock: number }[];
  every?: number;
  whenAll?: boolean;
}

const PORT_HI = 0x0c;
const PORT_LO = 0x02;

function findAll(rom: Uint8Array, pat: readonly number[], end = rom.length): number[] {
  const out: number[] = [];
  outer: for (let i = 0; i + pat.length <= end; i++) {
    for (let j = 0; j < pat.length; j++) if (pat[j]! >= 0 && rom[i + j] !== pat[j]) continue outer;
    out.push(i);
  }
  return out;
}

const pageOf = (i: number): number => i - (i % 0x10000);
const word = (rom: Uint8Array, i: number): number => (rom[i]! << 8) | rom[i + 1]!;

function offset4(rom: Uint8Array): Mpu4CoinLocks | null {
  const test = findAll(rom, [0xb6, PORT_HI, PORT_LO, 0xa4, 0x04]);
  if (!test.length) return null;
  for (const at of test) {
    const page = pageOf(at);
    for (const s of findAll(rom.subarray(page, page + 0x10000), [0x8e, -1, -1, 0xa1, 0x85, 0x27, -1, 0x30, 0x88, -1, 0x8c])) {
      const table = word(rom, page + s + 1);
      const stride = rom[page + s + 9]!;
      const end = word(rom, page + s + 11);
      if (stride < 5 || end <= table || end - table > stride * 16) continue;
      const records: { input: number; lock: number }[] = [];
      for (let p = table; p < end; p += stride) records.push({ input: rom[page + p + 3]!, lock: rom[page + p + 4]! });
      for (let p = table; p < end; p += stride) records.push({ input: rom[page + p + 2]!, lock: rom[page + p + 4]! });
      return { form: 'offset4', at: page + s, records };
    }
  }
  return null;
}

function offset5(rom: Uint8Array): Mpu4CoinLocks | null {
  const ports = findAll(rom, [PORT_HI, PORT_LO]).filter((p) => {
    const lock = rom[p + 3]!;
    return lock !== 0 && (lock & 0xf0) === 0 && rom[p + 2] !== 0;
  });
  for (let i = 0; i + 2 < ports.length; i++) {
    const stride = ports[i + 1]! - ports[i]!;
    if (stride < 7 || stride > 32 || ports[i + 2]! - ports[i + 1]! !== stride) continue;
    const first = ports[i]!;
    const page = pageOf(first);
    const table = first - page - 2;
    if (!findAll(rom.subarray(page, page + 0x10000), [0x8e, table >> 8, table & 0xff]).length) continue;
    if (!findAll(rom.subarray(page, page + 0x10000), [0xa4, 0x05]).length) continue;
    const records: { input: number; lock: number }[] = [];
    for (let p = first; rom[p] === PORT_HI && rom[p + 1] === PORT_LO; p += stride) {
      records.push({ input: rom[p + 2]!, lock: rom[p + 3]! });
    }
    return { form: 'offset5', at: first - 2, records };
  }
  return null;
}

function shifted(rom: Uint8Array): Mpu4CoinLocks | null {
  const [at] = findAll(rom, [0xb6, PORT_HI, PORT_LO, 0x84, -1, 0x48, 0x48, 0x48, 0x48, 0xb4]);
  if (at === undefined) return null;
  const m = rom[at + 4]!;
  const records: { input: number; lock: number }[] = [];
  for (let k = 0; k < 4; k++) if (m & (1 << k)) records.push({ input: 1 << (k + 4), lock: 1 << k });
  return records.length ? { form: 'shifted', at, records } : null;
}

function enableFlag(rom: Uint8Array): Mpu4CoinLocks | null {
  for (const [head, keep, every] of [[[0x43, 0x84, 0x01], 0xfe, 0x01], [[0x8d, 0x15], 0xfc, 0x03]] as const) {
    for (const at of findAll(rom, [...head, 0x34, 0x01, 0x34, 0x02, 0x86, keep, 0x1a, 0x10, 0xb4])) {
      const shadow = at + head.length + 9;
      const store = [0xaa, 0xe0, 0xb7, rom[shadow]!, rom[shadow + 1]!, 0xb7, PORT_HI, PORT_LO];
      if (store.some((v, j) => rom[shadow + 2 + j] !== v)) continue;
      const page = pageOf(at);
      const here = at - page;
      const body = rom.subarray(page, page + 0x10000);
      const entries = [here, ...findAll(body, [0x7e, here >> 8, here & 0xff])];
      for (const e of entries) {
        for (const call of findAll(body, [0xb7, -1, -1, 0xbd, e >> 8, e & 0xff, 0xc6, 0x0f, 0x7d])) {
          if (body[call + 1] === body[call + 9] && body[call + 2] === body[call + 10]) {
            return { form: 'enableFlag', at, records: [], every };
          }
        }
      }
    }
  }
  return null;
}

function whole(rom: Uint8Array): Mpu4CoinLocks | null {
  const end = Math.min(rom.length, 0x10000);
  const stores = [...findAll(rom, [0xb7, PORT_HI, PORT_LO], end), ...findAll(rom, [0xf7, PORT_HI, PORT_LO], end)];
  if (stores.length < 2) return null;
  const seen = new Set<number>();
  for (const s of stores) {
    const reg = rom[s] === 0xb7 ? 0x86 : 0xc6;
    if (rom[s - 2] !== reg || (rom[s - 1] !== 0x0f && rom[s - 1] !== 0x00)) return null;
    seen.add(rom[s - 1]!);
  }
  if (seen.size !== 2) return null;
  const [poll] = findAll(rom, [0xb6, PORT_HI, PORT_LO, 0x7d], end);
  if (poll === undefined) return null;
  return { form: 'whole', at: stores[0]!, records: [], every: 0x0f };
}

function slots(rom: Uint8Array): Mpu4CoinLocks | null {
  const [test] = findAll(rom, [0x10, 0xae, 0x02, 0xa6, 0x04, 0xe6, 0x05, 0x54, 0xa4, 0xa4]);
  if (test === undefined) return null;
  const page = pageOf(test);
  for (let s = test - page - 1; s >= 8 && s > test - page - 0x40; s--) {
    const b = page + s;
    if (rom[b] !== 0x8e || rom[b + 3] !== 0x7d || rom[b + 6] !== 0x26 || rom[b + 8] !== 0x8e) continue;
    const flag = rom[page + word(rom, b + 4)];
    const table = flag ? word(rom, b + 1) : word(rom, b + 9);
    const records: { input: number; lock: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const r = page + table + 9 * k;
      if (word(rom, r + 2) === (PORT_HI << 8 | PORT_LO) && rom[r + 5] === 0) {
        records.push({ input: 1 << k, lock: rom[r + 4]! });
      }
    }
    return records.length ? { form: 'slots', at: page + table, records } : null;
  }
  return null;
}

function creditLimit(rom: Uint8Array): Mpu4CoinLocks | null {
  for (const store of findAll(rom, [0xc4, 0x0f, 0x53, 0xf7, PORT_HI, PORT_LO])) {
    const from = Math.max(0, store - 0x30);
    const [head] = findAll(
      rom.subarray(from, store),
      [0x5f, 0xbe, -1, -1, 0xb6, -1, -1, 0xa1, 0x88, -1, 0x22, -1, 0xe6, 0x88, -1],
    );
    if (head !== undefined) return { form: 'creditLimit', at: from + head, records: [], every: 0x0f, whenAll: true };
  }
  return null;
}

const read = new WeakMap<Uint8Array, Mpu4CoinLocks | null>();
const live = new WeakMap<Uint8Array, readonly { input: number; lock: number }[] | null>();

export function readMpu4CoinLocks(rom: Uint8Array, hasTable: (rom: Uint8Array) => unknown): Mpu4CoinLocks | null {
  let r = read.get(rom);
  if (r === undefined) {
    r = hasTable(rom) ? null
      : offset4(rom) ?? offset5(rom) ?? shifted(rom) ?? enableFlag(rom) ?? whole(rom) ?? slots(rom) ?? creditLimit(rom);
    read.set(rom, r);
  }
  return r;
}

export function readMpu4LiveCoinRecords(rom: Uint8Array): readonly { input: number; lock: number }[] | null {
  let r = live.get(rom);
  if (r === undefined) {
    r = null;
    for (const s of findAll(rom, [0x8e, -1, -1, 0x10, 0x8e, -1, -1, 0xe6, 0x08])) {
      const page = pageOf(s);
      const table = page + word(rom, s + 1);
      if (rom[table + 2] !== PORT_HI || rom[table + 3] !== PORT_LO) continue;
      const records: { input: number; lock: number }[] = [];
      for (let p = table; rom[p + 2] === PORT_HI && rom[p + 3] === PORT_LO; p += 9) {
        records.push({ input: rom[p + 8]!, lock: rom[p + 4]! });
      }
      r = records;
      break;
    }
    live.set(rom, r);
  }
  return r;
}

export function mpu4CoinLockFor(locks: Mpu4CoinLocks, input: number): number | null {
  if (locks.every !== undefined) return locks.every;
  return locks.records.find((r) => r.input === input)?.lock ?? null;
}
