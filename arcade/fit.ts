
import type { SplitHow } from './fold';
import { asQuad, boundsOf, isConvexQuad, MIN_EDGE, quadAspect, quadOfRect, sameQuad, type Pt, type Quad } from './quad';
import { str } from '../web/i18n';

export type { Quad };
export interface Rect { left: number; top: number; width: number; height: number }

export interface Frac { x: number; y: number; w: number; h: number }

export type PanelName = 'glass' | 'buttons' | 'deck';
export const PANEL_LABEL: Record<PanelName, string> = { glass: str('arcade.fit.top_glass'), buttons: str('arcade.fit.lower_glass'), deck: str('arcade.fit.buttons') };
export const PANEL_NAMES: PanelName[] = ['glass', 'buttons', 'deck'];

export interface FitDetected {
  glass: Rect;
  buttons: Rect;
  deck: Rect;
  split: SplitHow;
  whole: Rect;
  read: boolean;
}

export interface FitSet {
  glass?: Quad;
  buttons?: Quad;
  deck?: Quad;
  noDeck?: boolean;
}

export function readFitSet<T extends FitSet>(s: T): T {
  const out = { ...s };
  for (const k of PANEL_NAMES) {
    if (k in out) {
      const q = asQuad(out[k]);
      if (q) out[k] = q; else delete out[k];
    }
  }
  return out;
}

export const MIN_BOX = MIN_EDGE;

export function estimateOutputSize(width: number, height: number, aspect?: number | null): { width: number; height: number } {
  let w = width;
  let h = height;
  if (aspect !== undefined && aspect !== null && aspect > 0 && aspect < Infinity) {
    const wFromH = h * aspect;
    const hFromW = w / aspect;
    if (wFromH >= w) w = wFromH; else h = hFromW;
  }
  return { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) };
}

export function stretchOf(box: { width: number; height: number }, panelAspect: number): { across: number; down: number } {
  const a = box.width / box.height;
  if (!(a > 0) || !(panelAspect > 0)) return { across: 1, down: 1 };
  return panelAspect >= a ? { across: panelAspect / a, down: 1 } : { across: 1, down: a / panelAspect };
}

export function proposeFit(
  content: Rect, column: { left: number; width: number },
  band: { top: number; bottom: number; read: boolean },
  split?: { top: number; how: SplitHow } | null,
): FitDetected {
  const H = content.height;
  const whole: Rect = { left: column.left, top: content.top, width: column.width, height: H };
  const bottom = band.read ? band.bottom : 1;
  const cut = split && split.top < bottom - MIN_BOX / H ? split.top : band.top;
  const how: SplitHow = split && cut === split.top ? split.how : 'none';
  const top = Math.max(cut, MIN_BOX / H);
  const foot = how === 'none' ? band.bottom : bottom;
  return {
    glass: { ...whole, height: top * H },
    buttons: { ...whole, top: content.top + top * H, height: Math.max(MIN_BOX, (foot - top) * H) },
    deck: { ...whole, top: content.top + band.top * H, height: Math.max(MIN_BOX, (band.bottom - band.top) * H) },
    split: how,
    whole,
    read: band.read,
  };
}

export function hasDeck(set: FitSet, det: FitDetected): boolean {
  return !set.noDeck && (det.split !== 'none' || !!set.deck);
}

export const DECK_SHARE = 0.25;

export function resolveFit(set: FitSet, det: FitDetected, hasButtons: boolean): { glass: Quad; buttons: Quad | null; deck: Quad | null } {
  const deck = hasButtons && hasDeck(set, det) ? set.deck ?? quadOfRect(det.deck) : null;
  let buttons: Quad | null = null;
  if (hasButtons) {
    const own = set.buttons ?? quadOfRect(det.buttons);
    buttons = own;
    if (deck) {
      const met = lowerOnLine(own, deck);
      buttons = isConvexQuad(met) ? met : lowerOnLine(quadOfRect(det.buttons), deck);
    }
  }
  return { glass: set.glass ?? quadOfRect(hasButtons ? det.glass : det.whole), buttons, deck };
}

export const LINE_SLOP = 1.5;

function lineAt(a: Pt, b: Pt): (x: number) => number {
  const dx = b.x - a.x;
  const k = Math.abs(dx) < 1e-9 ? 0 : (b.y - a.y) / dx;
  return (x) => a.y + k * (x - a.x);
}

export function lowerOnLine(lower: Quad, deck: Quad): Quad {
  const y = lineAt(deck[0], deck[1]);
  return [{ ...lower[0] }, { ...lower[1] }, { x: lower[2].x, y: y(lower[2].x) }, { x: lower[3].x, y: y(lower[3].x) }];
}

export function deckOnLine(deck: Quad, lower: Quad): Quad {
  const y = lineAt(lower[3], lower[2]);
  return [{ x: deck[0].x, y: y(deck[0].x) }, { x: deck[1].x, y: y(deck[1].x) }, { ...deck[2] }, { ...deck[3] }];
}

function onJoin(was: [Pt, Pt], now: [Pt, Pt]): [Pt, Pt] {
  const y = lineAt(was[0], was[1]);
  return now.map((p, i) => {
    const moved = p.x !== was[i].x || p.y !== was[i].y;
    return moved && Math.abs(p.y - y(p.x)) <= LINE_SLOP ? { x: p.x, y: y(p.x) } : p;
  }) as [Pt, Pt];
}

export function withBox(pair: { buttons: Quad; deck: Quad }, name: 'buttons' | 'deck', q: Quad): { buttons: Quad; deck: Quad } | null {
  let out: { buttons: Quad; deck: Quad };
  if (name === 'buttons') {
    const [br, bl] = onJoin([pair.buttons[2], pair.buttons[3]], [q[2], q[3]]);
    const lower: Quad = [q[0], q[1], br, bl];
    out = { buttons: lower, deck: deckOnLine(pair.deck, lower) };
  } else {
    const [tl, tr] = onJoin([pair.deck[0], pair.deck[1]], [q[0], q[1]]);
    const deck: Quad = [tl, tr, q[2], q[3]];
    out = { buttons: lowerOnLine(pair.buttons, deck), deck };
  }
  return isConvexQuad(out.buttons) && isConvexQuad(out.deck) ? out : null;
}

export function addDeck(set: FitSet, det: FitDetected): { buttons: Quad; deck: Quad; proposed: boolean } | null {
  const deck = quadOfRect(det.deck);
  for (const lower of [set.buttons, quadOfRect(det.buttons)]) {
    if (!lower) continue;
    const b = lowerOnLine(lower, deck);
    if (isConvexQuad(b)) return { buttons: b, deck, proposed: true };
  }
  for (const lower of [set.buttons, quadOfRect(det.buttons)]) {
    if (!lower) continue;
    const r = boundsOf(lower);
    const h = Math.max(MIN_BOX, r.height * DECK_SHARE);
    if (r.height - h < MIN_BOX) continue;
    const d = quadOfRect({ left: r.left, top: r.top + r.height - h, width: r.width, height: h });
    const b = lowerOnLine(lower, d);
    if (isConvexQuad(b)) return { buttons: b, deck: d, proposed: false };
  }
  return null;
}

export function removeDeck(set: FitSet, det: FitDetected): Quad | null {
  const both = resolveFit(set, det, true);
  if (!both.deck) return set.buttons ?? null;
  const lower = both.buttons!;
  const merged: Quad = [{ ...lower[0] }, { ...lower[1] }, { ...both.deck[2] }, { ...both.deck[3] }];
  const q = isConvexQuad(merged) ? merged : quadOfRect(det.buttons);
  return sameQuad(q, quadOfRect(det.buttons)) ? null : q;
}

export function resetBox(set: FitSet, det: FitDetected, name: PanelName): FitSet {
  const out = { ...set };
  if (name === 'glass' || !hasDeck(out, det)) { delete out[name]; return out; }
  if (name === 'deck') {
    delete out.deck;
    if (det.split === 'none') {
      const a = addDeck({}, det);
      if (!a) return out;
      out.deck = a.deck;
      if (out.buttons) {
        const met = lowerOnLine(out.buttons, a.deck);
        if (isConvexQuad(met) && !sameQuad(met, a.buttons)) out.buttons = met; else delete out.buttons;
      }
      return out;
    }
    if (out.buttons) {
      const met = lowerOnLine(out.buttons, quadOfRect(det.deck));
      if (isConvexQuad(met) && !sameQuad(met, lowerOnLine(quadOfRect(det.buttons), quadOfRect(det.deck)))) out.buttons = met;
      else delete out.buttons;
    }
    return out;
  }
  delete out.buttons;
  const deck = out.deck ?? quadOfRect(det.deck);
  if (!isConvexQuad(lowerOnLine(quadOfRect(det.buttons), deck))) return resetBox(out, det, 'deck');
  return out;
}

export function isSetBox(set: FitSet, det: FitDetected, name: PanelName): boolean {
  if (!set[name]) return false;
  const now = resolveFit(set, det, true)[name] ?? null;
  const back = resolveFit(resetBox(set, det, name), det, true)[name] ?? null;
  return !now || !back || !sameQuad(now, back);
}

export function union(...rs: Rect[]): Rect {
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((x) => x.left + x.width));
  const b = Math.max(...rs.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
}

export function cropOf(set: FitSet, det: FitDetected): Rect {
  const a = resolveFit(set, det, true);
  const rs = [boundsOf(a.glass), boundsOf(a.buttons!), boundsOf(resolveFit(set, det, false).glass)];
  if (a.deck) rs.push(boundsOf(a.deck));
  return union(...rs);
}

export function fracOf(r: Rect, of: Rect): Frac {
  return { x: (r.left - of.left) / of.width, y: (r.top - of.top) / of.height, w: r.width / of.width, h: r.height / of.height };
}

export function quadFrac(q: Quad, of: Rect): Quad {
  return q.map((p) => ({ x: (p.x - of.left) / of.width, y: (p.y - of.top) / of.height })) as Quad;
}

export function uvOf(f: Frac): [number, number, number, number] {
  return [f.x, 1 - (f.y + f.h), f.x + f.w, 1 - f.y];
}

export interface ShellFit { aspect: number; glass: Quad; buttons: Quad; deck: Quad | null; glassOnly: Quad }

export function fracToUnits(q: Quad, cropAspect: number): Quad {
  return q.map((p) => ({ x: p.x * cropAspect, y: p.y })) as Quad;
}

export function fracAspect(q: Quad, cropAspect: number): number {
  return quadAspect(fracToUnits(q, cropAspect));
}

export function wholeTextureFit(aspect: number, band: { top: number; bottom: number }): ShellFit {
  return {
    aspect,
    glass: quadOfRect({ left: 0, top: 0, width: 1, height: band.top }),
    buttons: quadOfRect({ left: 0, top: band.top, width: 1, height: band.bottom - band.top }),
    deck: null,
    glassOnly: quadOfRect({ left: 0, top: 0, width: 1, height: 1 }),
  };
}
