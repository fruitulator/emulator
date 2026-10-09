import { decryptFml, isEncryptedFml } from '../layout/fml';
import { parseLayout, type ParsedComponent } from '../layout/fmlparse';
import { datComponents } from '../layout/datreels';

export type DisplayKind = 'bda' | 'msc' | 'epochalpha' | 's16' | 'mpu5alpha';

export interface DeclaredDisplay {
  component: string;
  type: number | string;
  rect: { left: number; top: number; width: number; height: number } | null;
  reversed?: boolean;
  number?: number;
}

export const ALPHA_COMPONENTS: ReadonlyMap<number, string> = new Map([
  [0x07, 'Alpha'],
  [0x0c, 'BFMAlpha'],
  [0x13, 'DotAlpha'],
  [0x16, 'EpochDotAlpha'],
  [0x19, 'AlphaNew'],
  [0x1a, 'MatrixAlpha'],
]);

export const DOT_PANEL_COMPONENTS: ReadonlyMap<number, string> = new Map([
  [0x0d, 'DotMatrix'],
  [0x10, 'AceMatrix'],
  [0x11, 'ProconnMatrix'],
  [0x22, 'EpochMatrix'],
  [0x2e, 'MaygayMatrix'],
  [0x23, 'PlasmaDisplay'],
]);

const DAT_ALPHA_CLASSES = /^(TAlpha|TDotAlpha)$/;

function fmlReversed(c: ParsedComponent): boolean {
  if (c.type === 0x1a || c.type === 0x13) return true;
  const tag = (k: string): number | undefined => c.values.get(k) ?? c.defaults.get(k);
  return !!(tag('Reversed') || tag('ReversedLegacy'));
}

function fmlPayload(layout: Uint8Array | undefined): Uint8Array | null {
  if (!layout || layout.length === 0) return null;
  try {
    return isEncryptedFml(layout) ? decryptFml(layout) : layout;
  } catch {
    return null;
  }
}

export function declaredDisplays(layout: Uint8Array | undefined): DeclaredDisplay[] {
  const out: DeclaredDisplay[] = [];
  const payload = fmlPayload(layout);
  if (payload) {
    let comps: ParsedComponent[];
    try {
      comps = parseLayout(payload);
    } catch {
      comps = [];
    }
    for (const c of comps) {
      const name = ALPHA_COMPONENTS.get(c.type);
      if (!name) continue;
      out.push({
        component: name,
        type: c.type,
        rect: c.width > 0 && c.height > 0
          ? { left: c.x, top: c.y, width: c.width, height: c.height }
          : null,
        reversed: fmlReversed(c),
        number: c.number,
      });
    }
  }
  const alphaNew = out.findIndex((d) => d.type === 0x19);
  if (alphaNew > 0) out.unshift(...out.splice(alphaNew, 1));
  if (!out.length) {
    for (const c of datComponents(layout, DAT_ALPHA_CLASSES)) {
      out.push({
        component: c.cls,
        type: c.cls,
        rect: c.width > 0 && c.height > 0
          ? { left: c.left, top: c.top, width: c.width, height: c.height }
          : null,
        reversed: c.cls === 'TDotAlpha' ? true : !!c.reversed,
      });
    }
  }
  return out;
}

export interface BfmAlphaRoute {
  segmented: boolean;
  number: number;
  drawsHidden: boolean;
}

export function bfmAlphaRoute(layout: Uint8Array | undefined): BfmAlphaRoute | null {
  const decl = declaredDisplays(layout);
  return decl.length ? routeOf(decl) : null;
}

function drawnOf(decl: DeclaredDisplay[]): DeclaredDisplay {
  return decl.find((x) => x.type === 0x19)
    ?? decl.find((x) => x.type === 0x07 || x.type === 0x0c || x.type === 0x1a || x.type === 'TAlpha')
    ?? decl[0];
}

function routeOf(decl: DeclaredDisplay[]): BfmAlphaRoute {
  const d = drawnOf(decl);
  return {
    segmented: d.type === 0x07 || d.type === 0x0c || d.type === 0x16 || d.type === 0x19 || d.type === 'TAlpha',
    number: d.number ?? 0,
    drawsHidden: d.type !== 0x07 && d.type !== 'TAlpha',
  };
}

export interface V20AlphaPumps {
  m10937?: readonly number[];
  bd1?: number;
}

export interface V20AlphaServe {
  decoder: '10937' | 'bd1' | null;
  index: number;
  drawsHidden: boolean;
  classic: boolean;
}

export function v20AlphaServe(layout: Uint8Array | undefined, pumps: V20AlphaPumps): V20AlphaServe | null {
  const decl = declaredDisplays(layout);
  if (!decl.length) return null;
  const r = routeOf(decl);
  const d = drawnOf(decl);
  const type = d.type === 'TAlpha' ? 0x07 : d.type;
  const classic = typeof d.type === 'string';
  if (pumps.bd1 !== undefined && r.number === pumps.bd1 && r.segmented) {
    return { decoder: 'bd1', index: 0, drawsHidden: r.drawsHidden, classic };
  }
  const index = pumps.m10937?.indexOf(r.number) ?? -1;
  if (index >= 0 && type !== 0x0c && type !== 0x1a) {
    return { decoder: '10937', index, drawsHidden: r.drawsHidden, classic };
  }
  return { decoder: null, index: -1, drawsHidden: r.drawsHidden, classic };
}

export function cabinetDisplayReversed(layout: Uint8Array | undefined): boolean {
  const decl = declaredDisplays(layout);
  if (!decl.length) return false;
  if (decl.some((d) => d.type === 0x13 || d.type === 'TDotAlpha')) return true;
  return !!decl[0].reversed;
}

const VIRTUAL_REVERSED: ReadonlySet<string> = new Set([
  'PROCONN', 'SCORPION4', 'SCORPION5', 'IMPACT', 'M1AB',
]);

export function virtualDisplayReversed(board: string | undefined): boolean {
  return !!board && VIRTUAL_REVERSED.has(board);
}

export function glassText(text: string, reversed: boolean): string {
  if (!reversed) return text;
  const cells: string[] = [];
  for (const ch of text) {
    if ((ch === '.' || ch === ',') && cells.length) cells[cells.length - 1] += ch;
    else cells.push(ch);
  }
  return cells.reverse().join('');
}

export function declaredPrismLamps(layout: Uint8Array | undefined): DeclaredDisplay[] {
  const out: DeclaredDisplay[] = [];
  const payload = fmlPayload(layout);
  if (!payload) return out;
  let comps: ParsedComponent[];
  try {
    comps = parseLayout(payload);
  } catch {
    return out;
  }
  for (const c of comps) {
    if (c.type !== 0x29) continue;
    out.push({
      component: 'PrismLamp',
      type: c.type,
      rect: c.width > 0 && c.height > 0
        ? { left: c.x, top: c.y, width: c.width, height: c.height }
        : null,
    });
  }
  return out;
}

export function declaredBankDigits(layout: Uint8Array | undefined): DeclaredDisplay[] {
  const out: DeclaredDisplay[] = [];
  const payload = fmlPayload(layout);
  if (!payload) return out;
  let comps: ParsedComponent[];
  try {
    comps = parseLayout(payload);
  } catch {
    return out;
  }
  for (const c of comps) {
    if (c.type !== 0x0e || c.number < 0) continue;
    if ((c.subs ?? []).slice(0, 8).some((n) => n >= 0)) continue;
    out.push({
      component: 'SevenSeg',
      type: c.type,
      rect: c.width > 0 && c.height > 0
        ? { left: c.x, top: c.y, width: c.width, height: c.height }
        : null,
    });
  }
  return out;
}

export function declaredLedLamps(
  layout: Uint8Array | undefined,
): (DeclaredDisplay & { leds: number[] })[] {
  const out: (DeclaredDisplay & { leds: number[] })[] = [];
  const payload = fmlPayload(layout);
  if (!payload) return out;
  let comps: ParsedComponent[];
  try {
    comps = parseLayout(payload);
  } catch {
    return out;
  }
  for (const c of comps) {
    if (c.type !== 0x04 || !c.values.get('LED')) continue;
    const wired = (c.subs ?? []).filter((n) => n >= 0);
    out.push({
      component: 'Lamp',
      type: c.type,
      leds: wired.length ? wired : c.number >= 0 ? [c.number] : [],
      rect: c.width > 0 && c.height > 0
        ? { left: c.x, top: c.y, width: c.width, height: c.height }
        : null,
    });
  }
  return out;
}
