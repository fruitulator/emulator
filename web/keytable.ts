import type { MachineInfo } from './emu-protocol';
import type { PlatformView } from './platform';
import type { CabLamp } from './dat';
import { controlNaming, type NameSource } from './controlname';
import { acceptorResolve } from './platform';
import { capShortcuts, shortcutLabel } from './shortcuts';
import { card } from './ui/rows';
import { str } from './i18n';

export const PLAIN_BUTTON = str('keytable.button');

export interface MachineControl {
  id: string;
  kind: 'coin' | 'button';
  name: string | null;
  source: NameSource;
  keys: string[];
  lamps: CabLamp<unknown>[];
}

function keyRank(k: string): number {
  if (/^\d$/.test(k)) return k.charCodeAt(0) - 48;
  if (/^[A-Z]$/.test(k)) return 10 + k.charCodeAt(0) - 65;
  if (k === 'SPACE') return 40;
  if (k.startsWith('NUM ')) return 50 + Number(k.slice(4));
  return 100 + k.charCodeAt(0);
}

export function controlId(
  lp: CabLamp<unknown>, view: PlatformView,
  o: { coins?: MachineInfo['coins']; coinPort?: MachineInfo['coinPort'] } = {},
): string | null {
  if (lp.acceptor) {
    const got = acceptorResolve(view, lp as CabLamp, o.coins, o.coinPort);
    return `${got.kind === 'note' ? 'note' : 'coin'}:${got.line}`;
  }
  return lp.button === undefined ? null : `btn:${lp.button}`;
}

export function machineControls(
  lamps: readonly CabLamp<unknown>[],
  view: PlatformView,
  o: {
    coins?: MachineInfo['coins'];
    nameCoins?: MachineInfo['coins'];
    coinPort?: MachineInfo['coinPort'];
    capNames?: MachineInfo['capNames'];
  } = {},
): { rows: MachineControl[]; winner: Map<string, string> } {
  const controls = new Map<string, MachineControl>();
  const winner = new Map<string, string>();
  for (const lp of lamps) {
    if (lp.shortcut === undefined) continue;
    const id = controlId(lp, view, o);
    if (!id) continue;
    let c = controls.get(id);
    if (!c) {
      const n = controlNaming(lp as CabLamp, view, o.nameCoins ?? view.coins, o.capNames, o.coinPort);
      c = {
        id,
        kind: lp.acceptor ? 'coin' : 'button',
        name: n.source === 'none' ? null : n.label,
        source: n.source,
        keys: [],
        lamps: [],
      };
      controls.set(id, c);
    }
    c.lamps.push(lp);
    for (const vk of capShortcuts(lp)) {
      const key = shortcutLabel(vk);
      if (!key) continue;
      if (!winner.has(key)) winner.set(key, id);
      if (!c.keys.includes(key)) c.keys.push(key);
    }
  }
  const rows = [...controls.values()]
    .filter((c) => c.keys.length)
    .map((c) => ({ ...c, keys: [...c.keys].sort((a, b) => keyRank(a) - keyRank(b)) }))
    .sort((a, b) => keyRank(a.keys[0]) - keyRank(b.keys[0]));
  return { rows, winner };
}

export function controlCaption(c: Pick<MachineControl, 'name' | 'source'>, pictured: boolean): string | null {
  if (pictured) return c.source === 'board' ? null : c.name;
  return c.name ?? PLAIN_BUTTON;
}

export interface KeyTableRow {
  label: string;
  chords: string[][];
}

export function fillKeyTable(root: HTMLElement, groups: readonly { title: string; rows: KeyTableRow[] }[]): void {
  root.replaceChildren();
  const sep = (t: string): HTMLSpanElement => {
    const e = document.createElement('span');
    e.className = 'key-sep';
    e.textContent = t;
    return e;
  };
  for (const g of groups) {
    const c = card();
    if (groups.length > 1) {
      const cap = document.createElement('div');
      cap.className = 'menu-subhead';
      cap.textContent = g.title;
      root.append(cap);
    }
    root.append(c);
    fillGroup(c, g.rows, sep);
  }
}

function fillGroup(c: HTMLElement, rows: readonly KeyTableRow[], sep: (t: string) => HTMLSpanElement): void {
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'menu-row menu-kbd nb-kv';
    const l = document.createElement('span');
    l.className = 'row-label';
    l.textContent = row.label;
    const k = document.createElement('span');
    k.className = 'row-keys';
    row.chords.forEach((chord, i) => {
      const alt = (e: HTMLElement): HTMLElement => { if (i) e.classList.add('key-alt'); return e; };
      if (i) k.append(alt(sep('/')));
      chord.forEach((capText, j) => {
        if (j) k.append(alt(sep('+')));
        const kbd = document.createElement('kbd');
        kbd.className = 'nb-key';
        kbd.textContent = capText;
        k.append(alt(kbd));
      });
    });
    r.append(l, k);
    c.append(r);
  }
}
