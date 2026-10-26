import type * as THREE from 'three';
import type { CabinetShell } from './cabinets';
import { facePoint, meshPointAtUv } from './glasshit';
import { boundsOf, homography, isRectQuad, type Box, type Pt, type Quad } from './quad';
import { axisPlan, Presenter } from '../web/present';

export const CANVAS_OVER_GLASS_Z = 100_000;

const CORNERS = [[0, 1], [1, 1], [1, 0], [0, 0]] as const;

export function glassPieces(shell: CabinetShell, cw: number, ch: number, ox: number, oy: number, camera: THREE.Camera, W: number, H: number): Piece[] {
  const pieces: Piece[] = [];
  for (const m of shell.glassMeshes) {
    if (!m.visible) continue;
    const src = m.userData.src as Quad | undefined;
    if (!src) continue;
    m.updateWorldMatrix(true, false);
    const sq: Pt[] = [], dq: Pt[] = [];
    for (const [u, v] of CORNERS) {
      const f = facePoint(src, u, v);
      const local = meshPointAtUv(m.geometry, u, v);
      if (!f || !local) break;
      const p = local.applyMatrix4(m.matrixWorld).project(camera);
      if (p.z < -1 || p.z > 1) break;
      sq.push({ x: ox + f.x * cw, y: oy + f.y * ch });
      dq.push({ x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H });
    }
    if (sq.length === 4) pieces.push({ src: sq as Quad, dst: dq as Quad });
  }
  return pieces;
}

export function holeGlass(shell: CabinetShell, on: boolean): void {
  for (const m of shell.glassMeshes) {
    const mat = m.material as THREE.Material;
    if (mat.colorWrite === on) mat.colorWrite = !on;
    m.renderOrder = on ? -1 : 0;
  }
}

export interface Piece { src: Quad; dst: Quad }

export function axisMagnification(src: Quad, dst: Quad): { x: number; y: number } {
  const stretch = (i: number, j: number): number => {
    const ls = Math.hypot(src[j].x - src[i].x, src[j].y - src[i].y);
    return ls > 0 ? Math.hypot(dst[j].x - dst[i].x, dst[j].y - dst[i].y) / ls : 0;
  };
  return { x: Math.max(stretch(0, 1), stretch(3, 2)), y: Math.max(stretch(1, 2), stretch(0, 3)) };
}

export function shownScale(m: number): number {
  if (!(m > 0) || m >= 1) return 1;
  return Math.max(1 / 64, Math.min(1, 2 ** (Math.ceil(Math.log2(m) * 8) / 8)));
}

export function matrix3dFor(src: Quad, dst: Quad, origin: Pt): string | null {
  const local = src.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y })) as Quad;
  const h = homography(local, dst);
  if (!h) return null;
  const v = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]];
  return `matrix3d(${v.map((n) => (Math.abs(n) < 1e-12 ? 0 : +n.toPrecision(9))).join(',')})`;
}

export function clipPathFor(src: Quad, b: Box): string {
  if (isRectQuad(src, 1e-6)) return '';
  return `polygon(${src.map((p) => `${+(p.x - b.left).toFixed(2)}px ${+(p.y - b.top).toFixed(2)}px`).join(', ')})`;
}

interface PieceEl {
  el: HTMLDivElement; key: string; own: HTMLCanvasElement | null; b: Box; last: string;
  shown: { w: number; h: number } | null; presenter: Presenter | null;
}

export class GlassOverlay {
  readonly el = document.createElement('div');
  private canvas: HTMLCanvasElement | null = null;
  private present = false;
  private pieces: PieceEl[] = [];
  private main = -1;

  constructor(host: HTMLElement) {
    const s = this.el.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.width = '0';
    s.height = '0';
    s.pointerEvents = 'none';
    s.display = 'none';
    host.insertBefore(this.el, host.firstChild);
  }

  setOrder(z: number): void {
    const v = String(z);
    if (this.el.style.zIndex !== v) this.el.style.zIndex = v;
  }

  show(canvas: HTMLCanvasElement, present = false): void {
    if (this.canvas === canvas && this.present === present) return;
    this.canvas = canvas;
    this.present = present;
    for (const p of this.pieces) p.key = '';
  }

  get shownSaid(): string {
    const pe = this.pieces[this.main];
    if (!pe?.shown || !pe.b.width || !pe.b.height) return '1';
    return `${(pe.shown.w / pe.b.width).toFixed(2)}x${(pe.shown.h / pe.b.height).toFixed(2)}`;
  }

  place(pieces: Piece[] | null): void {
    const cv = this.canvas;
    if (!cv || !pieces?.length) { this.el.style.display = 'none'; for (const p of this.pieces) p.last = ''; return; }
    const area = (q: Quad): number => { const b = boundsOf(q); return b.width * b.height; };
    let main = 0;
    pieces.forEach((p, i) => { if (area(p.src) > area(pieces[main].src)) main = i; });
    if (main !== this.main) { this.main = main; for (const p of this.pieces) p.key = ''; }
    while (this.pieces.length < pieces.length) {
      const el = document.createElement('div');
      const s = el.style;
      s.position = 'absolute';
      s.left = '0';
      s.top = '0';
      s.overflow = 'hidden';
      s.transformOrigin = '0 0';
      s.willChange = 'transform';
      s.pointerEvents = 'none';
      this.el.appendChild(el);
      this.pieces.push({ el, key: '', own: null, b: { left: 0, top: 0, width: 0, height: 0 }, last: '', shown: null, presenter: null });
    }
    for (let i = pieces.length; i < this.pieces.length; i++) { this.pieces[i].el.style.display = 'none'; this.pieces[i].last = ''; }
    const dpr = devicePixelRatio || 1;
    pieces.forEach((p, i) => {
      const pe = this.pieces[i];
      const src = p.src;
      const b = boundsOf(src);
      let shown: { w: number; h: number } | null = null;
      if (this.present && b.width > 0 && b.height > 0) {
        const m = axisMagnification(src, p.dst);
        const sx = shownScale(m.x * dpr);
        const sy = shownScale(m.y * dpr);
        if (sx < 1 || sy < 1) shown = { w: Math.max(1, Math.ceil(b.width * sx)), h: Math.max(1, Math.ceil(b.height * sy)) };
      }
      const key = `${i === main ? 'm' : 'c'}:${shown ? `${shown.w}x${shown.h}` : '1'}:${src.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(';')}`;
      if (key !== pe.key) this.setUp(pe, src, b, i === main, key, shown);
      const t = shown
        ? matrix3dFor(src.map((q) => ({ x: ((q.x - b.left) * shown!.w) / b.width, y: ((q.y - b.top) * shown!.h) / b.height })) as Quad, p.dst, { x: 0, y: 0 })
        : matrix3dFor(src, p.dst, { x: b.left, y: b.top });
      if (t === null) { pe.el.style.display = 'none'; pe.last = ''; return; }
      if (t !== pe.last) { pe.last = t; pe.el.style.transform = t; pe.el.style.display = 'block'; }
    });
    this.el.style.display = 'block';
  }

  private setUp(pe: PieceEl, src: Quad, b: Box, main: boolean, key: string, shown: { w: number; h: number } | null): void {
    const cv = this.canvas!;
    pe.key = key;
    pe.b = b;
    pe.shown = shown;
    pe.el.replaceChildren();
    if (shown) {
      const local = src.map((q) => ({ x: ((q.x - b.left) * shown.w) / b.width, y: ((q.y - b.top) * shown.h) / b.height })) as Quad;
      pe.el.style.width = `${shown.w}px`;
      pe.el.style.height = `${shown.h}px`;
      pe.el.style.clipPath = clipPathFor(local, { left: 0, top: 0, width: shown.w, height: shown.h });
      const own = pe.own ?? document.createElement('canvas');
      own.width = shown.w;
      own.height = shown.h;
      pe.own = own;
      const s = own.style;
      s.position = 'absolute';
      s.left = '0px';
      s.top = '0px';
      s.width = `${shown.w}px`;
      s.height = `${shown.h}px`;
      s.pointerEvents = 'none';
      pe.el.appendChild(own);
      this.presentPiece(pe);
      return;
    }
    pe.presenter?.free();
    pe.presenter = null;
    pe.el.style.width = `${b.width}px`;
    pe.el.style.height = `${b.height}px`;
    pe.el.style.clipPath = clipPathFor(src, b);
    const place = (c: HTMLCanvasElement, left: number, top: number): void => {
      const s = c.style;
      s.position = 'absolute';
      s.left = `${left}px`;
      s.top = `${top}px`;
      s.width = `${c.width}px`;
      s.height = `${c.height}px`;
      s.pointerEvents = 'none';
      pe.el.appendChild(c);
    };
    if (main) { pe.own = null; place(cv, -b.left, -b.top); return; }
    const own = pe.own ?? document.createElement('canvas');
    own.width = Math.max(1, Math.ceil(b.width));
    own.height = Math.max(1, Math.ceil(b.height));
    pe.own = own;
    place(own, 0, 0);
    this.blit(pe);
  }

  private blit(pe: PieceEl): void {
    const cv = this.canvas;
    if (!cv || !pe.own) return;
    const g = pe.own.getContext('2d');
    if (!g) return;
    g.drawImage(cv, pe.b.left, pe.b.top, pe.b.width, pe.b.height, 0, 0, pe.b.width, pe.b.height);
  }

  private presentPiece(pe: PieceEl): void {
    const cv = this.canvas;
    if (!cv || !pe.own || !pe.shown) return;
    const g = pe.own.getContext('2d');
    if (!g) return;
    const { w, h } = pe.shown;
    pe.presenter ??= new Presenter();
    pe.presenter.run(g, cv, pe.b.left, pe.b.top, pe.b.width, pe.b.height, axisPlan(pe.b.width, pe.b.height, w, h), w, h);
  }

  refresh(): void {
    for (const pe of this.pieces) {
      if (!pe.own || pe.el.style.display === 'none') continue;
      if (pe.shown) this.presentPiece(pe);
      else this.blit(pe);
    }
  }

  get showing(): boolean { return this.el.style.display !== 'none'; }

  setDim(k: number, bright = 1): void {
    const s = (k < 1 ? Math.pow(k, 1 / 2.2) : 1) * bright;
    const f = s !== 1 ? `brightness(${+s.toFixed(3)})` : '';
    if (this.el.style.filter !== f) this.el.style.filter = f;
  }

  hide(): void {
    for (const pe of this.pieces) {
      pe.el.replaceChildren(); pe.key = ''; pe.last = ''; pe.el.style.display = 'none';
      pe.presenter?.free(); pe.presenter = null; pe.shown = null;
    }
    this.canvas = null;
    this.el.style.display = 'none';
  }

  dispose(): void {
    this.hide();
    this.el.remove();
  }
}
