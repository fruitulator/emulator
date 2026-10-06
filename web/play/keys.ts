import { hasInput, type CabLamp, type Rect } from '../dat';
import type { PlatformView } from '../platform';
import { KeyHintLayer, keyHints, type HintPlace } from '../keyhints';
import { browserActivatesOnKey, chordCaps, enterWorksTheControl, keyBelongsToTheMachine, capShortcuts, matchesShortcut } from '../shortcuts';
import type { KeyTableRow } from '../keytable';
import { str } from '../i18n';

export type KeyEv = Pick<KeyboardEvent,
  'key' | 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target' | 'preventDefault'>;

export interface HintMachine {
  lamps: readonly CabLamp<unknown>[];
  content: Rect;
  view: PlatformView;
  opts: Parameters<typeof keyHints>[3];
}

export interface KeySurface {
  lamps(): readonly CabLamp[] | null;
  running(): boolean;
  onScreen(): boolean;
  hasKeyboard(): boolean;
  pressable(lp: CabLamp): boolean;
  press(lp: CabLamp, pointerId: number): void;
  release(pointerId: number): void;
  hints(): { machine: HintMachine; place: HintPlace } | null;
}

export function showKeysRow(): KeyTableRow {
  return { label: str('play.keys.show_keyboard_shortcuts'), chords: [chordCaps(['alt'], '').filter(Boolean)] };
}

export function works(lp: CabLamp): boolean {
  return hasInput(lp) || !!lp.acceptor;
}

const boundCache = new WeakMap<readonly CabLamp[], readonly number[]>();
export function boundKeys(lamps: readonly CabLamp[]): readonly number[] {
  let got = boundCache.get(lamps);
  if (!got) {
    const vks = new Set<number>();
    for (const lp of lamps) if (works(lp)) for (const vk of capShortcuts(lp)) vks.add(vk);
    got = [...vks];
    boundCache.set(lamps, got);
  }
  return got;
}

export class PlayKeys {
  private readonly pointers = new Map<string, number>();
  private nextPointer = -1;

  constructor(private readonly surface: KeySurface, public layer: KeyHintLayer | null = null) {}

  private pointer(ev: KeyEv): number {
    const id = ev.code || ev.key;
    let p = this.pointers.get(id);
    if (p === undefined) {
      p = this.nextPointer--;
      this.pointers.set(id, p);
    }
    return p;
  }

  hit(ev: KeyEv): CabLamp | null {
    const lamps = this.surface.lamps();
    if (!lamps || !this.surface.running()) return null;
    for (const lp of lamps) {
      if (lp.shortcut === undefined || !this.surface.pressable(lp)) continue;
      for (const vk of capShortcuts(lp)) if (matchesShortcut(vk, ev as KeyboardEvent)) return lp;
    }
    return null;
  }

  private bound(): readonly number[] {
    const lamps = this.surface.lamps();
    return lamps ? boundKeys(lamps) : [];
  }

  keyDown(ev: KeyEv): boolean {
    if (ev.key === 'Alt') {
      if (this.surface.onScreen()) ev.preventDefault();
      if (!ev.repeat) this.showHints();
    }
    const machineHasTheKeyboard = this.surface.hasKeyboard();
    if (typeof HTMLInputElement !== 'undefined' && ev.target instanceof HTMLInputElement) {
      if (!machineHasTheKeyboard || !browserActivatesOnKey(ev.target)) return true;
      if ((ev.target.type === 'checkbox' || ev.target.type === 'radio')
          && enterWorksTheControl(ev)) {
        const box = ev.target;
        ev.preventDefault();
        if (!ev.repeat) {
          box.checked = box.type === 'radio' ? true : !box.checked;
          box.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
    }
    if (machineHasTheKeyboard && keyBelongsToTheMachine(ev, this.bound())) {
      ev.preventDefault();
    }
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const hit = this.hit(ev);
      if (hit) {
        ev.preventDefault();
        if (!ev.repeat) this.surface.press(hit, this.pointer(ev));
        return true;
      }
    }
    return false;
  }

  keyUp(ev: KeyEv): void {
    if (ev.key === 'Alt') {
      if (this.surface.onScreen()) ev.preventDefault();
      this.hideHints();
    }
    const p = this.pointers.get(ev.code || ev.key);
    if (p !== undefined) this.surface.release(p);
  }

  focusLost(): void {
    this.hideHints();
    for (const p of this.pointers.values()) this.surface.release(p);
  }

  reset(): void {
    for (const p of this.pointers.values()) this.surface.release(p);
    this.pointers.clear();
  }

  get hintsShown(): boolean {
    return !!this.layer?.shown;
  }

  showHints(): void {
    if (!this.layer || !this.surface.lamps() || !this.surface.running() || !this.surface.hasKeyboard()) return;
    const at = this.surface.hints();
    if (!at) return;
    const m = at.machine;
    this.layer.show(keyHints(m.lamps, m.content, m.view, m.opts), at.place);
  }

  hideHints(): void {
    this.layer?.hide();
  }

  refreshHints(): void {
    if (this.hintsShown) this.showHints();
  }

  watchWindow(win: Window = window, opts: { hideOnResize?: boolean } = {}): () => void {
    const blur = (): void => this.focusLost();
    const hide = (): void => this.hideHints();
    win.addEventListener('blur', blur);
    win.document.addEventListener('visibilitychange', hide);
    if (opts.hideOnResize !== false) win.addEventListener('resize', hide);
    return () => {
      win.removeEventListener('blur', blur);
      win.document.removeEventListener('visibilitychange', hide);
      win.removeEventListener('resize', hide);
    };
  }
}
