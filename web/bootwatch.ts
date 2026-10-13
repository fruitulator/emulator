import { attractFired, LampFlips, QUIET_LONG_S, quiet, type Second } from '../src/machine/attractwindow';
import {
  boardAlarmForms, classifyGlassCore, FLASH_FORM, flashedCredit, flashedStrim, readGlass, STRIM_FLASH_FORM,
  type CabinetSurfaces, type CoreReading,
} from '../src/machine/alarmread';
import type { FrameView } from '../src/machine/framestate';
import type { CashLedger } from '../src/machine/machine';
import { str } from './i18n';

export const ATTRACT_WINDOW_S = 10;

export function attractBudgetS(board: string): number {
  return ['MPU5', 'SCORPION5', 'ADDER5'].includes(board.toUpperCase()) ? 240 : 120;
}

export class BootDoor {
  private readonly secs: Second[] = [];
  private openNow = false;

  constructor(booting: boolean, private readonly budgetS: number) {
    this.openNow = !booting;
  }

  get open(): boolean { return this.openNow; }
  get seconds(): readonly Second[] { return this.secs; }

  private standing(): boolean {
    return this.secs.length >= QUIET_LONG_S && this.secs.slice(-QUIET_LONG_S).every(quiet);
  }

  second(s: Second): boolean {
    if (this.openNow) return false;
    this.secs.push(s);
    if (attractFired(this.secs, ATTRACT_WINDOW_S) || this.standing() || this.secs.length >= this.budgetS) this.openNow = true;
    return this.openNow;
  }
}

export interface DoorSource {
  latestFrame(): FrameView | null;
  ledger(): Promise<CashLedger | null>;
}

const SAMPLE_HZ = 25;

const FLASH_WINDOW_S = 4;

export class BootWatch {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: FrameView | null = null;
  private pose = '';
  private reels = false;
  private glassLine = '';
  private ledgerPrev = '';
  private t0 = 0;
  private busy = false;
  private readonly flips = new LampFlips();
  private readonly bankCells: string[][] = [];
  private readonly bankText: string[] = [];
  private readonly readsBank: boolean;
  private lastReading: CoreReading | null = null;
  private screenSerial = -1;
  private screenPic = -1;
  private screenMoved = false;
  private screenPics = new Set<number>();

  constructor(
    readonly door: BootDoor,
    private readonly src: DoorSource,
    private readonly board: string,
    private readonly layout: Uint8Array | undefined,
    private readonly surf: CabinetSurfaces | undefined,
    private readonly idle: () => boolean,
    private readonly onOpen: () => void,
  ) {
    const forms = boardAlarmForms(board) ?? [];
    this.readsBank = forms.includes(FLASH_FORM) || forms.includes(STRIM_FLASH_FORM);
  }

  get reading(): CoreReading | null { return this.lastReading; }

  start(): void {
    if (this.door.open || this.timer) return;
    this.t0 = performance.now();
    this.timer = setInterval(() => this.sample(), 1000 / SAMPLE_HZ);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private sample(): void {
    if (this.idle()) { this.t0 = performance.now(); return; }
    const v = this.src.latestFrame();
    if (v && v !== this.last) {
      this.last = v;
      const pose = v.reels.map((r) => `${r.position}/${r.travel}`).join(',');
      if (this.pose !== '' && pose !== this.pose) this.reels = true;
      this.pose = pose;
      this.flips.feed(v);
      if (v.videoRaw.length && v.videoSerial !== this.screenSerial) {
        this.screenSerial = v.videoSerial;
        let h = 2166136261;
        const raw = v.videoRaw;
        for (let i = 0; i < raw.length; i += 28) h = Math.imul(h ^ raw[i] ^ (raw[i + 1] << 8) ^ (raw[i + 2] << 16), 16777619);
        h >>>= 0;
        if (this.screenPic !== -1 && h !== this.screenPic) this.screenMoved = true;
        this.screenPic = h;
        this.screenPics.add(h);
      }
      if (this.readsBank && this.layout) {
        const g = readGlass(v, this.layout, this.surf);
        this.bankCells.push(g.cells ?? []);
        this.bankText.push(g.digits);
        const keep = FLASH_WINDOW_S * SAMPLE_HZ;
        if (this.bankCells.length > keep) { this.bankCells.shift(); this.bankText.shift(); }
      }
    }
    if (performance.now() - this.t0 >= 1000 && !this.busy) void this.endSecond();
  }

  private async endSecond(): Promise<void> {
    this.busy = true;
    this.t0 += 1000;
    const reels = this.reels;
    this.reels = false;
    try {
      const l = JSON.stringify(await this.src.ledger().catch(() => null));
      const ledger = this.ledgerPrev !== '' && l !== this.ledgerPrev;
      this.ledgerPrev = l;
      const g = this.last && this.layout ? readGlass(this.last, this.layout, this.surf) : null;
      if (g && this.readsBank) {
        g.flashedCode = flashedCredit(this.bankCells);
        g.flashedStrim = flashedStrim(this.bankText);
      }
      const reading = g ? classifyGlassCore(this.board, g) : null;
      this.lastReading = reading;
      const line = reading?.glass ?? '';
      const glass = line !== this.glassLine || this.screenMoved;
      this.glassLine = line;
      const opened = this.door.second({
        t: 0, reels, ledger, glass, alarm: reading?.verdict === 'ALARM', line,
        lamps: this.flips.take(), pics: this.flips.takePictures(), screen: [...this.screenPics],
      });
      this.screenMoved = false;
      this.screenPics = new Set();
      if (opened) { this.stop(); this.onOpen(); }
    } finally {
      this.busy = false;
    }
  }
}

export const SAVED_CREDIT = str('bootwatch.waiting_with_saved_credit');

export interface FreshStart {
  by: 'attract' | 'alarm' | 'still';
  seconds: number;
  alarm?: string;
  lines?: readonly string[];
  savedLines?: readonly string[];
  coin?: CoinTrial | null;
}

export interface CoinTrial {
  moved: boolean;
  before?: string;
  after?: string;
  why?: string;
}

const quoted = (l: string): string => (l.trim() ? l.trim() : str('bootwatch.a_dark_display'));

export function judgeFreshStart(f: FreshStart): { saved: boolean; detail: string } {
  const was = str('bootwatch.it_started_from_its_saved');
  if (f.by === 'attract') {
    return { saved: true, detail: str('bootwatch.n_started_again_without_the', { 0: was, 1: f.seconds }) };
  }
  if (f.by === 'alarm') {
    return {
      saved: true,
      detail: str('bootwatch.n_started_again_without_the_2', { 0: was, 1: f.alarm ?? 'unnamed', 2: f.seconds }),
    };
  }
  const saved = new Set(f.savedLines ?? []);
  const only = (f.lines ?? []).filter((l) => !saved.has(l));
  if (only.length && f.coin?.moved) {
    return {
      saved: true,
      detail: str('bootwatch.n_started_again_without_the_3', {
        0: was, 1: only.map(quoted).join(' / '), 2: f.seconds, 3: quoted(f.coin.before ?? ''), 4: quoted(f.coin.after ?? ''),
      }),
    };
  }
  const still = str('bootwatch.started_again_without_the_ram', { 0: f.seconds });
  if (!f.coin) return { saved: false, detail: still };
  const coin = f.coin.moved
    ? str('bootwatch.one_coin_moved_its_display', { 0: quoted(f.coin.before ?? ''), 1: quoted(f.coin.after ?? '') })
    : str('bootwatch.one_coin_did_not_move_its', { 0: f.coin.why ?? str('bootwatch.nothing_new_showed') });
  return { saved: false, detail: `${still} ${coin}` };
}

export const IDLES_AND_PLAYS = str('bootwatch.idles_and_plays');

export interface SpinTrial {
  start: { id: number; how: string } | null;
  control: number;
  afterCoin: number;
  afterStart: number;
  coin: (CoinTrial & { line?: number | null; took?: string }) | null;
  triedLines?: number[];
}

export function judgeIdle(t: SpinTrial): { plays: boolean; detail: string } {
  if (t.control > 0) {
    return { plays: false, detail: str('bootwatch.reels_moved_by_themselves', { 0: t.control }) };
  }
  const c = t.coin;
  const earlier = (t.triedLines ?? []).slice(0, -1);
  const one = !c || c.line == null ? str('bootwatch.no_coin_line')
    : c.moved ? str('bootwatch.coin_moved_display', { 0: c.line, 1: quoted(c.before ?? ''), 2: quoted(c.after ?? '') })
      : c.took && c.took !== 'dropped' ? str('bootwatch.coin_not_taken', { 0: c.line, 1: c.took })
        : str('bootwatch.coin_display_still', { 0: c.line });
  const coin = earlier.length ? str('bootwatch.coins_on_earlier_lines', { 0: earlier.join(', '), 1: one }) : one;
  const start = t.start ? str('bootwatch.start_pressed', { 0: t.start.id }) : str('bootwatch.no_start_cap');
  if (t.afterCoin > 0 || t.afterStart > 0) {
    const spun = t.afterStart > 0 ? str('bootwatch.start_spun', { 0: t.afterStart }) : str('bootwatch.coin_spun', { 0: t.afterCoin });
    return { plays: true, detail: str('bootwatch.it_idles_and_plays', { 0: coin, 1: spun }) };
  }
  return { plays: false, detail: str('bootwatch.no_reel_moved', { 0: coin, 1: start }) };
}

export interface PlayWindow {
  steps: number;
  lines: readonly string[];
  blink: readonly number[];
  paid?: number;
}

export interface PlayPress {
  steps: number;
  settled: boolean;
  rest: PlayWindow;
}

export interface PlayDown {
  start: { id: number; how: string } | null;
  control: PlayWindow;
  presses: readonly PlayPress[];
  attract?: { by: 'attract' | 'budget'; seconds: number; glass: string };
  bounds: { presses: number; seconds: number };
  boundHit?: 'presses' | 'seconds';
  capNames?: Readonly<Record<number, string>>;
}

export function glassNumbers(line: string): { shape: string; nums: number[] } {
  const nums: number[] = [];
  const shape = line.replace(/\d+(?:\.\d+)?|\.\d+/g, (m) => { nums.push(Number(m)); return '#'; }).replace(/\s+/g, ' ').trim();
  return { shape, nums };
}

export function glassParts(line: string): Map<string, { shape: string; nums: number[] }> {
  const out = new Map<string, { shape: string; nums: number[] }>();
  for (const m of line.matchAll(/(\w+) "((?:[^"\\]|\\.)*)"/g)) out.set(m[1], glassNumbers(m[2]));
  if (!out.size && line.trim()) out.set('', glassNumbers(line));
  return out;
}

export function glassDelta(before: string, after: string): Map<string, number> | null {
  const a = glassParts(before);
  const b = glassParts(after);
  const d = new Map<string, number>();
  let matched = false;
  for (const [name, was] of a) {
    const now = b.get(name);
    if (!now || now.shape !== was.shape || !was.nums.length) continue;
    matched = true;
    was.nums.forEach((v, k) => d.set(`${name}:${k}`, (cents(now.nums[k]) - cents(v)) / 100));
  }
  return matched ? d : null;
}

function glassValue(line: string, key: string): number | null {
  const [name, k] = key.split(':');
  const n = glassParts(line).get(name)?.nums[Number(k)];
  return n === undefined ? null : n;
}

export type SpinKind = 'loss' | 'win' | 'paid' | 'offer' | 'changed' | 'odd' | 'nodrop' | 'unread' | 'unsettled';

export interface SpinJudgement {
  kind: SpinKind;
  after: string;
  delta: [string, number][];
  newLamps: number[];
  spent?: boolean;
}

const cents = (n: number): number => Math.round(n * 100);

export type Stake = Record<string, number>;

export function judgeSpin(before: string, p: PlayPress, controlBlink: readonly number[], stake: Stake | null): SpinJudgement {
  const lines = p.rest.lines;
  const score = (l: string): number => (glassDelta(before, l)?.size ?? -1);
  let after = lines[lines.length - 1] ?? before;
  let best = -1;
  for (const l of lines) { const sc = score(l); if (sc >= best && sc >= 0) { best = sc; after = l; } }
  const base = new Set(controlBlink);
  const newLamps = p.rest.blink.filter((n) => !base.has(n));
  const d = best >= 0 ? glassDelta(before, after) : null;
  const delta: [string, number][] = d ? [...d] : [];
  const out = (kind: SpinKind, more: Partial<SpinJudgement> = {}): SpinJudgement => ({ kind, after, delta, newLamps, ...more });
  if (!p.settled) return out('unsettled');
  if ((p.rest.paid ?? 0) > 0) return out('paid');
  if (![...glassParts(before).values()].some((x) => x.nums.length)) return out('unread');
  if (!d) return out('changed');
  if (delta.some(([, v]) => v > 0)) return out('win');
  if (delta.every(([, v]) => v === 0)) return out('nodrop');
  const took = stake ?? Object.fromEntries(delta.filter(([, v]) => v < 0).map(([k, v]) => [k, -v]));
  if (stake && delta.some(([k, v]) => cents(-v) !== cents(stake[k] ?? 0))) return out('odd');
  if (stake && Object.keys(stake).some((k) => !d.has(k))) return out('odd');
  const spent = Object.entries(took).every(([k, s]) => cents(glassValue(after, k) ?? 0) < cents(s));
  if (newLamps.length) return out('offer', { spent });
  return out('loss', { spent });
}

export interface PlayVerdict {
  next: 'press' | 'watch' | 'done';
  plays: boolean;
  saved: boolean;
  spins: number;
  stake: Stake | null;
  ceiling: number;
  end: string;
  judged: SpinJudgement[];
  detail: string;
}

function lastStake(before: string, stake: Stake): boolean {
  return Object.entries(stake).every(([k, s]) => cents(glassValue(before, k) ?? 0) < 2 * cents(s));
}

const said = (stake: Stake | null): string => Object.values(stake ?? {}).join(', ');

function lampsSaid(lamps: readonly number[], caps: Readonly<Record<number, string>>): string {
  const named = lamps.filter((n) => caps[n]).map((n) => caps[n]);
  return named.length ? `${lamps.join(', ')} (${str('bootwatch.lamps_caps', { 0: named.join(', ') })})` : lamps.join(', ');
}

function stopReason(j: SpinJudgement, before: string, stake: Stake | null, spinBoundS: number, caps: Readonly<Record<number, string>> = {}): string {
  switch (j.kind) {
    case 'unsettled': return str('bootwatch.spin_unsettled', { 0: spinBoundS });
    case 'paid': return str('bootwatch.spin_paid');
    case 'unread': return str('bootwatch.spin_unread', { 0: quoted(before) });
    case 'changed': return str('bootwatch.spin_changed', { 0: quoted(before), 1: quoted(j.after) });
    case 'win': return str('bootwatch.spin_win', { 0: quoted(before), 1: quoted(j.after) });
    case 'nodrop': return str('bootwatch.spin_nodrop', { 0: quoted(before) });
    case 'odd': return str('bootwatch.spin_odd', { 0: quoted(before), 1: quoted(j.after), 2: said(stake) });
    case 'offer': return str('bootwatch.spin_offer', { 0: lampsSaid(j.newLamps, caps) });
    default: return '';
  }
}

export function judgePlayDown(p: PlayDown, spinBoundS = 45): PlayVerdict {
  const v = (o: Partial<PlayVerdict> & Pick<PlayVerdict, 'next' | 'detail'>): PlayVerdict => ({
    plays: false, saved: false, spins: 0, stake: null, ceiling: p.bounds.presses, end: '', judged: [], ...o,
  });
  const limits = str('bootwatch.playdown_limits', { 0: p.bounds.presses, 1: p.bounds.seconds });
  if (p.control.steps > 0) return v({ next: 'done', end: 'control', detail: str('bootwatch.reels_moved_by_themselves', { 0: p.control.steps }) });
  if (!p.start) return v({ next: 'done', end: 'no-spin', detail: str('bootwatch.start_first_no_cap') });
  if (!p.presses.length) return v({ next: 'press', detail: '' });
  if (p.presses[0].steps === 0) {
    return v({ next: 'done', end: 'no-spin', detail: str('bootwatch.start_first_did_nothing', { 0: p.start.id }) });
  }
  const cap = p.start.id;
  const judged: SpinJudgement[] = [];
  let before = p.control.lines[p.control.lines.length - 1] ?? '';
  const from = before;
  let stake: Stake | null = null;
  let ceiling = p.bounds.presses;
  let spins = 0;
  const watched = (base: Partial<PlayVerdict>, played: string, lead: string): PlayVerdict => {
    if (!p.attract) return v({ ...base, next: 'watch', detail: played });
    if (p.attract.by === 'attract') {
      return v({ ...base, next: 'done', end: 'attract', detail: `${played} ${lead} ${str('bootwatch.playdown_attract', { 0: p.attract.seconds })} ${limits}` });
    }
    return v({
      ...base, next: 'done', end: 'no-attract',
      detail: `${played} ${lead} ${str('bootwatch.playdown_no_attract', { 0: p.attract.seconds, 1: quoted(p.attract.glass) })} ${limits}`,
    });
  };
  for (let i = 0; i < p.presses.length; i++) {
    const press = p.presses[i];
    if (press.steps === 0) {
      const played = str('bootwatch.playdown_played', { 0: cap, 1: quoted(from), 2: quoted(before), n: spins });
      return watched({ plays: true, saved: true, spins, stake, ceiling, judged }, played, str('bootwatch.playdown_no_spin'));
    }
    const j = judgeSpin(before, press, p.control.blink, stake);
    judged.push(j);
    if (j.kind === 'offer' && j.spent) {
      spins++;
      const played = str('bootwatch.playdown_played', { 0: cap, 1: quoted(from), 2: quoted(j.after), n: spins });
      return watched({ plays: true, saved: true, spins, stake, ceiling, judged }, played, str('bootwatch.playdown_spent_lamps', { 0: lampsSaid(j.newLamps, p.capNames ?? {}) }));
    }
    if (stake && (j.kind === 'changed' || j.kind === 'offer') && lastStake(before, stake)) {
      const played = str('bootwatch.playdown_played', { 0: cap, 1: quoted(from), 2: quoted(before), n: spins });
      return watched({ plays: true, saved: true, spins, stake, ceiling, judged }, played, str('bootwatch.playdown_last_stake', { 0: stopReason(j, before, stake, spinBoundS, p.capNames) }));
    }
    if (j.kind !== 'loss') {
      const why = stopReason(j, before, stake, spinBoundS, p.capNames);
      const moved = i > 0 || j.delta.some(([, d]) => d !== 0) || j.kind === 'paid';
      if (i === 0) {
        const detail = moved
          ? `${str('bootwatch.plays_on_saved_credit', { 0: cap })} ${str('bootwatch.playdown_first_not_plain', { 0: why })} ${limits}`
          : `${str('bootwatch.start_spun_not_read', { 0: cap, 1: press.steps, 2: why })} ${limits}`;
        return v({ next: 'done', plays: true, saved: moved, spins, stake, ceiling, end: j.kind, judged, detail });
      }
      return v({
        next: 'done', plays: true, saved: true, spins, stake, ceiling, end: j.kind, judged,
        detail: `${str('bootwatch.playdown_played', { 0: cap, 1: quoted(from), 2: quoted(before), n: spins })} ${str('bootwatch.playdown_stopped', { 0: why })} ${limits}`,
      });
    }
    spins++;
    if (!stake) {
      stake = Object.fromEntries(j.delta.filter(([, d]) => d < 0).map(([k, d]) => [k, -d]));
      const fell = Object.entries(stake);
      const was = fell.length === 1 ? glassValue(before, fell[0][0]) : null;
      if (was !== null) ceiling = Math.min(p.bounds.presses, Math.floor(cents(was) / cents(fell[0][1])) + 1);
    }
    before = j.after;
  }
  const base = { plays: true, saved: true, spins, stake, ceiling, judged };
  const played = str('bootwatch.playdown_played', { 0: cap, 1: quoted(from), 2: quoted(before), n: spins });
  if (p.boundHit || p.presses.length >= ceiling) {
    return v({ ...base, next: 'done', end: 'bound', detail: `${played} ${str('bootwatch.playdown_bound')} ${limits}` });
  }
  return v({ ...base, next: 'press', detail: played });
}
