
const DATA = 0x50;
const HEADER = 0x40;

const CMD_MOVE = 0x62;
const CMD_CONFIGURE = 0x66;
const CMD_POLL = 0x67;
const CMD_READ_POSITIONS = 0x68;
const CMD_IDENTIFY = 0x69;
const CMD_SET_SPEED = 0x6a;

const ACK = 0x76;

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

export class JpmReels {
  readonly reels: JpmReel[] = [];
  optos = 0;
  changed = false;
  unknownSpeedCode = 0;
  readonly standInSteps: number[] = [];

  private rampAt = rampBase(RAMP_FIRST_CODE);
  private rxBuf: number[] = [];

  constructor(count = 6) {
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
    this.rampAt = rampBase(RAMP_FIRST_CODE);
    this.rxBuf = [];
    this.optos = 0;
    this.unknownSpeedCode = 0;
  }

  rxByte(b: number): number[] | null {
    b &= 0xff;
    this.rxBuf.push(b);
    if (b >= 0x60 && b <= 0x6f) {
      const reply = this.dispatch(this.rxBuf);
      this.rxBuf = [];
      return reply;
    }
    if (this.rxBuf.length > 32) this.rxBuf.shift();
    return null;
  }

  private static pair(msg: number[], i: number): number {
    return ((msg[i] ?? 0) & 0xf) + 16 * ((msg[i + 1] ?? 0) & 0xf);
  }

  private static emit(reply: number[], value: number): void {
    reply.push(DATA | (value & 0xf), DATA | ((value >> 4) & 0xf));
  }

  private dispatch(msg: number[]): number[] {
    const cmd = msg[msg.length - 1];
    const reply: number[] = [];
    switch (cmd) {
      case CMD_CONFIGURE: {
        const pairs = msg.length > 1 ? msg[0] & 0xf : 0;
        for (let i = 0; i < 4; i++) {
          const v = JpmReels.pair(msg, 1 + i * 2);
          const fitted = pairs === 4 ? v === 1 || v === 6 : i < 3;
          if (this.reels[i]) this.reels[i].present = fitted;
        }
        reply.push(ACK);
        break;
      }
      case CMD_SET_SPEED: {
        const code = JpmReels.pair(msg, 1);
        if (code >= RAMP_FIRST_CODE && code <= RAMP_LAST_CODE) this.rampAt = rampBase(code);
        else this.unknownSpeedCode = code;
        reply.push(ACK);
        break;
      }
      case CMD_MOVE: {
        for (let i = 0; i < 4; i++) {
          const base = 1 + i * 4;
          const hundreds = (msg[base] ?? 0) & 0xf;
          const reverse = ((msg[base + 1] ?? 0) & 0x8) !== 0;
          const steps = ((msg[base + 2] ?? 0) & 0xf) + 16 * ((msg[base + 3] ?? 0) & 0xf) + 256 * hundreds;
          const r = this.reels[i];
          if (r && r.present) {
            r.stepsRemaining = reverse ? -steps : steps;
            if (steps !== 0) { r.ramp = 0; r.accel = true; }
          }
        }
        reply.push(ACK);
        break;
      }
      case CMD_POLL: {
        let busy = 0;
        for (let i = 0; i < 4; i++) {
          const r = this.reels[i];
          if (r?.present && r.stepsRemaining !== 0) busy |= 1 << i;
        }
        reply.push(HEADER | 1);
        JpmReels.emit(reply, busy);
        break;
      }
      case CMD_READ_POSITIONS: {
        reply.push(HEADER | 4);
        for (let i = 0; i < 4; i++) JpmReels.emit(reply, this.reels[i]?.pos ?? 0);
        break;
      }
      case CMD_IDENTIFY: {
        reply.push(HEADER | 1);
        JpmReels.emit(reply, IDENTITY);
        break;
      }
      default:
        break;
    }
    return reply;
  }

  subStep(n: number): number {
    const r = this.reels[n];
    if (!r || !r.present || r.stepsRemaining === 0 || r.timer <= 0) return 0;
    const period = RAMP[this.rampAt + r.ramp];
    return (r.stepsRemaining < 0 ? -1 : 1) * Math.min(1, Math.max(0, 1 - r.timer / period));
  }

  tick(cycles: number): void {
    for (const r of this.reels) {
      if (r.stepsRemaining === 0 || !r.present) continue;
      if (r.timer === 0) { r.timer = RAMP[this.rampAt + r.ramp]; continue; }
      r.timer -= cycles;
      if (r.timer >= 1) continue;
      const dir = r.stepsRemaining < 0 ? -1 : 1;
      r.stepsRemaining -= dir;
      const left = Math.abs(r.stepsRemaining);
      if (r.ramp < 3 && r.accel) r.ramp++;
      else if (left !== 0 && left < 5) { r.accel = false; r.ramp--; }
      r.timer = left === 0 ? 0 : r.timer + RAMP[this.rampAt + r.ramp];
      r.pos = (r.pos + dir + r.steps) % r.steps;
      r.reelpos = (r.pos + r.adjust + r.steps) % r.steps;
      r.stepped += dir;
      this.changed = true;
    }
  }
}
