
export type ReelLampLaw = (lamp: number) => { reel: number; row: number } | null;

const thirds: ReelLampLaw = (l) => (l < 9 ? { reel: Math.floor(l / 3), row: l % 3 } : null);

const scorpion: ReelLampLaw = (l) => {
  const hi = l >> 4, lo = l & 15;
  if (hi < 2 || hi > 4 || lo >= 6) return null;
  return { reel: Math.floor(lo / 3) + hi * 2 - 4, row: lo % 3 };
};

const LAWS: Record<string, ReelLampLaw> = {
  MPU4: (l) => (l >> 3 < 3 && (l & 7) < 7 ? { reel: l & 7, row: l >> 3 } : null),
  MPU4PLASMA: (l) => (l >> 3 < 3 && (l & 7) < 7 ? { reel: l & 7, row: l >> 3 } : null),
  MPS2: (l) => {
    const hi = l >> 4, lo = l & 15;
    return hi < 3 && lo > 7 && lo < 12 ? { reel: lo - 8, row: hi } : null;
  },
  MPU5: (l) => {
    if (l < 0x1e0 || l >= 0x210) return null;
    let reel = (l - 0x1e0) & 7, row = (l - 0x1e0) >> 3;
    if (reel >= 5) return null;
    if (row > 2) { row -= 3; reel += 5; }
    return row < 3 ? { reel, row } : null;
  },
  SCORPION1: (l) => {
    const hi = l >> 4, lo = l & 15;
    if (hi < 2 || hi > 4 || lo >= 6) return null;
    return { reel: Math.floor(lo / 3) + hi * 2 - 4, row: 2 - (lo % 3) };
  },
  SCORPION2: (l) => {
    const hi = l >> 4, lo = l & 15;
    if (hi < 3 || hi > 5 || lo > 5) return null;
    return { reel: Math.floor(lo / 3) + (l >> 3) - 6, row: lo % 3 };
  },
  SCORPION4: scorpion,
  SCORPION5: scorpion,
  ADDER5: scorpion,
  SYS5: (l) => {
    if (l < 0x100 || l >= 0x118) return null;
    const row = (l - 0x100) >> 3;
    return row < 3 ? { reel: (l - 0x100) & 7, row } : null;
  },
  SYS85: (l) => (l >> 4 < 3 && (l & 15) < 3 ? { reel: l >> 4, row: l & 15 } : null),
  PROCONN: thirds,
  MMM: thirds,
};

export function reelLampLaw(system: string | undefined): ReelLampLaw | undefined {
  return system ? LAWS[system.toUpperCase()] : undefined;
}

export function boardFilledTray(
  tray: readonly number[], reelNumber: number, system: string | undefined,
  lampsEnabled: boolean, customEnabled: boolean,
): readonly number[] {
  const law = reelLampLaw(system);
  if (!law || !lampsEnabled || customEnabled) return tray;
  let out: number[] | null = null;
  for (let lamp = 0; lamp < 0x270; lamp++) {
    const at = law(lamp);
    if (!at || at.reel !== reelNumber) continue;
    const slot = at.row + 1;
    if ((out ?? tray)[slot] !== undefined && (out ?? tray)[slot] !== -2) continue;
    out ??= Array.from({ length: Math.max(tray.length, 15) }, (_, i) => tray[i] ?? -2);
    out[slot] = lamp;
  }
  return out ?? tray;
}
