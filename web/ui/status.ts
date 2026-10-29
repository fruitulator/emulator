import { str } from '../i18n';

export type Mark = 'pass' | 'fail' | 'warn' | 'pending' | 'running';

export const MARK_LABEL: Record<Mark, string> = {
  pass: str('ui.status.pass'), fail: str('ui.status.failed'), warn: str('ui.status.warning'), pending: str('ui.status.not_run'), running: str('ui.status.running'),
};

const CHECK_CLASS: Record<Mark, string> = {
  pass: 'is-pass', fail: 'is-fail', warn: 'is-fail', pending: 'is-pending', running: 'is-running',
};

export function statusIcon(mark: Mark, label?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `nb-mark ${CHECK_CLASS[mark]} ui-mark ${mark}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label ?? MARK_LABEL[mark]);
  const m = document.createElement('span');
  m.className = 'nb-checklist__mark';
  el.append(m);
  return el;
}

export function statusRow(mark: Mark, title: string, note?: string | null, result: string | null = MARK_LABEL[mark]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `menu-row menu-stat ui-status ${mark}`;
  const text = document.createElement('span');
  text.className = 'row-label';
  const t = document.createElement('span');
  t.className = 'ui-status-title';
  t.textContent = title;
  text.append(t);
  if (note) {
    const n = document.createElement('span');
    n.className = 'row-sub';
    n.textContent = note;
    text.append(n);
  }
  row.append(statusIcon(mark), text);
  if (result != null) {
    const r = document.createElement('span');
    r.className = 'row-value ui-status-result';
    r.textContent = result;
    row.append(r);
  }
  return row;
}

export function checklist(): HTMLUListElement {
  const ul = document.createElement('ul');
  ul.className = 'nb-checklist';
  return ul;
}

export function checkItem(mark: Mark, title: string, note?: string | null, result: string | null = MARK_LABEL[mark]): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `${CHECK_CLASS[mark]} ${mark}`;
  const m = document.createElement('span');
  m.className = 'nb-checklist__mark';
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', MARK_LABEL[mark]);
  const text = document.createElement('span');
  text.className = 'nb-checklist__text';
  const t = document.createElement('span');
  t.className = 'ui-status-title';
  t.textContent = title;
  text.append(t);
  if (note) {
    const n = document.createElement('small');
    n.textContent = note;
    text.append(n);
  }
  li.append(m, text);
  if (result != null) {
    const r = document.createElement('span');
    r.className = 'nb-checklist__state';
    r.textContent = result;
    li.append(r);
  }
  return li;
}
