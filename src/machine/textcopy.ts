
export const TEXT_SHARE = 0.9;

export const MIN_PAIRS = 16;

export interface LineEndingCounts {
  size: number;
  pairs: number;
  loneLf: number;
}

export function countLineEndings(bytes: Uint8Array): LineEndingCounts {
  let pairs = 0;
  let loneLf = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    if (i > 0 && bytes[i - 1] === 0x0d) pairs++;
    else loneLf++;
  }
  return { size: bytes.length, pairs, loneLf };
}

export function looksTextModeCopied(bytes: Uint8Array): boolean {
  const excess = bytes.length % 1024;
  if (excess === 0) return false;
  const { pairs, loneLf } = countLineEndings(bytes);
  if (loneLf !== 0 || pairs < MIN_PAIRS || pairs < excess) return false;
  let text = 0;
  for (const b of bytes) if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) text++;
  return text < TEXT_SHARE * bytes.length;
}

export function textCopyDamaged(
  files: readonly { name: string; bytes: Uint8Array }[],
  named: readonly string[],
): string[] {
  const want = new Set(named.filter(Boolean).map((n) => n.toLowerCase()));
  return files
    .filter((f) => want.has(f.name.toLowerCase()) && looksTextModeCopied(f.bytes))
    .map((f) => f.name);
}

export function damagedRoms(game: { files: readonly { name: string; bytes: Uint8Array }[]; gam: { roms: string[]; sound: string[] } | null }): string[] {
  return game.gam ? textCopyDamaged(game.files, [...game.gam.roms, ...game.gam.sound]) : [];
}

export function damagedRomLine(name: string): string {
  return `file · ${name} looks damaged by a copy that changed its line endings; get a fresh copy of the set`;
}
