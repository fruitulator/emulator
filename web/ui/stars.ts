import { chip } from './list';
import { str } from '../i18n';

const STAR = '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>';

function starSvg(): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = STAR;
  return s;
}

export function ratingChip(rating: number, ratings: number): HTMLElement | null {
  if (!ratings) return null;
  const c = chip(str('ui.stars.rating_n', { 0: rating.toFixed(1), 1: ratings }));
  c.classList.add('ui-stars-chip');
  c.prepend(starSvg());
  return c;
}

export interface StarPicker {
  el: HTMLElement;
  set(value: number): void;
}

export function starPicker(o: { label: string; value: number; onPick: (stars: number) => void; disabled?: boolean }): StarPicker {
  const el = document.createElement('div');
  el.className = 'ui-stars';
  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', o.label);
  let value = o.value;
  const buttons: HTMLButtonElement[] = [];
  const light = (n: number): void => { buttons.forEach((b, i) => b.classList.toggle('on', i < n)); };
  const set = (n: number): void => {
    value = n;
    buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i + 1 === n));
      b.tabIndex = i + 1 === (n || 1) ? 0 : -1;
    });
    light(n);
  };
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-star';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', str('ui.stars.n_of_5', { 0: i }));
    b.disabled = !!o.disabled;
    b.append(starSvg());
    b.addEventListener('click', () => { set(i); o.onPick(i); });
    b.addEventListener('pointerenter', () => light(i));
    b.addEventListener('keydown', (e) => {
      const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? i - 1 : 0;
      if (to < 1 || to > 5) return;
      e.preventDefault();
      buttons[to - 1].focus();
    });
    buttons.push(b);
  }
  el.addEventListener('pointerleave', () => light(value));
  el.append(...buttons);
  set(value);
  return { el, set };
}
