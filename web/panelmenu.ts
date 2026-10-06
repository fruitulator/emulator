import { str } from './i18n';

export interface PanelDownload {
  label: string;
  run(): Promise<boolean> | boolean;
}

const SVG = 'http://www.w3.org/2000/svg';
const DOWNLOAD = 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14';

function icon(d: string, cls: string, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  svg.classList.add(cls);
  return svg;
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

export class DownloadMenu {
  readonly button: HTMLButtonElement;
  readonly popover: HTMLDivElement;

  constructor(private readonly downloads: () => PanelDownload[]) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'schem-action';
    this.button.setAttribute('aria-haspopup', 'true');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.append(icon(DOWNLOAD, 'schem-action-icon', 14), span('', str('panelmenu.download')));
    this.button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));

    this.popover = document.createElement('div');
    this.popover.className = 'pm-pop';
    this.popover.hidden = true;
    this.popover.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      this.close(true);
    });
  }

  get isOpen(): boolean {
    return !this.popover.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.append(...this.downloads().map((d, i) => this.row(d, i)));
    this.popover.replaceChildren(card);
    this.popover.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onOutside, true);
    card.querySelector('button')?.focus({ preventScroll: true });
  }

  close(refocus = false): void {
    if (!this.isOpen) return;
    this.popover.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onOutside, true);
    if (refocus) this.button.focus({ preventScroll: true });
  }

  private readonly onOutside = (ev: PointerEvent): void => {
    const t = ev.target as Node;
    if (!this.popover.contains(t) && !this.button.contains(t)) this.close();
  };

  private row(d: PanelDownload, i: number): HTMLButtonElement {
    return downloadRow(d, i);
  }
}

export function downloadRow(d: PanelDownload, i: number): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'menu-row';
  row.style.setProperty('--d', `${i * 28}ms`);
  const text = span('row-label', d.label);
  const note = span('row-sub', str('panelmenu.saved'));
  note.hidden = true;
  text.append(note);
  row.append(icon(DOWNLOAD, 'row-icon', 17), text);
  let timer = 0;
  row.addEventListener('click', () => {
    if (row.dataset.state === 'busy') return;
    window.clearTimeout(timer);
    row.dataset.state = 'busy';
    const settle = (): void => { delete row.dataset.state; note.hidden = true; };
    void Promise.resolve(d.run()).then((ok) => {
      if (ok !== true) { settle(); return; }
      row.dataset.state = 'done';
      note.hidden = false;
      timer = window.setTimeout(settle, 1600);
    }, settle);
  });
  return row;
}
