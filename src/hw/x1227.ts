export class X1227 {
  static readonly EEPROM_ADDRESS = 0xae;
  static readonly CCR_ADDRESS = 0xde;

  readonly data = new Uint8Array(512).fill(0xff);

  private readonly ccr = new Uint8Array(0x14);

  private wel = false;
  private rwel = false;
  private rtcf = false;

  private target: 'eeprom' | 'ccr' | null = null;
  private addressBytes = 0;
  private addr = 0;
  private terminated = false;
  private ccrWritten = false;

  now: () => Date = () => new Date();

  private pinnedAt: number | null = null;
  private pinnedCycles = 0;
  private pinnedHz = 1;

  pin(at: Date | null, hz: number): void {
    this.pinnedAt = at === null ? null : at.getTime();
    this.pinnedCycles = 0;
    this.pinnedHz = Math.max(1, hz);
  }

  tick(cycles: number): void {
    if (this.pinnedAt !== null) this.pinnedCycles += cycles;
  }

  rtcReads = 0;

  private stamp(): Date {
    this.rtcReads++;
    if (this.pinnedAt === null) return this.now();
    return new Date(this.pinnedAt + Math.floor((this.pinnedCycles * 1000) / this.pinnedHz));
  }

  private latched: Date | null = null;

  private clockRegister(reg: number): number {
    const d = this.latched ?? (this.latched = this.stamp());
    const bcd = (n: number) => ((Math.floor(n / 10) % 10) << 4) | (n % 10);
    switch (reg & 7) {
      case 0: return bcd(d.getSeconds());
      case 1: return bcd(d.getMinutes());
      case 2: return bcd(d.getHours()) | 0x80;
      case 3: return bcd(d.getDate());
      case 4: return bcd(d.getMonth() + 1);
      case 5: return bcd(d.getFullYear() % 100);
      case 6: return d.getDay();
      default: return 0x20;
    }
  }

  static owns(slaveByte: number): boolean {
    const a = slaveByte & 0xfe;
    return a === X1227.EEPROM_ADDRESS || a === X1227.CCR_ADDRESS;
  }

  select(slaveByte: number): void {
    const target = (slaveByte & 0xfe) === X1227.CCR_ADDRESS ? 'ccr' : 'eeprom';
    const reading = (slaveByte & 1) !== 0;
    this.terminated = false;
    this.latched = null;
    if (reading) {
      if (this.target !== target) this.terminated = true;
    } else {
      this.target = target;
      this.addressBytes = 2;
      this.addr = 0;
    }
  }

  private wdtLeft = 0;

  watchdogResets = 0;

  private static wdPeriod(bl: number): number | null {
    switch ((bl >> 3) & 3) {
      case 0: return 1.75;
      case 1: return 0.75;
      case 2: return 0.25;
      default: return null;
    }
  }

  busStart(hz: number): void {
    const p = X1227.wdPeriod(this.ccr[0x10]);
    this.wdtLeft = p === null ? 0 : Math.round(p * hz);
  }

  watchdogHorizon(): number {
    return this.wdtLeft > 0 ? this.wdtLeft : Infinity;
  }

  watchdogTick(cycles: number): boolean {
    if (this.wdtLeft <= 0) return false;
    this.wdtLeft -= cycles;
    if (this.wdtLeft > 0) return false;
    this.wdtLeft = 0;
    this.watchdogResets++;
    return true;
  }

  stopWatchdog(): void {
    this.wdtLeft = 0;
  }

  stop(): void {
    if (this.ccrWritten) this.rwel = false;
    this.ccrWritten = false;
    this.addressBytes = 0;
    this.terminated = false;
    this.latched = null;
  }

  write(v: number): void {
    v &= 0xff;
    if (this.addressBytes > 0) {
      this.addr = ((this.addr << 8) | v) & 0xffff;
      if (--this.addressBytes === 0) this.addr &= this.target === 'ccr' ? 0x3f : 0x1ff;
      return;
    }
    if (this.terminated || this.target === null) return;
    if (this.target === 'eeprom') this.writeArray(v);
    else this.writeCcr(v);
  }

  private writeArray(v: number): void {
    if (this.wel) this.data[this.addr] = v;
    this.addr = (this.addr & 0x1c0) | ((this.addr + 1) & 0x3f);
  }

  private writeCcr(v: number): void {
    if (this.addr === 0x3f) {
      if (v === 0x00) { this.wel = false; this.rwel = false; }
      else if (v === 0x02) { this.wel = true; this.rwel = false; }
      else if (v === 0x06 && this.wel) this.rwel = true;
      this.terminated = true;
      return;
    }
    if (this.wel && this.rwel) {
      if (this.addr >= 0x30 && this.addr <= 0x37) {
        this.rtcf = false;
        this.ccrWritten = true;
      } else if (this.addr < this.ccr.length) {
        this.ccr[this.addr] = v;
        this.ccrWritten = true;
      }
    }
    this.addr = this.nextCcr(this.addr);
  }

  private nextCcr(addr: number): number {
    if (addr >= 0x10 && addr <= 0x13) return 0x10 | ((addr + 1) & 3);
    return (addr & 0x38) | ((addr + 1) & 7);
  }

  arrayRead: ((addr: number) => number | null) | null = null;

  read(): number {
    if (this.terminated || this.target === null) return 0xff;
    if (this.target === 'eeprom') {
      const sub = this.arrayRead ? this.arrayRead(this.addr) : null;
      const v = sub === null ? this.data[this.addr] : sub & 0xff;
      this.addr = (this.addr + 1) & 0x1ff;
      return v;
    }
    if (this.addr === 0x3f) {
      this.terminated = true;
      return (this.rwel ? 0x04 : 0) | (this.wel ? 0x02 : 0) | (this.rtcf ? 0x01 : 0);
    }
    let v = 0;
    if (this.addr >= 0x30 && this.addr <= 0x37) v = this.clockRegister(this.addr);
    else if (this.addr < this.ccr.length) v = this.ccr[this.addr];
    this.addr = this.nextCcr(this.addr);
    return v;
  }
}
