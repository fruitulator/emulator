export interface StrayAccessCount {
  total: number;
  top?: { address: number; count: number };
}

const STRAY_ADDRESS_CAP = 10_000;

export class StrayCounter {
  total = 0;
  readonly byAddress = new Map<number, number>();

  hit(address: number): void {
    this.total++;
    const m = this.byAddress;
    const n = m.get(address);
    if (n !== undefined) m.set(address, n + 1);
    else if (m.size < STRAY_ADDRESS_CAP) m.set(address, 1);
  }

  clear(): void {
    this.total = 0;
    this.byAddress.clear();
  }
}

function topOf(map: Map<number, number>): { address: number; count: number } | undefined {
  let top: { address: number; count: number } | undefined;
  for (const [address, count] of map) if (!top || count > top.count) top = { address, count };
  return top;
}

export function strayAccessesOf(m: object): StrayAccessCount | null {
  const b = m as { strays?: unknown; strayReads?: unknown; wildAccesses?: unknown; highRamAccesses?: unknown };
  if (b.strays instanceof StrayCounter) {
    const top = topOf(b.strays.byAddress);
    return { total: b.strays.total, ...(top ? { top } : {}) };
  }
  if (b.strayReads instanceof Map) {
    let total = 0;
    for (const count of (b.strayReads as Map<number, number>).values()) total += count;
    const top = topOf(b.strayReads as Map<number, number>);
    return { total, ...(top ? { top } : {}) };
  }
  if (typeof b.wildAccesses === 'number') return { total: b.wildAccesses };
  if (typeof b.highRamAccesses === 'number') return { total: b.highRamAccesses };
  return null;
}

export function strayAccessLine(c: StrayAccessCount): string | null {
  if (c.total <= 0) return null;
  const top = c.top ? `, most at $${c.top.address.toString(16).toUpperCase()} (${c.top.count})` : '';
  return `stray memory access · ${c.total} so far${top}`;
}
