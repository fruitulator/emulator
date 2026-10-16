
let returnFocus: HTMLElement | null = null;

interface SheetParts { sheet: HTMLElement; scrim: HTMLElement; rows: HTMLElement; title: HTMLElement }

function parts(): SheetParts {
  let sheet = document.getElementById('sheet');
  let scrim = document.getElementById('sheet-scrim');
  if (!sheet || !scrim) {
    scrim = document.createElement('div');
    scrim.id = 'sheet-scrim';
    scrim.hidden = true;
    sheet = document.createElement('div');
    sheet.id = 'sheet';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'sheet-title');
    const grab = document.createElement('div');
    grab.className = 'grab';
    const title = document.createElement('h3');
    title.id = 'sheet-title';
    const rows = document.createElement('div');
    rows.id = 'sheet-rows';
    sheet.append(grab, title, rows);
    document.body.append(scrim, sheet);
  }
  if (!scrim.dataset.bound) {
    scrim.dataset.bound = '1';
    scrim.addEventListener('click', closeSheet);
    bindPull(sheet, scrim);
  }
  return {
    sheet, scrim,
    rows: document.getElementById('sheet-rows')!,
    title: document.getElementById('sheet-title')!,
  };
}

function bindPull(sheet: HTMLElement, scrim: HTMLElement): void {
  const SLACK = 8;
  const FLICK = 0.5;
  let id = -1;
  let startY = 0;
  let dy = 0;
  let pulling = false;
  let trail: { t: number; y: number }[] = [];
  let swallowClick = false;
  const WINDOW = 100;
  const speed = (now: number): number => {
    const from = trail.find((s) => now - s.t <= WINDOW);
    if (!from) return 0;
    const dt = now - from.t;
    return dt > 0 ? (trail[trail.length - 1].y - from.y) / dt : 0;
  };

  sheet.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || sheet.hidden) return;
    if ((ev.target as HTMLElement).closest('input, textarea, select')) return;
    id = ev.pointerId;
    startY = ev.clientY;
    dy = 0;
    swallowClick = false;
    trail = [{ t: ev.timeStamp, y: ev.clientY }];
    pulling = false;
  });
  sheet.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== id) return;
    dy = ev.clientY - startY;
    if (!pulling) {
      if (dy < SLACK) return;
      pulling = true;
      sheet.setPointerCapture(id);
      sheet.classList.add('pulling');
    }
    trail.push({ t: ev.timeStamp, y: ev.clientY });
    if (trail.length > 32) trail.shift();
    const y = Math.max(0, dy);
    sheet.style.transform = `translate(-50%, ${y}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - y / Math.max(1, sheet.offsetHeight)));
  });
  const end = (ev: PointerEvent, cancelled: boolean): void => {
    if (ev.pointerId !== id) return;
    id = -1;
    if (!pulling) return;
    pulling = false;
    swallowClick = true;
    sheet.classList.remove('pulling');
    sheet.style.transform = '';
    scrim.style.opacity = '';
    const y = Math.max(0, dy);
    const far = y > sheet.offsetHeight / 3;
    const flick = speed(ev.timeStamp) > FLICK && y > SLACK * 3;
    if (!cancelled && (far || flick)) closeSheet();
  };
  window.addEventListener('pointerup', (ev) => end(ev, false));
  window.addEventListener('pointercancel', (ev) => end(ev, true));
  sheet.addEventListener('click', (ev) => {
    if (!swallowClick) return;
    swallowClick = false;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
}

export function sheetRow(label: string, sub: string, o: { disabled?: boolean } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sheet-row';
  b.disabled = !!o.disabled;
  const text = document.createElement('span');
  text.textContent = label;
  if (sub) {
    const s = document.createElement('span');
    s.className = 'sheet-sub';
    s.textContent = sub;
    text.append(s);
  }
  b.append(text);
  return b;
}

export function showSheet(titleText: string, rowEls: HTMLElement[], returnTo: HTMLElement): void {
  const { sheet, scrim, rows, title } = parts();
  returnFocus = returnTo;
  title.textContent = titleText;
  rows.replaceChildren(...rowEls);
  sheet.hidden = false;
  scrim.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  (rows.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus();
}

export function closeSheet(): void {
  const sheet = document.getElementById('sheet');
  const scrim = document.getElementById('sheet-scrim');
  if (!sheet || !scrim || sheet.hidden) return;
  sheet.classList.remove('open');
  scrim.hidden = true;
  window.setTimeout(() => {
    if (!sheet.classList.contains('open')) sheet.hidden = true;
  }, 260);
  returnFocus?.focus();
  returnFocus = null;
}

export function confirmInSheet(o: {
  ask: string; sub?: string; keep: string; yes: string; onYes: () => void;
}): void {
  const ask = sheetRow(o.ask, o.sub ?? '');
  ask.classList.add('inert');
  const keep = sheetRow(o.keep, '');
  keep.addEventListener('click', closeSheet);
  const yes = sheetRow(o.yes, '');
  yes.classList.add('destructive');
  yes.addEventListener('click', () => { closeSheet(); o.onYes(); });
  parts().rows.replaceChildren(ask, keep, yes);
  keep.focus();
}
