import { boardDefaultsOf } from '../src/machine/boarddefaults';
import { strayAccessesOf, strayAccessLine } from '../src/machine/strayaccess';
import { cabinetDisplayReversed, glassText } from '../src/machine/layoutdisplay';
import type { Machine, CashLedger } from '../src/machine/machine';

export type DiagKind =
  | 'load' | 'reset' | 'coin' | 'input' | 'ledger' | 'display' | 'reels' | 'halt' | 'note'
  | 'audio'
  | 'speed';

export function audioReportText(data: unknown): string | null {
  const t = (data as { audioReport?: unknown } | null)?.audioReport;
  return typeof t === 'string' && t ? `sound ${t}` : null;
}

export interface DiagEntry {
  seq: number;
  ms: number;
  kind: DiagKind;
  text: string;
}

const MAX_ENTRIES = 4000;

const TRIM_CHUNK = 400;

const SETTLE_MS = 250;

const REEL_STILL_TICKS = 8;

const STRAY_POLL_MS = 5_000;

export class DiagLog {
  enabled = false;

  private ring: DiagEntry[] = [];
  private nextSeq = 1;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  add(kind: DiagKind, text: string): void {
    if (!this.enabled) return;
    this.ring.push({ seq: this.nextSeq++, ms: this.now(), kind, text });
    if (this.ring.length > MAX_ENTRIES) this.ring.splice(0, TRIM_CHUNK);
  }

  entries(): readonly DiagEntry[] {
    return this.ring;
  }

  clear(): void {
    this.ring = [];
  }

  setEnabled(on: boolean): void {
    if (on && !this.enabled) this.clear();
    this.enabled = on;
  }
}

const LEDGER_FIELDS: readonly (keyof CashLedger)[] = [
  'inPence', 'outPence', 'unpricedOut', 'tokenInPence', 'tokenOutPence', 'unpricedTokenOut',
  'unpricedTokenIn',
];

function money(p: number): string {
  return `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;
}

function ledgerDelta(field: keyof CashLedger, d: number): string {
  const counted = field === 'unpricedOut' || field === 'unpricedTokenOut' || field === 'unpricedTokenIn';
  return `${field} ${d > 0 ? '+' : ''}${counted ? d : money(d)}`;
}

export class DiagWatch {
  private lastLedger: CashLedger | null = null;
  private lastTravel: number[] = [];
  private stillTicks: number[] = [];
  private travelSinceRest: number[] = [];
  private sawInput = false;
  private pending = '';
  private pendingAt = 0;
  private shown = '';
  private layoutNotes: string[] = [];
  private settingNotes: string[] = [];
  private displayReversed = false;

  constructor(private readonly log: DiagLog, private readonly now: () => number = Date.now) {}

  install(
    m: Machine, game: string, system: string, layoutNotes: string[] = [],
    layout?: Uint8Array, settingNotes: string[] = [],
  ): void {
    this.layoutNotes = layoutNotes;
    this.settingNotes = settingNotes;
    this.lastStrays = 0;
    this.strayPolledAt = -Infinity;
    this.displayReversed = cabinetDisplayReversed(layout);
    this.lastLedger = null;
    this.lastTravel = m.reels.map((r) => r.travel);
    this.stillTicks = m.reels.map(() => REEL_STILL_TICKS);
    this.travelSinceRest = m.reels.map(() => 0);
    this.sawInput = false;
    this.pending = '';
    this.shown = '';
    this.announce(m, game, system);
  }

  announce(m: Machine, game: string, system: string): void {
    this.log.add('load', this.describe(m, game, system));
    for (const d of boardDefaultsOf(m)) this.log.add('load', `board default · ${d.text}`);
    this.defaultsLogged = boardDefaultsOf(m).length;
    for (const n of this.layoutNotes) this.log.add('load', `layout · ${n}`);
    for (const n of this.settingNotes) this.log.add('load', n);
    this.lastStrays = 0;
    this.strayPolledAt = -Infinity;
  }

  describe(m: Machine, game: string, system: string): string {
    const runs: { from: number; to: number; geo: string }[] = [];
    m.reels.forEach((r, i) => {
      const geo = `${r.stepsPerRevolution}st/${r.symbols}sym`;
      const last = runs[runs.length - 1];
      if (last && last.geo === geo) last.to = i;
      else runs.push({ from: i, to: i, geo });
    });
    const reels = runs
      .map((u) => `${u.from === u.to ? `r${u.from}` : `r${u.from}-r${u.to}`} ${u.geo}`)
      .join(' ');
    return `${game} · ${system}${reels ? ` · reels: ${reels}` : ' · no reels'}`;
  }

  pressed(): void {
    this.sawInput = true;
  }

  tick(m: Machine): void {
    if (!this.log.enabled) return;
    this.pollLedger(m);
    this.pollDisplay(m);
    this.pollReels(m);
    this.pollCoinRefusals(m);
    this.pollBoardDefaults(m);
    this.pollStrays(m);
  }

  private pollStrays(m: Machine): void {
    const t = this.now();
    if (t - this.strayPolledAt < STRAY_POLL_MS) return;
    this.strayPolledAt = t;
    const c = strayAccessesOf(m);
    if (!c) return;
    if (c.total < this.lastStrays) this.lastStrays = 0;
    if (c.total === this.lastStrays) return;
    this.lastStrays = c.total;
    const line = strayAccessLine(c);
    if (line) this.log.add('note', line);
  }

  private lastStrays = 0;
  private strayPolledAt = -Infinity;

  private pollBoardDefaults(m: Machine): void {
    const list = boardDefaultsOf(m);
    for (; this.defaultsLogged < list.length; this.defaultsLogged++) {
      this.log.add('load', `board default · ${list[this.defaultsLogged].text}`);
    }
  }

  private defaultsLogged = 0;

  private pollCoinRefusals(m: Machine): void {
    const n = m.coinsRefused;
    if (typeof n !== 'number') return;
    if (this.lastRefusals !== null && n > this.lastRefusals) {
      this.log.add('coin', `coin refused at the mech (${n - this.lastRefusals})`);
    }
    this.lastRefusals = n;
  }

  private lastRefusals: number | null = null;

  private pollLedger(m: Machine): void {
    const l = m.cashLedger;
    if (!l) return;
    const prev = this.lastLedger;
    if (prev) {
      const moved = LEDGER_FIELDS
        .filter((f) => l[f] !== prev[f])
        .map((f) => ledgerDelta(f, l[f] - prev[f]));
      if (moved.length) {
        this.log.add('ledger', `${moved.join(', ')} → in ${money(l.inPence)} out ${money(l.outPence)}`);
      }
    }
    this.lastLedger = { ...l };
  }

  private pollDisplay(m: Machine): void {
    const d = m.display;
    if (!d) return;
    const text = glassText(d.text(), this.displayReversed).replace(/\s+$/, '');
    const now = this.now();
    if (text !== this.pending) {
      this.pending = text;
      this.pendingAt = now;
      return;
    }
    if (now - this.pendingAt < SETTLE_MS || text === this.shown) return;
    this.shown = text;
    this.log.add('display', text.trim() ? `"${text}"` : '(blank)');
  }

  private pollReels(m: Machine): void {
    if (!m.reels.length) return;
    if (this.lastTravel.length !== m.reels.length) {
      this.lastTravel = m.reels.map((r) => r.travel);
      this.stillTicks = m.reels.map(() => REEL_STILL_TICKS);
      this.travelSinceRest = m.reels.map(() => 0);
      this.sawInput = false;
    }
    let allStill = true;
    m.reels.forEach((r, i) => {
      if (r.travel !== this.lastTravel[i]) {
        this.travelSinceRest[i] += Math.abs(r.travel - this.lastTravel[i]);
        this.lastTravel[i] = r.travel;
        this.stillTicks[i] = 0;
      } else if (this.stillTicks[i] < REEL_STILL_TICKS) {
        this.stillTicks[i]++;
      }
      if (this.stillTicks[i] < REEL_STILL_TICKS) allStill = false;
    });
    if (!allStill) return;
    if (!this.travelSinceRest.some((t) => t > 0)) return;
    const spun = m.reels.some((r, i) => this.travelSinceRest[i] >= r.stepsPerRevolution);
    const nudged = this.sawInput && m.reels.some(
      (r, i) => r.symbols > 0 && this.travelSinceRest[i] >= r.stepsPerRevolution / r.symbols,
    );
    this.travelSinceRest.fill(0);
    this.sawInput = false;
    if (!spun && !nudged) return;
    this.log.add('reels', `at rest: ${m.reels.map((r) => r.position).join(', ')}`);
  }
}

export function formatDiagLog(
  entries: readonly DiagEntry[], header: Record<string, string> = {},
): string {
  const out = ['# fruitulator diagnostics log'];
  for (const [k, v] of Object.entries(header)) out.push(`# ${k}: ${v}`);
  if (!entries.length) {
    out.push('#', '# (no entries - the log was not running, or nothing happened)');
    return `${out.join('\n')}\n`;
  }
  out.push(`# started: ${new Date(entries[0].ms).toISOString()}`, '#');
  const t0 = entries[0].ms;
  for (const e of entries) {
    const t = ((e.ms - t0) / 1000).toFixed(3).padStart(9);
    out.push(`${t}  ${e.kind.padEnd(7)} ${e.text}`);
  }
  return `${out.join('\n')}\n`;
}
