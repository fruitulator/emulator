import { MENU_ICONS, UI_ICONS, rowIcon } from './icons';
import { str } from '../i18n';

export function card(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'menu-card';
  return el;
}

export function menuRow(
  label: string, icon: string, onClick: () => void, chevron: boolean,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'menu-row';
  const l = document.createElement('span');
  l.className = 'row-label';
  l.textContent = label;
  b.append(rowIcon(icon), l);
  if (chevron) b.append(rowIcon(MENU_ICONS.chevRight, 'row-chev', 16));
  b.addEventListener('click', onClick);
  return b;
}

export function toggleInput(onChange?: (checked: boolean) => void): HTMLInputElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.setAttribute('role', 'switch');
  if (onChange) box.addEventListener('change', () => onChange(box.checked));
  return box;
}

export function checkRow(label: string, onChange: (checked: boolean) => void): {
  row: HTMLLabelElement; box: HTMLInputElement;
} {
  const row = document.createElement('label');
  row.className = 'menu-row menu-check';
  const text = document.createElement('span');
  text.className = 'row-label';
  text.textContent = label;
  const box = toggleInput(onChange);
  row.append(text, box);
  return { row, box };
}

export function statRow(card: HTMLElement, label: string): HTMLSpanElement {
  const r = document.createElement('div');
  r.className = 'menu-row menu-stat';
  const l = document.createElement('span');
  l.className = 'row-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'row-value';
  r.append(l, v);
  card.append(r);
  return v;
}

export function sliderRow(button: HTMLElement, slider: HTMLInputElement, extra = ''): HTMLDivElement {
  const row = document.createElement('div');
  row.className = extra ? `menu-row menu-vol ${extra}` : 'menu-row menu-vol';
  row.append(button, slider);
  return row;
}

export interface ResetSlider {
  row: HTMLDivElement;
  slider: HTMLInputElement;
  set(v: number): void;
}

export function resetSlider(o: {
  label: string; min: number; max: number; step: number; value: number; home: number;
  format?: (v: number) => string; onInput: (v: number) => void; onReset?: () => void;
  resetLabel?: string;
}): ResetSlider {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(o.min);
  slider.max = String(o.max);
  slider.step = String(o.step);
  slider.value = String(o.value);
  slider.setAttribute('aria-label', o.label);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-reset';
  btn.append(rowIcon(UI_ICONS.reset, 'row-icon', 16).firstElementChild!);
  const label = document.createElement('span');
  label.className = 'row-label ui-slider-label';
  label.textContent = o.label;
  const out = document.createElement('span');
  out.className = 'row-value ui-slider-value';
  const fmt = o.format ?? ((v: number) => String(v));
  const sync = (): void => {
    const v = Number(slider.value);
    out.textContent = fmt(v);
    const home = Math.abs(v - o.home) < o.step / 2;
    btn.classList.toggle('off-neutral', !home);
    btn.disabled = home;
    const what = o.resetLabel ?? str('ui.rows.reset_n', { 0: o.label.toLowerCase() });
    btn.setAttribute('aria-label', what);
    btn.title = what;
  };
  slider.addEventListener('input', () => { sync(); o.onInput(Number(slider.value)); });
  btn.addEventListener('click', () => {
    slider.value = String(o.home);
    sync();
    if (o.onReset) o.onReset(); else o.onInput(o.home);
  });
  const row = sliderRow(btn, slider, 'ui-slider');
  row.prepend(label);
  row.append(out);
  sync();
  return { row, slider, set: (v) => { slider.value = String(v); sync(); } };
}

export function backRow(title: string, onBack: () => void): HTMLButtonElement {
  const back = document.createElement('button');
  back.className = 'menu-back';
  const h = document.createElement('span');
  h.textContent = title;
  back.append(rowIcon(MENU_ICONS.chevLeft, 'row-chev', 16), h);
  back.addEventListener('click', onBack);
  return back;
}

export function caption(text: string): HTMLDivElement {
  const c = document.createElement('div');
  c.className = 'menu-caption';
  c.textContent = text;
  return c;
}

export function choreograph(root: ParentNode, base = 0): void {
  let card = 0;
  for (const group of root.querySelectorAll<HTMLElement>('.menu-card, .menu-grid')) {
    let row = 0;
    for (const el of group.querySelectorAll<HTMLElement>(':scope > .menu-row, :scope > button')) {
      el.style.setProperty('--d', `${base + Math.min(card * 60 + row * 26, 480)}ms`);
      row++;
    }
    card++;
  }
}
