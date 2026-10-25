import type { CashLedger } from '../src/machine/machine';
import type { ArcadeDoc, DocMachine } from './doc';
import { asPlayer, devPlayerForPage, serverFlag } from './remote';
import { MACHINE_PATH, MONEY_OP, type CreditSince, type LostCredit, type MachineMoney, type MoneyReply } from './serverwire';
import { str } from '../web/i18n';
import {
  LEDGER_FIELDS as FIELDS, MONEY_RECORD_VERSION, addReading, emptyRecord, keptNumber, readMoneyTotals, sameRun,
  zeroLedger as zero, type MoneyTotals,
} from '../web/moneyrecord';
const n = (x: number | undefined): number => x ?? 0;

export { MONEY_RECORD_VERSION, addReading, emptyRecord, sameRun };

export interface MoneyRecord extends MoneyTotals {
  lost?: LostCredit[];
}

export function readMoneyRecord(x: unknown, now: number): MoneyRecord | null {
  const core = readMoneyTotals(x, now);
  if (!core) return null;
  const o = x as Record<string, unknown>;
  const num = keptNumber;
  const rec: MoneyRecord = core;
  if (Array.isArray(o.lost)) {
    const lost: LostCredit[] = [];
    for (const x of o.lost as unknown[]) {
      const e = x as Record<string, unknown> | null;
      if (!e || typeof e !== 'object') continue;
      lost.push({
        at: typeof e.at === 'number' ? e.at : now, savedAt: typeof e.savedAt === 'number' ? e.savedAt : 0,
        version: num(e.version), n: num(e.n), sinceGame: readCredit(e.sinceGame),
      });
    }
    if (lost.length) rec.lost = lost;
  }
  return rec;
}

export function readCredit(x: unknown): CreditSince | null {
  const c = x as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') return null;
  const ok = (y: unknown): y is number => typeof y === 'number' && Number.isSafeInteger(y) && y >= 0;
  return ok(c.inPence) && ok(c.tokenInPence) ? { inPence: c.inPence, tokenInPence: c.tokenInPence } : null;
}

export function addLost(rec: MoneyRecord, lost: LostCredit): MoneyRecord {
  if (rec.lost?.some((x) => x.n === lost.n && x.savedAt === lost.savedAt)) return rec;
  return { ...rec, lost: [...(rec.lost ?? []), lost] };
}

export class CreditWatch {
  private base: CashLedger | null = null;
  private now: CreditSince = { inPence: 0, tokenInPence: 0 };

  mark(l: CashLedger | null): void {
    if (l) this.base = { ...l };
    this.now = { inPence: 0, tokenInPence: 0 };
  }

  reading(l: CashLedger | null): CreditSince {
    if (!l) return this.now;
    const b = this.base;
    if (!b || !sameRun(b, l)) { this.mark(l); return this.now; }
    this.now = {
      inPence: Math.max(0, (l.inPence - b.inPence) - (l.outPence - b.outPence)),
      tokenInPence: Math.max(0, (l.tokenInPence - b.tokenInPence) - (l.tokenOutPence - b.tokenOutPence)),
    };
    return this.now;
  }

  get value(): CreditSince { return { ...this.now }; }
}

export function startingRecord(m: DocMachine, now: number): MoneyRecord {
  const rec = emptyRecord(now);
  const base = m.balance.find((b) => b.kind === 'float')?.ledger ?? m.balance[0]?.ledger ?? null;
  const l = m.stats?.ledger ?? m.balance.at(-1)?.ledger ?? null;
  if (!l) return rec;
  for (const k of FIELDS) rec.total[k] = Math.max(0, n(l[k]) - n(base?.[k]));
  return rec;
}

export function lostCreditText(c: CreditSince | null): string {
  const pounds = (p: number): string => `£${(p / 100).toFixed(2)}`;
  if (!c || (!c.inPence && !c.tokenInPence)) return str('arcade.moneyrecord.not_known');
  const parts = [];
  if (c.inPence) parts.push(pounds(c.inPence));
  if (c.tokenInPence) parts.push(`${pounds(c.tokenInPence)} tokens`);
  return str('arcade.moneyrecord.at_least_n', { 0: parts.join(' + ') });
}

export interface StatsMoney {
  inPence: number;
  outPence: number;
  unpricedIn: number;
  unpricedOut: number;
  euroInCents: number;
  euroOutCents: number;
  tokenInPence: number;
  tokenOutPence: number;
  lost: LostCredit[];
}

export function statsMoney(m: DocMachine, server?: MachineMoney | null): StatsMoney {
  const rec: { total: Partial<CashLedger>; lost?: LostCredit[] } = server !== undefined
    ? server ?? emptyRecord(0)
    : readMoneyRecord(m.moneyRecord, 0) ?? startingRecord(m, 0);
  const t = rec.total;
  return {
    inPence: n(t.inPence), outPence: n(t.outPence), tokenInPence: n(t.tokenInPence), tokenOutPence: n(t.tokenOutPence),
    unpricedIn: n(t.unpricedIn), unpricedOut: n(t.unpricedOut),
    euroInCents: n(t.euroInCents), euroOutCents: n(t.euroOutCents),
    lost: [...(rec.lost ?? [])].reverse(),
  };
}

export async function serverMoney(arcadeId: string, machine: string): Promise<MachineMoney | null | undefined> {
  const base = serverFlag();
  if (!base) return undefined;
  try {
    const player = await devPlayerForPage();
    const r = await fetch(`${base}${MACHINE_PATH}/${encodeURIComponent(arcadeId)}/${encodeURIComponent(machine)}/${MONEY_OP}`, asPlayer(player));
    const body = (await r.json()) as MoneyReply;
    return body.ok ? body.money : undefined;
  } catch (e) {
    console.warn('[arcade] could not read the machine\'s money record from the arcade server', e);
    return undefined;
  }
}

export function readLedger(x: unknown): CashLedger | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const num = (y: unknown): number => (typeof y === 'number' && Number.isFinite(y) && y >= 0 ? Math.round(y) : 0);
  const l = zero();
  let any = false;
  for (const k of FIELDS) if (o[k] !== undefined) { l[k] = num(o[k]); any = true; }
  return any ? l : null;
}

const moved = (l: CashLedger | null): boolean => !!l && FIELDS.some((k) => n(l[k]) > 0);

export function salvageMoney(x: unknown, version: number, now: number): ArcadeDoc | null {
  if (!x || typeof x !== 'object') return null;
  const d = x as Record<string, unknown>;
  if (typeof d.id !== 'string' || !d.id) return null;
  const machines: DocMachine[] = [];
  for (const raw of Array.isArray(d.machines) ? d.machines as unknown[] : []) {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m !== 'object' || typeof m.contentHash !== 'string' || !m.contentHash) continue;
    const balance: DocMachine['balance'] = [];
    for (const b of Array.isArray(m.balance) ? m.balance as unknown[] : []) {
      const r = b as Record<string, unknown> | null;
      if (!r || typeof r !== 'object') continue;
      balance.push({ at: typeof r.at === 'number' ? r.at : 0, kind: r.kind === 'float' ? 'float' : 'reading', ledger: readLedger(r.ledger) });
    }
    const s = m.stats as Record<string, unknown> | null | undefined;
    const stats: DocMachine['stats'] = s && typeof s === 'object' ? {
      plays: typeof s.plays === 'number' && s.plays >= 0 ? Math.round(s.plays) : 0,
      lastPlayedAt: typeof s.lastPlayedAt === 'number' ? s.lastPlayedAt : null,
      ledger: readLedger(s.ledger),
      ...(typeof s.ledgerAt === 'number' ? { ledgerAt: s.ledgerAt } : {}),
    } : null;
    const moneyRecord = readMoneyRecord(m.moneyRecord, now);
    const carries = (moneyRecord && (moved(moneyRecord.total) || !!moneyRecord.lost?.length))
      || moved(stats?.ledger ?? null) || balance.some((b) => moved(b.ledger));
    if (!carries) continue;
    machines.push({
      id: typeof m.id === 'string' && m.id ? m.id : m.contentHash,
      contentHash: m.contentHash,
      contentRule: typeof m.contentRule === 'number' ? m.contentRule : 0,
      ...(typeof m.hash === 'string' ? { hash: m.hash } : {}),
      name: typeof m.name === 'string' ? m.name : '',
      board: typeof m.board === 'string' ? m.board : '',
      status: 'pending', config: {}, setup: {}, balance, trace: null, stats,
      moneyRecord: moneyRecord ?? startingRecord({ balance, stats } as DocMachine, now),
      place: null,
    });
  }
  if (!machines.length) return null;
  return {
    format: 'fruitulator-arcade', version, id: d.id,
    name: typeof d.name === 'string' ? d.name : '',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : now,
    updatedAt: now,
    machines,
    ...(typeof d.hostKey === 'string' ? { hostKey: d.hostKey } : {}),
  };
}
