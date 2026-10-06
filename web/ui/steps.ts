import { UI_ICONS, rowIcon } from './icons';
import { str } from '../i18n';

export interface StepHeader {
  root: HTMLElement;
  set(current: number, done: (i: number) => boolean, canPick?: (i: number) => boolean): void;
}

export function stepHeader(names: string[], onPick?: (i: number) => void): StepHeader {
  const root = document.createElement('ol');
  root.className = 'ui-steps ui-rail';
  root.style.setProperty('--n', String(names.length));
  const items = names.map((n, i) => {
    const li = document.createElement('li');
    li.className = 'ui-step';
    const b = document.createElement('button');
    b.type = 'button';
    const disc = document.createElement('span');
    disc.className = 'ui-step-n';
    disc.textContent = String(i + 1);
    const badge = rowIcon(UI_ICONS.tick, 'ui-step-tick', 10);
    badge.setAttribute('aria-hidden', 'true');
    disc.append(badge);
    const t = document.createElement('span');
    t.className = 'ui-step-name';
    t.textContent = n;
    b.title = n;
    b.append(disc, t);
    b.addEventListener('click', () => onPick?.(i));
    li.append(b);
    root.append(li);
    return { li, b };
  });
  return {
    root,
    set(current, done, canPick) {
      items.forEach((it, i) => {
        const cur = i === current;
        const d = !cur && done(i);
        it.li.classList.toggle('current', cur);
        it.li.classList.toggle('done', d);
        it.li.classList.toggle('future', !cur && !d);
        it.li.classList.toggle('filled', i <= current);
        const pick = !!onPick && !cur && (canPick ? canPick(i) : d && i < current);
        it.b.disabled = !pick;
        it.b.setAttribute('aria-label', str('ui.steps.step_n_nn', { 0: i + 1, 1: names[i], 2: cur ? ' (current)' : d ? ' (done)' : '' }));
        if (cur) it.b.setAttribute('aria-current', 'step'); else it.b.removeAttribute('aria-current');
      });
    },
  };
}
