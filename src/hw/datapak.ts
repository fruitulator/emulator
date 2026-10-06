
export const DATAPAK_ACK = 0x06;

const FIRST_REPORT_TYPE = 0x60;

const REPEAT_FLAG = 0x80;

export const DATAPAK_CASH_OUT_PENCE = new Map<number, number>([
  [0x40, 5], [0x41, 10], [0x42, 20], [0x43, 50],
  [0x44, 100], [0x45, 200], [0x46, 500], [0x47, 1000],
]);

export const V20_CPU32_DATAPAK_CLOCK = 8_389_000;

export class DataPak {
  private frame: number[] = [];

  framed = 0;
  unframed = 0;
  flushed = 0;

  private gap = 0;
  private lastAt = 0;

  constructor(clockHz = 0) {
    if (clockHz) this.setClock(clockHz);
  }

  setClock(clockHz: number): void {
    this.gap = Math.floor(clockHz / 40);
  }

  onCashOut?: (pence: number) => void;

  reset(): void {
    this.frame = [];
    this.framed = 0;
    this.unframed = 0;
    this.flushed = 0;
    this.lastAt = 0;
  }

  flushPartial(): void {
    if (this.frame.length) this.flushed++;
    this.frame = [];
  }

  receive(b: number, now: number): number[] | null {
    if (this.gap && this.frame.length && now - this.lastAt > this.gap) this.flushPartial();
    this.lastAt = now;
    b &= 0xff;
    this.frame.push(b);
    if (b === 0 && this.frame.length === 1) {
      this.frame = [];
      return null;
    }
    const want = DataPak.frameLength(this.frame);
    if (want === null || this.frame.length < want) return null;

    const frame = this.frame;
    this.frame = [];
    let sum = 0;
    for (let i = 0; i < frame.length - 1; i++) sum = (sum + frame[i]) & 0xff;
    if (sum !== frame[frame.length - 1]) {
      this.unframed++;
      return null;
    }
    this.framed++;
    const pence = DATAPAK_CASH_OUT_PENCE.get(frame[0]);
    if (pence !== undefined) this.onCashOut?.(pence);
    return [DATAPAK_ACK];
  }

  private static frameLength(frame: readonly number[]): number | null {
    if (frame.length === 0) return null;
    if ((frame[0] & ~REPEAT_FLAG) < FIRST_REPORT_TYPE) return 2;
    if (frame.length < 2) return null;
    return 3 + frame[1];
  }
}
