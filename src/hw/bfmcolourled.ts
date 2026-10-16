export const BFM_COLOUR_LED_DATA_BYTES = 48;
export const BFM_COLOUR_LED_INTENSITIES = 6;
export const BFM_COLOUR_LED_FRAME_BYTES = BFM_COLOUR_LED_DATA_BYTES + BFM_COLOUR_LED_INTENSITIES;

export class BfmColourLed {
  readonly frame = new Uint8Array(BFM_COLOUR_LED_FRAME_BYTES);
  frames = 0;
  private clk = 0;
  private enabled = false;
  private shift = 0;
  private bits = 0;
  private word = 0;
  private byteCount = 0;
  private dataCount = 0;
  private intCount = 0;
  private readonly data = new Uint8Array(BFM_COLOUR_LED_DATA_BYTES);
  private readonly intensity = new Uint8Array(BFM_COLOUR_LED_INTENSITIES);

  write(v: number): void {
    const enable = (v & 4) !== 0;
    const clock = v & 1 ? 1 : 0;
    let ready = -1;
    if (!enable) {
      if (this.enabled) { this.shift = 0; this.bits = 0; }
      this.enabled = false;
      this.clk = clock;
    } else {
      this.enabled = true;
      if (clock !== this.clk) {
        this.clk = clock;
        if (clock === 0) {
          this.shift = ((this.shift << 1) | ((v & 2) === 0 ? 1 : 0)) & 0xff;
          if (++this.bits === 8) {
            this.bits = 0;
            ready = this.shift;
          }
        }
      }
    }
    if (!enable) {
      this.byteCount = 0;
      if (this.dataCount >= BFM_COLOUR_LED_DATA_BYTES) {
        this.dataCount = 0;
        this.publish();
      }
      if (this.intCount >= BFM_COLOUR_LED_INTENSITIES) {
        this.intCount = 0;
        this.publish();
      }
    }
    if (ready >= 0) this.byte(ready);
  }

  private byte(b: number): void {
    this.word = ((this.word << 8) | b) & 0xffff;
    if (++this.byteCount & 1) return;
    const hi = this.word >> 8;
    const lo = this.word & 0xff;
    if ((hi >= 1 && hi <= 8) || hi > 0x0f) {
      if (this.dataCount < BFM_COLOUR_LED_DATA_BYTES) this.data[this.dataCount++] = lo;
    } else if (hi === 0x0a) {
      if (this.byteCount <= 12) this.intensity[(this.byteCount >> 1) - 1] = Math.min(255, (lo & 0x0f) * 16 + 16);
      this.intCount++;
    } else if (hi === 0x0c) {
      this.intCount++;
    }
  }

  private publish(): void {
    this.frame.set(this.data, 0);
    this.frame.set(this.intensity, BFM_COLOUR_LED_DATA_BYTES);
    this.frames++;
  }

  reset(): void {
    this.data.fill(0);
    this.byteCount = 0;
    this.dataCount = 0;
    this.intCount = 0;
  }
}
