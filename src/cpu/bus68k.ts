export interface Bus16 {
  read8(addr: number, fc?: number): number;
  read16(addr: number, fc?: number): number;
  write8(addr: number, val: number, fc?: number): void;
  write16(addr: number, val: number, fc?: number): void;
  fetchCost?(addr: number, words: number): void;
  refetch16?(addr: number): number;
  penaltyMark?(): number;
  penaltyRestore?(mark: number): void;
}

export const FC_USER_DATA = 1;
export const FC_USER_PROG = 2;
export const FC_SUPER_DATA = 5;
export const FC_SUPER_PROG = 6;
export const FC_CPU = 7;

export class SparseBus implements Bus16 {
  private readonly mem = new Map<number, number>();

  readonly unmapped = new Set<number>();

  constructor(private readonly addrMask = 0xffffff) {}

  clear(): void {
    this.mem.clear();
    this.unmapped.clear();
  }

  set(addr: number, val: number): void {
    this.mem.set((addr & this.addrMask) >>> 0, val & 0xff);
  }

  get(addr: number): number {
    const a = (addr & this.addrMask) >>> 0;
    const v = this.mem.get(a);
    if (v === undefined) {
      this.unmapped.add(a);
      return 0;
    }
    return v;
  }

  entries(): [number, number][] {
    return [...this.mem.entries()].sort((x, y) => x[0] - y[0]);
  }

  read8(addr: number): number {
    return this.get(addr);
  }

  write8(addr: number, val: number): void {
    this.set(addr, val);
  }

  read16(addr: number): number {
    return ((this.get(addr) << 8) | this.get(addr + 1)) & 0xffff;
  }

  write16(addr: number, val: number): void {
    this.set(addr, val >> 8);
    this.set(addr + 1, val);
  }
}
