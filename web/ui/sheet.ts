import { UI_ICONS, rowIcon } from './icons';
import { str } from '../i18n';
import { closeSideCard, escapeSideCard } from './sidecard';

let returnFocus: HTMLElement | null = null;

let byPointer = false;
if (typeof addEventListener === 'function') {
  addEventListener('pointerdown', () => { byPointer = true; }, true);
  addEventListener('keydown', () => {
    byPointer = false;
    document.getElementById('sheet')?.classList.remove('by-pointer');
  }, true);
}

interface SheetParts { sheet: HTMLElement; scrim: HTMLElement; rows: HTMLElement; title: HTMLElement }

function parts(): SheetParts {
  let sheet = document.getElementById('sheet');
  let scrim = document.getElementById('sheet-scrim');
  if (!sheet || !scrim) {
    scrim = document.createElement('div');
    scrim.id = 'sheet-scrim';
    scrim.className = 'nb-backdrop';
    scrim.hidden = true;
    sheet = document.createElement('div');
    sheet.id = 'sheet';
    sheet.className = 'nb-bottom-sheet';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'sheet-title');
    const grab = document.createElement('div');
    grab.className = 'grab nb-bottom-sheet__grab';
    const head = document.createElement('div');
    head.className = 'nb-sheet-head';
    const title = document.createElement('h2');
    title.id = 'sheet-title';
    head.append(title);
    const rows = document.createElement('div');
    rows.id = 'sheet-rows';
    sheet.append(grab, head, rows);
    document.body.append(scrim, sheet);
  }
  if (!scrim.dataset.bound) {
    scrim.dataset.bound = '1';
    scrim.addEventListener('click', closeSheet);
    bindPull(sheet, scrim);
  }
  return {
    sheet, scrim,
    rows: document.getElementById('sheet-rows')!,
    title: document.getElementById('sheet-title')!,
  };
}

function bindPull(sheet: HTMLElement, scrim: HTMLElement): void {
  const SLACK = 8;
  const FLICK = 0.5;
  let id = -1;
  let startY = 0;
  let dy = 0;
  let pulling = false;
  let trail: { t: number; y: number }[] = [];
  let swallowClick = false;
  const WINDOW = 100;
  const speed = (now: number): number => {
    const from = trail.find((s) => now - s.t <= WINDOW);
    if (!from) return 0;
    const dt = now - from.t;
    return dt > 0 ? (trail[trail.length - 1].y - from.y) / dt : 0;
  };

  sheet.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || sheet.hidden) return;
    if ((ev.target as HTMLElement).closest('input, textarea, select, .sheet-line')) return;
    const list = (ev.target as HTMLElement).closest('#sheet-rows');
    if (list && list.scrollHeight > list.clientHeight) return;
    id = ev.pointerId;
    startY = ev.clientY;
    dy = 0;
    swallowClick = false;
    trail = [{ t: ev.timeStamp, y: ev.clientY }];
    pulling = false;
  });
  sheet.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== id) return;
    dy = ev.clientY - startY;
    if (!pulling) {
      if (dy < SLACK) return;
      pulling = true;
      sheet.setPointerCapture(id);
      sheet.classList.add('pulling');
    }
    trail.push({ t: ev.timeStamp, y: ev.clientY });
    if (trail.length > 32) trail.shift();
    const y = Math.max(0, dy);
    sheet.style.transform = `translateY(${y}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - y / Math.max(1, sheet.offsetHeight)));
  });
  const end = (ev: PointerEvent, cancelled: boolean): void => {
    if (ev.pointerId !== id) return;
    id = -1;
    if (!pulling) return;
    pulling = false;
    swallowClick = true;
    sheet.classList.remove('pulling');
    sheet.style.transform = '';
    scrim.style.opacity = '';
    const y = Math.max(0, dy);
    const far = y > sheet.offsetHeight / 3;
    const flick = speed(ev.timeStamp) > FLICK && y > SLACK * 3;
    if (!cancelled && (far || flick)) closeSheet();
  };
  window.addEventListener('pointerup', (ev) => end(ev, false));
  window.addEventListener('pointercancel', (ev) => end(ev, true));
  sheet.addEventListener('click', (ev) => {
    if (!swallowClick) return;
    swallowClick = false;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
}

export function sheetRow(label: string, sub: string, o: { disabled?: boolean; icon?: Element; note?: string } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sheet-row nb-menu-item';
  b.disabled = !!o.disabled;
  if (o.icon) b.append(o.icon);
  const text = document.createElement('span');
  text.textContent = label;
  if (o.note) text.append(noteOf(o.note));
  if (sub) text.append(subOf(sub));
  b.append(text);
  return b;
}

export function valueRow(label: string, value: string): { row: HTMLButtonElement; setValue(v: string): void } {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'sheet-row nb-menu-item sheet-value-row';
  row.setAttribute('aria-haspopup', 'true');
  row.setAttribute('aria-expanded', 'false');
  const text = document.createElement('span');
  text.textContent = label;
  const v = document.createElement('span');
  v.className = 'sheet-value-row__value';
  v.textContent = value;
  row.append(text, v, rowIcon(UI_ICONS.chevRight, 'sheet-value-row__chev', 18));
  return { row, setValue: (t) => { v.textContent = t; } };
}

export function optionRow(label: string, sub: string, icon: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sheet-option nb-option';
  const text = document.createElement('span');
  text.className = 'sheet-option-text';
  text.textContent = label;
  if (sub) text.append(subOf(sub));
  b.append(rowIcon(icon, 'nb-option__icon', 22), text, rowIcon(UI_ICONS.chevRight, 'sheet-option-chev', 18));
  return b;
}

function noteOf(text: string): HTMLElement {
  const n = document.createElement('small');
  n.className = 'sheet-row-note';
  n.textContent = text;
  return n;
}

function subOf(text: string): HTMLElement {
  const s = document.createElement('small');
  s.className = 'sheet-sub';
  s.textContent = text;
  return s;
}

export function dangerRow(row: HTMLElement): void {
  row.classList.add('destructive', 'nb-menu-item--danger');
}

export function sheetLine(label: string, sub: string, o: { quiet?: boolean; icon?: Element; note?: string } = {}): HTMLDivElement {
  const d = document.createElement('div');
  d.className = o.quiet ? 'sheet-row sheet-line nb-menu-item quiet' : 'sheet-row sheet-line nb-menu-item';
  if (o.icon) d.append(o.icon);
  const text = document.createElement('span');
  text.textContent = label;
  if (o.note) text.append(noteOf(o.note));
  if (sub) text.append(subOf(sub));
  d.append(text);
  return d;
}

let escapeOn = false;
function escapeAlwaysCloses(): void {
  if (escapeOn) return;
  escapeOn = true;
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.getElementById('sheet')?.classList.contains('open')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (escapeSideCard()) return;
    closeSheet();
  }, true);
}

export function escapeCloses(onClosed?: () => void): void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    closeSheet();
  };
  addEventListener('keydown', onKey, true);
  const sheet = document.getElementById('sheet');
  const watch = new MutationObserver(() => {
    if (sheet && !sheet.classList.contains('open')) {
      removeEventListener('keydown', onKey, true);
      watch.disconnect();
      onClosed?.();
    }
  });
  if (sheet) watch.observe(sheet, { attributes: true, attributeFilter: ['class'] });
}

export function showSheet(titleText: string, rowEls: HTMLElement[], returnTo: HTMLElement, o: {
  foot?: HTMLElement[];
  sub?: string;
  closeButton?: boolean;
  back?: () => void;
  variant?: 'wide';
  help?: () => void;
} = {}): void {
  escapeAlwaysCloses();
  closeSideCard();
  const { sheet, scrim, rows, title } = parts();
  const head = title.parentElement!;
  head.querySelector(':scope > .sheet-sub')?.remove();
  head.querySelector(':scope > .sheet-close')?.remove();
  head.querySelector(':scope > .sheet-back')?.remove();
  head.classList.toggle('sheet-head--back', !!o.back);
  if (o.back) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'nb-icon-btn sheet-back';
    back.setAttribute('aria-label', str('ui.rows.back'));
    back.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI_ICONS.chevLeft}</svg>`;
    back.addEventListener('click', o.back);
    title.before(back);
  }
  if (o.sub) {
    const sub = document.createElement('div');
    sub.className = 'nb-meta sheet-sub';
    sub.textContent = o.sub;
    head.append(sub);
  }
  if (o.closeButton) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'nb-icon-btn sheet-close';
    x.setAttribute('aria-label', str('ui.dialog.close'));
    x.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI_ICONS.cross}</svg>`;
    x.addEventListener('click', closeSheet);
    title.after(x);
  }
  if (o.help) {
    const run = o.help;
    const q = document.createElement('button');
    q.type = 'button';
    q.className = 'nb-icon-btn sheet-close';
    q.setAttribute('aria-label', str('help.title'));
    q.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI_ICONS.help}</svg>`;
    q.addEventListener('click', () => { closeSheet(); run(); });
    title.after(q);
  }
  if (o.variant) sheet.dataset.variant = o.variant;
  else delete sheet.dataset.variant;
  let foot = document.getElementById('sheet-foot');
  if (!foot) {
    foot = document.createElement('div');
    foot.id = 'sheet-foot';
    sheet.append(foot);
  }
  foot.replaceChildren(...grouped(o.foot ?? []));
  foot.hidden = !o.foot?.length;
  returnFocus = returnTo;
  title.textContent = titleText;
  title.parentElement?.querySelectorAll(':scope > .nb-avatar, :scope > .sheet-head-icon').forEach((e) => e.remove());
  rows.replaceChildren(...grouped(rowEls));
  sheet.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  rows.scrollTop = 0;
  sheet.classList.toggle('by-pointer', byPointer);
  (rows.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
}

function grouped(els: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  let group: HTMLElement | null = null;
  let options: HTMLElement | null = null;
  for (const e of els) {
    if (e.classList.contains('nb-option')) {
      group = null;
      if (!options) {
        options = document.createElement('div');
        options.className = 'sheet-options';
        out.push(options);
      }
      options.append(e);
      continue;
    }
    options = null;
    if (e.classList.contains('nb-menu-item')) {
      if (!group) {
        group = document.createElement('div');
        group.className = 'nb-group sheet-group';
        out.push(group);
      }
      group.append(e);
    } else {
      group = null;
      out.push(e);
    }
  }
  return out;
}

export function closeSheet(): void {
  closeSideCard();
  const sheet = document.getElementById('sheet');
  const scrim = document.getElementById('sheet-scrim');
  if (!sheet || !scrim || sheet.hidden) return;
  sheet.classList.remove('open');
  scrim.hidden = true;
  window.setTimeout(() => {
    if (!sheet.classList.contains('open')) sheet.hidden = true;
  }, 260);
  returnFocus?.focus();
  returnFocus = null;
}

export function confirmInSheet(o: {
  ask: string; sub?: string; keep: string; yes: string; onYes: () => void;
}): void {
  const ask = sheetRow(o.ask, o.sub ?? '');
  ask.classList.add('inert');
  const keep = sheetRow(o.keep, '');
  keep.addEventListener('click', closeSheet);
  const yes = sheetRow(o.yes, '');
  dangerRow(yes);
  yes.addEventListener('click', () => { closeSheet(); o.onYes(); });
  parts().rows.replaceChildren(...grouped([ask, keep, yes]));
  const foot = document.getElementById('sheet-foot');
  if (foot) foot.hidden = true;
  keep.focus();
}
