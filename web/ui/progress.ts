import { pillButton } from './list';
import { statusIcon } from './status';

export interface ProgressCard {
  root: HTMLElement;
  label(text: string): void;
  title(text: string): void;
  fill(share: number): void;
}

export function progressCard(o: { label: string; meter?: boolean; stop?: { label: string; run: () => void } }): ProgressCard {
  const root = document.createElement('div');
  root.className = 'nb-progress';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const spin = document.createElement('span');
  spin.className = 'nb-spinner';
  spin.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div');
  body.className = 'nb-progress__body';
  const label = document.createElement('span');
  label.className = 'nb-progress__label';
  label.textContent = o.label;
  const title = document.createElement('strong');
  title.className = 'nb-progress__title';
  title.hidden = true;
  body.append(label, title);
  let bar: HTMLElement | null = null;
  if (o.meter) {
    const meter = document.createElement('div');
    meter.className = 'nb-meter';
    meter.setAttribute('role', 'progressbar');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', '0');
    bar = document.createElement('span');
    bar.style.width = '0%';
    meter.append(bar);
    body.append(meter);
  }
  root.append(spin, body);
  if (o.stop) {
    const stop = o.stop;
    const b = pillButton(stop.label, () => { b.disabled = true; stop.run(); });
    b.classList.add('nb-btn--sm');
    root.append(b);
  }
  return {
    root,
    label: (text) => { label.textContent = text; },
    title: (text) => { title.textContent = text; title.hidden = !text; },
    fill: (share) => {
      if (!bar) return;
      const pc = Math.round(Math.max(0, Math.min(1, share)) * 100);
      bar.style.width = `${pc}%`;
      bar.parentElement!.setAttribute('aria-valuenow', String(pc));
    },
  };
}

export interface DownloadCard {
  update(text: string, share?: number): void;
  done(): void;
  remove(): void;
}

const DONE_MS = 600;
const FADE_MS = 200;
const CARDS_SHOWN = 3;

const dlCards: HTMLElement[] = [];

function showNewest(): void {
  dlCards.forEach((c, i) => { c.hidden = i < dlCards.length - CARDS_SHOWN; });
}

export function downloadCard(): DownloadCard {
  let stack = document.querySelector<HTMLElement>('.nb-dlstack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'nb-dlstack';
    document.body.append(stack);
    const s = stack;
    new ResizeObserver(() => { document.documentElement.style.setProperty('--dl-h', `${s.offsetHeight}px`); }).observe(s);
  }
  const root = document.createElement('div');
  root.className = 'nb-dlcard';
  root.setAttribute('role', 'status');
  const spin = document.createElement('span');
  spin.className = 'nb-spinner';
  spin.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div');
  body.className = 'nb-dlcard__body';
  const line = document.createElement('div');
  line.className = 'nb-dlcard__line';
  const name = document.createElement('span');
  name.className = 'nb-dlcard__name';
  const pct = document.createElement('span');
  pct.className = 'nb-dlcard__pct';
  pct.setAttribute('aria-hidden', 'true');
  line.append(name, pct);
  const meter = document.createElement('div');
  meter.className = 'nb-meter';
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  meter.hidden = true;
  const bar = document.createElement('span');
  meter.append(bar);
  body.append(line, meter);
  root.append(spin, body);
  stack.append(root);
  dlCards.push(root);
  showNewest();

  const fill = (share: number | undefined): void => {
    meter.hidden = share === undefined;
    if (share === undefined) { pct.textContent = ''; return; }
    const n = Math.round(Math.max(0, Math.min(1, share)) * 100);
    pct.textContent = `${n}%`;
    bar.style.width = `${n}%`;
    meter.setAttribute('aria-valuenow', String(n));
  };
  let going = false;
  const remove = (): void => {
    if (going) return;
    going = true;
    root.classList.add('is-leaving');
    const gone = (): void => {
      root.remove();
      dlCards.splice(dlCards.indexOf(root), 1);
      showNewest();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) gone();
    else setTimeout(gone, FADE_MS);
  };
  return {
    update: (text, share) => {
      if (name.textContent !== text) name.textContent = text;
      fill(share);
    },
    done: () => {
      fill(1);
      spin.replaceWith(statusIcon('pass'));
      setTimeout(remove, DONE_MS);
    },
    remove,
  };
}

export function smallSpinner(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'nb-spinner nb-spinner--sm';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export function loadingLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'nb-loading';
  p.setAttribute('role', 'status');
  p.append(smallSpinner(), text);
  return p;
}
