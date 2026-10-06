
const BARCREST_PHASES = [0x1, 0x3, 0x2, 0x6, 0x4, 0xc, 0x8, 0x9];

const STARPOINT_PHASES = [0x4, 0x6, 0x2, 0xa, 0x8, 0x9, 0x1, 0x5];

function phaseIndex(phases: number[]): Int8Array {
  const t = new Int8Array(16).fill(-1);
  phases.forEach((p, i) => {
    t[p] = i;
  });
  return t;
}

const ACE_PHASES = [0x9, 0x8, 0xc, 0x4, 0x6, 0x2, 0x3, 0x1];

const PHASE_TABLES: Record<string, Int8Array> = {
  barcrest: phaseIndex(BARCREST_PHASES),
  starpoint: phaseIndex(STARPOINT_PHASES),
  ace: phaseIndex(ACE_PHASES),
};

function starpointPhase(pattern: number, oldPhase: number): number {
  switch (pattern) {
    case 0x02: return 7;
    case 0x06: return 6;
    case 0x04: return 5;
    case 0x05: return 4;
    case 0x01: return 3;
    case 0x09: return 2;
    case 0x08: return 1;
    case 0x0a: return 0;
    case 0x03: return (oldPhase === 6 || oldPhase === 0) ? 7 : 3;
    case 0x0c: return (oldPhase === 6 || oldPhase === 4) ? 5 : 1;
    default: return oldPhase;
  }
}

function barcrestPhase(pattern: number, oldPhase: number): number {
  switch (pattern) {
    case 0x01: return 7;
    case 0x03: return 6;
    case 0x02: return 5;
    case 0x06: return 4;
    case 0x04: return 3;
    case 0x0c: return 2;
    case 0x08: return 1;
    case 0x09: return 0;
    case 0x05: return (oldPhase === 6 || oldPhase === 0) ? 7 : 3;
    case 0x0a: return (oldPhase === 6 || oldPhase === 4) ? 5 : 1;
    default: return oldPhase;
  }
}

export interface ReelConfig {
  stepsPerRevolution?: number;
  symbols?: number;
  opticStart?: number;
  opticWidth?: number;
  opticPattern?: number;
  drive?: 'barcrest' | 'starpoint' | 'ace';
  mame?: boolean;
  indexStart?: number;
  indexEnd?: number;
  indexPattern?: number;
  initPhase?: number;
  indexTrail?: number;
  mfmeJpm?: boolean;
  mameDrive?: 'starpoint' | 'barcrest';
}

const NEWJPM: readonly (readonly number[])[] = [
  [0, 0, 4, 0, 2, 1, 3, 0, -2, -1, -3, 0, 0, 0, 0, 0],
  [0, -1, 3, 0, 1, 0, 2, 0, -3, -2, 4, 0, 0, 0, 0, 0],
  [0, -2, 2, 0, 0, -1, 1, 0, 4, -3, 3, 0, 0, 0, 0, 0],
  [0, -3, 1, 0, -1, -2, 0, 0, 3, 4, 2, 0, 0, 0, 0, 0],
  [0, 4, 0, 0, -2, -3, -1, 0, 2, 3, 1, 0, 0, 0, 0, 0],
  [0, 3, -1, 0, -3, -4, -2, 0, 1, 2, 0, 0, 0, 0, 0, 0],
  [0, 2, -2, 0, 4, 3, -3, 0, 0, 1, -1, 0, 0, 0, 0, 0],
  [0, 1, -3, 0, 3, 2, -4, 0, -1, 0, -2, 0, 0, 0, 0, 0],
];

export class Reel {
  readonly stepsPerRevolution: number;
  readonly symbols: number;
  private opticStart: number;
  private opticWidth: number;
  private readonly opticPattern: number;

  setOpticWindow(start: number, width: number): void {
    this.opticStart = start;
    this.opticWidth = width;
  }

  get indexWindow(): readonly [number, number] { return [this.indexStart, this.indexEnd]; }

  get mameStepper(): boolean { return this.mame; }

  get indexGateResidue(): number | null {
    if (!this.mame || this.indexPattern === 0) return null;
    if (this.indexPattern === 0x03 || this.indexPattern === 0x0c) return null;
    const phase = this.mamePhase(this.indexPattern, this.initPhase);
    return (((this.initPhase - phase) % 8) + 8) % 8;
  }

  setIndexWindow(start: number, end: number): void {
    this.indexStart = start;
    this.indexEnd = end;
  }

  position = 0;
  travel = 0;
  subStep = 0;

  bounce = 0;

  private phase = -1;
  private lastNibble = 0;
  private releasedPhase = -1;
  private lastDir = 1;
  onSnap?: (delta: number, steps: number) => void;
  private readonly phaseTable: Int8Array;
  private readonly mfmeJpm: boolean;
  readonly traceNib = new Uint8Array(512);
  readonly tracePos = new Uint8Array(512);
  readonly traceGap = new Uint32Array(512);
  traceAt = 0;
  private traceLast = 0;
  traceClock = 0;

  private readonly mame: boolean;
  private readonly mamePhase: (pattern: number, oldPhase: number) => number;
  private indexStart: number;
  private indexEnd: number;
  private readonly indexPattern: number;
  private readonly initPhase: number;
  private readonly indexTrail: number;
  private sinceIndex = -1;
  private indexDir = 1;
  private mPhase = 0;
  private mOldPhase = 0;
  private mOldPattern = 0;

  constructor(cfg: ReelConfig = {}) {
    this.stepsPerRevolution = cfg.stepsPerRevolution ?? 48;
    this.symbols = cfg.symbols ?? 12;
    this.opticStart = cfg.opticStart ?? 0;
    this.opticWidth = cfg.opticWidth ?? 4;
    this.opticPattern = cfg.opticPattern ?? -1;
    this.phaseTable = PHASE_TABLES[cfg.drive ?? 'barcrest'];
    this.mame = cfg.mame ?? false;
    this.mfmeJpm = cfg.mfmeJpm ?? false;
    this.mamePhase = cfg.mameDrive === 'barcrest' ? barcrestPhase : starpointPhase;
    this.indexStart = cfg.indexStart ?? 1;
    this.indexEnd = cfg.indexEnd ?? 3;
    this.indexPattern = cfg.indexPattern ?? 0;
    this.initPhase = cfg.initPhase ?? 0;
    this.indexTrail = cfg.indexTrail ?? 0;
    this.mPhase = this.initPhase;
    this.mOldPhase = this.initPhase;
  }

  refit(stepsPerRevolution: number | undefined, symbols: number | undefined): void {
    const w = this as { -readonly [K in 'stepsPerRevolution' | 'symbols']: number };
    if (stepsPerRevolution !== undefined && Number.isInteger(stepsPerRevolution) && stepsPerRevolution > 0) {
      w.stepsPerRevolution = stepsPerRevolution;
      this.position %= stepsPerRevolution;
    }
    if (symbols !== undefined && Number.isInteger(symbols) && symbols > 0) w.symbols = symbols;
  }

  reset(): void {
    this.position = 0;
    this.travel = 0;
    this.phase = -1;
    this.releasedPhase = -1;
    this.lastNibble = 0;
    this.mPhase = this.initPhase;
    this.mOldPhase = this.initPhase;
    this.mOldPattern = 0;
    this.sinceIndex = -1;
  }

  park(pos: number): void {
    const max = this.stepsPerRevolution;
    const p = ((Math.round(pos) % max) + max) % max;
    this.position = p;
    const ph = (((this.initPhase - p) % 8) + 8) % 8;
    this.mPhase = ph;
    this.mOldPhase = ph;
    this.sinceIndex = -1;
  }

  update(nibble: number): number {
    if ((nibble & 0x0f) !== this.lastNibble) {
      this.tracePos[this.traceAt] = this.position & 0xff;
      this.traceNib[this.traceAt] = nibble & 0x0f;
      this.traceGap[this.traceAt] = (this.traceClock - this.traceLast) >>> 0;
      this.traceLast = this.traceClock;
      this.traceAt = (this.traceAt + 1) & 511;
    }
    this.lastNibble = nibble & 0x0f;
    if (this.mfmeJpm) {
      const d = NEWJPM[this.position % 8][nibble & 0x0f];
      if (d !== 0) {
        this.position = (this.position + d + this.stepsPerRevolution) % this.stepsPerRevolution;
        this.travel += d;
        this.lastDir = d > 0 ? 1 : -1;
      }
      return d;
    }
    if (this.mame) return this.updateMame(nibble & 0x0f);
    const next = this.phaseTable[nibble & 0x0f];
    if (next < 0) {
      if (this.phase >= 0) this.releasedPhase = this.phase;
      this.phase = -1;
      return 0;
    }
    let prev = this.phase;
    this.phase = next;
    let relock = false;
    if (prev < 0) {
      prev = this.releasedPhase;
      if (prev < 0) return 0;
      relock = true;
    }

    const delta = (next - prev) & 7;
    let steps = 0;
    if (delta === 1 || delta === 2) steps = delta;
    else if (delta === 7 || delta === 6) steps = delta - 8;
    else if (relock && delta !== 0) {
      if (delta === 3) steps = 3;
      else if (delta === 5) steps = -3;
      else steps = 4 * this.lastDir;
      this.onSnap?.(delta, steps);
    }

    if (steps !== 0) {
      this.lastDir = steps > 0 ? 1 : -1;
      this.position =
        (this.position + steps + this.stepsPerRevolution) % this.stepsPerRevolution;
      this.travel += steps;
    }
    return steps;
  }

  private updateMame(pattern: number): number {
    this.mPhase = this.mamePhase(pattern, this.mOldPhase);
    let steps = this.mOldPhase - this.mPhase;
    if (steps < -4) steps += 8;
    if (steps > 4) steps -= 8;
    if (steps === 4 || steps === -4) {
      steps = 0;
      this.mPhase = this.mOldPhase;
    }
    this.mOldPhase = this.mPhase;
    this.mOldPattern = pattern;
    const max = this.stepsPerRevolution;
    this.position = (this.position + steps + max) % max;
    this.travel += steps;
    if (steps !== 0) this.lastDir = steps > 0 ? 1 : -1;
    if (this.indexTrail > 0) {
      if (this.mameIndex()) {
        this.sinceIndex = 0;
        if (steps !== 0) this.indexDir = this.lastDir;
      } else if (steps !== 0 && this.sinceIndex >= 0) {
        this.sinceIndex = this.lastDir === this.indexDir ? this.sinceIndex + Math.abs(steps) : -1;
      }
    }
    return steps;
  }

  private mameIndex(): boolean {
    const pos = this.position, start = this.indexStart, end = this.indexEnd;
    const inRange = start > end
      ? (pos > start || pos < end)
      : (pos > start && pos < end);
    if (!inRange) return false;
    const patt = this.indexPattern;
    const cur = this.lastNibble;
    return cur === patt || patt === 0
      || (cur === 0 && (this.mOldPattern === patt || patt === 0));
  }

  optic(): boolean {
    if (this.mame) {
      if (this.mameIndex()) return true;
      return this.sinceIndex > 0 && this.sinceIndex <= this.indexTrail;
    }
    if (this.opticPattern >= 0 && this.lastNibble !== this.opticPattern) return false;
    const rel = (this.position - this.opticStart + this.stepsPerRevolution) %
      this.stepsPerRevolution;
    return rel < this.opticWidth;
  }

  symbol(): number {
    const perSymbol = this.stepsPerRevolution / this.symbols;
    return Math.floor(this.position / perSymbol) % this.symbols;
  }
}
