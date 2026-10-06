import { UI_ICONS } from './icons';

const SVG = 'http://www.w3.org/2000/svg';

export class Avatar {
  readonly el: HTMLButtonElement;
  private readonly pillEl: HTMLSpanElement;
  private readonly faceEl: HTMLSpanElement;

  constructor(onClick: () => void, o: { pillId?: string } = {}) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'ui-avatar';
    this.pillEl = document.createElement('span');
    this.pillEl.className = 'ui-avatar-pill';
    if (o.pillId) this.pillEl.id = o.pillId;
    this.pillEl.hidden = true;
    this.faceEl = document.createElement('span');
    this.faceEl.className = 'ui-avatar-face';
    this.faceEl.setAttribute('aria-hidden', 'true');
    this.el.append(this.pillEl, this.faceEl);
    this.el.addEventListener('click', onClick);
    this.face(null);
  }

  face(name: string | null): void {
    const first = name ? [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c)) : undefined;
    if (first) {
      this.faceEl.textContent = first.toLocaleUpperCase();
      return;
    }
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = UI_ICONS.person;
    this.faceEl.replaceChildren(svg);
  }

  pill(text: string | null): void {
    this.pillEl.textContent = text ?? '';
    this.pillEl.hidden = !text;
    this.el.classList.toggle('with-pill', !!text);
  }

  label(text: string): void {
    this.el.setAttribute('aria-label', text);
    this.el.title = text;
  }
}
