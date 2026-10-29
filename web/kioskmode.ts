
export const KIOSK_MODE_KEY = 'fruitulator.kioskMode';

export const PIN_TRIES = 3;
export const COOLDOWN_MS = 30_000;
export const PIN_LENGTH = 4;

interface LockRecord {
  salt: string;
  hash: string;
  alg: 'sha256' | 'fnv';
  fails: number;
  until: number;
}

function read(): LockRecord | null {
  try {
    const raw = localStorage.getItem(KIOSK_MODE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<LockRecord>;
    if (typeof r.salt !== 'string' || typeof r.hash !== 'string') return null;
    return {
      salt: r.salt, hash: r.hash, alg: r.alg === 'fnv' ? 'fnv' : 'sha256',
      fails: Number(r.fails) || 0, until: Number(r.until) || 0,
    };
  } catch {
    return null;
  }
}

function write(r: LockRecord | null): void {
  try {
    if (r) localStorage.setItem(KIOSK_MODE_KEY, JSON.stringify(r));
    else localStorage.removeItem(KIOSK_MODE_KEY);
  } catch {  }
}

let memory: LockRecord | null = null;
const current = (): LockRecord | null => read() ?? memory;
function save(r: LockRecord | null): void {
  memory = r;
  write(r);
  changed();
}

export function isLocked(): boolean {
  return current() !== null;
}

const listeners = new Set<(locked: boolean) => void>();
export function onKioskMode(fn: (locked: boolean) => void): void { listeners.add(fn); }
let told = isLocked();
function changed(): void {
  const locked = isLocked();
  if (locked === told) return;
  told = locked;
  for (const fn of listeners) fn(locked);
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KIOSK_MODE_KEY || e.key === null) changed(); });
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= round;
  }
  return h.toString(16).padStart(8, '0');
}

async function digest(alg: LockRecord['alg'], salt: string, pin: string): Promise<string> {
  const text = `${salt}:${pin}`;
  if (alg === 'fnv') return fnv(text);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(buf));
}

export async function lockWith(pin: string): Promise<void> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const alg: LockRecord['alg'] = globalThis.crypto?.subtle ? 'sha256' : 'fnv';
  save({ salt, hash: await digest(alg, salt, pin), alg, fails: 0, until: 0 });
}

export function cooldownLeft(now = Date.now()): number {
  const r = current();
  return r && r.until > now ? r.until - now : 0;
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; left: number }
  | { ok: false; wait: number };

export async function tryUnlock(pin: string, now = Date.now()): Promise<UnlockResult> {
  const r = current();
  if (!r) return { ok: true };
  if (r.until > now) return { ok: false, wait: r.until - now };
  if (await digest(r.alg, r.salt, pin) === r.hash) {
    save(null);
    return { ok: true };
  }
  const fails = (r.until ? 0 : r.fails) + 1;
  if (fails >= PIN_TRIES) {
    save({ ...r, fails: 0, until: now + COOLDOWN_MS });
    return { ok: false, wait: COOLDOWN_MS };
  }
  save({ ...r, fails, until: 0 });
  return { ok: false, left: PIN_TRIES - fails };
}
