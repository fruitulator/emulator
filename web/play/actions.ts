import type { MachineInfo } from '../emu-protocol';
import type { PlatformView } from '../platform';
import type { CabinetEffects } from '../effects';
import type { Snapshot } from '../snapshot';
import type { DiagEntry } from '../diaglog';
import type { Game } from '../../src/machine/registry';
import { card, menuRow } from '../ui/rows';
import { MENU_ICONS } from '../ui/icons';
import { cabinetSoundsRow, coinsPanel, reelBounceRow, switchPanels, type OwnCoins } from '../menupanels';
import { downloadRow, uploadRow, type PanelDownload, type PanelUpload } from '../panelmenu';
import { saveDiagLog, saveSnapshot } from '../downloads';
import { UNBUILT_NOTE_TEXT, stopNoteParts } from '../stopnote';
import { statusRow } from '../ui/status';
import { str } from '../i18n';

export type CoinChoice = { label: string; bit: number };
export type PanelSwitch = MachineInfo['switchPanel'][number];

export interface ActionSurface {
  readonly emu: { snapshot(): Promise<Snapshot | null>; diagLog(): Promise<DiagEntry[]> };
  game(): Game | null;
  sound(): string;
  running(): boolean;
  closeMenu(): void;
  coin(c: CoinChoice): void;
  coinList?(): OwnCoins | null;
  throwSwitch(sw: PanelSwitch, on: boolean): void;
  namedSwitch(id: number, level: boolean): void;
  readonly effects: CabinetEffects;
  redraw(): void;
  optionRows?(m: MenuMachine): Node[];
  fillKeys(root: HTMLElement): void;
  openSystem(): void;
  reboot(): void;
  leave(): void;
  stateSaved?(snap: Snapshot): void;
  loadState?(file: File): void;
}

export type ActionId =
  | 'coins' | 'switches' | 'options' | 'keyboard' | 'download'
  | 'system' | 'reboot' | 'quit' | 'stepBack';

export const ACTIONS: Record<Exclude<ActionId, 'switches'>, { label: string; icon: string; sub?: string }> = {
  coins: { label: str('play.actions.coins'), icon: MENU_ICONS.coins },
  options: { label: str('play.actions.options'), icon: MENU_ICONS.options },
  keyboard: { label: str('play.actions.keyboard'), icon: MENU_ICONS.keyboard },
  download: { label: str('play.actions.download'), icon: MENU_ICONS.download },
  system: { label: str('play.actions.system_status'), icon: MENU_ICONS.activity },
  reboot: { label: str('play.actions.reboot_machine'), icon: MENU_ICONS.reboot },
  quit: { label: str('play.actions.quit_game'), icon: MENU_ICONS.back, sub: str('play.actions.the_machine_will_resume_on') },
  stepBack: { label: str('play.actions.leave_machine'), icon: MENU_ICONS.back, sub: str('play.actions.the_machine_stays_as_you') },
};

export type MenuItem =
  | { kind: 'nav'; id: ActionId; label: string; icon: string; panel: HTMLElement; disabled?: boolean }
  | { kind: 'row'; id: ActionId; label: string; icon: string; sub?: string; run(): void; disabled?: boolean }
  | { kind: 'note'; id: 'unbuilt'; label: string; disabled?: undefined };

export function unbuiltNote(info: Pick<MachineInfo, 'boardDefaults'>): MenuItem | null {
  return stopNoteParts(info.boardDefaults).length
    ? { kind: 'note', id: 'unbuilt', label: UNBUILT_NOTE_TEXT }
    : null;
}

export interface MenuMachine {
  info: MachineInfo;
  view: PlatformView;
  system: string | undefined;
}

export function saveState(s: ActionSurface): Promise<boolean> {
  if (!s.running()) return Promise.resolve(false);
  return saveSnapshot(s.emu).then((snap) => {
    if (!snap) return false;
    s.stateSaved?.(snap);
    return true;
  });
}

export function saveLog(s: ActionSurface): Promise<number> {
  return saveDiagLog(s.emu, s.game(), s.sound());
}

export function stateDownload(s: ActionSurface): PanelDownload {
  return { label: str('play.actions.machine_state'), run: () => saveState(s) };
}

export function stateUpload(s: ActionSurface): PanelUpload {
  return { label: str('play.actions.load_state'), accept: '.json', pick: (f) => s.loadState?.(f) };
}

export function logDownload(s: ActionSurface): PanelDownload {
  return { label: str('play.actions.diagnostics_log'), run: () => saveLog(s).then(() => true) };
}

export function menuItems(s: ActionSurface, m: MenuMachine, ids: readonly ActionId[]): MenuItem[] {
  const out: MenuItem[] = [];
  const note = unbuiltNote(m.info);
  if (note) out.push(note);
  const nav = (id: Exclude<ActionId, 'switches'>, panel: HTMLElement): void => {
    out.push({ kind: 'nav', id, label: ACTIONS[id].label, icon: ACTIONS[id].icon, panel });
  };
  const row = (id: Exclude<ActionId, 'switches'>, run: () => void): void => {
    const a = ACTIONS[id];
    out.push({ kind: 'row', id, label: a.label, icon: a.icon, ...(a.sub ? { sub: a.sub } : {}), run });
  };
  for (const id of ids) {
    switch (id) {
      case 'coins':
        nav('coins', coinsPanel(m.info, m.view, m.system, (c) => s.coin(c), s.coinList ? () => s.coinList!() : undefined));
        break;
      case 'switches':
        for (const p of switchPanels(m.info, m.view, (sw, on) => s.throwSwitch(sw, on),
          (line, level) => s.namedSwitch(line, level))) {
          out.push({ kind: 'nav', id, label: p.name, icon: p.icon, panel: p.panel });
        }
        break;
      case 'options': {
        const opts = card();
        for (const r of s.optionRows?.(m) ?? []) opts.append(r);
        opts.append(cabinetSoundsRow(s.effects));
        opts.append(reelBounceRow(() => s.redraw()));
        nav('options', opts);
        break;
      }
      case 'keyboard': {
        const keys = document.createElement('div');
        keys.className = 'menu-stack';
        s.fillKeys(keys);
        nav('keyboard', keys);
        break;
      }
      case 'download': {
        const dl = card();
        dl.classList.add('pm-rows');
        dl.append(downloadRow(stateDownload(s), 0), downloadRow(logDownload(s), 1));
        if (s.loadState) dl.append(uploadRow(stateUpload(s), 2));
        nav('download', dl);
        break;
      }
      case 'system':
        row('system', () => s.openSystem());
        break;
      case 'reboot':
        row('reboot', () => {
          s.reboot();
          s.closeMenu();
        });
        break;
      case 'quit':
      case 'stepBack':
        row(id, () => {
          s.closeMenu();
          s.leave();
        });
        break;
    }
  }
  return out;
}

export function disabledItems(ids: readonly ActionId[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const id of ids) {
    if (id === 'switches') continue;
    const a = ACTIONS[id];
    if (id === 'system' || id === 'reboot' || id === 'quit' || id === 'stepBack') {
      out.push({ kind: 'row', id, label: a.label, icon: a.icon, ...(a.sub ? { sub: a.sub } : {}), run: () => {}, disabled: true });
    } else {
      out.push({ kind: 'nav', id, label: a.label, icon: a.icon, panel: document.createElement('div'), disabled: true });
    }
  }
  return out;
}

function disable(b: HTMLElement): void {
  (b as HTMLButtonElement).disabled = true;
  b.setAttribute('aria-disabled', 'true');
}

export function appendItems(
  content: HTMLElement, items: readonly MenuItem[],
  navRow: (label: string, icon: string, panel: HTMLElement) => HTMLElement,
): void {
  let navCard: HTMLElement | null = null;
  for (const it of items) {
    if (it.kind === 'note') {
      navCard = null;
      const c = card();
      c.append(statusRow('warn', it.label, null, null));
      content.append(c);
      continue;
    }
    if (it.kind === 'nav') {
      if (!navCard) {
        navCard = card();
        content.append(navCard);
      }
      const b = navRow(it.label, it.icon, it.panel);
      if (it.disabled) disable(b);
      navCard.append(b);
      continue;
    }
    navCard = null;
    const c = card();
    const r = menuRow(it.label, it.icon, it.run, false);
    if (it.sub) {
      const sub = document.createElement('span');
      sub.className = 'row-sub';
      sub.textContent = it.sub;
      r.querySelector('.row-label')!.append(sub);
    }
    if (it.disabled) disable(r);
    c.append(r);
    content.append(c);
  }
}
