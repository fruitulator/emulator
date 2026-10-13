import { str } from '../i18n';

export function betaTag(): HTMLElement {
  const t = document.createElement('span');
  t.className = 'ui-beta';
  t.textContent = str('ui.beta.tag');
  return t;
}

export function betaNotice(more?: { label: string; run: () => void }): HTMLElement {
  const p = document.createElement('p');
  p.className = 'ui-beta-note';
  p.textContent = str('ui.beta.arcade_disclaimer');
  if (more) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-beta-more';
    b.textContent = more.label;
    b.addEventListener('click', more.run);
    p.append(' ', b);
  }
  return p;
}

export function betaBrand(home: HTMLElement): HTMLElement {
  const b = document.createElement('div');
  b.className = 'ui-beta-brand';
  b.append(home, betaTag());
  return b;
}
