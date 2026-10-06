import { toggleInput } from './ui/rows';
import type { DiagEntry, DiagKind } from './diaglog';
import type { PanelTab } from './schematic';
import { str } from './i18n';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function action(label: string, run: () => void): HTMLButtonElement {
  const b = el('button', 'pane-btn', label);
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
  const row = el('label', 'menu-check pane-switch');
  const box = el('input');
  box.type = 'checkbox';
  box.setAttribute('role', 'switch');
  box.addEventListener('change', () => onChange(box.checked));
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
      count = el('span', 'pane-count', '');
      const said = el('p', 'pane-empty');
      said.hidden = true;
      const clearRam = action(str('paneltabs.clear_ram'), () => {
        clearRam.disabled = true;
        void deps.clearRam().then((text) => {
          clearRam.disabled = false;
          if (text !== null) { said.textContent = text; said.hidden = false; }
          poll();
        });
      });
      host.append(head(
        str('paneltabs.diagnostics_log'),
        count, record.row,
        action(str('paneltabs.clear'), () => { deps.clear(); clearRows(); poll(); }),
        action(str('paneltabs.save_log'), deps.download), action(str('paneltabs.test_tone'), deps.testTone),
        clearRam,
      ), said);

      const filters = el('div', 'log-filters');
      for (const k of KINDS) {
        const chip = el('button', 'log-chip', k);
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
      empty = el('p', 'pane-empty');
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
      none = el('p', 'pane-empty', str('paneltabs.no_reel_windows_in_this'));
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
      const grid = el('div', 'matrix-grid');
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      for (const id of [...ids].sort((x, y) => x - y)) {
        const b = el('button', 'matrix-cell');
        b.type = 'button';
        b.append(el('span', 'matrix-sb', `${id >> 3}.${id & 7}`), el('span', 'matrix-id', String(id)));
        b.title = str('paneltabs.strobe_n_bit_n_input', { 0: id >> 3, 1: id & 7, 2: id });
        b.style.gridColumn = String((id & 7) + 1);
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
      host.append(grid);
    },
  };
}

export interface OptionSwitchRow {
  id: number;
  label: string;
  on: boolean;
  group?: string;
  bootOnly?: boolean;
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
      body.append(el('p', 'pane-empty', str('paneltabs.this_machine_states_no_option')));
      return;
    }
    const banks = el('div', 'opt-banks');
    const made = new Map<string, HTMLElement>();
    for (const row of rows) {
      const name = row.group || str('paneltabs.option_switches_2');
      let bank = made.get(name);
      if (!bank) {
        bank = el('section', 'opt-bank');
        bank.append(el('h4', 'opt-bank-name', name));
        made.set(name, bank);
        banks.append(bank);
      }
      const label = el('label', 'menu-check opt-row');
      const box = toggleInput((on) => {
        const said = deps.set(row, on);
        if (note) note.textContent = said;
      });
      box.checked = row.on;
      label.append(el('span', 'opt-row-name', row.label), box);
      bank.append(label);
    }
    body.append(banks);
  };

  return {
    id: 'options',
    label: str('paneltabs.option_switches'),
    icon: 'M4 8h16v8H4zM7.5 8v4M11 8v4M14.5 8v4M18 8v4',
    mount(host) {
      note = el('span', 'pane-count', '');
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
