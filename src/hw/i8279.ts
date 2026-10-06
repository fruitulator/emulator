
export interface I8279Hooks {
  scanLine?(value: number): void;
  display?(value: number): void;
  readReturn?(): number;
  irq?(state: boolean): void;
}

export class I8279 {
  readonly dram = new Uint8Array(16);
  readonly sram = new Uint8Array(8);
  private readonly fifo = new Uint8Array(8);

  private readonly cmd = new Uint8Array(8);

  private status = 0;
  private scanner = 0;
  private dPtr = 0;
  private sPtr = 0;
  private autoInc = false;
  private readFlag = false;
  private keyDown = 0;
  private debounce = 0;
  private seMode = false;

  constructor(private readonly hooks: I8279Hooks = {}) {
    this.reset();
  }

  reset(): void {
    this.dram.fill(0);
    this.sram.fill(0);
    this.fifo.fill(0);
    this.cmd.fill(0);
    this.status = 0;
    this.scanner = 0;
    this.dPtr = 0;
    this.sPtr = 0;
    this.autoInc = false;
    this.readFlag = false;
    this.keyDown = 0;
    this.debounce = 0;
    this.seMode = false;
  }

  private get decoded(): boolean { return (this.cmd[0] & 1) !== 0; }
  private get kbdType(): number { return (this.cmd[0] & 6) >> 1; }

  get displayPointer(): number { return this.dPtr & 15; }

  read(a0: number): number {
    return (a0 & 1) ? this.status : this.dataRead();
  }

  write(a0: number, value: number): void {
    if (a0 & 1) this.command(value & 0xff);
    else this.dataWrite(value & 0xff);
  }

  private command(data: number): void {
    const cmd = data >> 5;
    const arg = data & 0x1f;
    this.cmd[cmd] = arg;
    switch (cmd) {
      case 2:
        this.readFlag = false;
        if ((this.cmd[0] & 6) === 4) {
          this.autoInc = (arg & 0x10) !== 0;
          this.sPtr = arg & 7;
        }
        break;
      case 3:
        this.readFlag = true;
        this.dPtr = arg & 15;
        this.autoInc = (arg & 0x10) !== 0;
        break;
      case 4:
        this.dPtr = arg & 15;
        this.autoInc = (arg & 0x10) !== 0;
        break;
      case 6:
        this.clearDisplay();
        break;
      case 7:
        this.hooks.irq?.(false);
        this.status &= ~0x40 & 0xff;
        this.seMode = (arg & 1) !== 0;
        break;
      default:
        break;
    }
  }

  private clearDisplay(): void {
    const arg = this.cmd[6];
    if (arg & 2) {
      const fill = (arg & 4) ? 0xff : 0x00;
      this.dram.fill(fill);
    }
    if (arg & 1) {
      this.status &= ~0x07 & 0xff;
      this.sPtr = 0;
      this.hooks.irq?.(false);
    }
  }

  private dataWrite(data: number): void {
    this.dram[this.dPtr & 15] = data;
    if (this.autoInc) this.dPtr = (this.dPtr + 1) & 15;
  }

  private dataRead(): number {
    let data: number;
    const sensorMode = (this.cmd[0] & 6) === 4;
    if (this.readFlag) {
      data = this.dram[this.dPtr & 15];
      if (this.autoInc) this.dPtr = (this.dPtr + 1) & 15;
    } else if (sensorMode) {
      data = this.sram[this.sPtr & 7];
      if (this.autoInc) this.sPtr = (this.sPtr + 1) & 7;
      else this.hooks.irq?.(false);
    } else {
      data = this.fifo[0];
      let size = this.status & 7;
      switch (this.status & 0x38) {
        case 0x00:
          if (!size) {
            this.status |= 0x10;
          } else {
            for (let i = 1; i < 8; i++) this.fifo[i - 1] = this.fifo[i];
            size--;
            if (!size) this.hooks.irq?.(false);
          }
          break;
        case 0x28:
        case 0x08:
          for (let i = 1; i < 8; i++) this.fifo[i - 1] = this.fifo[i];
          break;
        default:
          break;
      }
      this.status = (this.status & 0xd0) | size;
    }
    this.dPtr &= 15;
    this.sPtr &= 7;
    return data & 0xff;
  }

  private pushFifo(data: number): void {
    const size = this.status & 7;
    if (size < 8) {
      this.fifo[size] = data & 0xff;
      this.status = (this.status & 0xf8) | (size + 1);
      if (size + 1 === 8) this.status |= 0x08;
    } else {
      this.status |= 0x20;
    }
    this.hooks.irq?.(true);
  }

  scan(): void {
    const scannerMask = this.decoded ? 3 : ((this.cmd[0] & 8) ? 15 : 7);

    if (this.hooks.readReturn) {
      const rl = this.hooks.readReturn() ^ 0xff;
      const addr = this.scanner & 7;
      const down = rl & ~this.sram[addr] & 0xff;
      switch (this.kbdType) {
        case 0:
        case 1:
          if (down !== 0) {
            for (let i = 0; i < 8; i++) {
              if (!((down >> i) & 1)) continue;
              const key = (addr << 3) | i;
              if (this.debounce === 0) {
                this.keyDown = key;
                this.debounce = 1;
              } else if (this.keyDown === key && this.debounce++ > 1) {
                this.pushFifo(key);
                this.sram[addr] |= 1 << i;
                this.debounce = 0;
              }
            }
          }
          if ((this.keyDown >> 3) === addr && !((rl >> (this.keyDown & 7)) & 1)) {
            this.debounce = 0;
          }
          this.sram[addr] &= rl;
          break;
        case 2:
          if (down !== 0 && !this.seMode) this.status |= 0x40;
          if (this.sram[addr] !== rl) {
            this.sram[addr] = rl;
            this.hooks.irq?.(true);
          }
          break;
        default:
          this.sram[addr] = rl;
          break;
      }
    }

    this.scanner = (this.scanner + 1) & (this.decoded ? 3 : 15);
    this.hooks.scanLine?.(this.decoded ? (1 << this.scanner) ^ 15 : this.scanner);
    this.hooks.display?.(this.dram[this.scanner & scannerMask]);
  }
}
