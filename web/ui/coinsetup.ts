import { CASH_COINS, TOKEN_VALUES, cashLabel, isTokenCoin, slotCoinLabel, type SlotCoin } from '../coinask';
import { str } from '../i18n';
import { enhanceSelect } from './dropdown';
import { UI_ICONS, rowIcon } from './icons';

export interface CoinTicks {
  root: HTMLElement;
  value(): SlotCoin[];
}

let ids = 0;

export function coinTicks(o: {
  label: string; start: readonly SlotCoin[];
  onChange: (coins: SlotCoin[], unused: boolean) => void;
  single?: boolean; unused?: boolean;
  noUnused?: boolean;
  takes?: ReadonlySet<number> | null;
}): CoinTicks {
  const root = document.createElement('div');
  root.className = 'coin-ticks nb-choices';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', o.label);
  const cash = new Set<number>(o.start.filter((c): c is number => typeof c === 'number'));
  const startToken = o.start.find((c): c is { token: number | null } => typeof c !== 'number');
  let token: { token: number | null } | null = startToken ? { token: startToken.token } : null;

  const value = (): SlotCoin[] => [
    ...CASH_COINS.filter((p) => cash.has(p)),
    ...(token ? [{ token: token.token }] : []),
  ];
  let unused = !!o.single && !!o.unused;
  const changed = (): void => o.onChange(value(), unused);

  const all: { b: HTMLButtonElement; flip: (on: boolean) => void }[] = [];
  const tick = (label: string, on: boolean, flip: (on: boolean) => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'coin-tick nb-choice';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const now = b.getAttribute('aria-pressed') !== 'true';
      if (now && o.single) {
        for (const t of all) {
          if (t.b === b || t.b.getAttribute('aria-pressed') !== 'true') continue;
          t.b.setAttribute('aria-pressed', 'false');
          t.flip(false);
        }
      }
      b.setAttribute('aria-pressed', String(now));
      flip(now);
      changed();
    });
    all.push({ b, flip });
    return b;
  };

  for (const p of CASH_COINS) {
    const refused = !!o.takes && !o.takes.has(p);
    const b = tick(cashLabel(p), cash.has(p), (on) => {
      if (on) cash.add(p); else cash.delete(p);
      if (!on && refused) b.disabled = true;
    });
    b.disabled = refused && !cash.has(p);
    root.append(b);
  }

  const worth = document.createElement('select');
  worth.className = 'coin-token-value';
  worth.id = `coin-token-value-${++ids}`;
  worth.setAttribute('aria-label', str('coinask.what_the_token_is_worth'));
  const none = document.createElement('option');
  none.value = '';
  none.textContent = str('coinask.no_value');
  worth.append(none);
  for (const p of TOKEN_VALUES) {
    if (o.takes && !o.takes.has(p) && token?.token !== p) continue;
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = cashLabel(p);
    worth.append(opt);
  }
  worth.value = token?.token ? String(token.token) : '';
  worth.addEventListener('change', () => {
    if (!token) return;
    token = { token: worth.value ? Number(worth.value) : null };
    changed();
  });
  const tokenTick = tick(slotCoinLabel({ token: null }), !!token, (on) => {
    token = on ? { token: worth.value ? Number(worth.value) : null } : null;
    dd.root.hidden = !on;
  });
  const tokenWrap = document.createElement('span');
  tokenWrap.className = 'coin-token';
  tokenWrap.append(tokenTick, worth);
  root.append(tokenWrap);
  const dd = enhanceSelect(worth, { small: true });
  dd.root.hidden = !token;

  if (o.single && !o.noUnused) root.append(tick(str('coinsetup.not_used'), unused, (on) => { unused = on; }));

  return { root, value };
}

export function slotList(slots: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const n of slots) {
    const last = runs[runs.length - 1];
    if (last && last[1] === n - 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ');
}

function warningLines(said: readonly (string | null)[]): HTMLElement[] {
  const saying = new Map<string, number[]>();
  said.forEach((text, i) => {
    if (text) saying.set(text, [...(saying.get(text) ?? []), i + 1]);
  });
  return [...saying].map(([text, slots]) => {
    const w = document.createElement('p');
    w.className = 'coin-grid-warning';
    const who = document.createElement('strong');
    who.textContent = slots.length === 1
      ? str('coinsetup.coin_slot_n_colon', { 0: slots[0] })
      : str('coinsetup.coin_slots_colon', { 0: slotList(slots) });
    const line = document.createElement('span');
    line.append(who, ` ${text}`);
    w.append(rowIcon(UI_ICONS.warn, 'coin-grid-warn', 16), line);
    return w;
  });
}

export interface SlotCards {
  root: HTMLElement;
  cards: HTMLElement[];
  repaint(): void;
}

export function slotCards(o: {
  slots: readonly { start: readonly SlotCoin[]; control?: HTMLElement }[];
  takes: ReadonlySet<number> | null;
  token: boolean;
  lost: (slot: number, coins: readonly SlotCoin[]) => readonly SlotCoin[];
  warning: (slot: number, coins: readonly SlotCoin[]) => string | null;
  footer: (slot: number, coins: readonly SlotCoin[]) => Node | string | null;
  onChange: (slot: number, coins: SlotCoin[]) => void;
}): SlotCards {
  const root = document.createElement('div');
  root.className = 'slot-cards';
  const states: { paint: () => void }[] = [];
  const repaint = (): void => {
    for (const s of states) s.paint();
  };

  const cards = o.slots.map((slot, i) => {
    const box = document.createElement('div');
    box.className = 'slot-card nb-group';
    const head = document.createElement('div');
    head.className = 'slot-card-head';
    const name = document.createElement('span');
    name.className = 'slot-card-name';
    const kind = document.createElement('span');
    kind.className = 'slot-card-kind';
    kind.textContent = ` \u00b7 ${slotCoinLabel({ token: null })}`;
    name.append(str('coinsetup.slot_n', { 0: i + 1 }), kind);
    head.append(name);
    if (slot.control) head.append(slot.control);
    const chips = document.createElement('div');
    chips.className = 'slot-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', str('coinsetup.slot_n', { 0: i + 1 }));
    const foot = document.createElement('p');
    foot.className = 'slot-card-foot';
    const warn = document.createElement('p');
    warn.className = 'coin-grid-warning slot-card-warning';
    const said = document.createElement('span');
    warn.append(rowIcon(UI_ICONS.warn, 'coin-grid-warn', 16), said);
    box.append(head, chips, foot, warn);

    const cash = new Set<number>(slot.start.filter((c): c is number => typeof c === 'number'));
    const startToken = slot.start.find(isTokenCoin);
    let token: { token: number | null } | null = startToken ? { token: startToken.token } : null;
    const value = (): SlotCoin[] => [...CASH_COINS.filter((p) => cash.has(p)), ...(token ? [{ token: token.token }] : [])];

    const painters: ((lost: readonly SlotCoin[]) => void)[] = [];
    const chip = (label: string, refused: boolean, on: () => boolean, flip: () => void, isLost: (lost: readonly SlotCoin[]) => boolean): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot-chip';
      b.textContent = label;
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-label', str('coinsetup.coin_slot_takes', { 0: i + 1, 1: label }));
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        flip();
        o.onChange(i, value());
        repaint();
      });
      chips.append(b);
      painters.push((lost) => {
        const lit = on();
        const shut = refused && !lit;
        b.setAttribute('aria-disabled', String(shut));
        b.setAttribute('aria-checked', String(lit));
        b.dataset.state = shut ? 'shut' : !lit ? 'off' : isLost(lost) ? 'warn' : 'on';
      });
    };
    for (const p of CASH_COINS) {
      chip(cashLabel(p), !!o.takes && !o.takes.has(p), () => cash.has(p), () => {
        if (cash.has(p)) cash.delete(p);
        else { cash.add(p); token = null; }
      }, (lost) => lost.includes(p));
    }
    chip(str('coinsetup.tok'), !o.token, () => !!token, () => {
      if (token) token = null;
      else { token = { token: null }; cash.clear(); }
    }, (lost) => lost.some(isTokenCoin));
    states.push({
      paint: () => {
        const coins = value();
        const lost = o.lost(i, coins);
        for (const paint of painters) paint(lost);
        kind.hidden = !token;
        const f = o.footer(i, coins);
        foot.replaceChildren(...(f === null ? [] : [f]));
        foot.hidden = f === null;
        const w = o.warning(i, coins);
        said.textContent = w ?? '';
        warn.hidden = w === null;
      },
    });
    root.append(box);
    return box;
  });
  repaint();
  return { root, cards, repaint };
}

export interface CoinGrid {
  root: HTMLElement;
  rows: HTMLElement[];
}

export function coinGrid(o: {
  slots: readonly { start: readonly SlotCoin[]; takes: ReadonlySet<number> | null; token?: boolean }[];
  lost: (slot: number) => readonly SlotCoin[];
  warning: (slot: number) => string | null;
  onChange: (slot: number, coins: SlotCoin[]) => void;
  tokenValue?: boolean;
}): CoinGrid {
  const root = document.createElement('div');
  root.className = 'coin-grid-card nb-group';
  const grid = document.createElement('div');
  grid.className = 'coin-grid';
  grid.setAttribute('role', 'grid');
  const tokens = document.createElement('div');
  tokens.className = 'coin-grid-tokens';
  const warnings = document.createElement('div');
  warnings.className = 'coin-grid-warnings';
  root.append(grid, tokens, warnings);

  const line = (): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'coin-grid-row';
    r.setAttribute('role', 'row');
    return r;
  };
  const head = line();
  const corner = document.createElement('span');
  corner.setAttribute('role', 'columnheader');
  head.append(corner);
  for (const p of CASH_COINS) {
    const c = document.createElement('span');
    c.setAttribute('role', 'columnheader');
    c.textContent = cashLabel(p);
    head.append(c);
  }
  const tokenHead = document.createElement('span');
  tokenHead.setAttribute('role', 'columnheader');
  tokenHead.setAttribute('aria-label', slotCoinLabel({ token: null }));
  tokenHead.textContent = str('coinsetup.tok');
  head.append(tokenHead);
  grid.append(head);

  const paints: (() => void)[] = [];
  const cells: HTMLButtonElement[][] = [];
  const settleTabStop = (): void => {
    const all = cells.flat();
    const stop = all.find((b) => b.tabIndex === 0 && !b.disabled) ?? all.find((b) => !b.disabled);
    for (const b of all) b.tabIndex = b === stop ? 0 : -1;
  };
  const repaint = (): void => {
    for (const paint of paints) paint();
    settleTabStop();
    warnings.replaceChildren(...warningLines(o.slots.map((_, i) => o.warning(i))));
  };

  const rows = o.slots.map((slot, i) => {
    const row = line();
    const name = document.createElement('span');
    name.className = 'coin-grid-slot';
    name.setAttribute('role', 'rowheader');
    name.textContent = str('coinsetup.slot_n', { 0: i + 1 });
    row.append(name);

    const cash = new Set<number>(slot.start.filter((c): c is number => typeof c === 'number'));
    const startToken = slot.start.find(isTokenCoin);
    let token: { token: number | null } | null = startToken ? { token: startToken.token } : null;
    const value = (): SlotCoin[] => [...CASH_COINS.filter((p) => cash.has(p)), ...(token ? [{ token: token.token }] : [])];

    const keep = startToken?.token ?? null;
    const worth = document.createElement('select');
    worth.className = 'coin-token-value';
    worth.setAttribute('aria-label', str('coinask.what_the_token_is_worth'));
    const none = document.createElement('option');
    none.value = '';
    none.textContent = str('coinask.no_value');
    worth.append(none);
    for (const p of TOKEN_VALUES) {
      if (slot.takes && !slot.takes.has(p) && token?.token !== p) continue;
      const opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = cashLabel(p);
      worth.append(opt);
    }
    worth.value = token?.token ? String(token.token) : '';
    const tokenRow = document.createElement('div');
    tokenRow.className = 'coin-grid-token';
    tokenRow.dataset.tokenSlot = String(i);
    const tokenName = document.createElement('span');
    tokenName.textContent = `${str('coinsetup.slot_n', { 0: i + 1 })} \u00b7 ${slotCoinLabel({ token: null })}`;
    tokenRow.append(tokenName, worth);
    if (o.tokenValue !== false) {
      tokens.append(tokenRow);
      enhanceSelect(worth, { small: true });
    }
    const changed = (): void => {
      o.onChange(i, value());
      repaint();
    };
    worth.addEventListener('change', () => {
      if (!token) return;
      token = { token: worth.value ? Number(worth.value) : null };
      changed();
    });

    const mine: HTMLButtonElement[] = [];
    const painters: ((lost: readonly SlotCoin[]) => void)[] = [];
    const cell = (coin: string, ask: string, on: () => boolean, flip: () => void, isLost: (lost: readonly SlotCoin[]) => boolean, refused: boolean): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'coin-cell';
      b.dataset.coin = coin;
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-label', str('coinsetup.coin_slot_takes', { 0: i + 1, 1: ask }));
      b.addEventListener('click', () => {
        flip();
        changed();
      });
      const wrap = document.createElement('div');
      wrap.setAttribute('role', 'gridcell');
      wrap.append(b);
      row.append(wrap);
      mine.push(b);
      painters.push((lost) => {
        const lit = on();
        const state = !lit ? 'off' : isLost(lost) ? 'warn' : 'on';
        const shut = refused && !lit;
        b.disabled = shut;
        b.setAttribute('aria-disabled', String(shut));
        if (b.dataset.state === state) return;
        b.dataset.state = state;
        b.setAttribute('aria-checked', String(lit));
        b.replaceChildren(...(state === 'on' ? [rowIcon(UI_ICONS.tick, 'coin-cell-icon', 16)] : state === 'warn' ? [rowIcon(UI_ICONS.warn, 'coin-cell-icon', 16)] : []));
      });
    };
    for (const p of CASH_COINS) {
      cell(cashLabel(p), cashLabel(p), () => cash.has(p), () => {
        if (cash.has(p)) cash.delete(p); else cash.add(p);
      }, (lost) => lost.includes(p), !!slot.takes && !slot.takes.has(p));
    }
    cell(slotCoinLabel({ token: null }), slotCoinLabel({ token: null }), () => !!token, () => {
      token = token ? null : { token: o.tokenValue === false ? keep : worth.value ? Number(worth.value) : null };
    }, (lost) => lost.some(isTokenCoin), slot.token === false);
    cells.push(mine);
    paints.push(() => {
      const lost = o.lost(i);
      for (const paint of painters) paint(lost);
      tokenRow.hidden = !token;
    });
    grid.append(row);
    return row;
  });

  grid.addEventListener('keydown', (ev) => {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
    const from = ev.target as HTMLButtonElement;
    const r = cells.findIndex((c) => c.includes(from));
    if (!step || r < 0) return;
    ev.preventDefault();
    let [y, x] = [r, cells[r].indexOf(from)];
    for (;;) {
      y += step[0];
      x += step[1];
      const to = cells[y]?.[x];
      if (!to) return;
      if (to.disabled) continue;
      for (const b of cells.flat()) b.tabIndex = -1;
      to.tabIndex = 0;
      to.focus();
      return;
    }
  });

  repaint();
  return { root, rows };
}

export function payoutDefaultNote(
  row: { kind: 'tube' | 'token-tube' | 'hopper' | 'token-hopper'; defaultPence?: number | null; defaultFrom?: 'layout' | 'machine' },
  typed: number | undefined,
): string | null {
  if (typed === undefined || typeof row.defaultPence !== 'number' || typed === row.defaultPence) return null;
  const part = row.kind.endsWith('hopper') ? str('coinsetup.hopper') : str('coinsetup.tube');
  const args = { coin: cashLabel(row.defaultPence), part };
  return row.defaultFrom === 'machine'
    ? str('coinsetup.machine_reports_value_used', args)
    : str('coinsetup.layout_says_value_used', args);
}
