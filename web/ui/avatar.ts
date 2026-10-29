import { UI_ICONS } from './icons';
import { nebulaAvatarColours } from './nebula-avatar.js';

const SVG = 'http://www.w3.org/2000/svg';

export class Avatar {
  readonly el: HTMLButtonElement;
  private readonly pillEl: HTMLSpanElement;
  private readonly faceEl: HTMLSpanElement;
  private name: string | null = null;
  private pic: string | null = null;

  constructor(onClick: () => void, o: { pillId?: string } = {}) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'ui-avatar';
    this.pillEl = document.createElement('span');
    this.pillEl.className = 'ui-avatar-pill';
    if (o.pillId) this.pillEl.id = o.pillId;
    this.pillEl.hidden = true;
    this.faceEl = document.createElement('span');
    this.faceEl.className = 'nb-avatar ui-avatar-face';
    this.faceEl.setAttribute('aria-hidden', 'true');
    this.el.append(this.pillEl, this.faceEl);
    this.el.addEventListener('click', onClick);
    this.face(null);
  }

  face(name: string | null): void {
    this.name = name;
    this.draw();
  }

  picture(url: string | null): void {
    this.pic = url;
    this.draw();
  }

  private draw(): void {
    drawFace(this.faceEl, this.name, this.pic);
  }

  pill(text: string | null, money = false): void {
    this.pillEl.textContent = text ?? '';
    this.pillEl.hidden = !text;
    this.el.classList.toggle('with-pill', !!text);
    this.el.classList.toggle('nb-balance', !!text && money);
    this.el.classList.toggle('nb-btn', !!text && !money);
  }

  label(text: string): void {
    this.el.setAttribute('aria-label', text);
    this.el.title = text;
  }
}

function drawFace(el: HTMLElement, name: string | null, pic: string | null): void {
  const [a, b] = nebulaAvatarColours(name ?? '');
  el.style.setProperty('--a', a);
  el.style.setProperty('--b', b);
  if (pic) {
    const img = document.createElement('img');
    img.src = pic;
    img.alt = '';
    img.decoding = 'async';
    el.replaceChildren(img);
    return;
  }
  const first = name ? [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c)) : undefined;
  if (first) {
    el.textContent = first.toLocaleUpperCase();
    return;
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = UI_ICONS.person;
  el.replaceChildren(svg);
}

export function avatarFace(name: string | null, pic: string | null, size: number): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'nb-avatar ui-avatar-face';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--s', `${size}px`);
  drawFace(el, name, pic);
  return el;
}

export function namePill(name: string, pic: string | null, size = 32): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'ui-name-pill';
  const label = document.createElement('span');
  label.className = 'ui-name-pill-name';
  label.textContent = name;
  el.append(avatarFace(name, pic, size), label);
  return el;
}
