import { readFitSet, type Quad } from './fit';
import { listGames, type GameMeta, type StateRec } from '../web/store';
import { byContentKey } from '../web/contentkeys';
import { rekeyHolders } from './restamp';
import { machineTitle } from './machinelist';
import {
  ARCADE_MAX_MACHINES, fromBase64, fromMachineState, onFloor, switchedOff, toMachineState, traceId, turnOf,
  type ArcadeDoc, type MachineConfig, type MachineSetup, type MachineSource, type Place,
} from './doc';
import { currentArcade, getArcade, getMachineState, putMachineState, updateMachineMoney, updateMachineStats } from './docstore';
import { addLost, addReading, readCredit, readMoneyRecord, sameRun, startingRecord, type MoneyRecord } from './moneyrecord';
import type { CashLedger } from '../src/machine/machine';
import type { StateStore } from '../web/statestore';
import { devPlayerForPage, remoteSlot, serverFlag } from './remote';
import type { CreditSince, RelayBatch } from './serverwire';
import type { Balance, CoinCounts } from './wallet';
import type { GameConfig } from '../src/machine/registry';
import type { HostFile } from '../web/hostfiles';

export interface StateSlot {
  load(stamp?: string): Promise<StateRec | null | 'version' | SlotBattery>;
  save(rec: StateRec, money?: CashLedger | null, coins?: CoinCounts, credit?: CreditSince | null, coinsStopped?: boolean): Promise<SaveResult | void>;
  visited?(): void;
  left?(ledger: CashLedger | null): void;
  money?: MoneyHooks;
  claim?(on: ClaimEvents, from?: ClaimFrom): Promise<ClaimResult>;
  visit?(on: VisitEvents, stamp?: string): Promise<Visit>;
  restart?(rec: StateRec, from: { base: number; kept: boolean; ledger: CashLedger | null }): Promise<number | null>;
  here?(): void;
  paused?(on: boolean): void;
  release?(): Promise<void>;
  log?(b: RelayBatch): void;
  relay?(b: RelayBatch): void;
  keyframe?(k: SlotKeyframe): void;
  watch?(on: WatchEvents): WatchHandle;
}

export interface MoneyHooks {
  start(ledger: CashLedger | null): void;
  reading(ledger: CashLedger | null): void;
  lost(version: number | null): void;
}

export interface Visit {
  holder: 'you' | 'other' | null;
  holderName?: string;
  rec: StateRec | null;
  why?: 'none' | 'version' | 'battery';
  nvram?: Uint8Array;
  base: number;
  stop(): void;
}

export interface ClaimFrom { base: number; fresh: boolean; ledger?: CashLedger | null; kept?: boolean }

export interface SlotBattery { battery: Uint8Array }

export type ClaimResult = true | 'moved' | { busy: true; holderName: string | null };

export interface VisitEvents {
  holder(h: 'you' | 'other' | null, name?: string | null): void;
}

export interface SaveResult { wallet?: Balance }

export interface SlotKeyframe {
  session: string; cycle: number; seq: number; hash: string; signals: string; data: Uint8Array;
}

export interface WatchEvents {
  holder(player: string | null): void;
  paused?(on: boolean): void;
  watching(why: null | 'free' | 'yours'): void;
  relay(b: RelayBatch): void;
  key(k: SlotKeyframe): void;
  dropped(): void;
  back(): void;
}

export interface WatchHandle {
  stop(): void;
  again(): void;
}

export interface ClaimEvents {
  holderName?(name: string | null): void;
  lost(): void;
  dropped?(holdMs: number): void;
  back?(): void;
  lapsed?(): void;
  watchers?(n: number): void;
  keyAsk?(): void;
}

export function arcadeStateStore(arcadeId: string): StateStore {
  return {
    get: async (machine) => {
      const st = await getMachineState(arcadeId, machine);
      return st ? fromMachineState(st, machine) : null;
    },
    put: async (machine, rec) => {
      if (!(await putMachineState(arcadeId, machine, toMachineState(rec)))) {
        throw new Error('this machine is no longer in the arcade');
      }
    },
    delete: async (machine) => { await putMachineState(arcadeId, machine, null); },
    keys: async () => new Set(
      ((await getArcade(arcadeId))?.machines ?? []).filter((m) => m.state).map((m) => m.id),
    ),
  };
}

export function arcadeSlot(arcadeId: string, machine: string): StateSlot {
  const store = arcadeStateStore(arcadeId);
  const money = docMoney(arcadeId, machine);
  return {
    load: () => store.get(machine),
    save: async (rec, _money, _coins, credit) => {
      const st = toMachineState(rec);
      if (credit) st.sinceGame = { inPence: credit.inPence, tokenInPence: credit.tokenInPence };
      if (!(await putMachineState(arcadeId, machine, st))) throw new Error('this machine is no longer in the arcade');
    },
    visited: () => {
      void updateMachineStats(arcadeId, machine, (s) => ({ ...s, plays: s.plays + 1, lastPlayedAt: Date.now() }))
        .catch((e) => console.warn('[arcade] play count failed', e));
    },
    left: (ledger) => {
      if (!ledger) return;
      money.reading(ledger);
      void updateMachineStats(arcadeId, machine, (s) => ({ ...s, ledger, ledgerAt: Date.now() }))
        .catch((e) => console.warn('[arcade] money reading failed', e));
    },
    money,
  };
}

export function docMoney(arcadeId: string, machine: string): MoneyHooks {
  let run: CashLedger | null = null;
  let begun = false;
  const write = (f: (rec: MoneyRecord) => MoneyRecord): void => {
    const now = Date.now();
    void updateMachineMoney(arcadeId, machine, (m) => f(readMoneyRecord(m.moneyRecord, now) ?? startingRecord(m, now)))
      .catch((e) => console.warn('[arcade] the money record could not be written', e));
  };
  return {
    start: (ledger) => {
      run = ledger ? { ...ledger } : null;
      begun = true;
      write((rec) => rec);
    },
    reading: (ledger) => {
      if (!ledger || !begun) return;
      const from = run;
      if (from && sameRun(from, ledger) && sameRun(ledger, from)) return;
      run = { ...ledger };
      write((rec) => addReading(rec, from, ledger, Date.now()));
    },
    lost: (version) => {
      const now = Date.now();
      void updateMachineMoney(arcadeId, machine, (m) => {
        const rec = readMoneyRecord(m.moneyRecord, now) ?? startingRecord(m, now);
        const st = m.state;
        if (!st) return rec;
        return addLost(rec, { at: now, savedAt: st.savedAt, version: version ?? 0, n: 0, sinceGame: readCredit(st.sinceGame) });
      }).catch((e) => console.warn('[arcade] the money record could not be written', e));
    },
  };
}

export interface MachineLook {
  glass: Quad;
  buttons: Quad;
  deck: Quad;
  trim: string;
}

export function trimFor(contentHash: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < contentHash.length; i++) h = Math.imul(h ^ contentHash.charCodeAt(i), 0x01000193) >>> 0;
  const hue = (h % 360) / 360;
  const sat = 0.65 + ((h >>> 9) % 30) / 100;
  const light = 0.45 + ((h >>> 17) % 15) / 100;
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const ch = (t: number): number => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return `#${[ch(hue + 1 / 3), ch(hue), ch(hue - 1 / 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export interface ArcadeMachine {
  id: string;
  contentHash: string;
  formerContentHashes: string[];
  name: string;
  board: string;
  cabinetStyle: string | null;
  traceUrl: string | null;
  traceBytes?: () => Promise<Uint8Array>;
  held: GameMeta | null;
  setup: MachineSetup;
  config: MachineConfig;
  slot?: StateSlot;
  installing?: boolean;
  otherVersion?: boolean;
  outOfService?: boolean;
  hostFiles?: HostFile[];
  gameConfig?: GameConfig | null;
  versions?: number;
  source?: MachineSource;
  place?: Place;
}

export function arcadeName(doc: ArcadeDoc | null): string | null {
  const q = new URLSearchParams(location.search);
  if (q.has('name')) return cleanName(q.get('name'));
  return cleanName(doc?.name);
}

export function cleanName(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? [...t].slice(0, ARCADE_NAME_MAX).join('') : null;
}

export const ARCADE_NAME_MAX = 40;

export async function loadMachines(doc?: ArcadeDoc | null, o: { visiting?: boolean } = {}): Promise<ArcadeMachine[]> {
  const [arcade, library] = await Promise.all([
    doc === undefined ? currentArcade() : Promise.resolve(doc),
    listGames().catch(() => [] as GameMeta[]),
  ]);
  if (!arcade) return [];
  const server = serverFlag();
  const player = server ? await devPlayerForPage() : '';
  if (server) console.info(`[arcade] playing against the arcade server at ${server} as ${player}`);
  const byContent = byContentKey(await rekeyHolders(library, onFloor(arcade)));
  const programs = new Set(library.map((g) => g.programHash).filter((p): p is string => !!p));
  const visiting = !!o.visiting;
  const out = onFloor(arcade).map((m): ArcadeMachine => {
    const t = m.trace;
    const formers = m.formerContentHashes ?? [];
    const mine = [m.contentHash, ...formers].map((k) => byContent.get(k)).find((g) => !!g) ?? null;
    return {
      id: m.id,
      contentHash: m.contentHash,
      formerContentHashes: formers,
      name: machineTitle(m.name, mine),
      board: m.board,
      cabinetStyle: m.detected?.cabinetStyle ?? null,
      traceUrl: t ? `doc:${m.contentHash}:${traceId(t)}` : null,
      traceBytes: t ? () => Promise.resolve(fromBase64(t.data)) : undefined,
      held: switchedOff(m) || m.status !== 'installed' ? null : mine,
      outOfService: !!m.outOfService || (m.status === 'installed' && switchedOff(m)),
      ...(m.hostFiles ? { hostFiles: m.hostFiles } : {}),
      ...(m.gameConfig !== undefined ? { gameConfig: m.gameConfig } : {}),
      ...(m.versions !== undefined ? { versions: m.versions } : {}),
      installing: m.status !== 'installed',
      ...(!mine && m.programHash && programs.has(m.programHash) ? { otherVersion: true } : {}),
      ...(m.source ? { source: m.source } : {}),
      setup: readSetup(m.setup ?? {}),
      config: m.config ?? {},
      slot: server
        ? visiting
          ? remoteSlot({ server, arcadeId: arcade.id, machine: m.id, player })
          : {
            ...arcadeSlot(arcade.id, m.id),
            ...remoteSlot({ server, arcadeId: arcade.id, machine: m.id, player, seedFrom: () => arcadeStateStore(arcade.id).get(m.id) }),
            money: undefined,
          }
        : visiting ? undefined : arcadeSlot(arcade.id, m.id),
      place: turnOf(m.place) ? { col: m.place.col, row: m.place.row, turn: turnOf(m.place) } : { col: m.place.col, row: m.place.row },
    };
  });
  const n = roomSize();
  if (out.length > n) console.info(`[arcade] ?machines=${n}: ${out.length - n} of this arcade's machines left out`);
  return out.slice(0, n);
}

function readSetup(s: MachineSetup): MachineSetup {
  const out = readFitSet(s);
  delete (out as { mounts?: unknown }).mounts;
  return out;
}

function roomSize(): number {
  const n = Number(new URLSearchParams(location.search).get('machines'));
  return Number.isInteger(n) && n > 0 ? Math.min(n, ARCADE_MAX_MACHINES) : ARCADE_MAX_MACHINES;
}
