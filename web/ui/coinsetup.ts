import { CASH_COINS, TOKEN_VALUES, cashLabel, slotCoinLabel, type SlotCoin } from '../coinask';
import { str } from '../i18n';
import { enhanceSelect } from './dropdown';

export interface CoinTicks {
  root: HTMLElement;
  value(): SlotCoin[];
}

let ids = 0;

export function coinTicks(o: {
  label: string; start: readonly SlotCoin[];
  onChange: (coins: SlotCoin[], unused: boolean) => void;
  single?: boolean; unused?: boolean;
}): CoinTicks {
  const root = document.createElement('div');
  root.className = 'coin-ticks';
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
    b.className = 'coin-tick';
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
    root.append(tick(cashLabel(p), cash.has(p), (on) => { if (on) cash.add(p); else cash.delete(p); }));
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
  const dd = enhanceSelect(worth);
  dd.root.hidden = !token;

  if (o.single) root.append(tick(str('coinsetup.not_used'), unused, (on) => { unused = on; }));

  return { root, value };
}
