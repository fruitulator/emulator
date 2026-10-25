import type { Quad } from './quad';

export interface MountCap {
  left: number;
  top: number;
  width: number;
  height: number;
  button?: number;
  acceptor?: unknown;
  coinInput?: number;
}

export interface MountMap {
  model: string;
  lamps: (number | null)[];
}

export function isCoinSlot(lp: MountCap): boolean {
  return lp.acceptor !== undefined || lp.coinInput !== undefined;
}

export function isPressButton(lp: MountCap, nonSwitch?: readonly number[]): boolean {
  if (lp.button === undefined || lp.button < 0 || isCoinSlot(lp)) return false;
  return !nonSwitch?.includes(lp.button);
}

export function inQuad(q: Quad, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function pressButtons(lamps: readonly MountCap[], regions: readonly Quad[], nonSwitch?: readonly number[]): number[] {
  const out: number[] = [];
  const cx = (lp: MountCap): number => lp.left + lp.width / 2;
  const cy = (lp: MountCap): number => lp.top + lp.height / 2;
  lamps.forEach((lp, i) => {
    if (!isPressButton(lp, nonSwitch)) return;
    if (!regions.some((q) => inQuad(q, cx(lp), cy(lp)))) return;
    const twin = out.findIndex((j) => {
      const o = lamps[j];
      return o.button === lp.button && lp.left < o.left + o.width && o.left < lp.left + lp.width
        && lp.top < o.top + o.height && o.top < lp.top + lp.height;
    });
    if (twin < 0) { out.push(i); return; }
    const o = lamps[out[twin]];
    if (lp.width * lp.height > o.width * o.height) out[twin] = i;
  });
  return out.sort((a, b) => cx(lamps[a]) - cx(lamps[b]) || cy(lamps[a]) - cy(lamps[b]));
}

export function mapMounts(
  buttons: readonly number[], count: number, model: string, set?: MountMap | null,
  keep: readonly number[] = [], prefer: readonly number[] = [],
): (number | null)[] {
  if (set && set.model === model) {
    const ok = new Set(buttons);
    return Array.from({ length: count }, (_, i) => {
      const v = set.lamps[i];
      return v !== null && v !== undefined && ok.has(v) ? v : null;
    });
  }
  const chosen = chooseButtons(buttons, count, keep, prefer);
  return Array.from({ length: count }, (_, i) => chosen[i] ?? null);
}

export function chooseButtons(
  buttons: readonly number[], count: number, keep: readonly number[] = [], prefer: readonly number[] = [],
): number[] {
  if (buttons.length <= count) return [...buttons];
  const take = new Set<number>();
  for (const group of [buttons.filter((b) => keep.includes(b)), buttons.filter((b) => prefer.includes(b)), buttons]) {
    for (const b of group) if (take.size < count) take.add(b);
  }
  return buttons.filter((b) => take.has(b));
}

export function bottomRow(lamps: readonly MountCap[], buttons: readonly number[]): number[] {
  if (!buttons.length) return [];
  const cy = (i: number): number => lamps[i].top + lamps[i].height / 2;
  const low = buttons.reduce((a, b) => (cy(b) > cy(a) ? b : a));
  return buttons.filter((i) => cy(low) - cy(i) <= Math.max(lamps[i].height, lamps[low].height) / 2);
}

export function reassign(current: readonly (number | null)[], mount: number, lamp: number | null, model: string): MountMap {
  const lamps = current.map((v, i) => (i === mount ? lamp : lamp !== null && v === lamp ? null : v));
  return { model, lamps };
}

export function readMountMap(v: unknown): MountMap | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { model?: unknown; lamps?: unknown };
  if (typeof o.model !== 'string' || !Array.isArray(o.lamps)) return undefined;
  if (!o.lamps.every((x) => x === null || (Number.isInteger(x) && (x as number) >= 0))) return undefined;
  return { model: o.model, lamps: o.lamps as (number | null)[] };
}
