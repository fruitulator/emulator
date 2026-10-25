
export interface WalkIntent { fwd: -1 | 0 | 1; side: -1 | 0 | 1; turn: -1 | 0 | 1 }

const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);
const any = (keys: ReadonlySet<string>, ...names: string[]): 0 | 1 => (names.some((k) => keys.has(k)) ? 1 : 0);

export function walkIntent(keys: ReadonlySet<string>, held: { walk: number; turn: number } = { walk: 0, turn: 0 }): WalkIntent {
  return {
    fwd: sign(any(keys, 'w', 'W', 'ArrowUp') - any(keys, 's', 'S', 'ArrowDown') + held.walk),
    side: sign(any(keys, 'd', 'D') - any(keys, 'a', 'A')),
    turn: sign(any(keys, 'q', 'Q', 'ArrowLeft') - any(keys, 'e', 'E', 'ArrowRight') + held.turn),
  };
}

export function walkMove(yaw: number, fwd: number, side: number, step: number): { dx: number; dz: number } {
  if (!fwd && !side) return { dx: 0, dz: 0 };
  const n = step / Math.hypot(fwd, side);
  return {
    dx: (Math.sin(yaw) * fwd - Math.cos(yaw) * side) * n,
    dz: (Math.cos(yaw) * fwd + Math.sin(yaw) * side) * n,
  };
}

export function easeShare(dt: number, tau: number): number {
  if (tau <= 0 || dt >= tau * 20) return 1;
  return 1 - Math.exp(-dt / tau);
}

export const GLIDE_TAU_S = 0.13;
export const AT_MACHINE_TAU_S = 0.04;
export const ORBIT_SPRING_TAU_S = 0.1;

export function aisleClick(
  drag: { id: number; moved: boolean } | null,
  ev: { pointerId: number; type: string },
): boolean {
  return !!drag && drag.id === ev.pointerId && !drag.moved && ev.type === 'pointerup';
}

export interface FocusWindow {
  addEventListener(type: 'blur', fn: () => void): void;
  document: { readonly hidden: boolean; addEventListener(type: 'visibilitychange', fn: () => void): void };
}

export function letGoOnFocusLoss(win: FocusWindow, letGo: () => void): void {
  win.addEventListener('blur', letGo);
  win.document.addEventListener('visibilitychange', () => { if (win.document.hidden) letGo(); });
}
