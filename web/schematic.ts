import type {
  ActivityLevel, BusKind, FrameSignal, Schematic, SchematicEdge, SchematicNode,
} from '../src/machine/schematic';
import { envelope, frameDuty, levelFromRatio } from '../src/machine/schematic';
import type { FrameView } from '../src/machine/framestate';
import type { DownloadMenu } from './panelmenu';
import { str } from './i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PanelStats {
  fps: number;
  tickHz: number;
  stepMs: number;
  clockHz: number;
  droppedMs: number;
  buildId: string;
}

function el<K extends keyof SVGElementTagNameMap>(
  name: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

interface Rect { x: number; y: number; w: number; h: number }
const cx = (r: Rect): number => r.x + r.w / 2;
const cy = (r: Rect): number => r.y + r.h / 2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function route(
  from: Rect, to: Rect, edge: SchematicEdge, fromRail: boolean, toRail: boolean,
  blockers: Rect[], seq: number,
): string {
  if (edge.via?.length) {
    const pts = edge.via;
    return `M${pts[0][0]} ${pts[0][1]}` + pts.slice(1).map((p) => ` L${p[0]} ${p[1]}`).join('');
  }
  if (toRail || fromRail) {
    const box = toRail ? from : to;
    const rail = toRail ? to : from;
    const lo = Math.min(box.y + box.h, rail.y);
    const hi = Math.max(box.y, rail.y);
    const x = clearLane(box, blockers, lo, hi);
    const startY = box.y + box.h <= rail.y ? box.y + box.h : box.y;
    return `M${x} ${startY} L${x} ${cy(rail)}`;
  }

  const inset = (r: Rect, v: number): number => clamp(v, r.x + 6, r.x + r.w - 6);

  if (from.y + from.h <= to.y) {
    const sx = inset(from, cx(to));
    const ex = inset(to, cx(from));
    const my = lane(from.y + from.h, to.y, seq);
    return `M${sx} ${from.y + from.h} L${sx} ${my} L${ex} ${my} L${ex} ${to.y}`;
  }
  if (to.y + to.h <= from.y) {
    const sx = inset(from, cx(to));
    const ex = inset(to, cx(from));
    const my = lane(to.y + to.h, from.y, seq);
    return `M${sx} ${from.y} L${sx} ${my} L${ex} ${my} L${ex} ${to.y + to.h}`;
  }
  if (from.x + from.w <= to.x) {
    const mx = (from.x + from.w + to.x) / 2;
    return `M${from.x + from.w} ${cy(from)} L${mx} ${cy(from)} L${mx} ${cy(to)} L${to.x} ${cy(to)}`;
  }
  const mx = (to.x + to.w + from.x) / 2;
  return `M${from.x} ${cy(from)} L${mx} ${cy(from)} L${mx} ${cy(to)} L${to.x + to.w} ${cy(to)}`;
}

function lane(top: number, bottom: number, seq: number): number {
  const span = bottom - top;
  if (span <= 6) return (top + bottom) / 2;
  const lanes = 5;
  const step = span / (lanes + 1);
  return top + step * (1 + (seq % lanes));
}

function clearLane(box: Rect, blockers: Rect[], lo: number, hi: number): number {
  const inWay = blockers.filter((b) => b.y + b.h > lo && b.y < hi);
  const mid = cx(box);
  if (!inWay.length) return mid;
  const free = (x: number): boolean => !inWay.some((b) => x > b.x - 3 && x < b.x + b.w + 3);
  if (free(mid)) return mid;
  const left = box.x + 5;
  const right = box.x + box.w - 5;
  for (let d = 2; d <= box.w; d += 2) {
    if (mid - d >= left && free(mid - d)) return mid - d;
    if (mid + d <= right && free(mid + d)) return mid + d;
  }
  return mid;
}

interface NodeView {
  node: SchematicNode;
  g: HTMLElement;
  peak: number;
  duty: number;
  level: ActivityLevel;
}

type FrameTally = Partial<Record<FrameSignal, number>>;

export class SchematicView {
  readonly el: HTMLDivElement;
  private readonly nodes = new Map<string, NodeView>();
  private readonly edges: {
    edge: SchematicEdge; path: SVGPathElement; halo: SVGPathElement;
  }[] = [];

  constructor(schematic: Schematic) {
    this.el = document.createElement('div');
    this.el.className = 'schem-diagram';
    this.el.style.width = `${schematic.width}px`;
    this.el.style.height = `${schematic.height}px`;
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', str('schematic.n_board_diagram', { 0: schematic.title }));

    const wires = el('svg', {
      class: 'schem-wires',
      viewBox: `0 0 ${schematic.width} ${schematic.height}`,
      'aria-hidden': 'true',
    });
    this.el.append(wires);

    const byId = new Map(schematic.nodes.map((n) => [n.id, n]));
    const boxes = schematic.nodes.filter((n) => n.band !== 'rail');
    schematic.edges.forEach((edge, i) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return;
      const blockers = boxes.filter((n) => n.id !== a.id && n.id !== b.id);
      const d = route(a, b, edge, a.band === 'rail', b.band === 'rail', blockers, i);
      const halo = el('path', { class: 'schem-halo', d });
      const path = el('path', { class: `schem-bus schem-bus-${edge.kind}`, d });
      wires.append(halo, path);
      this.edges.push({ edge, path, halo });
    });
    for (const node of schematic.nodes) {
      const g = this.drawNode(node);
      this.el.append(g);
      this.nodes.set(node.id, { node, g, peak: 0, duty: 0, level: 0 });
    }
  }

  private drawNode(n: SchematicNode): HTMLElement {
    const box = document.createElement('div');
    box.className = 'schem-node';
    box.dataset.band = n.band;
    box.dataset.state = n.state;
    box.style.left = `${n.x}px`;
    box.style.top = `${n.y}px`;
    box.style.width = `${n.w}px`;
    box.style.height = `${n.h}px`;
    if (n.state === 'live' && n.band !== 'rail' && n.activity) box.dataset.act = '0';
    if (n.note) box.title = n.note;

    if (n.band === 'rail') {
      if (n.rail) box.classList.add(`schem-rail-${n.rail}`);
      if (n.label) {
        const label = document.createElement('span');
        label.className = 'schem-raillbl';
        label.textContent = n.label;
        box.append(label);
      }
      return box;
    }

    const label = document.createElement('span');
    label.className = 'schem-lbl';
    label.textContent = n.label;
    box.append(label);
    if (n.part) {
      const part = document.createElement('span');
      part.className = 'schem-part';
      part.textContent = n.part;
      box.append(part);
    }
    if (n.state === 'live' && n.activity) {
      const led = document.createElement('i');
      led.className = 'schem-led';
      box.append(led);
    }
    if (n.state === 'unserved') {
      const bang = document.createElement('i');
      bang.className = 'schem-bang';
      bang.textContent = '!';
      box.append(bang);
    }
    return box;
  }

  reveal(): void {
    this.el.classList.remove('schem-reveal');
    void this.el.offsetWidth;
    this.el.classList.add('schem-reveal');
  }

  private lastCounts: Record<string, number> | null = null;

  private prevLamps: Uint8Array | null = null;
  private prevDots: Uint8Array | null = null;
  private prevChars: Uint8Array | null = null;
  private prevDigits: string | null = null;
  private prevTravel: number[] = [];
  private tally: FrameTally = {};
  private frames = 0;

  sampleFrame(v: FrameView): void {
    this.frames++;
    const bump = (s: FrameSignal): void => { this.tally[s] = (this.tally[s] ?? 0) + 1; };

    if (changed(this.prevLamps, v.lampsRaw)) bump('lamps');
    this.prevLamps = copy(v.lampsRaw, this.prevLamps);

    if (v.dotsRaw.length) {
      if (changed(this.prevDots, v.dotsRaw)) bump('dots');
      this.prevDots = copy(v.dotsRaw, this.prevDots);
    }
    if (v.display) {
      if (changed(this.prevChars, v.display.chars)) bump('display');
      this.prevChars = copy(v.display.chars, this.prevChars);
    }
    const digits = digitKey(v);
    if (digits !== null) {
      if (this.prevDigits !== null && digits !== this.prevDigits) bump('digits');
      this.prevDigits = digits;
    }
    let moved = false;
    for (let i = 0; i < v.reels.length; i++) {
      if (this.prevTravel[i] !== v.reels[i].travel) moved = true;
      this.prevTravel[i] = v.reels[i].travel;
    }
    if (moved) bump('reels');
    if (v.coinBusy) bump('coin');
  }

  update(counts: Record<string, number> | null, stats: PanelStats): void {
    const frames = this.frames || 1;
    for (const nv of this.nodes.values()) {
      const a = nv.node.activity;
      if (nv.node.state !== 'live' || !a) continue;
      let ratio: number | null = null;
      if (a.kind === 'frame') {
        ratio = frameDuty(this.tally[a.signal] ?? 0, frames);
      } else if (a.kind === 'cpu') {
        const budget = stats.tickHz > 0 ? 1000 / stats.tickHz : 1000 / 60;
        ratio = stats.stepMs / budget;
      } else if (counts) {
        const now = counts[nv.node.id] ?? 0;
        const delta = Math.max(0, now - (this.lastCounts?.[nv.node.id] ?? now));
        nv.peak = Math.max(nv.peak, delta);
        ratio = nv.peak > 0 ? delta / nv.peak : 0;
      }
      if (ratio === null) continue;
      nv.duty = envelope(nv.duty, Math.min(1, ratio));
      const level = levelFromRatio(nv.duty);
      if (level !== nv.level) {
        nv.level = level;
        nv.g.dataset.act = String(level);
      }
    }
    if (counts) this.lastCounts = counts;
    this.tally = {};
    this.frames = 0;

    for (const { edge, path, halo } of this.edges) {
      const a = this.nodes.get(edge.from);
      const b = this.nodes.get(edge.to);
      const live = (a?.level ?? 0) > 0 || (b?.level ?? 0) > 0;
      path.classList.toggle('schem-flow', live);
      halo.classList.toggle('schem-flow', live);
    }
  }
}

function changed(prev: Uint8Array | null, next: Uint8Array): boolean {
  if (!prev || prev.length !== next.length) return false;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return true;
  return false;
}

function copy(src: Uint8Array, into: Uint8Array | null): Uint8Array {
  const out = into && into.length === src.length ? into : new Uint8Array(src.length);
  out.set(src);
  return out;
}

function digitKey(v: FrameView): string | null {
  if (v.layout.digitKind === 'none') return null;
  let s = '';
  for (let i = 0; i < 16; i++) s += v.layoutDigit(i).toString(16) + ',';
  return s;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_PAD = 12;
const CAN_ZOOM = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('zoom', '1.5');

class DiagramStage {
  readonly el: HTMLDivElement;
  private readonly pan: HTMLDivElement;
  private readonly sheet: HTMLElement;
  private readonly readout: HTMLButtonElement;
  private scale = 1;
  private fitScale = 1;
  private tx = 0;
  private ty = 0;
  private following = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; scale: number; x: number; y: number } | null = null;
  private drag: { x: number; y: number } | null = null;
  private readonly ro: ResizeObserver | null;

  constructor(
    sheet: HTMLElement,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.sheet = sheet;
    this.el = div('schem-scroll');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', str('schematic.board_diagram_pinch_or_scroll'));
    this.pan = div('schem-pan');
    this.pan.append(sheet);
    this.el.append(this.pan);

    const zoom = div('schem-zoom');
    const step = (label: string, aria: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      return b;
    };
    this.readout = step('100%', str('schematic.fit_to_frame'), () => this.fit());
    this.readout.classList.add('schem-zoom-fit');
    this.readout.title = str('schematic.fit_to_frame');
    zoom.append(
      step('−', str('schematic.zoom_out'), () => this.nudge(1 / 1.3)),
      this.readout,
      step('+', str('schematic.zoom_in'), () => this.nudge(1.3)),
    );
    this.el.append(zoom);

    this.el.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });
    this.el.addEventListener('pointerdown', (ev) => this.onDown(ev));
    this.el.addEventListener('pointermove', (ev) => this.onMove(ev));
    for (const k of ['pointerup', 'pointercancel'] as const) {
      this.el.addEventListener(k, (ev) => this.onUp(ev as PointerEvent));
    }
    this.el.addEventListener('dblclick', (ev) => {
      const p = this.point(ev);
      if (this.scale > this.fitScale + 0.001) this.fit();
      else this.zoomTo(1, p.x, p.y);
    });
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === '+' || ev.key === '=') this.nudge(1.3);
      else if (ev.key === '-' || ev.key === '_') this.nudge(1 / 1.3);
      else if (ev.key === '0') this.fit();
      else return;
      ev.preventDefault();
    });

    this.ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.measure()) : null;
    this.ro?.observe(this.el);
  }

  dispose(): void {
    this.ro?.disconnect();
  }

  fit(): void {
    this.following = true;
    this.measure();
  }

  private measure(): void {
    const availW = this.el.clientWidth - ZOOM_PAD * 2;
    const availH = this.el.clientHeight - ZOOM_PAD * 2;
    if (availW <= 0 || availH <= 0) return;
    this.fitScale = clamp(Math.min(availW / this.w, availH / this.h), ZOOM_MIN, 1);
    if (this.following) this.scale = this.fitScale;
    this.apply();
  }

  private point(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private zoomTo(next: number, px: number, py: number): void {
    const s = clamp(next, Math.min(ZOOM_MIN, this.fitScale), ZOOM_MAX);
    const sx = (px - this.tx) / this.scale;
    const sy = (py - this.ty) / this.scale;
    this.scale = s;
    this.tx = px - sx * s;
    this.ty = py - sy * s;
    this.following = false;
    this.apply();
  }

  private nudge(by: number): void {
    this.zoomTo(this.scale * by, this.el.clientWidth / 2, this.el.clientHeight / 2);
  }

  private onWheel(ev: WheelEvent): void {
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      const p = this.point(ev);
      this.zoomTo(this.scale * Math.exp(-ev.deltaY * 0.0035), p.x, p.y);
      return;
    }
    if (!this.overflows()) return;
    ev.preventDefault();
    this.tx -= ev.deltaX;
    this.ty -= ev.deltaY;
    this.following = false;
    this.apply();
  }

  private onDown(ev: PointerEvent): void {
    if ((ev.target as HTMLElement).closest('.schem-zoom')) return;
    this.pointers.set(ev.pointerId, this.point(ev));
    this.el.setPointerCapture(ev.pointerId);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: this.scale,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    } else if (this.pointers.size === 1 && this.overflows()) {
      this.drag = this.point(ev);
      this.el.classList.add('schem-grabbing');
    }
  }

  private onMove(ev: PointerEvent): void {
    if (!this.pointers.has(ev.pointerId)) return;
    const p = this.point(ev);
    this.pointers.set(ev.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.tx += mx - this.pinch.x;
      this.ty += my - this.pinch.y;
      this.pinch.x = mx;
      this.pinch.y = my;
      this.zoomTo(this.pinch.scale * (dist / this.pinch.dist), mx, my);
      return;
    }
    if (this.drag) {
      this.tx += p.x - this.drag.x;
      this.ty += p.y - this.drag.y;
      this.drag = p;
      this.following = false;
      this.apply();
    }
  }

  private onUp(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    if (this.el.hasPointerCapture?.(ev.pointerId)) this.el.releasePointerCapture(ev.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.drag = null;
      this.el.classList.remove('schem-grabbing');
    }
  }

  private overflows(): boolean {
    return this.w * this.scale > this.el.clientWidth
      || this.h * this.scale > this.el.clientHeight;
  }

  private apply(): void {
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    const sw = this.w * this.scale;
    const sh = this.h * this.scale;
    this.tx = sw <= cw ? (cw - sw) / 2 : clamp(this.tx, cw - sw, 0);
    this.ty = sh <= ch ? (ch - sh) / 2 : clamp(this.ty, ch - sh, 0);
    if (CAN_ZOOM) this.sheet.style.zoom = String(this.scale);
    else this.sheet.style.transform = `scale(${this.scale})`;
    this.pan.style.transform = `translate(${Math.round(this.tx)}px, ${Math.round(this.ty)}px)`;
    this.readout.textContent = `${Math.round(this.scale * 100)}%`;
    this.el.dataset.grab = this.overflows() ? '1' : '0';
  }
}

export interface PanelTab {
  id: string;
  label: string;
  icon: string;
  mount(host: HTMLElement): void;
  onShow?(): void;
  onHide?(): void;
  onDiscard?(): void;
  clearScrim?: boolean;
}

export const DIAGRAM_TAB = 'diagram';

const DIAGRAM_ICON = 'M4 5h6v5H4zM14 14h6v5h-6zM14 5h6v5h-6zM7 10v4.5a2 2 0 0 0 2 2h5M17 10v4';

export class SchematicPanel {
  private view: SchematicView | null = null;
  private statEls: Record<string, HTMLElement> = {};
  private stage: DiagramStage | null = null;
  private timer = 0;
  private setName = '';
  private built = false;
  private current = DIAGRAM_TAB;
  private panes = new Map<string, HTMLElement>();
  private rail = new Map<string, HTMLButtonElement>();
  private mounted = new Set<string>();

  constructor(
    private readonly panel: HTMLElement,
    private readonly backdrop: HTMLElement,
    private readonly poll: () => Promise<Record<string, number> | null>,
    private readonly stats: () => PanelStats,
  ) {
    backdrop.addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  onToggle: ((open: boolean) => void) | null = null;

  menu: DownloadMenu | null = null;

  tabs: PanelTab[] = [];

  open(schematic: Schematic | null, setName: string, tab?: string): void {
    if (this.isOpen) {
      if (tab) this.showTab(tab);
      return;
    }
    if (!this.built || this.setName !== setName) {
      this.setName = setName;
      this.build(schematic, setName);
    }
    this.panel.hidden = false;
    this.backdrop.hidden = false;
    this.showTab(tab ?? this.current, true);
    requestAnimationFrame(() => this.panel.classList.add('open'));
    this.onToggle?.(true);
  }

  get tab(): string {
    return this.current;
  }

  showTab(id: string, force = false): void {
    if (!this.panes.has(id)) id = DIAGRAM_TAB;
    if (id === this.current && !force) return;
    if (id !== this.current) this.hideCurrent();
    this.current = id;
    for (const [k, pane] of this.panes) pane.hidden = k !== id;
    for (const [k, btn] of this.rail) {
      btn.setAttribute('aria-selected', String(k === id));
      btn.tabIndex = k === id ? 0 : -1;
    }
    const tab = this.tabs.find((t) => t.id === id);
    this.backdrop.classList.toggle('clear', tab?.clearScrim === true);
    if (id === DIAGRAM_TAB) {
      this.stage?.fit();
      this.view?.reveal();
      this.tick();
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => this.tick(), 125);
      return;
    }
    if (tab && !this.mounted.has(id)) {
      this.mounted.add(id);
      tab.mount(this.panes.get(id)!);
    }
    tab?.onShow?.();
  }

  private hideCurrent(): void {
    if (this.current === DIAGRAM_TAB) {
      window.clearInterval(this.timer);
      this.timer = 0;
    } else {
      this.tabs.find((t) => t.id === this.current)?.onHide?.();
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.menu?.close();
    this.hideCurrent();
    this.backdrop.classList.remove('clear');
    this.panel.classList.remove('open');
    this.backdrop.hidden = true;
    window.setTimeout(() => {
      if (!this.panel.classList.contains('open')) this.panel.hidden = true;
    }, 320);
    this.onToggle?.(false);
  }

  reset(): void {
    this.close();
    for (const t of this.tabs) if (this.mounted.has(t.id)) t.onDiscard?.();
    this.stage?.dispose();
    this.stage = null;
    this.view = null;
    this.built = false;
    this.current = DIAGRAM_TAB;
    this.panes.clear();
    this.rail.clear();
    this.mounted.clear();
    this.panel.replaceChildren();
  }

  sampleFrame(v: FrameView): void {
    if (this.current === DIAGRAM_TAB) this.view?.sampleFrame(v);
  }

  private build(schematic: Schematic | null, setName: string): void {
    this.built = true;
    this.panel.replaceChildren();
    const bar = div('schem-bar');
    const h = document.createElement('h2');
    h.textContent = str('schematic.system');
    const set = document.createElement('span');
    set.className = 'schem-set';
    set.textContent = schematic ? `${schematic.title} · ${setName}` : setName;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'schem-close';
    close.setAttribute('aria-label', str('schematic.close'));
    close.textContent = '×';
    close.addEventListener('click', () => this.close());
    bar.append(h, set);
    if (this.menu) bar.append(this.menu.button);
    bar.append(close);

    const body = div('schem-body');
    this.stage?.dispose();
    this.stage = null;
    this.view = null;
    if (schematic) {
      this.view = new SchematicView(schematic);
      this.stage = new DiagramStage(this.view.el, schematic.width, schematic.height);
      body.append(this.stage.el);
    } else {
      body.append(noDiagram(this.tabs.length > 0));
    }

    const title = div('schem-title');
    const id = div('schem-id');
    const board = schematic
      ? schematic.source.replace(/\s*[-·]\s*simplified board diagram$/i, '')
      : str('schematic.not_drawn_yet');
    for (const [key, value] of [['board', board], ['set', setName]]) {
      const row = document.createElement('span');
      const k = document.createElement('b');
      k.textContent = key.toUpperCase();
      row.append(k, document.createTextNode(value));
      row.title = value;
      id.append(row);
    }
    title.append(id);
    this.statEls = {};
    for (const [key, label] of STAT_ROWS) {
      const cell = div('schem-stat');
      const value = document.createElement('b');
      const name = document.createElement('span');
      name.textContent = label;
      cell.append(value, name);
      title.append(cell);
      this.statEls[key] = value;
    }

    const foot = div('schem-foot');
    const cite = div('schem-cite');
    cite.textContent = schematic
      ? str('schematic.simplified_not_a_wiring_reference', { 0: this.stats().buildId })
      : str('schematic.rev_n', { 0: this.stats().buildId });
    const legend = div('schem-legend');
    for (const key of LEGEND) {
      const item = document.createElement('span');
      if (key.line) {
        const svg = el('svg', { viewBox: '0 0 22 10', 'aria-hidden': 'true' });
        svg.append(el('path', { class: `schem-bus schem-bus-${key.line}`, d: 'M0 5H22' }));
        item.append(svg);
      } else {
        const swatch = document.createElement('i');
        if (key.box) swatch.className = `schem-key-${key.box}`;
        item.append(swatch);
      }
      item.append(document.createTextNode(key.text));
      legend.append(item);
    }
    foot.append(cite);
    if (schematic) foot.append(legend);
    title.append(foot);
    body.append(title);

    this.panes.clear();
    this.rail.clear();
    this.mounted.clear();
    const main = div('schem-main');
    const rail = div('schem-rail');
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-orientation', 'vertical');
    rail.setAttribute('aria-label', str('schematic.system_panel'));
    const panes = div('schem-panes');
    const all = [{ id: DIAGRAM_TAB, label: str('schematic.diagram'), icon: DIAGRAM_ICON }, ...this.tabs];
    for (const t of all) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'schem-tab';
      btn.id = `schem-tab-${t.id}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `schem-pane-${t.id}`);
      btn.title = t.label;
      const icon = el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      icon.append(el('path', { d: t.icon }));
      const label = document.createElement('span');
      label.textContent = t.label;
      btn.append(icon, label);
      btn.addEventListener('click', () => this.showTab(t.id));
      rail.append(btn);
      this.rail.set(t.id, btn);

      const pane = t.id === DIAGRAM_TAB ? body : div('schem-pane');
      pane.id = `schem-pane-${t.id}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', btn.id);
      pane.hidden = true;
      panes.append(pane);
      this.panes.set(t.id, pane);
    }
    rail.addEventListener('keydown', (ev) => {
      const ids = all.map((t) => t.id);
      const i = ids.indexOf(this.current);
      const to = ev.key === 'ArrowDown' ? ids[(i + 1) % ids.length]
        : ev.key === 'ArrowUp' ? ids[(i - 1 + ids.length) % ids.length]
          : ev.key === 'Home' ? ids[0]
            : ev.key === 'End' ? ids[ids.length - 1] : null;
      if (!to) return;
      ev.preventDefault();
      this.showTab(to);
      this.rail.get(to)?.focus({ preventScroll: true });
    });
    main.append(rail, panes);

    this.panel.append(bar, main);
    if (this.menu) this.panel.append(this.menu.popover);
  }

  private tick(): void {
    const s = this.stats();
    const set = (k: string, v: string): void => {
      const e = this.statEls[k];
      if (e) e.textContent = v;
    };
    set('fps', s.fps.toFixed(0));
    set('tick', s.tickHz.toFixed(1));
    const budget = s.tickHz > 0 ? 1000 / s.tickHz : 16.67;
    set('cpu', `${Math.min(999, Math.round((s.stepMs / budget) * 100))} %`);
    set('clock', (s.clockHz / 1e6).toFixed(2));
    set('step', s.stepMs.toFixed(1));
    set('dropped', Math.round(s.droppedMs).toString());
    void this.poll().then((counts) => {
      if (this.isOpen && this.current === DIAGRAM_TAB) this.view?.update(counts, s);
    });
  }
}

const STAT_ROWS: [string, string][] = [
  ['fps', 'fps'],
  ['tick', 'tick Hz'],
  ['cpu', 'cpu'],
  ['clock', 'MHz'],
  ['step', 'step ms'],
  ['dropped', 'dropped ms'],
];

const LEGEND: { text: string; line?: BusKind; box?: 'idle' | 'live' | 'off' }[] = [
  { text: 'active', box: 'live' },
  { text: str('schematic.not_emulated_not_fitted'), box: 'off' },
  { text: 'data', line: 'data' },
  { text: 'address', line: 'address' },
  { text: 'control', line: 'control' },
  { text: str('schematic.i_o'), line: 'serial' },
];

function noDiagram(hasOtherTabs: boolean): HTMLElement {
  const box = div('schem-none');
  const h = document.createElement('h3');
  h.textContent = str('schematic.no_diagram_for_this_board');
  const p = document.createElement('p');
  p.textContent = str('schematic.most_boards_are_drawn_here');
  box.append(h, p);
  if (hasOtherTabs) {
    const more = document.createElement('p');
    more.textContent = str('schematic.everything_else_in_this_panel');
    box.append(more);
  }
  return box;
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
