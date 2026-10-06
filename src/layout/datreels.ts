import { isAacsContainer, readAacsContainer } from './fml';

export interface DatReelWiring {
  cls: string;
  number: number;
  flag: number;
  inverted: boolean;
  offset: number;
  position: number;
  reversed: boolean;
  stops: number;
  totalSteps: number;
  left: number;
  top: number;
  width: number;
  height: number;
  tag: number;
  checked: boolean;
  caption: string;
}

export function opticWindowForFlag(flag: number): { start: number; width: number } {
  switch (flag) {
    case 1: return { start: 5, width: 1 };
    case 2: return { start: 2, width: 2 };
    case 3: return { start: 1, width: 3 };
    case 4: return { start: 7, width: 3 };
    case 5: return { start: 1, width: 1 };
    case 6: return { start: 119, width: 3 };
    case 7: return { start: 3, width: 1 };
    case 8: return { start: 3, width: 11 };
    case 9: return { start: 5, width: 3 };
    case 10: return { start: 1, width: 6 };
    case 11: return { start: 1, width: 1 };
    default: return { start: 7, width: 1 };
  }
}

const REEL_CLASSES = /^(TFancyReel|TReel)$/;

const ALL_REEL_CLASSES = /^(TFancyReel|TReel|TBandReel|TDiscReel)$/;

function datPayload(layout: Uint8Array | undefined): Uint8Array | null {
  if (!layout || !isAacsContainer(layout)) return null;
  try {
    const r = readAacsContainer(layout);
    if (r.encrypted || r.payload.length === 0) return null;
    return r.payload;
  } catch {
    return null;
  }
}

export function datReelWiring(layout: Uint8Array | undefined): DatReelWiring[] {
  const payload = datPayload(layout);
  if (!payload) return [];
  try {
    return reelsFromDfm(payload);
  } catch {
    return [];
  }
}

export function datReelChannels(layout: Uint8Array | undefined): number[] {
  const payload = datPayload(layout);
  if (!payload) return [];
  try {
    return reelsFromDfm(payload, ALL_REEL_CLASSES).map((r) => r.number);
  } catch {
    return [];
  }
}

export function datComponents(
  layout: Uint8Array | undefined, classes: RegExp,
): DatReelWiring[] {
  const payload = datPayload(layout);
  if (!payload) return [];
  try {
    return reelsFromDfm(payload, classes);
  } catch {
    return [];
  }
}

export function datCheckboxes(
  layout: Uint8Array | undefined,
): { number: number; label: string; closed: boolean }[] {
  const payload = datPayload(layout);
  return payload ? datCheckboxesFromDfm(payload) : [];
}

export function datCheckboxesFromDfm(
  payload: Uint8Array,
): { number: number; label: string; closed: boolean }[] {
  let comps: DatReelWiring[];
  try {
    comps = reelsFromDfm(payload, /^TCheckBox$/);
  } catch {
    return [];
  }
  return comps.map((c) => ({
    number: ((c.tag & 0xff00) >>> 8) & 0x7f,
    label: c.caption,
    closed: c.checked,
  }));
}

export function reelsFromDfm(b: Uint8Array, classes: RegExp = REEL_CLASSES): DatReelWiring[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const sig = [0x54, 0x50, 0x46, 0x30];
  let found = false;
  for (let i = 0; i < b.length - 4; i++) {
    if (b[i] === sig[0] && b[i + 1] === sig[1] && b[i + 2] === sig[2] && b[i + 3] === sig[3]) {
      p = i + 4;
      found = true;
      break;
    }
  }
  if (!found) return [];

  const sstr = (): string => {
    const n = b[p++];
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[p++]);
    return s;
  };

  const skipVal = (): number | string | boolean | null => {
    const t = b[p++];
    switch (t) {
      case 0: case 13: return null;
      case 1: { while (b[p] !== 0) skipVal(); p++; return null; }
      case 2: { const v = dv.getInt8(p); p += 1; return v; }
      case 3: { const v = dv.getInt16(p, true); p += 2; return v; }
      case 4: { const v = dv.getInt32(p, true); p += 4; return v; }
      case 5: p += 10; return null;
      case 6: case 7: return sstr();
      case 8: return false;
      case 9: return true;
      case 10: { const n = dv.getUint32(p, true); p += 4 + n; return null; }
      case 11: { while (b[p] !== 0) sstr(); p++; return null; }
      case 12: case 17: case 20: { const n = dv.getUint32(p, true); p += 4 + n; return null; }
      case 18: { const n = dv.getUint32(p, true); p += 4 + n * 2; return null; }
      default: throw new Error('DFM value type ' + t);
    }
  };

  const out: DatReelWiring[] = [];

  const obj = (): void => {
    if ((b[p] & 0xf0) === 0xf0) {
      const f = b[p++] & 0x0f;
      if (f & 2) skipVal();
    }
    const cls = sstr();
    sstr();
    let number = 0;
    let flag = 0;
    let inverted = false;
    let offset = 0;
    let position = 0;
    let reversed = false;
    let stops = 0;
    let totalSteps = 0;
    let left = 0;
    let top = 0;
    let width = 0;
    let height = 0;
    let tag = 0;
    let checked = false;
    let caption = '';
    while (b[p] !== 0) {
      const pn = sstr();
      const v = skipVal();
      if (typeof v === 'number' && pn === 'Number') number = v;
      else if (typeof v === 'number' && pn === 'Flag') flag = v;
      else if (typeof v === 'boolean' && pn === 'Inverted') inverted = v;
      else if (typeof v === 'number' && pn === 'Offset') offset = v;
      else if (typeof v === 'number' && pn === 'Position') position = v;
      else if (typeof v === 'boolean' && pn === 'Reversed') reversed = v;
      else if (typeof v === 'number' && pn === 'Stops') stops = v;
      else if (typeof v === 'number' && pn === 'TotalSteps') totalSteps = v;
      else if (typeof v === 'number' && pn === 'Steps' && cls === 'TDiscReel') totalSteps = v;
      else if (typeof v === 'number' && pn === 'Left') left = v;
      else if (typeof v === 'number' && pn === 'Top') top = v;
      else if (typeof v === 'number' && pn === 'Width') width = v;
      else if (typeof v === 'number' && pn === 'Height') height = v;
      else if (typeof v === 'number' && pn === 'Tag') tag = v >>> 0;
      else if (typeof v === 'boolean' && pn === 'Checked') checked = v;
      else if (typeof v === 'string' && pn === 'Caption') caption = v;
    }
    p++;
    if (classes.test(cls)) {
      out.push({
        cls, number, flag, inverted, offset, position, reversed,
        stops, totalSteps, left, top, width, height, tag, checked, caption,
      });
    }
    while (b[p] !== 0) obj();
    p++;
  };

  obj();
  return out;
}
