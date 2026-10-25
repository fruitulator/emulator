import { inflateSync, strFromU8 } from 'fflate';
import { SNAPSHOT_VERSION } from '../web/snapshot';
import type { StateRec } from '../web/store';
import { fromBase64, toBase64 } from './doc';
import { LiveLink, liveUrl, type LinkOptions } from './livelink';
import type {
  ClaimEvents, ClaimResult, ClaimFrom, SaveResult, SlotBattery, SlotKeyframe, StateSlot, Visit, VisitEvents, WatchEvents, WatchHandle,
} from './machines';
import {
  DEV_PLAYER_HEADER, KEY_PART_MAX, MACHINE_PATH, RESTART_OP, SEED_OP, VISIT_OP, WALLET_PATH,
  type AcquireReply, type ClaimBody, type CreditSince, type InputBody, type KeyPart, type Ledger, type LoadReply, type ReleaseReply, type RestartBody,
  type RestartReply, type SaveBody, type SaveReply, type SeedReply, type VisitReply, type WalletReply,
} from './serverwire';
import type { CashLedger } from '../src/machine/machine';
import type { CoinCounts, WalletServer } from './wallet';

export function heartbeatMs(leaseMs: number): number {
  return Math.max(1000, Math.min(20_000, Math.floor(leaseMs / 3)));
}

const INPUT_BATCH = 200;

export const DEV_SERVER_PROXY = '/arcade-server';

export const BUILT_SERVER: string | null = import.meta.env.MODE === 'live' ? DEV_SERVER_PROXY : null;

const SERVER_KEY = 'arcade-dev-server';

export function serverFlag(
  search: string = location.search,
  dev: boolean = import.meta.env.DEV,
  origin: string = globalThis.location?.origin ?? 'http://localhost',
  store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = session(),
  built: string | null = BUILT_SERVER,
): string | null {
  if (built) return new URL(built, origin).href.replace(/\/+$/, '');
  if (!dev) return null;
  let v = new URLSearchParams(search).get('server');
  if (v === 'off') {
    try { store?.removeItem(SERVER_KEY); } catch {  }
    return null;
  }
  if (v) {
    try { store?.setItem(SERVER_KEY, v); } catch {  }
  } else {
    try { v = store?.getItem(SERVER_KEY) ?? null; } catch { v = null; }
  }
  if (!v) return null;
  if (v === 'local') v = DEV_SERVER_PROXY;
  try {
    const u = v.startsWith('/') && !v.startsWith('//') ? new URL(v, origin) : new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function serverParam(
  search: string = location.search,
  dev: boolean = import.meta.env.DEV,
  store: Pick<Storage, 'getItem'> | null = session(),
): string | null {
  if (!dev) return null;
  const v = new URLSearchParams(search).get('server');
  if (v === 'off') return null;
  if (v) return v;
  try { return store?.getItem(SERVER_KEY) ?? null; } catch { return null; }
}

const PLAYER_KEY = 'arcade-dev-player';

export function devPlayer(search: string = location.search, store: Pick<Storage, 'getItem' | 'setItem'> | null = session()): string {
  const given = new URLSearchParams(search).get('player');
  if (given && /^[A-Za-z0-9_-]{1,64}$/.test(given)) {
    try { store?.setItem(PLAYER_KEY, given); } catch {  }
    return given;
  }
  try { return store?.getItem(PLAYER_KEY) ?? ''; } catch { return ''; }
}

export function devPlayerForPage(): Promise<string> {
  return Promise.resolve(devPlayer());
}

export function asPlayer(player: string, headers: Record<string, string> = {}): RequestInit {
  return { credentials: 'include', headers: { ...(player ? { [DEV_PLAYER_HEADER]: player } : {}), ...headers } };
}

function session(): Storage | null {
  try { return sessionStorage; } catch { return null; }
}

export interface RemoteOptions {
  server: string;
  arcadeId: string;
  machine: string;
  player: string;
  fetch?: typeof fetch;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  link?: Partial<LinkOptions>;
  seedFrom?: () => Promise<StateRec | null>;
}

export function machineUrl(server: string, arcadeId: string, machine: string): string {
  return `${server}${MACHINE_PATH}/${encodeURIComponent(arcadeId)}/${encodeURIComponent(machine)}`;
}

export function recVersion(rec: StateRec): number | null {
  try {
    const v = (JSON.parse(strFromU8(inflateSync(rec.data))) as { version?: unknown }).version;
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

export async function seedMachine(
  base: string, player: string, rec: StateRec, f: typeof fetch = (...a) => fetch(...a),
): Promise<SeedReply | null> {
  const version = recVersion(rec);
  if (version === null) return null;
  const body: SaveBody = { version, ...recFields(rec) };
  const res = await f(`${base}/${SEED_OP}`, {
    method: 'PUT', ...asPlayer(player, { 'content-type': 'application/json' }), body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`the arcade server answered ${res.status} to ${SEED_OP}`);
  return (await res.json()) as SeedReply;
}

function recFields(rec: StateRec): Omit<SaveBody, 'version'> {
  return {
    schema: rec.schema, savedAt: Math.round(rec.savedAt), cycles: Math.round(rec.cycles),
    ...(rec.build !== undefined ? { build: rec.build } : {}),
    ...(rec.stamp !== undefined ? { stamp: rec.stamp } : {}),
    ...(rec.nvram && rec.nvram.length > 0 ? { nvram: toBase64(rec.nvram) } : {}),
    data: toBase64(rec.data),
  };
}

function saveQuery(stamp: string | undefined): string {
  return `version=${SNAPSHOT_VERSION}${stamp ? `&stamp=${encodeURIComponent(stamp)}` : ''}`;
}

const LOAD_OP = 'save';

export function remoteSlot(o: RemoteOptions): StateSlot {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = o.now ?? (() => Date.now());
  const every = o.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopEvery = o.clearInterval ?? ((h) => clearInterval(h as number));
  const linkOpts: LinkOptions = {
    open: (url) => new WebSocket(url) as unknown as ReturnType<LinkOptions['open']>,
    now,
    setInterval: every,
    clearInterval: stopEvery,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as number),
    ...o.link,
  };
  const base = machineUrl(o.server, o.arcadeId, o.machine);
  let beat: unknown = null;
  let link: LiveLink | null = null;
  let visitLink: LiveLink | null = null;
  let held = false;
  let pausedNow = false;
  let pending: InputBody[] = [];

  const call = async <T>(op: string, method: string, body?: unknown): Promise<T> => {
    const res = await f(`${base}/${op}`, {
      method,
      ...asPlayer(o.player, body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 200) throw new Error(`the arcade server answered ${res.status} to ${op}`);
    return (await res.json()) as T;
  };

  const flush = async (): Promise<void> => {
    if (!held || !pending.length) return;
    const bodies = pending;
    pending = [];
    for (const b of bodies) {
      await call('input', 'POST', b).catch((e) => console.warn('[arcade] input log not sent', e));
    }
  };

  const stopVisit = (): void => {
    visitLink?.stop();
    visitLink = null;
  };

  const letGo = (): void => {
    if (beat !== null) stopEvery(beat);
    beat = null;
    link?.stop();
    link = null;
  };

  return {
    async claim(on: ClaimEvents, from?: ClaimFrom): Promise<ClaimResult> {
      const r = await call<AcquireReply>('acquire', 'POST', from
        ? ({
          base: from.base, fresh: from.fresh, ...(from.ledger ? { ledger: wireLedger(from.ledger) } : {}), ...(from.kept ? { kept: true } : {}),
        } satisfies ClaimBody)
        : undefined);
      if (!r.ok) return r.why === 'moved' ? 'moved' : { busy: true, holderName: r.holderName ?? null };
      stopVisit();
      held = true;
      pausedNow = false;
      pending = [];
      letGo();
      const ms = heartbeatMs(r.leaseMs);
      beat = every(() => { void flush(); }, ms);
      const end = (then: () => void) => () => { held = false; letGo(); then(); };
      link = new LiveLink(liveUrl(base, o.player), ms, {
        dropped: () => on.dropped?.(r.leaseMs),
        back: () => {
          if (pausedNow) link?.sendMsg({ type: 'paused', paused: true });
          on.back?.();
        },
        lapsed: end(() => (on.lapsed ?? on.lost)()),
        lost: end(() => on.lost()),
        presence: (p) => {
          on.watchers?.(p.watchers.length);
          if (!held && p.holder !== null) on.holderName?.(p.holderName ?? null);
        },
        keyAsk: () => on.keyAsk?.(),
      }, linkOpts);
      link.start();
      return true;
    },

    async visit(on: VisitEvents, stamp?: string): Promise<Visit> {
      stopVisit();
      let r = await call<VisitReply>(`${VISIT_OP}?${saveQuery(stamp)}`, 'GET');
      if (r.holder === null && !r.save && r.why !== 'version' && r.base === 0 && o.seedFrom) {
        const mine = await o.seedFrom().catch(() => null);
        const seeded = mine ? await seedMachine(base, o.player, mine, f).catch((e) => {
          console.warn('[arcade] could not give the server this machine\'s save', e);
          return null;
        }) : null;
        if (seeded?.ok) console.log('[arcade] the machine\'s own save in this arcade is now its save on the server');
        if (seeded) r = await call<VisitReply>(`${VISIT_OP}?${saveQuery(stamp)}`, 'GET');
      }
      if (!r.save && r.why === 'version') console.log('[arcade] the machine\'s last save is from another version: it starts fresh');
      if (!r.save && r.why === 'battery') console.log('[arcade] the machine\'s last save is from another emulation: it restarts from its battery');
      const s = r.save;
      const rec: StateRec | null = s
        ? {
          hash: o.machine, schema: s.schema, savedAt: s.savedAt, cycles: s.cycles,
          ...(s.build !== undefined ? { build: s.build } : {}),
          ...(s.stamp !== undefined ? { stamp: s.stamp } : {}),
          data: fromBase64(s.data),
        }
        : null;
      let mine: LiveLink | null = null;
      if (r.holder === null) {
        const link = new LiveLink(liveUrl(base, o.player), 0, {
          dropped: () => undefined,
          back: () => undefined,
          lapsed: () => undefined,
          lost: () => undefined,
          presence: (p) => {
            if (visitLink !== link) return;
            on.holder(p.holder === null ? null : p.holder === r.player ? 'you' : 'other', p.holderName ?? null);
          },
        }, linkOpts, 'visit');
        visitLink = mine = link;
        link.start();
      }
      return {
        holder: r.holder, ...(r.holderName === undefined ? {} : { holderName: r.holderName }),
        rec, base: r.base, ...(r.save ? {} : { why: r.why ?? 'none' }),
        ...(!r.save && r.why === 'battery' ? { nvram: fromBase64(r.nvram) } : {}),
        stop: () => { if (mine && visitLink === mine) stopVisit(); },
      };
    },

    here(): void {
      if (held) link?.sendMsg({ type: 'here' });
    },

    paused(on: boolean): void {
      if (!held || pausedNow === on) return;
      pausedNow = on;
      link?.sendMsg({ type: 'paused', paused: on });
    },

    async load(stamp?: string): Promise<StateRec | null | 'version' | SlotBattery> {
      const r = await call<LoadReply>(`${LOAD_OP}?${saveQuery(stamp)}`, 'GET');
      if (!r.ok) throw new Error('this machine is not ours to load');
      if (!r.save) {
        if (r.why === 'version') {
          console.log('[arcade] the machine\'s last save is from another version: it starts fresh');
          return 'version';
        }
        if (r.why === 'battery') {
          console.log('[arcade] the machine\'s last save is from another emulation: it restarts from its battery');
          return { battery: fromBase64(r.nvram) };
        }
        return null;
      }
      const s = r.save;
      return {
        hash: o.machine, schema: s.schema, savedAt: s.savedAt, cycles: s.cycles,
        ...(s.build !== undefined ? { build: s.build } : {}),
        ...(s.stamp !== undefined ? { stamp: s.stamp } : {}),
        data: fromBase64(s.data),
      };
    },

    async save(rec: StateRec, money?: CashLedger | null, coins?: CoinCounts, credit?: CreditSince | null, coinsStopped?: boolean): Promise<SaveResult> {
      const body: SaveBody = {
        version: SNAPSHOT_VERSION, ...recFields(rec),
        ...(money ? { ledger: wireLedger(money) } : {}),
        ...(coins && (coins.spent || coins.rejected) ? { coins: { spent: coins.spent, rejected: coins.rejected } } : {}),
        ...(credit ? { sinceGame: { inPence: credit.inPence, tokenInPence: credit.tokenInPence } } : {}),
        ...(coinsStopped !== undefined ? { coinsStopped } : {}),
      };
      const r = await call<SaveReply>('save', 'PUT', body);
      if (!r.ok) throw new Error('the machine was not ours to save');
      return r.wallet ? { wallet: r.wallet } : {};
    },

    async restart(rec, from): Promise<number | null> {
      const body: RestartBody = {
        version: SNAPSHOT_VERSION, ...recFields(rec), stamp: rec.stamp ?? '', base: from.base, kept: from.kept,
        ...(from.ledger ? { ledger: wireLedger(from.ledger) } : {}),
      };
      if (!body.stamp) return null;
      const r = await call<RestartReply>(RESTART_OP, 'PUT', body);
      return r.ok ? r.n : null;
    },

    async release(): Promise<void> {
      letGo();
      await flush();
      held = false;
      await call<ReleaseReply>('release', 'POST');
    },

    relay(b): void {
      if (held) link?.sendMsg({ type: 'relay', ...b });
    },

    keyframe(k: SlotKeyframe): void {
      if (!held || !link) return;
      for (const p of keyParts(k)) if (!link.sendMsg({ type: 'key', ...p })) return;
    },

    watch(on: WatchEvents): WatchHandle {
      const parts = new KeyAssembly();
      let watchLink: LiveLink | null = new LiveLink(liveUrl(base, o.player), 0, {
        dropped: () => on.dropped(),
        back: () => on.back(),
        lapsed: () => undefined,
        lost: () => undefined,
        presence: (p) => {
          on.holder(p.holder);
          on.paused?.(p.holder !== null && p.paused === true);
        },
        watching: (why) => on.watching(why),
        relay: (b) => on.relay(b),
        key: (k) => { const whole = parts.add(k); if (whole) on.key(whole); },
      }, linkOpts, 'watch');
      watchLink.start();
      return {
        stop: () => { watchLink?.stop(); watchLink = null; },
        again: () => { watchLink?.sendMsg({ type: 'watch' }); },
      };
    },

    log(b): void {
      if (!held || !b.inputs.length) return;
      const last = pending.at(-1);
      if (last?.session === b.session && last.inputs.length + b.inputs.length <= INPUT_BATCH) last.inputs.push(...b.inputs);
      else pending.push({ session: b.session, inputs: [...b.inputs] });
      if (pending.reduce((n, p) => n + p.inputs.length, 0) >= INPUT_BATCH) void flush();
    },
  };
}

export function wireLedger(l: CashLedger): Ledger {
  const out: Ledger = {
    inPence: l.inPence, outPence: l.outPence, unpricedOut: l.unpricedOut,
    tokenInPence: l.tokenInPence, tokenOutPence: l.tokenOutPence, unpricedTokenOut: l.unpricedTokenOut,
  };
  if (typeof l.unpricedTokenIn === 'number') out.unpricedTokenIn = l.unpricedTokenIn;
  if (typeof l.unpricedIn === 'number') out.unpricedIn = l.unpricedIn;
  if (typeof l.euroInCents === 'number') out.euroInCents = l.euroInCents;
  if (typeof l.euroOutCents === 'number') out.euroOutCents = l.euroOutCents;
  return out;
}

export function walletServer(server: string, player: string, f: typeof fetch = (...a) => fetch(...a)): WalletServer {
  const ask = async (path: string, method: 'GET') => {
    const res = await f(`${server}${path}`, { method, ...asPlayer(player) });
    if (res.status !== 200) throw new Error(`the arcade server answered ${res.status} to the wallet`);
    const r = (await res.json()) as WalletReply;
    return r.wallet;
  };
  return { balance: () => ask(WALLET_PATH, 'GET') };
}

export function keyParts(k: SlotKeyframe, max: number = KEY_PART_MAX): KeyPart[] {
  const data = toBase64(k.data);
  const parts = Math.max(1, Math.ceil(data.length / max));
  const out: KeyPart[] = [];
  for (let i = 0; i < parts; i++) {
    out.push({
      session: k.session, cycle: k.cycle, seq: k.seq, hash: k.hash, signals: k.signals,
      part: i, parts, data: data.slice(i * max, (i + 1) * max),
    });
  }
  return out;
}

export class KeyAssembly {
  private at: { key: string; parts: string[]; got: number } | null = null;

  add(p: KeyPart): SlotKeyframe | null {
    const key = `${p.session}/${p.cycle}/${p.seq}/${p.parts}`;
    if (this.at?.key !== key) this.at = { key, parts: new Array<string>(p.parts), got: 0 };
    const a = this.at;
    if (a.parts[p.part] === undefined) a.got++;
    a.parts[p.part] = p.data;
    if (a.got < p.parts) return null;
    this.at = null;
    return {
      session: p.session, cycle: p.cycle, seq: p.seq, hash: p.hash, signals: p.signals,
      data: fromBase64(a.parts.join('')),
    };
  }
}
