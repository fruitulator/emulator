import type { Reel } from './reel';

export interface BouncePhase {
  readonly offset: number;
  readonly ticks: number;
}

export interface BounceProfile {
  readonly table: number;
  readonly serviceCycles: number;
  readonly settleCycles: readonly [number, number, number];
  readonly minTravel: number;
  readonly scripts: readonly (readonly BouncePhase[])[];
}

const p = (offset: number, ticks: number): BouncePhase => ({ offset, ticks });

export const BOUNCE_PROFILES: ReadonlyMap<string, BounceProfile> = new Map<string, BounceProfile>([
  ['MPU3', {
    table: 0x00ac6404, serviceCycles: 5000, settleCycles: [50000, 50000, 50000],
    minTravel: 1, scripts: [[p(0.10, 8), p(-0.15, 6), p(0, 0)]],
  }],
  ['MPU4', {
    table: 0x00ac6778, serviceCycles: 5000, settleCycles: [75000, 75000, 75000],
    minTravel: 7,
    scripts: [
      [p(0.15, 20), p(-0.20, 16), p(0, 0)],
      [p(0.20, 20), p(-0.25, 16), p(0, 0)],
    ],
  }],
  ['MPU4VIDEO', {
    table: 0x00ac6778, serviceCycles: 5000, settleCycles: [75000, 75000, 75000],
    minTravel: 7,
    scripts: [
      [p(0.15, 20), p(-0.20, 16), p(0, 0)],
      [p(0.20, 20), p(-0.25, 16), p(0, 0)],
    ],
  }],
  ['MPU4PLASMA', {
    table: 0x00ac6778, serviceCycles: 5000, settleCycles: [75000, 75000, 75000],
    minTravel: 7,
    scripts: [
      [p(0.15, 20), p(-0.20, 16), p(0, 0)],
      [p(0.20, 20), p(-0.25, 16), p(0, 0)],
    ],
  }],
  ['IMPACT', {
    table: 0x00a85f54, serviceCycles: 5000, settleCycles: [450000, 450000, 450000],
    minTravel: 7,
    scripts: [
      [p(0.20, 140), p(-0.15, 100), p(0, 0)],
      [p(0.40, 180), p(-0.20, 180), p(0.10, 180), p(-0.05, 180), p(0, 0)],
    ],
  }],
  ['M1AB', {
    table: 0x00a9a2f4, serviceCycles: 5000, settleCycles: [90000, 90000, 90000],
    minTravel: 5, scripts: [[p(0.25, 24), p(-0.30, 16), p(0, 0)]],
  }],
  ['SYS1', {
    table: 0x00a475dc, serviceCycles: 5000, settleCycles: [350000, 350000, 350000],
    minTravel: 5, scripts: [[p(0.20, 50), p(-0.35, 30), p(0, 0)]],
  }],
  ['SCORPION2', {
    table: 0x00ae0624, serviceCycles: 5000, settleCycles: [140000, 140000, 140000],
    minTravel: 4,
    scripts: [
      [p(0.25, 12), p(-0.35, 8), p(0, 0)],
      [p(0.30, 8), p(-0.50, 8), p(0.30, 8), p(-0.20, 8), p(0, 0)],
    ],
  }],
  ['SYS5', {
    table: 0x00ae5e68, serviceCycles: 5000, settleCycles: [450000, 450000, 450000],
    minTravel: 7,
    scripts: [
      [p(0.20, 140), p(-0.15, 100), p(0, 0)],
      [p(0.40, 180), p(-0.20, 180), p(0.10, 180), p(-0.05, 180), p(0, 0)],
    ],
  }],
  ['SCORPION1', {
    table: 0x00ae00a0, serviceCycles: 5000, settleCycles: [75000, 75000, 75000],
    minTravel: 4,
    scripts: [
      [p(0.20, 12), p(-0.35, 8), p(0.10, 4), p(0, 0)],
      [p(0.30, 8), p(-0.40, 8), p(0.25, 8), p(-0.15, 8), p(0, 0)],
    ],
  }],
  ['SYS85', {
    table: 0x00ae6a8c, serviceCycles: 5000, settleCycles: [70000, 70000, 70000],
    minTravel: 4,
    scripts: [
      [p(0.25, 12), p(-0.40, 8), p(0, 0)],
      [p(0.30, 8), p(-0.50, 8), p(0.30, 8), p(-0.15, 8), p(0, 0)],
    ],
  }],
  ['SPACE', {
    table: 0x00ae44d8, serviceCycles: 5000, settleCycles: [150000, 150000, 150000],
    minTravel: 6,
    scripts: [
      [p(0.15, 20), p(-0.25, 16), p(0, 0)],
      [p(0.20, 20), p(-0.35, 16), p(0, 0)],
    ],
  }],
  ['PROCONN', {
    table: 0x00acbbfc, serviceCycles: 5000, settleCycles: [255000, 255000, 255000],
    minTravel: 5,
    scripts: [
      [p(0.20, 25), p(-0.25, 20), p(0, 0)],
      [p(0.30, 25), p(-0.40, 20), p(0, 0)],
    ],
  }],
  ['SCORPION4', {
    table: 0x00ae0b0c, serviceCycles: 50000, settleCycles: [750000, 750000, 750000],
    minTravel: 5, scripts: [[p(0.25, 15), p(-0.35, 10), p(0, 0)]],
  }],
  ['MPU5', {
    table: 0x00ac78c4, serviceCycles: 20000, settleCycles: [750000, 1000000, 750000],
    minTravel: 5, scripts: [[p(0.20, 60), p(-0.25, 40), p(0, 0)]],
  }],
  ['EPOCH', {
    table: 0x00a72ac4, serviceCycles: 5000, settleCycles: [750000, 750000, 750000],
    minTravel: 7, scripts: [[p(0.20, 180), p(-0.30, 180), p(0, 0)]],
  }],
  ['MMM', {
    table: 0x00ac5798, serviceCycles: 5000, settleCycles: [130000, 130000, 130000],
    minTravel: 4,
    scripts: [
      [p(0.20, 12), p(-0.35, 8), p(0, 0)],
      [p(0.30, 8), p(-0.50, 8), p(0.30, 8), p(-0.15, 8), p(0, 0)],
    ],
  }],
  ['MPU2', {
    table: 0x00ac60a4, serviceCycles: 5000, settleCycles: [70000, 70000, 70000],
    minTravel: 3, scripts: [[p(0.10, 8), p(-0.15, 6), p(0, 0)]],
  }],
  ['SCORPION5', {
    table: 0x00ae1310, serviceCycles: 50000, settleCycles: [1500000, 1500000, 1500000],
    minTravel: 5, scripts: [[p(0.25, 45), p(-0.35, 30), p(0, 0)]],
  }],
  ['ADDER5', {
    table: 0x00ae1310, serviceCycles: 50000, settleCycles: [1500000, 1500000, 1500000],
    minTravel: 5, scripts: [[p(0.25, 45), p(-0.35, 30), p(0, 0)]],
  }],
  ['SYS83', {
    table: 0x00ae6710, serviceCycles: 5000, settleCycles: [70000, 70000, 70000],
    minTravel: 4,
    scripts: [
      [p(0.25, 12), p(-0.40, 8), p(0, 0)],
      [p(0.30, 8), p(-0.50, 8), p(0.30, 8), p(-0.15, 8), p(0, 0)],
    ],
  }],
  ['ASTRASYSA1', {
    table: 0x00ae6ec0, serviceCycles: 5000, settleCycles: [750000, 750000, 750000],
    minTravel: 5, scripts: [[p(0.30, 160), p(-0.35, 140), p(0, 0)]],
  }],
  ['PLUTO5', {
    table: 0x00aca438, serviceCycles: 5000, settleCycles: [750000, 1000000, 750000],
    minTravel: 5, scripts: [[p(0.25, 60), p(-0.20, 40), p(0, 0)]],
  }],
  ['PHOENIX', {
    table: 0x00ac91e0, serviceCycles: 5000, settleCycles: [400000, 400000, 400000],
    minTravel: 6,
    scripts: [
      [p(0.20, 48), p(-0.35, 32), p(0.10, 16), p(0, 0)],
      [p(0.30, 32), p(-0.40, 32), p(0.25, 32), p(-0.15, 32), p(0, 0)],
    ],
  }],
  ['M1VIDEO', {
    table: 0x00a9a82c, serviceCycles: 5000, settleCycles: [50000, 50000, 50000],
    minTravel: 6, scripts: [[p(0.25, 16), p(-0.30, 12), p(0, 0)]],
  }],
  ['PCLMAXI', {
    table: 0x00aa21bc, serviceCycles: 5000, settleCycles: [130000, 130000, 130000],
    minTravel: 4,
    scripts: [
      [p(0.20, 12), p(-0.35, 8), p(0, 0)],
      [p(0.30, 8), p(-0.50, 8), p(0.30, 8), p(-0.15, 8), p(0, 0)],
    ],
  }],
  ['PHOENIX2', {
    table: 0x00ac9600, serviceCycles: 5000, settleCycles: [400000, 400000, 400000],
    minTravel: 6,
    scripts: [
      [p(0.20, 48), p(-0.35, 32), p(0.10, 16), p(0, 0)],
      [p(0.30, 32), p(-0.40, 32), p(0.25, 32), p(-0.15, 32), p(0, 0)],
    ],
  }],
]);

export function bounceProfileFor(system: string): BounceProfile | undefined {
  return BOUNCE_PROFILES.get(system.trim().toUpperCase());
}

export interface BounceWiring {
  readonly kind: 0 | 1 | 2 | 3;
  readonly script: number;
}

export function kindCanBounce(kind: BounceWiring['kind']): boolean {
  return kind === 0 || kind === 1;
}

interface ReelBounceState {
  seen: boolean;
  travel: number;
  steps: number;
  dir: number;
  moving: boolean;
  idle: number;
  phase: number;
  hold: number;
}

export class ReelBounce {
  private readonly state: ReelBounceState[] = [];

  constructor(
    readonly profile: BounceProfile,
    readonly wiring: readonly (BounceWiring | undefined)[],
  ) {}

  private slot(i: number): ReelBounceState {
    let s = this.state[i];
    if (!s) {
      s = { seen: false, travel: 0, steps: 0, dir: 1, moving: false, idle: 0, phase: -1, hold: 0 };
      this.state[i] = s;
    }
    return s;
  }

  private scriptFor(w: BounceWiring | undefined): readonly BouncePhase[] | null {
    if (!w || !kindCanBounce(w.kind)) return null;
    if (w.script < 1 || w.script > this.profile.scripts.length) return null;
    return this.profile.scripts[w.script - 1];
  }

  running(i: number): boolean {
    return (this.state[i]?.phase ?? -1) >= 0;
  }

  tick(reels: readonly Reel[], cycles: number): void {
    if (cycles <= 0) return;
    for (let i = 0; i < reels.length; i++) {
      const reel = reels[i];
      if (!reel) continue;
      const s = this.slot(i);
      const wiring = this.wiring[i];
      if (!s.seen) { s.seen = true; s.travel = reel.travel; continue; }

      const delta = reel.travel - s.travel;
      if (delta !== 0) {
        s.dir = delta > 0 ? 1 : -1;
        if (s.moving) s.steps += Math.abs(delta);
        else { s.moving = true; s.steps = 0; }
        s.travel = reel.travel;
        s.idle = 0;
        if (s.phase >= 0) { s.phase = -1; reel.bounce = 0; }
        continue;
      }

      if (s.moving) {
        s.idle += cycles;
        const settle = this.profile.settleCycles[Math.min(wiring?.kind ?? 0, 2)];
        if (s.idle <= settle) continue;
        s.moving = false;
        const script = this.scriptFor(wiring);
        if (script && s.steps > this.profile.minTravel) {
          s.phase = -1;
          s.hold = 0;
          this.advance(reel, s, script);
        }
        continue;
      }

      if (s.phase >= 0) {
        const script = this.scriptFor(wiring)!;
        s.hold -= cycles;
        while (s.hold <= 0 && s.phase >= 0) this.advance(reel, s, script);
      }
    }
  }

  private advance(reel: Reel, s: ReelBounceState, script: readonly BouncePhase[]): void {
    s.phase++;
    if (s.phase >= script.length) { s.phase = -1; reel.bounce = 0; return; }
    const ph = script[s.phase];
    reel.bounce = ph.offset === 0 ? 0 : s.dir * ph.offset;
    s.hold += ph.ticks * this.profile.serviceCycles;
    if (ph.ticks === 0) s.phase = -1;
  }
}
