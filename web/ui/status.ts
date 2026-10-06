import { UI_ICONS, rowIcon } from './icons';
import { str } from '../i18n';

export type Mark = 'pass' | 'fail' | 'warn' | 'pending' | 'running';

export const MARK_LABEL: Record<Mark, string> = {
  pass: str('ui.status.pass'), fail: str('ui.status.failed'), warn: str('ui.status.warning'), pending: str('ui.status.not_run'), running: str('ui.status.running'),
};

const PATHS: Record<Mark, string> = {
  pass: UI_ICONS.tick,
  fail: UI_ICONS.cross,
  warn: '<path d="M12 6.5v7"/><path d="M12 17.4v.1"/>',
  pending: '<path d="M8 12h8"/>',
  running: '<path d="M12 6.5a5.5 5.5 0 1 1-5.5 5.5"/>',
};

export function statusIcon(mark: Mark, label?: string, size = 18): HTMLSpanElement {
  const el = rowIcon(PATHS[mark], `ui-mark ${mark}`, size);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label ?? MARK_LABEL[mark]);
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
