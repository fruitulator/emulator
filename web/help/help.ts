import { openDialog, type Dialog } from '../ui/dialog';
import { UI_ICONS } from '../ui/icons';
import { richInto } from '../ui/rich';
import { valueRow } from '../ui/sheet';
import { bubbleTip } from '../ui/tip';
import { hasArcade } from '../ui/sitenav';
import { str } from '../i18n';
import { guides, type Block, type GuideId } from './guides';

let open: Dialog | null = null;
let arcadeGuide: (() => void) | null = null;

export function setArcadeGuide(opener: () => void): void { arcadeGuide = opener; }

function blockNode(b: Block): HTMLElement {
  if ('p' in b) return richInto(document.createElement('p'), b.p);
  if ('h' in b) {
    const h = document.createElement('h3');
    h.textContent = b.h;
    if (b.at) h.dataset.at = b.at;
    return h;
  }
  const list = document.createElement('ul' in b ? 'ul' : 'ol');
  for (const line of 'ul' in b ? b.ul : b.ol) list.append(richInto(document.createElement('li'), line));
  return list;
}

function show(title: string, body: Node[], onClose?: () => void): Dialog {
  open?.close();
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    d.close();
  };
  const d = openDialog({
    title,
    body,
    onClose: () => {
      document.removeEventListener('keydown', onKey, true);
      if (open === d) open = null;
      onClose?.();
    },
  });
  document.addEventListener('keydown', onKey, true);
  d.panel.classList.add('help');
  open = d;
  return d;
}

export function openHelp(id: GuideId, at?: string, onClose?: () => void): void {
  const g = guides().find((x) => x.id === id);
  if (!g) return;
  const d = show(g.title, g.blocks.map(blockNode), onClose);
  if (at) d.body.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: 'start' });
}

export function openHelpList(onClose?: () => void): void {
  const rows: HTMLElement[] = [];
  for (const g of guides()) {
    if (g.arcade && !hasArcade()) continue;
    const { row } = valueRow(g.title, '');
    row.addEventListener('click', () => openHelp(g.id, undefined, onClose));
    rows.push(row);
  }
  if (hasArcade()) {
    const { row } = valueRow(str('arcade.guide.how_the_arcade_works'), '');
    row.addEventListener('click', () => {
      open?.close();
      if (arcadeGuide) arcadeGuide();
      else location.href = '/arcade/?guide';
    });
    rows.push(row);
  }
  const group = document.createElement('div');
  group.className = 'nb-group';
  group.append(...rows);
  show(str('help.title'), [group], onClose);
}

export function helpButton(run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nb-icon-btn help-btn';
  b.setAttribute('aria-label', str('help.title'));
  bubbleTip(b, str('help.title'), str('help.tip'));
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI_ICONS.help}</svg>`;
  b.addEventListener('click', run);
  return b;
}

export function showHelpPage(id: string | null): void {
  document.getElementById('veil')?.remove();
  const home = (): void => { location.href = '/'; };
  const g = guides().find((x) => x.id === id && (!x.arcade || hasArcade()));
  if (g) openHelp(g.id, undefined, home);
  else openHelpList(home);
}
