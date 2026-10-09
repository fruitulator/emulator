export function placeV20RomList(rom: Uint8Array, parts: readonly Uint8Array[]): number {
  if (parts.length === 0) return 0;
  if (parts.length < 2) {
    rom.set(parts[0].subarray(0, rom.length));
    return parts[0].length;
  }
  const half = parts[0].length;
  parts.forEach((p, i) => {
    const lane = i & 1;
    for (let k = 0; k + 1 < p.length; k += 2) {
      if (lane + k < rom.length) rom[lane + k] = p[k];
      if (half + lane + k < rom.length) rom[half + lane + k] = p[k + 1];
    }
  });
  return 2 * half;
}
