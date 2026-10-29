import { pillButton } from './list';

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
