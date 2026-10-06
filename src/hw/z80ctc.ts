import { Z80_DAISY_IEO, Z80_DAISY_INT, type Z80DaisyDevice } from './z80daisy';

const INTERRUPT = 0x80;
const MODE = 0x40;
const MODE_COUNTER = 0x40;
const PRESCALER = 0x20;
const EDGE = 0x10;
const EDGE_RISING = 0x10;
const TRIGGER = 0x08;
const TRIGGER_AUTO = 0x00;
const CONSTANT = 0x04;
const RESET = 0x02;
const CONTROL = 0x01;
const WAITING_FOR_TRIG = 0x100;

class CtcChannel {
  mode = RESET;
  tconst = 0x100;
  down = 0;
  extclk = false;
  intState = 0;
  timerLeft: number | null = null;
  timerPeriod: number | null = null;
  private gen = 0;

  constructor(private readonly ctc: Z80Ctc, readonly index: number) {}

  reset(): void {
    this.mode = RESET;
    this.tconst = 0x100;
    this.stop();
    this.intState = 0;
  }

  private start(first: number | null, period: number | null): void {
    this.gen++;
    this.timerLeft = first;
    this.timerPeriod = first === null ? null : period;
  }

  private stop(): void {
    this.start(null, null);
  }

  private period(): number | null {
    if (this.mode & RESET) return null;
    if ((this.mode & MODE) === MODE_COUNTER) return null;
    return ((this.mode & PRESCALER) ? 256 : 16) * this.tconst;
  }

  read(): number {
    if (this.timerLeft === null || (this.mode & WAITING_FOR_TRIG)) return this.down & 0xff;
    const per = (this.mode & MODE) === MODE_COUNTER ? 1 : (this.mode & PRESCALER) ? 256 : 16;
    return Math.floor(this.timerLeft / per + 1) & 0xff;
  }

  write(data: number): void {
    data &= 0xff;
    if (this.mode & CONSTANT) {
      this.tconst = data || 0x100;
      this.mode &= ~CONSTANT;
      this.mode &= ~RESET;
      if ((this.mode & MODE) === MODE_COUNTER || (this.mode & TRIGGER) === TRIGGER_AUTO) {
        const p = this.period();
        this.start(p, p);
      } else {
        this.mode |= WAITING_FOR_TRIG;
        this.start(1, null);
      }
      this.down = this.tconst;
    } else if ((data & CONTROL) === 0 && this.index === 0) {
      this.ctc.vector = data & 0xf8;
    } else if (data & CONTROL) {
      if ((this.mode & MODE) !== MODE_COUNTER && (data & MODE) === MODE_COUNTER && !(data & RESET)) {
        this.stop();
      }
      const startTimer = (this.mode & MODE) === MODE_COUNTER && (data & MODE) !== MODE_COUNTER
        && !(data & RESET) && !(data & CONSTANT);
      if (data & RESET) {
        this.down = this.read();
        this.stop();
      }
      this.mode = data;
      if (startTimer) {
        if ((this.mode & TRIGGER) === TRIGGER_AUTO) {
          const p = this.period();
          this.start(p, p);
        } else {
          this.mode |= WAITING_FOR_TRIG;
          this.start(1, null);
        }
        this.down = this.tconst;
      }
      if (!(data & INTERRUPT) && (this.intState & Z80_DAISY_INT)) {
        this.intState &= ~Z80_DAISY_INT;
        this.ctc.interruptCheck();
      }
    }
  }

  trigger(state: boolean): void {
    if (state === this.extclk) return;
    this.extclk = state;
    const rising = (this.mode & EDGE) === EDGE_RISING;
    if (rising !== state) return;
    if ((this.mode & WAITING_FOR_TRIG) && (this.mode & MODE) !== MODE_COUNTER) {
      const p = this.period();
      this.start(p, p);
    }
    this.mode &= ~WAITING_FOR_TRIG;
    if ((this.mode & MODE) === MODE_COUNTER) {
      this.down = (this.down - 1) & 0xffff;
      if (this.down === 0) this.timerCallback();
    }
  }

  private timerCallback(): void {
    if (this.mode & WAITING_FOR_TRIG) {
      const p = this.period();
      this.start(p, p);
      this.mode &= ~WAITING_FOR_TRIG;
      return;
    }
    if (this.mode & INTERRUPT) {
      this.intState |= Z80_DAISY_INT;
      this.ctc.interruptCheck();
    }
    this.ctc.onZc?.(this.index);
    this.down = this.tconst;
  }

  tick(cycles: number): void {
    if (this.timerLeft === null) return;
    this.timerLeft -= cycles;
    while (this.timerLeft !== null && this.timerLeft <= 0) {
      const over: number = this.timerLeft;
      this.timerLeft = this.timerPeriod === null ? null : over + this.timerPeriod;
      const gen = this.gen;
      this.timerCallback();
      if (this.gen !== gen && this.timerLeft !== null) this.timerLeft += over;
    }
  }
}

export class Z80Ctc implements Z80DaisyDevice {
  readonly channels: CtcChannel[];
  vector = 0;
  onIntr?: (asserted: boolean) => void;
  onZc?: (channel: number) => void;

  constructor() {
    this.channels = [0, 1, 2, 3].map((i) => new CtcChannel(this, i));
  }

  reset(): void {
    for (const c of this.channels) c.reset();
    this.interruptCheck();
  }

  read(offset: number): number {
    return this.channels[offset & 3].read();
  }

  write(offset: number, data: number): void {
    this.channels[offset & 3].write(data);
  }

  trg(ch: number, state: boolean): void {
    this.channels[ch & 3].trigger(state);
  }

  tick(cycles: number): void {
    for (const c of this.channels) c.tick(cycles);
  }

  interruptCheck(): void {
    this.onIntr?.((this.daisyIrqState() & Z80_DAISY_INT) !== 0);
  }

  daisyIrqState(): number {
    let state = 0;
    for (const c of this.channels) {
      if (c.intState & Z80_DAISY_IEO) return state | Z80_DAISY_IEO;
      state |= c.intState;
    }
    return state;
  }

  daisyIrqAck(): number {
    for (const c of this.channels) {
      if (c.intState & Z80_DAISY_INT) {
        c.intState = Z80_DAISY_IEO;
        this.interruptCheck();
        return (this.vector + c.index * 2) & 0xff;
      }
    }
    return this.vector;
  }

  daisyIrqReti(): void {
    for (const c of this.channels) {
      if (c.intState & Z80_DAISY_IEO) {
        c.intState &= ~Z80_DAISY_IEO;
        this.interruptCheck();
        return;
      }
    }
  }
}
