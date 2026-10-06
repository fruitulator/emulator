import type { AudioSource } from '../machine/machine';
import { OneBitSpeaker } from './speaker';
import { BASE_BOARD_BASS_FREQ } from './blipleak';

export const PERIOD_NE555: readonly number[] = [0, 400, 430, 460, 490, 520, 550, 650, 770, 890, 1020, 1160, 1300, 2800, 4500, 7000];
export const PERIOD_NE566: readonly number[] = [5000, 1333, 1136, 791, 666, 500, 357, 270];
export const PERIOD_NE555_2: readonly number[] = [5000, 1333, 1136, 791, 666, 500, 357, 270];

export type BbSoundType = 0 | 1 | 2;

export function bbTonePeriod(type: BbSoundType, page: number, v: number): number | null {
  const n = v & 0xf;
  if (type === 2) {
    if (page !== 0x380) return null;
    return n === 0 ? 0 : (PERIOD_NE555_2[(~n) & 0xf] ?? 0);
  }
  if (page !== 0x500) return null;
  if (type === 0) return n < 8 ? 0 : PERIOD_NE566[n - 8];
  return PERIOD_NE555[n];
}

export const BB_TONE_RATE = 48000;
const TONE_CLOCK = 1_000_000;

export class BbTone implements AudioSource {
  private readonly speaker = new OneBitSpeaker(TONE_CLOCK, BB_TONE_RATE, { bassFreq: BASE_BOARD_BASS_FREQ });
  private half = 0;
  private countdown = 0;
  private high = 0;

  get rate(): number { return this.speaker.rate; }

  setPeriod(cycles: number): void {
    this.half = cycles >> 1;
    if (this.countdown < 1) this.countdown = this.half;
  }

  get frequency(): number {
    return this.half > 0 ? 1e6 / (this.half * 2) : 0;
  }

  reset(): void {
    this.half = 0;
    this.countdown = 0;
    this.high = 0;
    this.speaker.reset();
  }

  tick(cycles: number, cpuHz: number = TONE_CLOCK): void {
    let left = (cycles * TONE_CLOCK) / cpuHz;
    while (left > 0 && this.countdown > 0) {
      if (this.countdown > left) { this.countdown -= left; this.speaker.tick(left); return; }
      this.speaker.tick(this.countdown);
      left -= this.countdown;
      this.high = this.high ? 0 : 1;
      this.countdown = this.half;
      if (this.half === 0) this.high = 0;
      this.speaker.write(0, this.high);
    }
    if (left > 0) this.speaker.tick(left);
  }

  buffered(): number {
    return this.speaker.buffered();
  }

  readAudio(out: Float32Array, frames: number): number {
    return this.speaker.readAudio(out, frames);
  }
}
