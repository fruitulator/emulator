
export interface Hd6303yPorts {
  portRead(port: 2 | 5 | 6): number;
  portWrite(port: 2 | 5 | 6, v: number, changed: number): void;
  tdrWrite?(v: number): void;
  rdrRead?(v: number): number;
}

export class Hd6303yRegs {
  readonly plain = new Uint8Array(0x28);
  readonly ram = new Uint8Array(0x140);
  ddr2 = 0;
  port2 = 0;
  tcsr = 0;
  frc = 0;
  private frcLatch = 0;
  ocr1 = 0xffff;
  icr = 0;
  tcsr2 = 0;
  rmcr = 0;
  trcsr = 0x20;
  rdr = 0;
  tdr = 0;
  rp5cr = 0xf8;
  port5 = 0;
  ddr6 = 0;
  port6 = 0xff;
  ocr2 = 0xffff;
  tcsr3 = 0;
  tconr = 0xff;
  t2cnt = 0;
  trcsr2 = 0x28;
  tstreg = 0;
  p6csr = 7;
  private prescale = 1;
  private prescaleCount = 1;
  private tdrCount = 0;

  constructor(private readonly ports: Hd6303yPorts) {}

  reset(): void {
    this.port2 = 0;
    this.tcsr = 0;
    this.frc = 0;
    this.ocr1 = 0xffff;
    this.icr = 0;
    this.tcsr2 = 0;
    this.rmcr = 0;
    this.trcsr = 0x20;
    this.rdr = 0;
    this.tdr = 0;
    this.rp5cr = 0xf8;
    this.ddr6 = 0;
    this.ocr2 = 0xffff;
    this.tcsr3 = 0;
    this.tconr = 0xff;
    this.t2cnt = 0;
    this.trcsr2 = 0x28;
    this.tstreg = 0;
    this.port6 = 0xff;
    this.p6csr = 7;
    this.tdrCount = 0;
    this.prescale = 1;
    this.prescaleCount = 1;
  }

  get ramEnabled(): boolean { return (this.rp5cr & 0x40) !== 0; }

  owns(addr: number): boolean {
    return addr < 0x28 || (addr >= 0x40 && addr < 0x140 && this.ramEnabled);
  }

  read(addr: number): number {
    if (addr >= 0x28) return this.ram[addr];
    switch (addr) {
      case 0x03: return this.ports.portRead(2) & 0xff;
      case 0x08: return this.tcsr;
      case 0x09: return this.frc >> 8;
      case 0x0a: this.tcsr &= ~0x20; return this.frc & 0xff;
      case 0x0b: return this.ocr1 >> 8;
      case 0x0c: return this.ocr1 & 0xff;
      case 0x0d: return this.icr >> 8;
      case 0x0e: return this.icr & 0xff;
      case 0x0f: return this.tcsr2;
      case 0x10: return this.rmcr;
      case 0x11: return this.trcsr;
      case 0x12: {
        const v = this.rdr;
        this.trcsr &= 0x7f;
        return this.ports.rdrRead ? this.ports.rdrRead(v) & 0xff : v;
      }
      case 0x14: return this.rp5cr;
      case 0x15: return this.ports.portRead(5) & 0xff;
      case 0x17: this.p6csr &= 0x7f; return this.ports.portRead(6) & 0xff;
      case 0x19: return this.ocr2 >> 8;
      case 0x1a: return this.ocr2 & 0xff;
      case 0x1b: return this.tcsr3;
      case 0x1c: return this.tconr;
      case 0x1d: return this.t2cnt;
      case 0x1e: return (this.trcsr2 & 0x1f) | (this.trcsr & 0xe0);
      case 0x21: return this.p6csr;
      default: return this.plain[addr];
    }
  }

  write(addr: number, val: number): void {
    const v = val & 0xff;
    if (addr >= 0x28) { this.ram[addr] = v; return; }
    switch (addr) {
      case 0x01: this.ddr2 = v; break;
      case 0x03: {
        const changed = this.port2 ^ v;
        this.ports.portWrite(2, v, changed);
        this.port2 = v;
        break;
      }
      case 0x08: this.tcsr = (this.tcsr & 0xe0) | (v & 0x1f); break;
      case 0x09: this.frcLatch = v; this.frc = 0xfff8; break;
      case 0x0a: this.frc = ((this.frcLatch << 8) | v) & 0xffff; break;
      case 0x0b: this.ocr1 = (v << 8) | (this.ocr1 & 0xff); this.tcsr &= ~0x40; this.tcsr2 &= ~0x40; break;
      case 0x0c: this.ocr1 = (this.ocr1 & 0xff00) | v; this.tcsr &= ~0x40; this.tcsr2 &= ~0x40; break;
      case 0x0f: this.tcsr2 = (this.tcsr2 & 0xf0) | (v & 0x0f); break;
      case 0x10: this.rmcr = v; break;
      case 0x11: this.trcsr = (this.trcsr & 0xe0) | (v & 0x1f); break;
      case 0x13:
        this.tdr = v;
        this.trcsr &= ~0x20;
        this.tdrCount = 2000;
        this.ports.tdrWrite?.(v);
        break;
      case 0x14: this.rp5cr = v; break;
      case 0x15: {
        const changed = this.port5 ^ v;
        this.ports.portWrite(5, v, changed);
        this.port5 = v;
        break;
      }
      case 0x16: this.ddr6 = v; break;
      case 0x17: {
        this.p6csr &= 0x7f;
        const changed = this.port6 ^ v;
        this.ports.portWrite(6, v, changed);
        this.port6 = v;
        break;
      }
      case 0x19: this.ocr2 = (v << 8) | (this.ocr2 & 0xff); this.tcsr2 &= ~0x20; break;
      case 0x1a: this.ocr2 = (this.ocr2 & 0xff00) | v; this.tcsr2 &= ~0x20; break;
      case 0x1b:
        this.tcsr3 = v & 0x7f;
        if ((v & 3) === 0) this.prescale = 1;
        else if ((v & 3) === 1) this.prescale = 8;
        else if ((v & 3) === 2) this.prescale = 0x80;
        break;
      case 0x1c: this.tconr = v; break;
      case 0x1d: this.t2cnt = v; break;
      case 0x1e: this.trcsr2 = (this.trcsr2 & 0xe0) | (v & 0x1f); break;
      case 0x20: this.tstreg = v; break;
      case 0x21: this.p6csr = v & 0x7f; break;
      default: this.plain[addr] = v; break;
    }
  }

  tick(cycles: number): void {
    if (this.tdrCount !== 0) {
      this.tdrCount -= cycles;
      if (this.tdrCount < 1) { this.tdrCount = 0; this.trcsr |= 0x20; }
    }
    for (let i = 0; i < cycles; i++) {
      this.frc = (this.frc + 1) & 0xffff;
      if (this.frc === 0) this.tcsr |= 0x20;
      if (this.frc === this.ocr1) { this.tcsr |= 0x40; this.tcsr2 |= 0x40; }
      if (this.frc === this.ocr2) this.tcsr2 |= 0x20;
      if ((this.tcsr3 & 0x10) && --this.prescaleCount === 0) {
        this.prescaleCount = this.prescale;
        this.t2cnt = (this.t2cnt + 1) & 0xff;
        if (this.t2cnt === this.tconr) { this.t2cnt = 0; this.tcsr3 |= 0x80; }
      }
    }
  }

  get oci(): boolean { return (this.tcsr & 0x48) === 0x48 || (this.tcsr2 & 0x28) === 0x28; }
  get cmi(): boolean { return (this.tcsr3 & 0xc0) === 0xc0; }
  get toi(): boolean { return (this.tcsr & 0x24) === 0x24; }
  get sci(): boolean { return (this.trcsr & 0x24) === 0x24; }
}
