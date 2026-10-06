
import type { Msm6376 } from './msm6376';

export const STATUS_IDLE = 0x40;
export const STATUS_STARTED = 0x80;

const START_DELAY = 700;
const STARTED_DELAY = 200;

export class AceSpSoundPort {
  oki: Msm6376 | null = null;
  onR98?: (v: number) => void;

  private armed = false;
  private cmd = 0;
  private echo = 0;
  private sample = 0;
  private r98 = 0;
  private r9c = 0;
  lampExtend = 0;
  private started = 0;
  private startedTimer = 0;
  private readonly pending = [0, 0];
  private readonly pendingSample = [0, 0];
  private readonly pendingTimer = [0, 0];
  aux = 0;

  reset(): void {
    this.armed = false;
    this.cmd = 0;
    this.echo = 0;
    this.sample = 0;
    this.r98 = 0;
    this.r9c = 0;
    this.lampExtend = 0;
    this.started = 0;
    this.startedTimer = 0;
    this.pending.fill(0);
    this.pendingSample.fill(0);
    this.pendingTimer.fill(0);
    this.aux = 0;
  }

  write(v: number): void {
    v &= 0xff;
    if (!this.armed) {
      if ((v & 0x9f) === 0x80) {
        const sel = (v >> 5) & 3;
        if (sel === 1 || sel === 2) this.start(sel - 1);
        return;
      }
      this.cmd = v;
      this.armed = true;
      return;
    }
    if ((this.cmd & 0x90) === 0x90) this.echo = v;
    switch (this.cmd) {
      case 0x98: this.r98 = v; this.onR98?.(v); break;
      case 0x9a: this.sample = v; break;
      case 0x9b: this.lampExtend = v; break;
      case 0x9c: this.r9c = v; break;
      default: break;
    }
    this.armed = false;
  }

  read(): number {
    this.armed = false;
    switch (this.cmd) {
      case 0x00: return (~this.aux & 0x10) << 3;
      case 0x88: return this.r98;
      case 0x8a: return this.sample;
      case 0x8b: return this.status();
      case 0x8c: return this.r9c;
      default: return this.echo;
    }
  }

  private status(): number {
    let idle = STATUS_IDLE;
    for (let ch = 0; ch < 2; ch++) {
      const playing = this.pendingSample[ch] !== 0 && !!this.oki?.voicePlaying(ch);
      if (playing || this.pending[ch]) idle = 0;
    }
    return this.started | idle | (~this.aux & 0x10);
  }

  private start(ch: number): void {
    if (ch === 0) {
      this.started = 0;
      this.startedTimer = STARTED_DELAY;
    }
    if (this.sample !== 0 && this.oki?.voicePlaying(ch)) return;
    this.pendingSample[ch] = this.sample;
    this.pending[ch] = 1;
    this.pendingTimer[ch] = START_DELAY;
  }

  tick(cycles: number): void {
    if (this.startedTimer > 0) {
      this.startedTimer -= cycles;
      if (this.startedTimer <= 0) {
        this.startedTimer = 0;
        this.started = STATUS_STARTED;
      }
    }
    for (let ch = 0; ch < 2; ch++) {
      if (!this.pending[ch]) continue;
      this.pendingTimer[ch] -= cycles;
      if (this.pendingTimer[ch] > 0) continue;
      this.pendingTimer[ch] = 0;
      this.pending[ch] = 0;
      const n = this.pendingSample[ch];
      if (n === 0) this.oki?.stop(ch);
      else this.oki?.play(n, ch);
    }
  }
}
