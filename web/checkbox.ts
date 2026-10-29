import type { CabCheckbox } from './dat';

const BTN_SHADOW = '#a0a0a0';
const WHITE = '#ffffff';
const DK_SHADOW = '#696969';
const LIGHT_3D = '#e3e3e3';
const BLACK = '#000000';

export function boxTop(height: number): number {
  return Math.trunc((height - 12) / 2);
}

export function paintCheckBox(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, left: number, top: number, height: number, ticked: boolean): void {
  const t = top + boxTop(height);
  const px = (colour: string, x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = colour;
    ctx.fillRect(left + x, t + y, w, h);
  };
  px(BTN_SHADOW, 0, 1, 1, 12);
  px(BTN_SHADOW, 0, 0, 13, 1);
  px(WHITE, 13, 0, 1, 14);
  px(WHITE, 0, 13, 14, 1);
  px(DK_SHADOW, 1, 2, 1, 10);
  px(DK_SHADOW, 1, 1, 11, 1);
  px(LIGHT_3D, 12, 1, 1, 11);
  px(LIGHT_3D, 1, 12, 12, 1);
  px(WHITE, 2, 2, 10, 10);
  if (!ticked) return;
  const starts = [5, 6, 7, 6, 5, 4, 3];
  starts.forEach((y, i) => px(BLACK, 3 + i, y, 1, 3));
}

export const CAPTION_DX = 20;

export function checkboxAt(list: readonly CabCheckbox[] | undefined, x: number, y: number): CabCheckbox | null {
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (x >= c.left && x < c.left + c.width && y >= c.top && y < c.top + c.height) return c;
  }
  return null;
}

export class SwitchLevels {
  private readonly levels = new Map<number, boolean>();

  set(id: number, on: boolean): void {
    this.levels.set(id, on);
  }

  ticked(cb: CabCheckbox, rows?: readonly { id: number; on: boolean }[]): boolean {
    return this.levels.get(cb.id) ?? rows?.find((r) => r.id === cb.id)?.on ?? cb.checked;
  }

  clear(): void {
    this.levels.clear();
  }
}
