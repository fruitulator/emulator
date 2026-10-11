export class StatedLines {
  private readonly owned: Uint8Array;
  private readonly level: Uint8Array;

  constructor(strobes: number) {
    this.owned = new Uint8Array(strobes);
    this.level = new Uint8Array(strobes);
  }

  state(strobe: number, mask: number, value: number): void {
    if (strobe < 0 || strobe >= this.owned.length) return;
    this.owned[strobe] |= mask & 0xff;
    this.level[strobe] = (this.level[strobe] & ~mask) | (value & mask);
  }

  stateLine(id: number, on: boolean): void {
    const mask = 1 << (id & 7);
    this.state(id >> 3, mask, on ? mask : 0);
  }

  reassert(...images: Uint8Array[]): void {
    for (const img of images) {
      const n = Math.min(img.length, this.owned.length);
      for (let i = 0; i < n; i++) {
        const m = this.owned[i];
        if (m) img[i] = (img[i] & ~m) | (this.level[i] & m);
      }
    }
  }
}

export interface OperatorPreset { id: number; made: boolean }

const PRESETS = new WeakMap<object, OperatorPreset[]>();

export function recordOperatorPreset(m: object, id: number, made: boolean): void {
  const list = PRESETS.get(m) ?? [];
  const at = list.findIndex((p) => p.id === id);
  if (at >= 0) list.splice(at, 1);
  list.push({ id, made });
  PRESETS.set(m, list);
}

export function operatorPresetsOf(m: object): readonly OperatorPreset[] {
  return PRESETS.get(m) ?? [];
}
