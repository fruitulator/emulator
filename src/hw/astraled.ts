export const ASTRA_LED_FRAME_BYTES = 48;

export class AstraLedQueue {
  readonly frame = new Uint8Array(ASTRA_LED_FRAME_BYTES);
  private buffer = new Uint8Array(ASTRA_LED_FRAME_BYTES);
  private ptr = 0;
  private changed = false;

  data(v: number): void {
    const p = this.ptr++;
    if (p >= ASTRA_LED_FRAME_BYTES) return;
    if (this.buffer[p] !== v) {
      this.buffer[p] = v;
      this.changed = true;
    }
  }

  control(v: number): void {
    if (v !== 0x0f) return;
    this.ptr = 0;
    if (!this.changed) return;
    this.frame.set(this.buffer);
    this.changed = false;
  }

  reset(): void {
    this.buffer.fill(0);
    this.ptr = 0;
    this.changed = false;
  }
}
