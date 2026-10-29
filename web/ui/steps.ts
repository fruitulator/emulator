import { str } from '../i18n';

export interface StepHeader {
  root: HTMLElement;
  set(current: number, done: (i: number) => boolean, canPick?: (i: number) => boolean): void;
}

export function stepHeader(names: string[], onPick?: (i: number) => void): StepHeader {
  const root = document.createElement('ol');
  root.className = 'ui-steps nb-steps';
  const items = names.map((n, i) => {
    const li = document.createElement('li');
    li.className = 'ui-step';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-step-name';
    b.textContent = n;
    b.title = n;
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
        it.li.classList.toggle('is-done', d);
        if (cur) it.li.setAttribute('aria-current', 'step'); else it.li.removeAttribute('aria-current');
        const pick = !!onPick && !cur && (canPick ? canPick(i) : d && i < current);
        it.b.disabled = !pick;
        it.b.setAttribute('aria-label', str('ui.steps.step_n_nn', { 0: i + 1, 1: names[i], 2: cur ? ' (current)' : d ? ' (done)' : '' }));
      });
    },
  };
}
