import type { MachineInfo } from './emu-protocol';
import type { PlatformView } from './platform';
import type { CabinetEffects } from './effects';
import { card, checkRow } from './ui/rows';
import { MENU_ICONS } from './ui/icons';
import { hasOperatedSwitches, layoutNamedInputs, namedInputId, testLabelsForPanel, testRowsForPanel } from './switchids';
import { reelBounceOn, setReelBounceOn } from './bouncepref';
import { str } from './i18n';
import { PANEL_SHOW } from './ui/drawer';

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function coinsPanel(
  info: MachineInfo, view: PlatformView, system: string | undefined,
  onCoin: (c: { label: string; bit: number }) => void,
  own?: () => OwnCoins | null,
): HTMLElement {
  const coins = document.createElement('div');
  coins.className = 'menu-grid';
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
      const { row, box } = checkRow(testNames.get(sw.id) ?? sw.label, (checked) => onPanel(sw, checked));
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
  for (const n of layoutNamedInputs(view.namedInputs, info.switchIds ?? {})) {
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
