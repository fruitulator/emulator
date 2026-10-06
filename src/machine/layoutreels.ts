import { decryptFml, isEncryptedFml } from '../layout/fml';
import { parseLayout, type ParsedComponent } from '../layout/fmlparse';
import { datComponents, reelsFromDfm, type DatReelWiring } from '../layout/datreels';

export interface ReelGeometry {
  number: number;
  band: boolean;
  flip?: boolean;
  disc?: boolean;
  bounce?: number;
  stops: number;
  halfSteps: number;
  optoTab: number;
  bandOffset: number;
  reversed: boolean;
  invertedOpto: boolean;
}

const REEL_COMPONENT = 0x03;
const BAND_REEL_COMPONENT = 0x08;
const DISC_REEL_COMPONENT = 0x06;
const FLIP_REEL_COMPONENT = 0x2d;

export const REEL_COMPONENTS: ReadonlyMap<number, string> = new Map([
  [0x03, 'Reel'],
  [0x06, 'DiscReel'],
  [0x08, 'BandReel'],
  [0x2d, 'Reel2D'],
]);

const DAT_REEL_CLASSES = /^(TFancyReel|TReel|TBandReel|TDiscReel)$/;

export interface DeclaredReel {
  component: string;
  type: number | string;
  number: number;
  rect: { left: number; top: number; width: number; height: number } | null;
}

const FALLBACK = { stops: 16, halfSteps: 96 };

export function reelGeometry(layout: Uint8Array | undefined): ReelGeometry[] {
  if (!layout || layout.length === 0) return [];
  let payload: Uint8Array | null = null;
  try {
    payload = isEncryptedFml(layout) ? decryptFml(layout) : layout;
  } catch {
    payload = null;
  }
  const fml = payload ? fmlReelGeometry(payload) : [];
  if (fml.length) return fml;
  return datReelGeometry(datComponents(layout, DAT_REEL_CLASSES));
}

const DAT_REEL_DEFAULTS: Readonly<Record<string, { stops: number; halfSteps: number }>> = {
  TReel: { stops: 16, halfSteps: 96 },
  TFancyReel: { stops: 16, halfSteps: 96 },
  TBandReel: { stops: 16, halfSteps: 320 },
  TDiscReel: { stops: 12, halfSteps: 96 },
};

export function datReelGeometry(reels: readonly DatReelWiring[]): ReelGeometry[] {
  const out: ReelGeometry[] = [];
  for (const r of reels) {
    const def = DAT_REEL_DEFAULTS[r.cls];
    if (!def) continue;
    out.push({
      number: r.number,
      band: r.cls === 'TBandReel',
      disc: r.cls === 'TDiscReel',
      flip: false,
      optoTab: r.flag,
      stops: r.stops || def.stops,
      halfSteps: r.totalSteps || def.halfSteps,
      bandOffset: 0,
      reversed: r.reversed,
      invertedOpto: r.inverted,
    });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

export function reelGeometryFromPayload(payload: Uint8Array): ReelGeometry[] {
  const fml = fmlReelGeometry(payload);
  if (fml.length) return fml;
  try {
    return datReelGeometry(reelsFromDfm(payload, DAT_REEL_CLASSES));
  } catch {
    return [];
  }
}

function fmlReelGeometry(payload: Uint8Array): ReelGeometry[] {
  let comps;
  try {
    comps = parseLayout(payload);
  } catch {
    return [];
  }

  const out: ReelGeometry[] = [];
  for (const c of comps) {
    const band = c.type === BAND_REEL_COMPONENT;
    const disc = c.type === DISC_REEL_COMPONENT;
    const flip = c.type === FLIP_REEL_COMPONENT;
    if (c.type !== REEL_COMPONENT && !band && !disc && !flip) continue;
    out.push({
      number: c.number,
      band,
      flip,
      disc,
      bounce: c.values.get('Bounce') ?? c.defaults.get('Bounce') ?? 0,
      stops: c.values.get('Stops') ?? c.defaults.get('Stops') ?? FALLBACK.stops,
      halfSteps: c.values.get('HalfSteps') ?? c.defaults.get('HalfSteps') ?? FALLBACK.halfSteps,
      optoTab: c.values.get('OptoTab') ?? c.defaults.get('OptoTab') ?? 0,
      bandOffset: c.values.get('BandOffset') ?? c.defaults.get('BandOffset') ?? 0,
      reversed: !!c.values.get('Reversed'),
      invertedOpto: !!c.values.get('InvertedOpto'),
    });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

export function declaredReels(layout: Uint8Array | undefined): DeclaredReel[] {
  const out: DeclaredReel[] = [];
  if (layout && layout.length) {
    let payload: Uint8Array | null = null;
    try {
      payload = isEncryptedFml(layout) ? decryptFml(layout) : layout;
    } catch {
      payload = null;
    }
    let comps: ParsedComponent[] = [];
    if (payload) {
      try {
        comps = parseLayout(payload);
      } catch {
        comps = [];
      }
    }
    for (const c of comps) {
      const name = REEL_COMPONENTS.get(c.type);
      if (!name) continue;
      out.push({
        component: name,
        type: c.type,
        number: c.number,
        rect: c.width > 0 && c.height > 0
          ? { left: c.x, top: c.y, width: c.width, height: c.height }
          : null,
      });
    }
    if (!out.length) {
      for (const c of datComponents(layout, DAT_REEL_CLASSES)) {
        out.push({
          component: c.cls,
          type: c.cls,
          number: c.number,
          rect: c.width > 0 && c.height > 0
            ? { left: c.left, top: c.top, width: c.width, height: c.height }
            : null,
        });
      }
    }
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

export function declaredReelChannels(layout: Uint8Array | undefined): number[] {
  return [...new Set(declaredReels(layout).map((r) => r.number))].sort((a, b) => a - b);
}
