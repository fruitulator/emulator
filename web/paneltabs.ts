import { toggleInput } from './ui/rows';
import type { DiagEntry, DiagKind } from './diaglog';
import type { PanelTab } from './schematic';
import { str } from './i18n';
import type { DilPlace } from '../src/machine/machine';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function action(label: string, run: () => void): HTMLButtonElement {
  const b = el('button', 'pane-btn nb-btn nb-btn--sm', label);
  b.type = 'button';
  b.addEventListener('click', run);
  return b;
}

function head(title: string, ...controls: HTMLElement[]): HTMLElement {
  const h = el('div', 'pane-head');
  const text = el('div', 'pane-title');
  text.append(el('h3', undefined, title));
  const tools = el('div', 'pane-tools');
  tools.append(...controls);
  h.append(text, tools);
  return h;
}

function switchRow(label: string, onChange: (on: boolean) => void): {
  row: HTMLLabelElement; box: HTMLInputElement;
} {
  const row = el('label', 'pane-switch');
  const box = toggleInput((on) => onChange(on));
  row.append(el('span', undefined, label), box);
  return { row, box };
}

export interface LogTabDeps {
  entries(): Promise<DiagEntry[]>;
  recording(): { on: boolean; locked: boolean };
  setRecording(on: boolean): void;
  clear(): void;
  download(): void;
  testTone(): void;
  clearRam(): Promise<string | null>;
}

const KINDS: readonly DiagKind[] = [
  'load', 'reset', 'coin', 'input', 'ledger', 'display', 'reels', 'halt', 'note',
];

const LOG_POLL_MS = 400;

export function logTab(deps: LogTabDeps): PanelTab {
  let list: HTMLElement | null = null;
  let empty: HTMLElement | null = null;
  let count: HTMLElement | null = null;
  let recordBox: HTMLInputElement | null = null;
  let timer = 0;
  let firstSeq = 0;
  let lastSeq = 0;
  let t0 = 0;
  const hidden = new Set<DiagKind>();

  const clearRows = (): void => {
    list?.replaceChildren();
    firstSeq = 0;
    lastSeq = 0;
  };

  const sync = (entries: readonly DiagEntry[]): void => {
    if (!list || !empty || !count) return;
    const rec = deps.recording();
    if (recordBox) recordBox.checked = rec.on;
    count.textContent = str('paneltabs.n_lines', { n: entries.length });
    empty.hidden = entries.length > 0;
    empty.textContent = rec.on ? str('paneltabs.recording_nothing_yet') : str('paneltabs.not_recording');
    if (!entries.length) { clearRows(); return; }
    if (entries[entries.length - 1].seq < lastSeq || entries[0].seq < firstSeq) clearRows();
    while (list.firstElementChild && firstSeq < entries[0].seq) {
      list.firstElementChild.remove();
      firstSeq = Number((list.firstElementChild as HTMLElement | null)?.dataset.seq ?? 0);
    }
    const fresh = entries.filter((e) => e.seq > lastSeq);
    if (!fresh.length) return;
    if (!firstSeq) { firstSeq = fresh[0].seq; t0 = entries[0].ms; }
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    const frag = document.createDocumentFragment();
    for (const e of fresh) {
      const row = el('div', 'log-row');
      row.dataset.seq = String(e.seq);
      row.dataset.kind = e.kind;
      row.hidden = hidden.has(e.kind);
      row.append(
        el('span', 'log-t', ((e.ms - t0) / 1000).toFixed(3)),
        el('span', 'log-kind', e.kind),
        el('span', 'log-text', e.text),
      );
      frag.append(row);
    }
    list.append(frag);
    lastSeq = fresh[fresh.length - 1].seq;
    if (atEnd) list.scrollTop = list.scrollHeight;
  };

  const poll = (): void => { void deps.entries().then(sync); };

  return {
    id: 'log',
    label: str('paneltabs.diagnostics_log'),
    icon: 'M6 4h9l3 3v13H6zM14.5 4v3.5H18M9 11h6M9 14h6M9 17h4',
    mount(host) {
      const rec = deps.recording();
      const record = switchRow(str('paneltabs.record'), (on) => {
        deps.setRecording(on);
        poll();
      });
      recordBox = record.box;
      record.box.checked = rec.on;
      if (rec.locked) {
        record.box.disabled = true;
        record.row.title = str('paneltabs.held_by_diag_in_the');
        record.row.classList.add('pane-locked');
      }
      count = el('span', 'pane-count nb-meta', '');
      const said = el('p', 'pane-empty nb-meta');
      said.hidden = true;
      const clearRam = action(str('paneltabs.clear_ram'), () => {
        clearRam.disabled = true;
        void deps.clearRam().then((text) => {
          clearRam.disabled = false;
          if (text !== null) { said.textContent = text; said.hidden = false; }
          poll();
        });
      });
      clearRam.classList.add('pane-btn--danger');
      host.append(head(
        str('paneltabs.diagnostics_log'),
        count, record.row,
        action(str('paneltabs.clear'), () => { deps.clear(); clearRows(); poll(); }),
        action(str('paneltabs.save_log'), deps.download), action(str('paneltabs.test_tone'), deps.testTone),
        clearRam,
      ), said);

      const filters = el('div', 'log-filters');
      for (const k of KINDS) {
        const chip = el('button', 'log-chip pane-pill', k);
        chip.type = 'button';
        chip.dataset.kind = k;
        chip.setAttribute('aria-pressed', 'true');
        chip.addEventListener('click', () => {
          const show = hidden.has(k);
          if (show) hidden.delete(k); else hidden.add(k);
          chip.setAttribute('aria-pressed', String(show));
          list?.querySelectorAll<HTMLElement>(`.log-row[data-kind="${k}"]`)
            .forEach((r) => { r.hidden = !show; });
        });
        filters.append(chip);
      }
      host.append(filters);

      list = el('div', 'log-list');
      list.tabIndex = 0;
      list.setAttribute('role', 'log');
      list.setAttribute('aria-label', str('paneltabs.diagnostics_log_2'));
      empty = el('p', 'pane-empty nb-meta');
      host.append(empty, list);
    },
    onShow() {
      poll();
      window.clearInterval(timer);
      timer = window.setInterval(poll, LOG_POLL_MS);
    },
    onHide() {
      window.clearInterval(timer);
      timer = 0;
    },
    onDiscard() {
      list = null; empty = null; count = null; recordBox = null;
      firstSeq = 0; lastSeq = 0;
      hidden.clear();
    },
  };
}

export interface BulbTabDeps {
  active(): boolean;
  setActive(on: boolean): boolean;
  setHost(host: HTMLElement | null): void;
  windows(): number;
}

export function bulbTab(deps: BulbTabDeps): PanelTab {
  let box: HTMLInputElement | null = null;
  let none: HTMLElement | null = null;
  const sync = (): void => {
    if (box) box.checked = deps.active();
    if (none) none.hidden = !(deps.active() && deps.windows() === 0);
  };
  return {
    id: 'bulbs',
    label: str('paneltabs.bulb_lab'),
    icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
    clearScrim: true,
    mount(host) {
      const run = switchRow(str('paneltabs.run'), (on) => {
        deps.setActive(on);
        sync();
      });
      box = run.box;
      host.append(head(str('paneltabs.bulb_lab'), run.row));
      none = el('p', 'pane-empty nb-meta', str('paneltabs.no_reel_windows_in_this'));
      none.hidden = true;
      const controls = el('div', 'bulb-host');
      host.append(none, controls);
      deps.setHost(controls);
      sync();
    },
    onShow: sync,
    onDiscard() {
      box = null;
      none = null;
      deps.setActive(false);
      deps.setHost(null);
    },
  };
}

export interface MatrixTabDeps {
  size(): { strobes: number; bits: number };
  press(id: number, on: boolean): void;
}

export function matrixTab(deps: MatrixTabDeps): PanelTab {
  return {
    id: 'matrix',
    label: str('paneltabs.switch_matrix'),
    icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    mount(host) {
      const { strobes, bits } = deps.size();
      const ids = new Set<number>();
      for (let strobe = 0; strobe < strobes; strobe++) {
        for (let bit = 0; bit < bits; bit++) ids.add(strobe * 8 + bit);
      }
      const cols = Math.min(bits, 8);
      host.append(head(str('paneltabs.switch_matrix')));
      const group = el('div', 'matrix-group nb-group');
      const grid = el('div', 'matrix-grid');
      grid.style.gridTemplateColumns = `52px repeat(${cols}, minmax(40px, 1fr))`;
      const axis = (text: string, row: number, col: number): void => {
        const a = el('span', 'matrix-axis', text);
        a.setAttribute('aria-hidden', 'true');
        a.style.gridRow = String(row);
        a.style.gridColumn = String(col);
        grid.append(a);
      };
      for (let bit = 0; bit < cols; bit++) axis(String(bit), 1, bit + 2);
      const strobeRows = new Set<number>();
      for (const id of [...ids].sort((x, y) => x - y)) {
        const strobe = id >> 3;
        if (!strobeRows.has(strobe)) { strobeRows.add(strobe); axis(String(strobe), strobe + 2, 1); }
        const b = el('button', 'matrix-cell');
        b.type = 'button';
        b.append(el('span', 'matrix-id', String(id)));
        b.title = str('paneltabs.strobe_n_bit_n_input', { 0: id >> 3, 1: id & 7, 2: id });
        b.style.gridColumn = String((id & 7) + 2);
        b.style.gridRow = String(strobe + 2);
        const set = (v: boolean): void => {
          deps.press(id, v);
          b.classList.toggle('on', v);
        };
        b.addEventListener('pointerdown', () => set(true));
        for (const up of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
          b.addEventListener(up, () => { if (b.classList.contains('on')) set(false); });
        }
        b.addEventListener('keydown', (ev) => {
          if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) { ev.preventDefault(); set(true); }
        });
        b.addEventListener('keyup', (ev) => {
          if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); set(false); }
        });
        b.addEventListener('blur', () => { if (b.classList.contains('on')) set(false); });
        grid.append(b);
      }
      group.append(grid);
      host.append(group);
    },
  };
}

export interface OptionSwitchRow {
  id: number;
  label: string;
  on: boolean;
  group?: string;
  bootOnly?: boolean;
  dil?: DilPlace;
}

export interface OptionsTabDeps {
  rows(): OptionSwitchRow[];
  set(row: OptionSwitchRow, on: boolean): string;
}

export function optionsTab(deps: OptionsTabDeps): PanelTab {
  let note: HTMLElement | null = null;
  let body: HTMLElement | null = null;

  const fill = (): void => {
    if (!body) return;
    body.replaceChildren();
    const rows = deps.rows();
    if (!rows.length) {
      body.append(el('p', 'pane-empty nb-meta', str('paneltabs.this_machine_states_no_option')));
      return;
    }
    const banks = el('div', 'opt-banks');
    const made = new Map<string, HTMLElement>();
    const packages = new Map<string, OptionSwitchRow[]>();
    for (const row of rows) {
      const name = row.group || str('paneltabs.option_switches_2');
      let bank = made.get(name);
      if (!bank) {
        bank = el('section', 'opt-bank');
        bank.append(el('h4', 'opt-bank-name nb-field__label', name));
        made.set(name, bank);
        banks.append(bank);
      }
      if (row.dil) {
        const key = `${name}\u0000${row.dil.bank}`;
        let pkg = packages.get(key);
        if (!pkg) {
          pkg = [];
          packages.set(key, pkg);
          const slot = el('div', 'dip nb-group');
          slot.dataset.pkg = key;
          bank.append(slot);
        }
        pkg.push(row);
        continue;
      }
      const label = el('label', 'opt-row nb-row-toggle');
      const box = toggleInput((on) => {
        const said = deps.set(row, on);
        if (note) note.textContent = said;
      });
      box.checked = row.on;
      label.append(el('span', 'opt-row-name', row.label), box);
      let rowsGroup = bank.querySelector<HTMLElement>(':scope > .opt-rows');
      if (!rowsGroup) { rowsGroup = el('div', 'opt-rows nb-group'); bank.append(rowsGroup); }
      rowsGroup.append(label);
    }
    for (const slot of banks.querySelectorAll<HTMLElement>('.dip')) {
      dipPackage(slot, packages.get(slot.dataset.pkg!)!, (row, on) => {
        const said = deps.set(row, on);
        if (note) note.textContent = said;
      });
    }
    body.append(banks);
  };

  return {
    id: 'options',
    label: str('paneltabs.option_switches'),
    icon: 'M4 8h16v8H4zM7.5 8v4M11 8v4M14.5 8v4M18 8v4',
    mount(host) {
      note = el('span', 'pane-count nb-meta', '');
      body = el('div', 'opt-body');
      host.append(head(str('paneltabs.option_switches'), note), body);
      fill();
    },
    onShow: fill,
    onDiscard() {
      note = null;
      body = null;
    },
  };
}

export function dipPackage(
  host: HTMLElement, rows: OptionSwitchRow[],
  set: (row: OptionSwitchRow, on: boolean) => void,
): void {
  const first = rows[0].dil!;
  const ways = Math.max(first.ways, ...rows.map((r) => r.dil!.slot + 1));
  const bySlot = new Map(rows.map((r) => [r.dil!.slot, r]));
  const head = el('div', 'dip-head');
  const bits = el('span', 'dip-bits');
  if (first.bank) head.append(el('span', 'dip-name', first.bank));
  head.append(bits);

  const body = el('div', 'dip-body');
  body.setAttribute('role', 'group');
  body.setAttribute('aria-label', first.bank || rows[0].group || str('paneltabs.option_switches_2'));
  body.style.setProperty('--ways', String(ways));
  const on = el('span', 'dip-on', str('paneltabs.dip_on'));
  on.setAttribute('aria-hidden', 'true');
  const levers = el('div', 'dip-levers');
  const marks = el('div', 'dip-marks');
  marks.setAttribute('aria-hidden', 'true');
  body.append(on, levers, marks);

  const legend = el('ol', 'dip-legend');
  const buttons: HTMLButtonElement[] = [];
  const legendBySlot = new Map<number, HTMLElement>();

  const readout = (): void => {
    bits.replaceChildren();
    for (let i = 0; i < ways; i++) {
      const row = bySlot.get(i);
      const bit = el('span', 'dip-bit', row ? (row.on ? '1' : '0') : '-');
      bit.classList.toggle('on', row?.on === true);
      bits.append(bit);
    }
  };
  const hot = (slot: number, lit: boolean): void => {
    buttons.find((b) => Number(b.dataset.slot) === slot)?.classList.toggle('hot', lit);
    legendBySlot.get(slot)?.classList.toggle('hot', lit);
  };

  for (let i = 0; i < ways; i++) {
    const row = bySlot.get(i);
    const mark = String(first.base + i);
    marks.append(el('span', undefined, mark));
    if (!row) {
      const gap = el('span', 'dip-lever none');
      gap.title = str('paneltabs.not_connected');
      levers.append(gap);
      continue;
    }
    const b = el('button', 'dip-lever');
    b.type = 'button';
    b.dataset.slot = String(i);
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', row.label);
    b.title = row.label;
    b.append(el('span', 'dip-knob'));
    const throwTo = (v: boolean): void => {
      if (v === row.on) return;
      row.on = v;
      b.setAttribute('aria-checked', String(v));
      readout();
      set(row, v);
    };
    b.setAttribute('aria-checked', String(row.on));
    b.addEventListener('click', () => throwTo(!row.on));
    b.addEventListener('keydown', (ev) => {
      const at = buttons.indexOf(b);
      if (ev.key === 'ArrowUp') throwTo(true);
      else if (ev.key === 'ArrowDown') throwTo(false);
      else if (ev.key === 'ArrowLeft') buttons[at - 1]?.focus();
      else if (ev.key === 'ArrowRight') buttons[at + 1]?.focus();
      else return;
      ev.preventDefault();
    });
    b.addEventListener('pointerenter', () => hot(i, true));
    b.addEventListener('pointerleave', () => hot(i, false));
    b.addEventListener('focus', () => hot(i, true));
    b.addEventListener('blur', () => hot(i, false));
    buttons.push(b);
    levers.append(b);
    if (row.dil!.name) {
      const li = el('li');
      li.append(el('span', 'dip-legend-mark', mark), el('span', undefined, row.dil!.name));
      li.addEventListener('pointerenter', () => hot(i, true));
      li.addEventListener('pointerleave', () => hot(i, false));
      li.addEventListener('click', () => b.click());
      legendBySlot.set(i, li);
      legend.append(li);
    }
  }
  readout();
  host.append(head, body);
  if (legend.childElementCount) host.append(legend);
}
