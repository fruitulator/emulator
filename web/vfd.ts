
export interface SegmentColours {
  on: string;
  off: string;
  bg: string;
}

export function argbToCss(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
