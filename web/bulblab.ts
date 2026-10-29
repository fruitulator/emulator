import { LAMP_FULL } from '../src/machine/framestate';
import { str } from './i18n';

interface LabWindow {
  left: number; top: number; width: number; height: number;
  lampNums: number[];
  machineIndex: number;
  bandOffset?: number;
}
interface LabCabinet { reels: LabWindow[] }

interface LabFrameReel {
  position: number; travel: number; stepsPerRevolution: number; symbol(): number;
}
interface BaseView {
  layout: { reelCount: number; stepsPerRevolution: number[]; symbols: number[] };
  reels: LabFrameReel[];
  layoutLamp(n: number): boolean;
  layoutLampLevel(n: number): number;
}

interface ReelDrive {
  pos: number;
  travel: number;
  spinning: boolean;
}

const CHASE_ROW: (number | null)[] = [2, 1, 0, null];

export class BulbLab {
  active = false;
  readonly on = new Set<number>();
  cabinetFromEmulator = false;
  chase = false;
  chaseMs = 70;
  chaseSpinningOnly = true;
  speed = 160;
  direction = 1;
  private drives: ReelDrive[] = [];
  private lastNow = 0;
  private panel: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private statusTiles: { pos: HTMLElement; state: HTMLElement }[] = [];
  private windowButtons: { lamp: number; el: HTMLButtonElement }[] = [];
  private windows: LabWindow[] = [];
  private tray = new Set<number>();

  constructor(private readonly onToggle: (active: boolean) => void) {}

  setHost(host: HTMLElement | null): void {
    this.host = host;
    if (this.active) this.buildPanel();
  }

  get windowCount(): number {
    return this.windows.length;
  }

  toggle(cab: LabCabinet | null): void {
    if (this.active) this.disable();
    else if (cab) this.enable(cab);
  }

  enable(cab: LabCabinet): void {
    this.windows = [...cab.reels].sort((a, b) => a.left - b.left);
    this.tray = new Set(this.windows.flatMap((w) => w.lampNums.filter((n) => n >= 0)));
    for (const n of this.tray) this.on.add(n);
    this.drives = [];
    this.active = true;
    this.buildPanel();
    this.onToggle(true);
  }

  disable(): void {
    this.active = false;
    this.panel?.remove();
    this.panel = null;
    this.onToggle(false);
  }

  view<V extends BaseView>(base: V, now: number): V {
    if (!this.drives.length) {
      this.drives = base.reels.map((r) => ({ pos: r.position, travel: r.travel, spinning: false }));
      this.lastNow = now;
    }
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const reels: LabFrameReel[] = this.drives.map((d, i) => {
      const spr = base.layout.stepsPerRevolution[i] || 96;
      const symbols = base.layout.symbols[i] || 16;
      if (d.spinning) {
        const before = Math.floor(d.pos);
        d.pos = (((d.pos + this.direction * this.speed * dt) % spr) + spr) % spr;
        const moved = Math.floor(d.pos) - before;
        d.travel += moved !== 0 ? moved : this.direction;
      }
      const position = d.pos;
      return {
        position, travel: d.travel, stepsPerRevolution: spr,
        symbol: () => Math.floor(position / (spr / symbols)) % symbols,
      };
    });
    const phase = this.chase ? Math.floor(now / this.chaseMs) % CHASE_ROW.length : -1;
    const litByChase = new Set<number>();
    if (phase >= 0) {
      const row = CHASE_ROW[phase];
      for (const w of this.windows) {
        if (this.chaseSpinningOnly && !this.drives[w.machineIndex]?.spinning) continue;
        if (row !== null && w.lampNums[row] >= 0) litByChase.add(w.lampNums[row]);
      }
    }
    const chased = new Set<LabWindow>();
    if (phase >= 0) {
      for (const w of this.windows) {
        if (!this.chaseSpinningOnly || this.drives[w.machineIndex]?.spinning) chased.add(w);
      }
    }
    const chasedLamps = new Set<number>();
    for (const w of chased) for (const n of w.lampNums) if (n >= 0) chasedLamps.add(n);
    const lab = this;
    const v = Object.create(base) as V;
    Object.defineProperty(v, 'reels', { value: reels });
    Object.defineProperty(v, 'layoutLamp', {
      value: (n: number): boolean => {
        if (lab.tray.has(n)) {
          if (chasedLamps.has(n)) return litByChase.has(n);
          return lab.on.has(n);
        }
        return lab.cabinetFromEmulator ? base.layoutLamp(n) : false;
      },
    });
    Object.defineProperty(v, 'layoutLampLevel', {
      value: (n: number): number => {
        if (lab.tray.has(n)) return v.layoutLamp(n) ? LAMP_FULL : 0;
        return lab.cabinetFromEmulator ? base.layoutLampLevel(n) : 0;
      },
    });
    this.refreshStatus();
    return v;
  }

  setBulb(n: number, lit: boolean): void {
    if (lit) this.on.add(n); else this.on.delete(n);
    this.refreshButtons();
  }
  setRow(row: number, lit: boolean): void {
    for (const w of this.windows) if (w.lampNums[row] >= 0) this.setBulb(w.lampNums[row], lit);
  }
  setAll(lit: boolean): void { for (const n of this.tray) this.setBulb(n, lit); }
  held(): void { this.setRow(0, false); this.setRow(1, true); this.setRow(2, false); }

  spin(machineIndex: number | 'all', on: boolean): void {
    for (const [i, d] of this.drives.entries()) {
      if (machineIndex === 'all' || machineIndex === i) {
        d.spinning = on;
        if (!on) d.pos = Math.round(d.pos);
      }
    }
    this.refreshButtons();
  }
  step(machineIndex: number | 'all', halfSteps: number): void {
    for (const [i, d] of this.drives.entries()) {
      if (machineIndex !== 'all' && machineIndex !== i) continue;
      const spr = 96;
      d.pos = (((Math.round(d.pos) + halfSteps) % spr) + spr) % spr;
      d.travel += halfSteps;
    }
  }
  setPosition(machineIndex: number, pos: number): void {
    const d = this.drives[machineIndex];
    if (!d) return;
    d.travel += pos - d.pos;
    d.pos = pos;
  }

  reelState(): { pos: number; travel: number; spinning: boolean }[] {
    return this.drives.map((d) => ({ ...d }));
  }

  private buildPanel(): void {
    this.panel?.remove();
    const p = document.createElement('div');
    p.id = 'bulbLab';
    p.className = 'bulb-lab';
    if (!this.host) {
      p.classList.add('nb-panel', 'bulb-lab--float');
      p.style.cssText = 'right:12px;top:56px;z-index:50';
      const title = document.createElement('div');
      title.className = 'bulb-float-head';
      const name = document.createElement('h3');
      name.className = 'nb-panel__title';
      name.textContent = str('bulblab.bulb_lab_renderer_only_no');
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'nb-mini-btn';
      close.textContent = '×';
      close.addEventListener('click', () => this.disable());
      title.append(name, close);
      p.append(title);
    }

    this.windowButtons = [];
    const lights = this.group(str('bulblab.backlights_click_a_bulb_windows'));
    lights.classList.add('bulb-lights');
    const grid = document.createElement('div');
    grid.className = 'bulb-grid';
    grid.style.gridTemplateColumns = `repeat(${this.windows.length}, minmax(0, 1fr))`;
    for (let row = 0; row < 3; row++) {
      for (const w of this.windows) {
        const n = w.lampNums[row] ?? -2;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bulb-cell';
        const num = document.createElement('span');
        num.className = 'bulb-n';
        num.textContent = n >= 0 ? String(n) : '-';
        b.append(num);
        b.addEventListener('click', () => this.setBulb(n, !this.on.has(n)));
        b.title = str('bulblab.window_x_n_machine_reel', { 0: w.left, 1: w.machineIndex, 2: row });
        if (n < 0) b.disabled = true;
        else this.windowButtons.push({ lamp: n, el: b });
        grid.append(b);
      }
    }
    lights.append(grid);

    const rows = this.group(str('bulblab.rows_presets'));
    rows.classList.add('bulb-presets');
    const pills = document.createElement('div');
    pills.className = 'bulb-pills';
    const pill = (label: string, run: () => void): void => {
      const b = this.btn(label, run);
      b.className = 'pane-pill';
      pills.append(b);
    };
    for (const [label, row] of [[str('bulblab.top'), 0], [str('bulblab.middle'), 1], [str('bulblab.bottom'), 2]] as const) {
      pill(str('bulblab.n_on', { 0: label }), () => this.setRow(row, true));
      pill(str('bulblab.n_off', { 0: label }), () => this.setRow(row, false));
    }
    pill(str('bulblab.all_on'), () => this.setAll(true));
    pill(str('bulblab.all_off'), () => this.setAll(false));
    pill(str('bulblab.held_middle_only'), () => this.held());
    rows.append(pills);

    const chase = this.group(str('bulblab.firmware_spin_chase_c0_30'));
    const chaseLine = this.line();
    const chaseBtn = this.btn(str('bulblab.chase'), () => { this.chase = !this.chase; chaseBtn.classList.toggle('on', this.chase); }, true);
    chaseLine.append(chaseBtn, this.num(str('bulblab.ms_phase'), this.chaseMs, 10, 1000, (v) => { this.chaseMs = v; }));
    chase.append(chaseLine);
    chase.append(this.check(str('bulblab.spinning_windows_only'), this.chaseSpinningOnly, (v) => { this.chaseSpinningOnly = v; }));

    const misc = this.group(str('bulblab.everything_else'));
    misc.append(this.check(str('bulblab.cabinet_lamps_from_the_emulator'), this.cabinetFromEmulator, (v) => { this.cabinetFromEmulator = v; }));

    const spin = this.group(str('bulblab.reels'));
    spin.classList.add('bulb-reels');
    const spinLine = this.line();
    const spinBtn = this.btn(str('bulblab.spin_all'), () => {
      const any = this.drives.some((d) => d.spinning);
      this.spin('all', !any);
    }, true);
    spinBtn.dataset.role = 'spinAll';
    spinLine.append(spinBtn);
    spinLine.append(this.num(str('bulblab.half_steps_s'), this.speed, 1, 2000, (v) => { this.speed = v; }));
    spinLine.append(this.btn(str('bulblab.direction'), () => { this.direction = -this.direction; }));
    spinLine.append(this.btn(str('bulblab.step_1'), () => this.step('all', -1)));
    spinLine.append(this.btn(str('bulblab.step_1_2'), () => this.step('all', 1)));
    spinLine.append(this.btn(str('bulblab.step_6_a_symbol'), () => this.step('all', 6)));
    spin.append(spinLine);
    const reelLine = this.line();
    for (const w of this.windows) {
      const b = this.btn(str('bulblab.reel_n_xn', { 0: w.machineIndex, 1: w.left }), () => {
        this.spin(w.machineIndex, !this.drives[w.machineIndex]?.spinning);
      });
      b.dataset.reel = String(w.machineIndex);
      reelLine.append(b);
    }
    this.status = document.createElement('div');
    this.status.className = 'bulb-pos';
    this.statusTiles = [];
    spin.append(reelLine, this.status);

    const left = document.createElement('div');
    left.className = 'bulb-col bulb-col--main';
    left.append(lights, rows);
    const right = document.createElement('div');
    right.className = 'bulb-col';
    right.append(chase, misc);
    const top = document.createElement('div');
    top.className = 'bulb-top';
    top.append(left, right);
    p.append(top, spin);

    (this.host ?? document.body).append(p);
    this.panel = p;
    this.refreshButtons();
  }

  private refreshButtons(): void {
    for (const { lamp, el } of this.windowButtons) el.classList.toggle('on', this.on.has(lamp));
    this.panel?.querySelectorAll<HTMLButtonElement>('button[data-reel]').forEach((b) => {
      b.classList.toggle('on', !!this.drives[Number(b.dataset.reel)]?.spinning);
    });
    const all = this.panel?.querySelector<HTMLButtonElement>('button[data-role=spinAll]');
    all?.classList.toggle('on', this.drives.some((d) => d.spinning));
  }

  private refreshStatus(): void {
    if (!this.status) return;
    if (this.statusTiles.length !== this.drives.length) {
      const tiles = this.drives.map((_, i) => {
        const tile = document.createElement('div');
        tile.className = 'bulb-pos-tile';
        const label = document.createElement('span');
        label.className = 'nb-field__label';
        label.textContent = str('bulblab.reel_n_pos', { 0: i });
        const pos = document.createElement('b');
        const state = document.createElement('span');
        state.className = 'nb-meta';
        tile.append(label, pos, state);
        return { tile, pos, state };
      });
      this.statusTiles = tiles.map(({ pos, state }) => ({ pos, state }));
      this.status.replaceChildren(...tiles.map((t) => t.tile));
    }
    this.drives.forEach((d, i) => {
      const t = this.statusTiles[i];
      const pos = d.pos.toFixed(1);
      if (t.pos.textContent !== pos) t.pos.textContent = pos;
      const state = d.spinning ? 'turning' : 'still';
      if (t.state.textContent !== state) t.state.textContent = state;
    });
  }

  private group(title: string): HTMLElement {
    const g = document.createElement('div');
    g.className = 'bulb-group nb-group';
    const h = document.createElement('span');
    h.className = 'nb-field__label';
    h.textContent = title;
    g.append(h);
    return g;
  }
  private line(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'bulb-line';
    return d;
  }
  private btn(label: string, onClick: () => void, main = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = main ? 'nb-btn nb-btn--primary nb-btn--sm' : 'nb-btn nb-btn--sm';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  private num(label: string, value: number, min: number, max: number, set: (v: number) => void): HTMLElement {
    const l = document.createElement('label');
    l.className = 'bulb-num';
    l.append(label);
    const i = document.createElement('input');
    i.type = 'number';
    i.className = 'nb-input';
    i.min = String(min); i.max = String(max); i.value = String(value);
    i.addEventListener('input', () => { const v = Number(i.value); if (v >= min && v <= max) set(v); });
    l.append(i);
    return l;
  }
  private check(label: string, value: boolean, set: (v: boolean) => void): HTMLElement {
    const l = document.createElement('label');
    l.className = 'bulb-check';
    const text = document.createElement('span');
    text.textContent = label;
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.className = 'nb-toggle';
    i.setAttribute('role', 'switch');
    i.checked = value;
    i.addEventListener('change', () => set(i.checked));
    l.append(text, i);
    return l;
  }
}
