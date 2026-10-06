import { card, menuRow } from './rows';

export interface Section {
  root: HTMLElement;
  body: HTMLElement;
  setOpen(open: boolean): void;
}

export function expandSection(label: string, icon: string, body: HTMLElement, open = false): Section {
  const root = card();
  root.classList.add('ui-section');
  const head = menuRow(label, icon, () => setOpen(!root.classList.contains('open')), true);
  head.classList.add('ui-section-head');
  body.classList.add('ui-section-body');
  const setOpen = (o: boolean): void => {
    root.classList.toggle('open', o);
    head.setAttribute('aria-expanded', String(o));
    body.hidden = !o;
  };
  root.append(head, body);
  setOpen(open);
  return { root, body, setOpen };
}
