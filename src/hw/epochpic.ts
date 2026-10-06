const OSC_HALF_PERIOD = 3000;

export class EpochPic {
  private out = false;
  private shiftOut = 0;

  private reply: number[] = [];
  private replyIndex = 0;
  private replyLeft = 0;

  private inByte = 0;
  private inBits = 0;
  private outBits = 0;

  private clockLevel = false;
  private dataLevel = false;
  private swallow = 0;

  private oscLevel = false;
  private oscCycles = 0;

  now: () => Date = () => new Date();

  rtcReads = 0;

  private pinnedAt: number | null = null;
  private pinnedCycles = 0;

  constructor(private readonly clockHz = 16_000_000) {}

  pin(at: Date | null): void {
    this.pinnedAt = at === null ? null : at.getTime();
    this.pinnedCycles = 0;
  }

  get oscillator(): boolean {
    return this.oscLevel;
  }

  tick(cycles: number): void {
    this.pinnedCycles += cycles;
    this.oscCycles += cycles;
    while (this.oscCycles >= OSC_HALF_PERIOD) {
      this.oscCycles -= OSC_HALF_PERIOD;
      this.oscLevel = !this.oscLevel;
    }
  }

  reset(): void {
    this.oscLevel = false;
    this.oscCycles = 0;
    this.out = false;
    this.shiftOut = 0;
    this.reply = [];
    this.replyIndex = 0;
    this.replyLeft = 0;
    this.inByte = 0;
    this.inBits = 0;
    this.outBits = 0;
    this.clockLevel = false;
    this.dataLevel = false;
    this.swallow = 0;
  }

  get dataOut(): boolean {
    return this.out;
  }

  setData(level: boolean): void {
    this.dataLevel = level;
  }

  setClock(level: boolean): void {
    if (level === this.clockLevel) return;
    this.clockLevel = level;

    if (level) {
      this.out = (this.shiftOut & 0x80) !== 0;
      this.shiftOut = (this.shiftOut << 1) & 0xff;
      return;
    }

    this.outBits++;
    if (this.outBits === 8) {
      this.outBits = 0;
      if (this.replyLeft) {
        this.replyLeft--;
        this.shiftOut = this.reply[this.replyIndex++] ?? 0;
      }
    }

    this.inByte = ((this.inByte << 1) | (this.dataLevel ? 1 : 0)) & 0xff;
    this.inBits++;
    if (this.inBits === 8) {
      this.inBits = 0;
      this.command(this.inByte);
      this.inByte = 0;
    }
  }

  private command(cmd: number): void {
    if (this.swallow) {
      this.swallow--;
      return;
    }
    switch (cmd) {
      case 0xf9:
      case 0xfa:
        this.load([0x3b, 0x27, 0x14, 0x0c, 0x1b, 0x07]);
        break;
      case 0xfd: {
        this.rtcReads++;
        if (this.pinnedAt !== null) {
          const t = new Date(this.pinnedAt + Math.floor((this.pinnedCycles * 1000) / this.clockHz));
          this.load([t.getUTCSeconds(), t.getUTCMinutes(), t.getUTCHours(), t.getUTCDate(),
            (t.getUTCMonth() + 1) | 0x10, t.getUTCFullYear() % 100]);
          break;
        }
        const t = this.now();
        this.load([
          t.getSeconds(),
          t.getMinutes(),
          t.getHours(),
          t.getDate(),
          (t.getMonth() + 1) | 0x10,
          t.getFullYear() % 100,
        ]);
        break;
      }
      case 0xfe:
        this.swallow = 6;
        break;
      default:
        break;
    }
  }

  private load(bytes: number[]): void {
    this.reply = bytes;
    this.replyIndex = 0;
    this.replyLeft = bytes.length;
    this.shiftOut = this.reply[this.replyIndex++] ?? 0;
  }
}
