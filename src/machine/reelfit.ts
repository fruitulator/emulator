import type { Reel } from '../hw/reel';

export interface ReelFit {
  mask: number;
  channels: number;
  beyond: number[];
}

export const reelFitControl = { disabled: false };

export function fitReelBank(reels: Reel[], channels: readonly number[]): ReelFit {
  const all = (1 << reels.length) - 1;
  if (reelFitControl.disabled) return { mask: all, channels: reels.length, beyond: [] };
  if (!channels.length) return { mask: all, channels: reels.length, beyond: [] };
  let mask = 0;
  let top = 0;
  const beyond: number[] = [];
  for (const n of channels) {
    if (n < 0) continue;
    if (n >= reels.length) { if (!beyond.includes(n)) beyond.push(n); continue; }
    mask |= 1 << n;
    if (n + 1 > top) top = n + 1;
  }
  if (!top) return { mask: all, channels: reels.length, beyond: beyond.sort((a, b) => a - b) };
  reels.length = top;
  return { mask: mask & ((1 << top) - 1), channels: top, beyond: beyond.sort((a, b) => a - b) };
}
