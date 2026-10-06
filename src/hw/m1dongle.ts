
export const DONGLE_WINDOW = 49_999;

export function dongleAnswer(challenge: number, key: number): number {
  let x = (challenge ^ key) & 0xff;
  x = ((x >> 4) | (x << 4)) & 0xff;
  let carry = 0;
  for (let i = 0; i < 3; i++) {
    const out = x & 1;
    x = ((carry << 7) | (x >> 1)) & 0xff;
    carry = out;
  }
  return (x + 0x54 + carry) & 0xff;
}

export class MaygayDongle {
  private armed = false;
  private armedAt = 0;

  constructor(readonly key: number) {}

  transmit(b: number, now: number): number | null {
    b &= 0xff;
    if (b === 0xff && !this.armed) {
      this.armed = true;
      this.armedAt = now;
      return null;
    }
    const answer = this.armed && now - this.armedAt <= DONGLE_WINDOW;
    this.armed = false;
    return answer ? dongleAnswer(b, this.key) : null;
  }
}
