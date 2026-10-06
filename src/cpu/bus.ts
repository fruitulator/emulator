export interface Bus {
  read8(addr: number): number;
  write8(addr: number, val: number): void;
}

export class FlatBus implements Bus {
  readonly mem = new Uint8Array(0x10000);

  read8(addr: number): number {
    return this.mem[addr & 0xffff];
  }

  write8(addr: number, val: number): void {
    this.mem[addr & 0xffff] = val & 0xff;
  }

  load(at: number, bytes: Uint8Array): void {
    this.mem.set(bytes, at & 0xffff);
  }
}
