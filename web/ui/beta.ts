import { str } from '../i18n';

export function betaTag(): HTMLElement {
  const t = document.createElement('span');
  t.className = 'nb-chip nb-chip--cherry ui-beta';
  t.textContent = str('ui.beta.tag');
  return t;
}

export function betaNotice(more?: { label: string; run: () => void }): HTMLElement {
  const p = document.createElement('p');
  p.className = 'nb-notice ui-beta-note';
  const line = document.createElement('span');
  line.textContent = str('ui.beta.arcade_disclaimer');
  if (more) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = more.label;
    a.addEventListener('click', (ev) => { ev.preventDefault(); more.run(); });
    line.append(' ', a);
  }
  p.append(line);
  return p;
}

export function betaBrand(home: HTMLElement): HTMLElement {
  const b = document.createElement('div');
  b.className = 'ui-beta-brand';
  b.append(home, betaTag());
  return b;
}
