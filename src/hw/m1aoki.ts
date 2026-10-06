import type { Msm6376 } from './msm6376';

export const M1A_OKI_POLL_INSTRUCTIONS = 50;

const NAR_AFTER_PLAY = 50;
const NAR_AFTER_REPLAY = 45;

export class M1aOki {
  private latch = 0;
  private pend1 = -1;
  private pend2 = -1;
  private prev = 1;
  private st = true;
  private ch2 = false;
  private readonly busy = [false, false];
  private atten = 0;
  private pulses = 0;
  private ch2TookPend1 = false;
  private replayDue = false;
  nar = true;
  private narCount = 0;

  constructor(private readonly chip: Msm6376) {}

  reset(): void {
    this.latch = 0;
    this.pend1 = -1;
    this.pend2 = -1;
    this.prev = 1;
    this.st = true;
    this.ch2 = false;
    this.busy.fill(false);
    this.atten = 0;
    this.pulses = 0;
    this.ch2TookPend1 = false;
    this.replayDue = false;
    this.nar = true;
    this.narCount = 0;
  }

  writeLatch(v: number): void {
    this.latch = v & 0x7f;
  }

  private exists(n: number): boolean {
    return n > 0 && this.chip.phrase(n) !== undefined;
  }

  private get sampled(): boolean {
    return this.chip.phraseCount > 0;
  }

  private play(n: number, ch: number, atten: number): void {
    const cut = atten === 1 ? 50 : atten === 2 ? 100 : atten;
    this.chip.startNow(n, ch, (0xff - cut) / 0xff);
  }

  control(val: number): void {
    const stEdge = ((val ^ this.prev) & 1) !== 0;
    if (stEdge) this.st = (val & 1) !== 0;
    const ch2Edge = ((val ^ this.prev) & 2) !== 0;
    if (ch2Edge) this.ch2 = (val & 2) !== 0;

    if (this.ch2 && !ch2Edge && stEdge && !this.st && this.sampled) {
      this.pend1 = this.latch;
      if (!this.exists(this.pend1) && this.pend1 !== 0) {
        this.pend1 = -1;
        this.pend2 = -1;
        this.ch2TookPend1 = false;
      } else {
        if (this.pend1 === 0) {
          this.pend2 = -1;
          this.ch2TookPend1 = false;
          this.replayDue = false;
        }
        if (!this.busy[0] || this.pend1 === 0) {
          this.nar = false;
          if (this.pend1 < 0x70 || this.pend1 > 0x78) this.narCount = NAR_AFTER_PLAY;
          const tune = this.pend1;
          this.pend1 = -1;
          this.busy[0] = true;
          this.play(tune, 0, 0);
        } else if (this.nar) {
          this.pend1 = this.latch;
          this.nar = false;
          this.narCount = 0;
        }
      }
    }

    if (!this.ch2) {
      if (ch2Edge) this.pulses = 0;
      if (stEdge) {
        if (!this.st) {
          if (this.pulses === 0) this.pend2 = this.latch;
        } else {
          if (this.pulses < 3) {
            this.pulses++;
            this.atten++;
          } else {
            this.pulses = 0;
            this.atten = 0;
          }
          if (this.pulses === 1) this.atten = 0;
        }
      }
    }

    if (this.ch2 && ch2Edge) {
      let tune: number;
      if (this.pulses === 0 && this.pend2 < 0) {
        tune = this.pend1;
        if (this.pend1 >= 0) {
          this.ch2TookPend1 = true;
          this.atten = 1;
        }
      } else {
        tune = this.pend2;
      }
      if (tune >= 0 && this.sampled && this.exists(tune)) {
        if (!this.busy[1] && this.pend2 > 0) {
          this.busy[1] = true;
          this.play(tune, 1, this.atten);
        }
      }
    }
    this.prev = val & 0xff;
  }

  poll(): boolean {
    const was = this.nar;
    if (this.narCount > 0 && --this.narCount === 0) this.nar = true;
    for (let ch = 0; ch < 2; ch++) {
      if (this.busy[ch] && !this.chip.voicePlaying(ch)) {
        this.ended(ch);
        if (this.replayDue) {
          this.replay(ch);
          this.replayDue = false;
        }
      }
    }
    return !was && this.nar;
  }

  private ended(ch: number): void {
    if (ch === 0 && (this.pend1 >= 0 || (this.prev & 3) === 2)) this.replayDue = true;
    if (ch === 1 && this.ch2TookPend1) this.replayDue = true;
    this.busy[ch] = false;
    if (!this.busy[0]) {
      this.nar = true;
      this.narCount = 0;
    }
  }

  private replay(ch: number): void {
    if (ch === 0 && this.sampled) {
      let tune: number;
      if (this.pend1 < 0) {
        tune = this.latch;
      } else {
        tune = this.pend1;
        this.pend1 = -1;
      }
      this.busy[0] = true;
      this.nar = false;
      this.narCount = NAR_AFTER_REPLAY;
      this.play(tune, 0, 0);
    }
    if (ch === 1 && this.ch2TookPend1 && this.pend1 >= 0 && this.sampled) {
      this.busy[1] = true;
      this.play(this.pend1, 1, this.atten);
    }
  }
}
