import type { MachineInfo } from './emu-protocol';
import type { PlatformView } from './platform';
import type { CabinetEffects } from './effects';
import { caption, card, checkRow } from './ui/rows';
import type { NamingSlot } from './coinslots';
import { namedCoinLabel } from './coinask';
import { MENU_ICONS } from './ui/icons';
import { hasOperatedSwitches, layoutNamedInputs, namedInputId, testLabelsForPanel, testRowsForPanel } from './switchids';
import { reelBounceOn, setReelBounceOn } from './bouncepref';
import { reelPeekOn, setReelPeekOn } from './peekpref';
import { reelBandsOn, setReelBandsOn } from './bandspref';
import { fillScreenOn, setFillScreenOn } from './fillpref';
import { cropViewOn, setCropViewOn } from './croppref';
import { str } from './i18n';
import { PANEL_SHOW } from './ui/drawer';

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = coinClass(label);
  const two = /^(\S+)\s+(\S.*)$/.exec(label.trim());
  if (two) {
    const v = document.createElement('span');
    v.className = 'nb-coin__v';
    v.textContent = two[1];
    const w = document.createElement('span');
    w.className = 'nb-coin__w';
    w.textContent = two[2];
    b.append(v, w);
    b.setAttribute('aria-label', label);
  } else {
    b.textContent = label;
  }
  b.addEventListener('click', onClick);
  return b;
}

function fitCoins(coins: HTMLElement): void {
  for (const b of coins.querySelectorAll<HTMLElement>(':scope > .nb-coin:not([data-fit])')) {
    if (b.children.length || !b.firstChild) continue;
    const room = b.clientWidth * 0.78;
    if (!room) continue;
    b.dataset.fit = '';
    const range = document.createRange();
    range.selectNodeContents(b);
    const wide = range.getBoundingClientRect().width;
    if (wide > room) b.style.fontSize = `${parseFloat(getComputedStyle(b).fontSize) * room / wide}px`;
  }
}

function coinClass(label: string): string {
  if (/token/i.test(label)) return 'nb-coin nb-coin--token';
  if (/^£\s*[12](\.00)?$/.test(label.trim())) return 'nb-coin';
  return 'nb-coin nb-coin--silver';
}

export function coinsPanel(
  info: MachineInfo, view: PlatformView, system: string | undefined,
  onCoin: (c: { label: string; bit: number }) => void,
  own?: () => OwnCoins | null,
  naming?: CoinNaming,
  money: HTMLElement | null = null,
): HTMLElement {
  const coins = document.createElement('div');
  coins.className = 'nb-coins';
  const grid = coinsGrid(coins, info, view, system, onCoin, own);
  if (!money) return naming?.slots().length ? withNaming(grid, naming) : grid;
  const panel = document.createElement('div');
  panel.className = 'menu-stack coins-panel';
  panel.append(grid);
  if (money) {
    money.classList.add('coin-money');
    panel.append(money);
  }
  panel.addEventListener(PANEL_SHOW, () => grid.dispatchEvent(new Event(PANEL_SHOW)));
  return naming?.slots().length ? withNaming(panel, naming) : panel;
}

function coinsGrid(
  coins: HTMLElement, info: MachineInfo, view: PlatformView, system: string | undefined,
  onCoin: (c: { label: string; bit: number }) => void,
  own?: () => OwnCoins | null,
): HTMLElement {
  const fill = (): boolean => {
    const mine = own?.();
    if (!mine) return false;
    coins.replaceChildren();
    for (const c of mine.coins) coins.append(button(c.label, () => { onCoin(c); fill(); }));
    if (mine.note) {
      const p = document.createElement('div');
      p.className = 'menu-row menu-kbd';
      p.textContent = mine.note;
      coins.append(p);
    }
    return true;
  };
  if (own) coins.addEventListener(PANEL_SHOW, () => { fill(); });
  coins.addEventListener(PANEL_SHOW, () => requestAnimationFrame(() => fitCoins(coins)));
  if (fill()) return coins;
  const list = machineCoins(info, view);
  for (const c of list) coins.append(button(c.label, () => onCoin(c)));
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'menu-row menu-kbd';
    p.textContent = view.unread
      ? str('menupanels.no_coin_list_is_known', { 0: system || str('menupanels.this_board') })
      : COINS_ON_GLASS;
    coins.append(p);
  }
  return coins;
}

export interface CoinNaming {
  slots(): readonly NamingSlot[];
  change(line: number, at: { x: number; y: number } | null, done: () => void): void;
}

function withNaming(grid: HTMLElement, naming: CoinNaming): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'menu-stack';
  const cap = caption(str('menupanels.coin_slots'));
  const box = card();
  const fill = (): void => {
    const slots = naming.slots();
    cap.hidden = box.hidden = !slots.length;
    box.replaceChildren(...slots.map((s, i) => {
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 'menu-row menu-stat nb-kv coin-name-row';
      const l = document.createElement('span');
      l.className = 'row-label';
      l.textContent = slots.length === 1 ? str('menupanels.coin_slot') : str('menupanels.coin_slot_n', { 0: i + 1 });
      const v = document.createElement('span');
      v.className = 'row-value';
      v.textContent = s.coin === null ? str('menupanels.not_set') : namedCoinLabel(s.coin);
      r.append(l, v);
      r.addEventListener('click', (ev) => {
        const b = r.getBoundingClientRect();
        const at = ev.detail > 0 ? { x: ev.clientX, y: ev.clientY } : { x: b.left + b.width * 0.75, y: b.top + b.height / 2 };
        naming.change(s.line, at, fill);
      });
      return r;
    }));
  };
  fill();
  wrap.append(grid, cap, box);
  wrap.addEventListener(PANEL_SHOW, () => {
    grid.dispatchEvent(new Event(PANEL_SHOW));
    fill();
  });
  return wrap;
}

export interface OwnCoins { coins: readonly { label: string; bit: number }[]; note?: string }

export function machineCoins(info: MachineInfo | null | undefined, view: PlatformView): readonly { label: string; bit: number }[] {
  return info?.coins ?? view.coins;
}

export const COINS_ON_GLASS = str('menupanels.coins_go_in_through_the');

export interface SwitchPanel {
  name: string;
  icon: string;
  panel: HTMLElement;
}

function shownLabel(sw: { id: number; label: string }): string {
  const text = sw.label.trim();
  if (/^\d*$/.test(text)) return str('menupanels.switch_n', { 0: sw.id });
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function switchPanels(
  info: MachineInfo, view: PlatformView,
  onPanel: (sw: MachineInfo['switchPanel'][number], on: boolean) => void,
  onNamed: (id: number, level: boolean) => void,
): SwitchPanel[] {
  if (hasOperatedSwitches(info)) {
    const groups = new Map<string, HTMLElement>();
    const testNames = testLabelsForPanel(view.namedInputs, info.switchIds ?? {}, info.switchPanel.filter((s) => !s.option));
    for (const sw of info.switchPanel.filter((s) => !s.option)) {
      const name = sw.group || str('menupanels.switches');
      let panel = groups.get(name);
      if (!panel) {
        panel = card();
        groups.set(name, panel);
      }
      const { row, box } = checkRow(testNames.get(sw.id) ?? shownLabel(sw), (checked) => onPanel(sw, checked));
      box.checked = sw.on;
      panel.append(row);
    }
    const tests = testRowsForPanel(view.namedInputs, info.switchIds ?? {}, info.switchPanel.map((s) => s.id));
    if (tests.length) {
      let panel = groups.get('Switches');
      if (!panel) { panel = card(); groups.set('Switches', panel); }
      for (const n of tests) {
        const { row } = checkRow(n.label, (checked) => onNamed(namedInputId(n), n.invert ? !checked : checked));
        panel.append(row);
      }
    }
    return [...groups].map(([name, panel]) => ({
      name, icon: /dil/i.test(name) ? MENU_ICONS.dil : MENU_ICONS.switches, panel,
    }));
  }
  const switches = card();
  for (const n of layoutNamedInputs(view.namedInputs, info.switchIds ?? {}, info.switchPresets)) {
    const { row } = checkRow(n.label, (checked) => {
      onNamed(namedInputId(n), n.invert ? !checked : checked);
    });
    switches.append(row);
  }
  if (!switches.childElementCount) {
    const p = document.createElement('div');
    p.className = 'menu-row menu-kbd';
    p.textContent = str('menupanels.this_machine_has_no_switches');
    switches.append(p);
  }
  return [{ name: str('menupanels.switches'), icon: MENU_ICONS.switches, panel: switches }];
}

export const EFFECTS_KEY = 'fruitulator.cabinetEffects';

export function restoreCabinetSounds(effects: CabinetEffects): void {
  try { effects.setEnabled(localStorage.getItem(EFFECTS_KEY) !== 'off'); } catch {  }
}

export function cabinetSoundsRow(effects: CabinetEffects): HTMLLabelElement {
  const { row, box } = checkRow(str('menupanels.cabinet_sounds'), (on) => {
    effects.setEnabled(on);
    try { localStorage.setItem(EFFECTS_KEY, on ? 'on' : 'off'); } catch {  }
  });
  box.checked = effects.enabled;
  row.title = str('menupanels.reel_button_coin_meter_and');
  return row;
}

export function reelBounceRow(redraw: () => void): HTMLLabelElement {
  const { row, box } = checkRow(str('menupanels.reel_bounce'), (on) => {
    setReelBounceOn(on);
    redraw();
  });
  box.checked = reelBounceOn();
  row.title = str('menupanels.the_small_settle_a_reel');
  return row;
}

export function fillScreenRow(refit: () => void): HTMLLabelElement {
  const { row, box } = checkRow(str('menupanels.fill_screen'), (on) => {
    setFillScreenOn(on);
    refit();
  });
  box.checked = fillScreenOn();
  row.title = str('menupanels.stretch_the_machine_to_fill');
  return row;
}

export function cropRow(recrop: () => void): HTMLLabelElement {
  const { row, box } = checkRow(str('menupanels.crop'), (on) => {
    setCropViewOn(on);
    recrop();
  });
  box.checked = cropViewOn();
  row.title = str('menupanels.show_just_the_machine_without');
  return row;
}

export function reelBandsRow(refit: () => void): HTMLLabelElement {
  const { row, box } = checkRow(str('menupanels.reel_bands'), (on) => {
    setReelBandsOn(on);
    refit();
  });
  box.checked = reelBandsOn();
  row.title = str('menupanels.each_reel_s_whole_band');
  return row;
}

export function reelPeekRow(): HTMLLabelElement {
  const { row, box } = checkRow(str('menupanels.reel_peek'), (on) => setReelPeekOn(on));
  box.checked = reelPeekOn();
  row.title = str('menupanels.drag_a_reel_to_see');
  return row;
}
