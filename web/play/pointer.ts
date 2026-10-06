import type { CabLamp } from '../dat';
import { works } from './keys';

export const CLICK_SLOP_PX = 8;
export const HOLD_MS = 250;

export function answers(lp: CabLamp, gatedOff: ReadonlySet<CabLamp> | null | undefined): boolean {
  return works(lp) && (!gatedOff?.has(lp) || !!lp.acceptor);
}

export interface ButtonSink {
  down(input: number): void;
  up(input: number): void;
}

export class HeldButtons {
  private readonly byPointer = new Map<number, number>();
  private readonly counts = new Map<number, number>();

  constructor(private readonly sink: ButtonSink) {}

  hold(pointerId: number, input: number): void {
    this.release(pointerId);
    this.byPointer.set(pointerId, input);
    const n = (this.counts.get(input) ?? 0) + 1;
    this.counts.set(input, n);
    if (n === 1) this.sink.down(input);
  }

  release(pointerId: number): void {
    const input = this.byPointer.get(pointerId);
    if (input === undefined) return;
    this.byPointer.delete(pointerId);
    const n = (this.counts.get(input) ?? 1) - 1;
    if (n > 0) this.counts.set(input, n);
    else {
      this.counts.delete(input);
      this.sink.up(input);
    }
  }

  releaseAll(): void {
    for (const id of [...this.byPointer.keys()]) this.release(id);
  }

  has(pointerId: number): boolean {
    return this.byPointer.has(pointerId);
  }

  holding(input: number): boolean {
    return this.counts.has(input);
  }

  get size(): number {
    return this.byPointer.size;
  }

  entries(): Array<[number, number]> {
    return [...this.byPointer];
  }
}

export type PointerEv = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'button' | 'type' | 'preventDefault'>;

export function primary(ev: Pick<PointerEvent, 'button'>): boolean {
  return ev.button === 0;
}

export interface PointerSurface<H> {
  at(ev: PointerEv): H | null;
  press(hit: H, pointerId: number): void;
  release(pointerId: number): void;
  capture(pointerId: number): void;
  momentary?(hit: H): boolean;
}

interface Pending<H> { id: number; x: number; y: number; hit: H | null; pressed: boolean; timer: ReturnType<typeof setTimeout> | null }

export class PlayPointer<H> {
  private pending: Pending<H> | null = null;

  constructor(
    private readonly surface: PointerSurface<H>,
    private readonly opts: { holdMs?: number; slopPx?: number } = {},
  ) {}

  down(ev: PointerEv): H | null {
    if (!primary(ev)) return null;
    const hit = this.surface.at(ev);
    if (hit === null) return null;
    ev.preventDefault();
    if (!this.surface.momentary?.(hit)) this.surface.capture(ev.pointerId);
    this.surface.press(hit, ev.pointerId);
    return hit;
  }

  begin(ev: PointerEv): void {
    this.drop();
    const hit = primary(ev) ? this.surface.at(ev) : null;
    const p: Pending<H> = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, hit, pressed: false, timer: null };
    if (hit !== null) {
      p.timer = setTimeout(() => {
        if (this.pending !== p) return;
        p.pressed = true;
        this.surface.press(hit, p.id);
      }, this.opts.holdMs ?? HOLD_MS);
    }
    this.pending = p;
  }

  move(ev: Pick<PointerEv, 'pointerId' | 'clientX' | 'clientY'>): 'held' | { x: number; y: number } | null {
    const p = this.pending;
    if (!p || p.id !== ev.pointerId) return null;
    if (p.pressed || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) <= (this.opts.slopPx ?? CLICK_SLOP_PX)) return 'held';
    this.clear();
    return { x: p.x, y: p.y };
  }

  up(ev: Pick<PointerEv, 'pointerId' | 'type'>): boolean {
    const p = this.pending;
    const was = !!p && p.id === ev.pointerId;
    if (p && was) {
      this.clear();
      if (!p.pressed && p.hit !== null && ev.type === 'pointerup') this.surface.press(p.hit, p.id);
    }
    this.surface.release(ev.pointerId);
    return was;
  }

  drop(): void {
    const p = this.pending;
    if (!p) return;
    this.clear();
    if (p.pressed) this.surface.release(p.id);
  }

  private clear(): void {
    if (this.pending?.timer !== null && this.pending?.timer !== undefined) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
