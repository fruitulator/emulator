import { UI_ICONS } from '../web/ui/icons';
import { card } from '../web/ui/rows';
import { actionButton } from '../web/ui/list';
import { PANEL_LABEL, PANEL_NAMES, stretchOf, type PanelName, type Rect } from './fit';
import type { SplitHow } from './fold';
import { dragQuad, isRectQuad, levelEdges, rectifiedSize, roundQuad, squareUp, type Quad, type QuadGrip as Grip } from './quad';
import { el, iconButton } from './host';
import { NudgeRun } from './looksettle';
import type { CabinetPanels } from './cabinets';
import { str } from '../web/i18n';

export interface FitViewOptions {
  content: Rect;
  source: () => HTMLCanvasElement | null;
  boxes: (hasButtons: boolean) => { glass: Quad; buttons: Quad | null; deck: Quad | null };
  isSet: (name: PanelName) => boolean;
  split: SplitHow;
  onChange: (name: PanelName, q: Quad, done: boolean) => boolean;
  onReset: (name: PanelName | 'all') => void;
  onDeck: (on: boolean) => void;
  canAddDeck: () => boolean;
  accepts: (name: PanelName, q: Quad) => boolean;
}

const GRIPS: Grip[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const PAD = 16;
const DRAG_SLOP = 3;
const ZOOM_MAX = 8;
const ZOOM_PER_UNIT = 0.0025;
const EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
const NAMES: PanelName[] = PANEL_NAMES;
const SVG = 'http://www.w3.org/2000/svg';
const NO_LOWER = str('arcade.fitview.this_model_has_no_lower');
const SQUARE_ICON = '<path d="M4 18 8 6h8l4 12z" stroke-dasharray="2 2.2"/><rect x="6.5" y="6.5" width="11" height="11" rx="0.5"/>';

export class FitView {
  readonly root: HTMLElement;
  readonly stageRoot = el('div', null, { class: 'fit-wrap', 'data-fit': 'wrap' });
  private readonly stage = el('div', null, { class: 'fit-stage', 'data-fit': 'stage' });
  private readonly pic = el('canvas', null, { class: 'fit-pic', 'aria-hidden': 'true' });
  private readonly boxEls = new Map<PanelName, HTMLElement>();
  private readonly marks = el('div', null, { class: 'fit-marks', 'aria-hidden': 'true' });
  private readonly notes = new Map<PanelName, HTMLElement>();
  private readonly resets = new Map<PanelName, HTMLButtonElement>();
  private readonly squares = new Map<PanelName, HTMLButtonElement>();
  private readonly polys = new Map<PanelName, SVGPolygonElement>();
  private readonly edges = new Map<PanelName, SVGLineElement[]>();
  private readonly picked = new Map<PanelName, Grip>();
  private readonly svgs = new Map<PanelName, SVGSVGElement>();
  private readonly resetAll: HTMLButtonElement;
  private readonly rows = new Map<PanelName, HTMLElement>();
  private readonly deckAdd: HTMLButtonElement;
  private readonly deckRemove: HTMLButtonElement;
  private panels: CabinetPanels | null = null;
  private drag: { name: PanelName; grip: Grip; x: number; y: number; start: Quad; id: number; moving: boolean } | null = null;
  private pan: { id: number; x: number; y: number; sx: number; sy: number } | null = null;
  private zoom = 1;
  private drawnPaints = -1;
  private readonly ro: ResizeObserver | null;
  private sizeRaf = 0;

  constructor(private readonly o: FitViewOptions) {
    this.root = el('div', null, { class: 'fit-view', 'data-fit': 'view' });
    this.stageRoot.append(this.stage);
    this.stage.append(this.pic);
    for (const name of NAMES) {
      const b = el('div', null, {
        class: `fit-box fit-${name}`, 'data-fit': name, tabindex: '0', role: 'group',
        'aria-label': str('arcade.fitview.n_box_drag_to_move', { 0: PANEL_LABEL[name] }),
      });
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'fit-svg');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('class', 'fit-poly');
      poly.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(poly);
      const lines: SVGLineElement[] = [];
      for (let i = 0; i < 4; i++) {
        const line = document.createElementNS(SVG, 'line');
        line.setAttribute('class', 'fit-edge');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(line);
        lines.push(line);
      }
      b.append(svg);
      this.svgs.set(name, svg);
      this.polys.set(name, poly);
      this.edges.set(name, lines);
      this.picked.set(name, 'move');
      b.append(el('span', PANEL_LABEL[name], { class: 'fit-tag' }));
      for (const g of GRIPS) b.append(el('span', null, { class: `fit-grip fit-grip-${g}`, 'data-grip': g }));
      this.wire(b, name);
      this.boxEls.set(name, b);
      this.stage.append(b);
    }
    this.stage.append(this.marks);
    this.wireZoom();
    const list = card();
    list.classList.add('fit-rows');
    for (const name of NAMES) {
      const row = el('div', null, { class: 'menu-row fit-row', 'data-fit-row': name });
      const text = el('div', null, { class: 'fit-row-text' });
      const note = el('span', '', { class: 'row-sub fit-note' });
      text.append(el('span', PANEL_LABEL[name], { class: `row-label fit-row-label fit-key-${name}` }), note);
      const square = iconButton(SQUARE_ICON, str('arcade.fitview.square_it_up_the_n', { 0: PANEL_LABEL[name].toLowerCase() }), () => {
        const q = this.current(name);
        if (q && !isRectQuad(q)) { o.onChange(name, roundQuad(squareUp(q)), true); this.sync(); }
      });
      square.className = 'ui-reset fit-square';
      square.setAttribute('data-fit-square', name);
      const reset = iconButton(UI_ICONS.reset, str('arcade.fitview.reset_the_n_box', { 0: PANEL_LABEL[name].toLowerCase() }), () => o.onReset(name));
      reset.className = 'ui-reset';
      row.append(text, square, reset);
      this.rows.set(name, row);
      this.squares.set(name, square);
      this.notes.set(name, note);
      this.resets.set(name, reset);
      list.append(row);
    }
    this.resetAll = actionButton(str('arcade.fitview.reset_all'), 'tertiary', () => o.onReset('all'), UI_ICONS.reset);
    this.resetAll.classList.add('fit-reset-all');
    this.deckAdd = iconButton(UI_ICONS.plus, str('arcade.fitview.add_a_buttons_panel'), () => { o.onDeck(true); this.sync(); });
    this.deckAdd.className = 'ui-reset fit-deck-add';
    this.deckAdd.setAttribute('data-fit-deck', 'add');
    this.deckRemove = iconButton(UI_ICONS.trash, str('arcade.fitview.remove_the_buttons_panel'), () => { o.onDeck(false); this.sync(); });
    this.deckRemove.className = 'ui-reset fit-deck-remove';
    this.deckRemove.setAttribute('data-fit-deck', 'remove');
    this.rows.get('deck')!.append(this.deckRemove, this.deckAdd);
    const foot = el('div', null, { class: 'fit-foot' });
    foot.append(this.resetAll);
    this.root.append(list, foot);
    this.ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { cancelAnimationFrame(this.sizeRaf); this.sizeRaf = requestAnimationFrame(() => this.size()); })
      : null;
    this.ro?.observe(this.stageRoot);
    this.sync();
  }

  setPanels(p: CabinetPanels | null): void {
    this.panels = p;
    this.sync();
  }

  dispose(): void {
    this.ro?.disconnect();
    cancelAnimationFrame(this.sizeRaf);
  }

  private size(): void {
    const c = this.o.content;
    const W0 = this.stageRoot.clientWidth;
    const H0 = this.stageRoot.clientHeight;
    if (!W0 || !H0) return;
    const tools = this.stageRoot.parentElement?.querySelector('.wz-tools');
    const box = this.stageRoot.getBoundingClientRect();
    const t = tools?.getBoundingClientRect();
    const down = t && t.height ? t.bottom - box.top : 0;
    const left = t && t.width ? box.right - t.left : 0;
    const fit = (w: number, h: number): number => (w > 0 && h > 0 ? Math.min(w / c.width, h / c.height) : 0);
    const below = fit(W0 - 2 * PAD, H0 - PAD - Math.max(PAD, down + 8));
    const beside = fit(W0 - PAD - Math.max(PAD, left + 8), H0 - 2 * PAD);
    const k = Math.max(below, beside) * this.zoom;
    if (k <= 0) return;
    const pad = below >= beside
      ? `${Math.max(PAD, down + 8)}px ${PAD}px ${PAD}px`
      : `${PAD}px ${Math.max(PAD, left + 8)}px ${PAD}px ${PAD}px`;
    if (this.stageRoot.style.padding !== pad) this.stageRoot.style.padding = pad;
    this.stageRoot.classList.toggle('fit-zoomed', this.zoom > 1);
    const W = `${Math.floor(c.width * k)}px`;
    const H = `${Math.floor(c.height * k)}px`;
    if (this.stage.style.width !== W || this.stage.style.height !== H) {
      this.stage.style.width = W;
      this.stage.style.height = H;
      this.drawnPaints = -1;
    }
  }

  draw(paints: number): void {
    if (paints === this.drawnPaints) return;
    const src = this.o.source();
    if (!src) return;
    const r = this.stage.getBoundingClientRect();
    if (!r.width) { this.size(); return; }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const scale = Math.min(dpr, src.width / (r.width || 1), src.height / (r.height || 1));
    const w = Math.round(r.width * scale);
    const h = Math.round(r.height * scale);
    if (this.pic.width !== w || this.pic.height !== h) { this.pic.width = w; this.pic.height = h; }
    const g = this.pic.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
    this.drawnPaints = paints;
  }

  private current(name: PanelName): Quad | null {
    return this.o.boxes(this.hasLower())[name];
  }

  private hasLower(): boolean {
    return this.panels ? this.panels.buttons !== null : true;
  }

  sync(): void {
    this.size();
    const c = this.o.content;
    const hasButtons = this.hasLower();
    const boxes = this.o.boxes(hasButtons);
    const pct = (x: number, y: number): [string, string] => [
      `${((x - c.left) / c.width) * 100}%`, `${((y - c.top) / c.height) * 100}%`,
    ];
    for (const name of NAMES) {
      const b = this.boxEls.get(name)!;
      const q = boxes[name];
      b.hidden = !q;
      if (q) {
        this.svgs.get(name)!.setAttribute('viewBox', `${c.left} ${c.top} ${c.width} ${c.height}`);
        this.polys.get(name)!.setAttribute('points', q.map((p) => `${p.x},${p.y}`).join(' '));
        b.dataset.quad = q.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
        const level = levelEdges(q);
        this.edges.get(name)!.forEach((line, i) => {
          const [a, z] = EDGES[i];
          line.setAttribute('x1', String(q[a].x));
          line.setAttribute('y1', String(q[a].y));
          line.setAttribute('x2', String(q[z].x));
          line.setAttribute('y2', String(q[z].y));
          line.classList.toggle('fit-edge-level', level[i]);
        });
        b.dataset.level = level.map((l) => (l ? '1' : '0')).join('');
        const picked = this.picked.get(name);
        for (const g of GRIPS) {
          const [x, y] = gripPoint(q, g);
          const e = b.querySelector<HTMLElement>(`.fit-grip-${g}`)!;
          [e.style.left, e.style.top] = pct(x, y);
          e.classList.toggle('fit-grip-picked', g === picked);
        }
        b.dataset.picked = picked;
        const tag = b.querySelector<HTMLElement>('.fit-tag')!;
        [tag.style.left, tag.style.top] = pct(q.reduce((t, p) => t + p.x, 0) / 4, q.reduce((t, p) => t + p.y, 0) / 4);
      }
      if (name === 'deck') {
        this.rows.get(name)!.hidden = !q && !this.hasLower();
        this.rows.get(name)!.classList.toggle('fit-row-off', !q);
      }
      const note = this.note(name);
      const ne = this.notes.get(name)!;
      ne.textContent = note;
      ne.hidden = !note;
      const reset = this.resets.get(name)!;
      const on = this.o.isSet(name);
      reset.disabled = !on;
      reset.hidden = name === 'deck' && !q;
      reset.classList.toggle('off-neutral', on);
      const sq = this.squares.get(name)!;
      const skew = !!q && !isRectQuad(q);
      sq.hidden = !q;
      sq.disabled = !skew;
      sq.classList.toggle('off-neutral', skew);
    }
    this.resetAll.disabled = !NAMES.some((n) => this.o.isSet(n));
    this.deckAdd.hidden = !!boxes.deck || !hasButtons || !this.o.canAddDeck();
    this.deckRemove.hidden = !boxes.deck;
    this.logFit(boxes);
  }

  setMarks(marks: { n: number; rect: Rect }[], on: number | null = null): void {
    const c = this.o.content;
    const pc = (v: number, o: number, w: number): string => `${((v - o) / w) * 100}%`;
    this.marks.replaceChildren();
    for (const m of marks) {
      const r = m.rect;
      if (m.n === on) {
        const ring = el('span', null, { class: 'fit-mark-cap' });
        ring.style.left = pc(r.left, c.left, c.width);
        ring.style.top = pc(r.top, c.top, c.height);
        ring.style.width = `${(r.width / c.width) * 100}%`;
        ring.style.height = `${(r.height / c.height) * 100}%`;
        this.marks.append(ring);
      }
      const b = el('span', String(m.n + 1), { class: `fit-mark${m.n === on ? ' on' : ''}`, 'data-mount': String(m.n) });
      b.style.left = pc(r.left + r.width / 2, c.left, c.width);
      b.style.top = pc(r.top + r.height / 2, c.top, c.height);
      this.marks.append(b);
    }
  }

  private note(name: PanelName): string {
    const p = this.panels;
    if (name === 'buttons' && p && p.buttons === null) return NO_LOWER;
    return '';
  }

  private logFit(boxes: { glass: Quad; buttons: Quad | null; deck: Quad | null }): void {
    const p = this.panels;
    if (!p) return;
    const line = NAMES.map((name) => {
      const q = boxes[name];
      if (!q) return `${name}: none`;
      const straight = isRectQuad(q) ? '' : ', four corners straightened';
      if (!p.fixed) return `${name}: cabinet built to the box${straight}`;
      const aspect = name === 'glass' ? p.glass : name === 'buttons' ? p.buttons : p.deck;
      if (!aspect) return `${name}: no panel`;
      const s = stretchOf(rectifiedSize(q), aspect);
      return `${name}: stretched ${s.across.toFixed(2)} across, ${s.down.toFixed(2)} down${straight}`;
    }).join('; ') + (this.o.isSet('buttons') ? '' : `; lower glass top found by ${this.o.split}`);
    if (line === this.logged) return;
    this.logged = line;
    console.info(`[arcade] fit: ${line}`);
  }

  private logged = '';

  private wire(b: HTMLElement, name: PanelName): void {
    const layoutPerPx = (): { x: number; y: number } => {
      const r = this.stage.getBoundingClientRect();
      return { x: this.o.content.width / (r.width || 1), y: this.o.content.height / (r.height || 1) };
    };
    const current = (): Quad | null => this.current(name);
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      if (this.drag && this.drag.id === ev.pointerId) this.endDrag(ev.pointerId);
      if (this.drag) return;
      const start = current();
      if (!start) return;
      ev.preventDefault();
      const grip = gripAt(this.stage, this.o.content, start, ev.clientX, ev.clientY);
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      b.focus({ preventScroll: true });
      this.raise(name);
      this.picked.set(name, grip);
      this.drag = { name, grip, x: ev.clientX, y: ev.clientY, start, id: ev.pointerId, moving: false };
      this.sync();
    });
    b.addEventListener('pointermove', (ev) => {
      const d = this.drag;
      if (!d || d.id !== ev.pointerId || d.name !== name) return;
      if (ev.pointerType === 'mouse' && ev.buttons === 0) { this.endDrag(ev.pointerId); return; }
      if (!d.moving) {
        if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < DRAG_SLOP) return;
        d.moving = true;
        b.classList.add('fit-dragging');
      }
      const k = layoutPerPx();
      const dx = (ev.clientX - d.x) * k.x;
      const dy = (ev.clientY - d.y) * k.y;
      const at = (t: number): Quad => roundQuad(dragQuad(d.start, d.grip, dx * t, dy * t, this.o.content));
      if (!this.o.onChange(name, at(1), false)) {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          if (this.o.accepts(name, at(mid))) lo = mid; else hi = mid;
        }
        if (lo > 0) this.o.onChange(name, at(lo), false);
      }
      this.sync();
    });
    const end = (ev: PointerEvent): void => {
      const d = this.drag;
      if (!d || d.id !== ev.pointerId || d.name !== name) return;
      this.endDrag(ev.pointerId);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    const nudges = new NudgeRun(() => {
      const q = current();
      if (q) this.o.onChange(name, q, true);
      this.sync();
    });
    b.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.picked.get(name) !== 'move') {
        ev.preventDefault();
        ev.stopPropagation();
        this.picked.set(name, 'move');
        this.sync();
        return;
      }
      const step = ev.shiftKey ? 10 : 1;
      const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[ev.key];
      const start = current();
      if (!d || !start) return;
      ev.preventDefault();
      ev.stopPropagation();
      const grip = this.picked.get(name) ?? 'move';
      nudges.down(() => {
        this.o.onChange(name, roundQuad(dragQuad(start, grip, d[0], d[1], this.o.content)), false);
        this.sync();
      });
    });
    b.addEventListener('keyup', (ev) => { if (ev.key.startsWith('Arrow')) nudges.up(); });
    b.addEventListener('blur', () => nudges.up());
  }

  private endDrag(id: number): void {
    const d = this.drag;
    if (!d || d.id !== id) return;
    this.drag = null;
    const b = this.boxEls.get(d.name)!;
    b.classList.remove('fit-dragging');
    if (d.moving) {
      const q = this.current(d.name);
      if (q) this.o.onChange(d.name, q, true);
    }
    this.sync();
  }

  private wireZoom(): void {
    const wrap = this.stageRoot;
    wrap.addEventListener('wheel', (ev) => {
      if (this.drag) return;
      ev.preventDefault();
      const units = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
      const z = Math.max(1, Math.min(ZOOM_MAX, this.zoom * Math.exp(-units * ZOOM_PER_UNIT)));
      this.setZoom(z, ev.clientX, ev.clientY);
    }, { passive: false });
    const stage = this.stage;
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      if (this.zoom <= 1 || this.drag || this.pan) return;
      if (ev.target !== stage && ev.target !== this.pic) return;
      ev.preventDefault();
      stage.setPointerCapture?.(ev.pointerId);
      this.pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sx: wrap.scrollLeft, sy: wrap.scrollTop };
      stage.classList.add('fit-panning');
    });
    stage.addEventListener('pointermove', (ev) => {
      const p = this.pan;
      if (!p || p.id !== ev.pointerId) return;
      if (ev.pointerType === 'mouse' && ev.buttons === 0) { endPan(ev); return; }
      wrap.scrollLeft = p.sx - (ev.clientX - p.x);
      wrap.scrollTop = p.sy - (ev.clientY - p.y);
    });
    const endPan = (ev: PointerEvent): void => {
      if (!this.pan || this.pan.id !== ev.pointerId) return;
      this.pan = null;
      stage.classList.remove('fit-panning');
    };
    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', endPan);
    stage.addEventListener('lostpointercapture', endPan);
  }

  private setZoom(z: number, cx: number, cy: number): void {
    if (z === this.zoom) return;
    const wrap = this.stageRoot;
    const w = wrap.getBoundingClientRect();
    const r = this.stage.getBoundingClientRect();
    const fx = r.width ? (cx - r.left) / r.width : 0.5;
    const fy = r.height ? (cy - r.top) / r.height : 0.5;
    this.zoom = z;
    this.size();
    this.drawnPaints = -1;
    const left = this.stage.offsetLeft + fx * this.stage.offsetWidth - (cx - w.left);
    const top = this.stage.offsetTop + fy * this.stage.offsetHeight - (cy - w.top);
    wrap.scrollLeft = Math.max(0, left);
    wrap.scrollTop = Math.max(0, top);
    this.sync();
  }

  private raise(name: PanelName): void {
    for (const [n, e] of this.boxEls) e.classList.toggle('fit-top', n === name);
  }
}

const GRIP_HALF = 11;

function gripPoint(q: Quad, g: Grip): [number, number] {
  const mid = (a: number, b: number): [number, number] => [(q[a].x + q[b].x) / 2, (q[a].y + q[b].y) / 2];
  switch (g) {
    case 'nw': return [q[0].x, q[0].y];
    case 'ne': return [q[1].x, q[1].y];
    case 'se': return [q[2].x, q[2].y];
    case 'sw': return [q[3].x, q[3].y];
    case 'n': return mid(0, 1);
    case 'e': return mid(1, 2);
    case 's': return mid(3, 2);
    case 'w': return mid(0, 3);
    default: return [(q[0].x + q[2].x) / 2, (q[0].y + q[2].y) / 2];
  }
}

function gripAt(stage: HTMLElement, c: Rect, q: Quad, x: number, y: number): Grip {
  const r = stage.getBoundingClientRect();
  let best: Grip = 'move';
  let bestD = Infinity;
  for (const g of GRIPS) {
    const [gx, gy] = gripPoint(q, g);
    const cx = r.left + ((gx - c.left) / c.width) * r.width;
    const cy = r.top + ((gy - c.top) / c.height) * r.height;
    if (Math.abs(x - cx) > GRIP_HALF || Math.abs(y - cy) > GRIP_HALF) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}
