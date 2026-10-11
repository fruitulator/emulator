
const CMD_MOVE = 2;
const CMD_CONFIGURE = 6;
const CMD_POLL = 7;
const CMD_READ_POSITIONS = 8;
const CMD_IDENTIFY = 9;
const CMD_SET_SPEED = 10;

const ACK = 0x36;

const REELS_PER_CHANNEL = 4;
const CHANNELS = 2;

const IDENTITY = 15;

const RAMP_FIRST_CODE = 0x86;
const RAMP_LAST_CODE = 0x8b;
const RAMP: readonly number[] = [
  16367,
  40000, 20000, 10000, 5750,
  60416, 25000, 12500, 6150,
  60000, 30000, 15000, 6550,
  72000, 36000, 18000, 9000,
  84000, 42000, 21000, 10500,
  69000, 48000, 27500, 18750,
];
const rampBase = (code: number): number => 1 + (code - RAMP_FIRST_CODE) * 4;

const DEFAULT_HALF_STEPS = 96;

interface JpmReel {
  pos: number;
  reelpos: number;
  stepsRemaining: number;
  steps: number;
  adjust: number;
  present: boolean;
  stepped: number;
  timer: number;
  ramp: number;
  accel: boolean;
}

interface JpmChannel {
  base: number;
  first: number;
  rampAt: number;
  left: number;
  msg: number[];
}

export class JpmReels {
  readonly reels: JpmReel[] = [];
  optos = 0;
  changed = false;
  unknownSpeedCode = 0;
  readonly standInSteps: number[] = [];

  private readonly channels: JpmChannel[] = [];

  get rampAt(): number { return this.channels[0].rampAt; }
  set rampAt(v: number) { if (Number.isInteger(v) && v >= 0 && v < RAMP.length) this.channels[0].rampAt = v; }

  constructor(count = CHANNELS * REELS_PER_CHANNEL) {
    for (let ch = 0; ch < CHANNELS; ch++) {
      this.channels.push({ base: 0x40 << ch, first: ch * REELS_PER_CHANNEL, rampAt: rampBase(RAMP_FIRST_CODE), left: 0, msg: [] });
    }
    for (let i = 0; i < count; i++) {
      this.reels.push({
        pos: 0, reelpos: 0, stepsRemaining: 0, steps: DEFAULT_HALF_STEPS, adjust: 0, present: false, stepped: 0,
        timer: 0, ramp: 0, accel: true,
      });
    }
  }

  setGeometry(n: number, steps: number, adjust: number): void {
    const r = this.reels[n];
    if (!r) return;
    if (steps > 0) r.steps = steps;
    else if (!this.standInSteps.includes(n)) {
      this.standInSteps.push(n);
      this.standInSteps.sort((a, b) => a - b);
    }
    r.adjust = adjust;
  }

  setPosition(n: number, pos: number): void {
    const r = this.reels[n];
    if (!r || !r.present) return;
    r.pos = ((Math.round(pos) % r.steps) + r.steps) % r.steps;
    r.reelpos = (r.pos + r.adjust + r.steps) % r.steps;
  }

  reset(): void {
    for (const r of this.reels) {
      r.stepsRemaining = 0;
      r.present = false;
      r.timer = 0;
      r.ramp = 0;
      r.accel = true;
    }
    for (const c of this.channels) { c.rampAt = rampBase(RAMP_FIRST_CODE); c.left = 0; c.msg = []; }
    this.optos = 0;
    this.unknownSpeedCode = 0;
  }

  rxByte(b: number): number[] | null {
    b &= 0xff;
    const c = b & 0x40 ? this.channels[0] : b & 0x80 ? this.channels[1] : null;
    if (!c) return null;
    if (c.left !== 0) {
      c.msg.push(b & 0xf);
      if (--c.left !== 0) return null;
      return this.dispatch(c);
    }
    if (b & 0x20) {
      c.msg = [b & 0xf];
      return this.dispatch(c);
    }
    c.left = (b & 0xf) * 2 + 1;
    c.msg = [b & 0xf];
    return null;
  }

  private static pair(msg: number[], i: number): number {
    return ((msg[i] ?? 0) & 0xf) + 16 * ((msg[i + 1] ?? 0) & 0xf);
  }

  private static emit(reply: number[], base: number, value: number): void {
    reply.push(base | 0x10 | (value & 0xf), base | 0x10 | ((value >> 4) & 0xf));
  }

  private dispatch(c: JpmChannel): number[] {
    const msg = c.msg;
    const cmd = msg[msg.length - 1];
    const head = msg[0];
    const base = c.base;
    const reel = (i: number): JpmReel | undefined => this.reels[c.first + i];
    const reply: number[] = [];
    switch (cmd) {
      case CMD_CONFIGURE: {
        for (let i = 0; i < REELS_PER_CHANNEL; i++) {
          const v = JpmReels.pair(msg, 1 + i * 2);
          const fitted = head === 4 ? v === 1 || v === 6 : i < 3;
          const r = reel(i);
          if (r) r.present = fitted;
        }
        reply.push(base | ACK);
        break;
      }
      case CMD_SET_SPEED: {
        const code = JpmReels.pair(msg, 1);
        if (code >= RAMP_FIRST_CODE && code <= RAMP_LAST_CODE) c.rampAt = rampBase(code);
        else this.unknownSpeedCode = code;
        reply.push(base | ACK);
        break;
      }
      case CMD_MOVE: {
        for (let i = 0; i < REELS_PER_CHANNEL; i++) {
          const at = 1 + i * 4;
          const hundreds = (msg[at] ?? 0) & 0xf;
          const reverse = ((msg[at + 1] ?? 0) & 0x8) !== 0;
          const steps = ((msg[at + 2] ?? 0) & 0xf) + 16 * ((msg[at + 3] ?? 0) & 0xf) + 256 * hundreds;
          const r = reel(i);
          if (r && r.present) {
            r.stepsRemaining = reverse ? -steps : steps;
            if (steps !== 0) { r.ramp = 0; r.accel = true; }
          }
        }
        reply.push(base | ACK);
        break;
      }
      case CMD_POLL: {
        let busy = 0;
        for (let i = 0; i < REELS_PER_CHANNEL; i++) {
          const r = reel(i);
          if (r?.present && r.stepsRemaining !== 0) busy |= 1 << i;
        }
        reply.push(base | 1);
        JpmReels.emit(reply, base, busy);
        break;
      }
      case CMD_READ_POSITIONS: {
        reply.push(base | 4);
        for (let i = 0; i < REELS_PER_CHANNEL; i++) JpmReels.emit(reply, base, reel(i)?.pos ?? 0);
        break;
      }
      case CMD_IDENTIFY: {
        reply.push(base | 1);
        JpmReels.emit(reply, base, IDENTITY);
        break;
      }
      default:
        break;
    }
    return reply;
  }

  private rampOf(n: number): number {
    return this.channels[Math.min(CHANNELS - 1, Math.floor(n / REELS_PER_CHANNEL))].rampAt;
  }

  subStep(n: number): number {
    const r = this.reels[n];
    if (!r || !r.present || r.stepsRemaining === 0 || r.timer <= 0) return 0;
    const period = RAMP[this.rampOf(n) + r.ramp];
    return (r.stepsRemaining < 0 ? -1 : 1) * Math.min(1, Math.max(0, 1 - r.timer / period));
  }

  tick(cycles: number): void {
    for (let n = 0; n < this.reels.length; n++) {
      const r = this.reels[n];
      const rampAt = this.rampOf(n);
      if (r.stepsRemaining === 0 || !r.present) continue;
      if (r.timer === 0) { r.timer = RAMP[rampAt + r.ramp]; continue; }
      r.timer -= cycles;
      if (r.timer >= 1) continue;
      const dir = r.stepsRemaining < 0 ? -1 : 1;
      r.stepsRemaining -= dir;
      const left = Math.abs(r.stepsRemaining);
      if (r.ramp < 3 && r.accel) r.ramp++;
      else if (left !== 0 && left < 5) { r.accel = false; r.ramp--; }
      r.timer = left === 0 ? 0 : r.timer + RAMP[rampAt + r.ramp];
      r.pos = (r.pos + dir + r.steps) % r.steps;
      r.reelpos = (r.pos + r.adjust + r.steps) % r.steps;
      r.stepped += dir;
      this.changed = true;
    }
  }
}
