
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
  }
  return {
    sheet, scrim,
    rows: document.getElementById('sheet-rows')!,
    title: document.getElementById('sheet-title')!,
  };
}

export function sheetRow(label: string, sub: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sheet-row';
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
  (rows.querySelector('button') as HTMLElement | null)?.focus();
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
