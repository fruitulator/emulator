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
      const glass = line !== this.glassLine;
      this.glassLine = line;
      const opened = this.door.second({
        t: 0, reels, ledger, glass, alarm: reading?.verdict === 'ALARM', line,
        lamps: this.flips.take(), pics: this.flips.takePictures(),
      });
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
}

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
  return { saved: false, detail: str('bootwatch.started_again_without_the_ram', { 0: f.seconds }) };
}
