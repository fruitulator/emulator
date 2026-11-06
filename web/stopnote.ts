import { unbuiltParts } from '../src/machine/boarddefaults';
import { isNoteId } from '../src/machine/effects';
import type { UnbuiltPart } from '../src/machine/boarddefaults';
import { decodeLamp, type FrameLayout } from '../src/machine/framestate';
import { str } from './i18n';
import { BAR_PLACED_FROM_PX, barClearance, placeBar, type CabinetBox } from './ui/barplace';
import { holdClock } from './ui/holdclock';
import { UI_ICONS, rowIcon } from './ui/icons';

export interface StopSample {
  lampsRaw: Uint8Array;
  reels: readonly { travel: number }[];
  lampPhase?: number;
  layout?: Pick<FrameLayout, 'lampKind'>;
}

export const QUIET_MS = 25_000;

export class StopWatch {
  private lamps: Uint8Array | null = null;
  private travel = '';
  private phase = 0;
  private lastMotion = 0;
  private engaged = false;
  private everMoved = false;

  constructor(private readonly quietMs = QUIET_MS) {}

  reset(now: number): void {
    this.lamps = null;
    this.travel = '';
    this.phase = 0;
    this.lastMotion = now;
    this.engaged = false;
    this.everMoved = false;
  }

  engage(): void {
    this.engaged = true;
  }

  sample(v: StopSample, now: number): boolean {
    if (!this.lamps || this.lamps.length !== v.lampsRaw.length) {
      this.lamps = new Uint8Array(v.lampsRaw.length);
      this.lamps.set(v.lampsRaw);
      this.travel = v.reels.map((r) => r.travel).join(',');
      this.phase = v.lampPhase ?? 0;
      this.lastMotion = now;
      return false;
    }
    let moved = false;
    for (let i = 0; i < v.lampsRaw.length; i++) {
      if (this.lamps[i] !== v.lampsRaw[i]) { moved = true; break; }
    }
    const phase = v.lampPhase ?? 0;
    if (!moved && phase !== this.phase && v.layout) {
      const kind = v.layout.lampKind;
      for (let i = 0; i < v.lampsRaw.length; i++) {
        if (decodeLamp(kind, v.lampsRaw, i, this.phase) !== decodeLamp(kind, v.lampsRaw, i, phase)) {
          moved = true;
          break;
        }
      }
    }
    this.phase = phase;
    if (!moved) {
      const travel = v.reels.map((r) => r.travel).join(',');
      if (travel !== this.travel) moved = true;
      this.travel = travel;
    } else {
      this.travel = v.reels.map((r) => r.travel).join(',');
    }
    this.lamps.set(v.lampsRaw);
    if (moved) {
      this.lastMotion = now;
      this.everMoved = true;
      return false;
    }
    return this.engaged && this.everMoved && now - this.lastMotion >= this.quietMs;
  }

  resumed(now: number): void {
    this.lastMotion = now;
  }

  paused(now: number): false {
    this.lastMotion = now;
    return false;
  }

  get proven(): boolean { return this.everMoved; }

  get touched(): boolean { return this.engaged; }
}

export function judgeStop(
  watch: StopWatch, v: StopSample, now: number,
  o: { paused: boolean; quietIsWaiting: boolean },
): boolean {
  if (o.paused || o.quietIsWaiting) return watch.paused(now);
  return watch.sample(v, now);
}

export function stopNoteText(parts: readonly string[]): string {
  return parts.length ? UNBUILT_NOTE_TEXT : HALT_NOTE_TEXT;
}

export const HALT_NOTE_TEXT = str('stopnote.machine_halt_please_file_a');

export function offersState(reason: NoteReason | null, parts: readonly string[]): boolean {
  return reason === 'stopped' && !parts.length;
}

export const UNBUILT_NOTE_TEXT = str('stopnote.we_re_still_working_on');

const LOG_PART_NAMES: Record<UnbuiltPart, string> = {
  'payout unit': 'payout unit',
  'sound board': 'sound board',
  'security chip': 'characteriser',
  'lamp extender': 'lamp extender',
  'reel drive': 'reel multiplexer',
  'reel controller': 'reel controller',
  'seven-segment driver': 'seven-segment driver',
  'program decoder': 'program decoder',
};

export function unbuiltLogText(parts: readonly string[]): string {
  if (!parts.length) return '';
  const named = parts.map((p) => LOG_PART_NAMES[p as UnbuiltPart] ?? p);
  const withArticle = named.map((p) => `${article(p)} ${p}`);
  if (withArticle.length === 1) {
    return str('stopnote.this_cabinet_asks_for_n', { 0: withArticle[0] });
  }
  const list = `${withArticle.slice(0, -1).join(', ')} and ${withArticle[withArticle.length - 1]}`;
  return str('stopnote.this_cabinet_asks_for_n_2', { 0: list });
}

export type NoteReason = 'stopped' | 'unbuilt';

export function noteReason(stopped: boolean, _parts: readonly string[]): NoteReason | null {
  return stopped ? 'stopped' : null;
}

export function noteText(reason: NoteReason, parts: readonly string[]): string {
  return reason === 'stopped' ? stopNoteText(parts) : UNBUILT_NOTE_TEXT;
}

function article(part: string): string {
  return /^[aeiou]/i.test(part) ? 'an' : 'a';
}

export function stopNoteParts(
  boardDefaults: readonly { unbuilt?: string }[] | undefined,
): string[] {
  return unbuiltParts(boardDefaults ?? []);
}

export interface NoteIcon {
  paths: string;
  label: string;
  kind?: NoteKind;
}
type NoteKind = 'halt' | 'wait' | 'info' | 'warn' | 'error' | 'ok';

const HALT_ICON = { paths: UI_ICONS.failed, label: '' };
export const NOTE_INFO: NoteIcon = { paths: UI_ICONS.info, label: '', kind: 'info' };
export const NOTE_WARN: NoteIcon = { paths: UI_ICONS.warn, label: '', kind: 'warn' };
export const NOTE_ERROR: NoteIcon = { paths: UI_ICONS.failed, label: '', kind: 'error' };
export const NOTE_OK: NoteIcon = { paths: UI_ICONS.tick, label: '', kind: 'ok' };

const HIDE_MS = 240;

export class StopNote {
  private el: HTMLElement | null;
  private msg: HTMLElement | null;
  private shown = false;
  private dismissed = new Set<NoteReason>();
  private reason: NoteReason | null = null;
  private lastText = '';
  private stateBtn: HTMLButtonElement | null = null;
  private moreBtn: HTMLButtonElement | null = null;
  private offering = false;
  private buttonsBefore: { more: boolean; state: boolean } | null = null;
  private actBtn: HTMLButtonElement | null = null;
  private actRun: (() => void) | null = null;
  private closeRun: (() => void) | null = null;
  private hideTimer: (() => void) | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;
  private cabinet: (() => CabinetBox | null) | null = null;
  private placed = false;
  private anchor: CabinetBox | null = null;
  private following = false;
  private asking = false;
  private dim: HTMLElement | null = null;
  private lastToastH = '';

  constructor(
    root: Document | HTMLElement = document,
    onDetails?: () => void,
    onState?: () => void,
  ) {
    const q = (id: string): HTMLElement | null =>
      (root as Document).getElementById
        ? (root as Document).getElementById(id)
        : (root as HTMLElement).querySelector(`#${id}`);
    this.el = q('stopnote');
    this.msg = q('stopnote-msg');
    this.iconEl = q('stopnote-icon');
    const more = q('stopnote-more') as HTMLButtonElement | null;
    const close = q('stopnote-close') as HTMLButtonElement | null;
    this.closeBtn = close;
    this.stateBtn = q('stopnote-state') as HTMLButtonElement | null;
    this.moreBtn = more;
    this.actBtn = q('stopnote-act') as HTMLButtonElement | null;
    this.actBtn?.addEventListener('click', () => this.actRun?.());
    if (more && onDetails) more.addEventListener('click', () => onDetails());
    if (this.stateBtn && onState) this.stateBtn.addEventListener('click', () => onState());
    if (close) close.addEventListener('click', () => {
      const run = this.closeRun;
      this.dismiss();
      run?.();
    });
  }

  placeBeside(cabinet: () => CabinetBox | null): void {
    this.cabinet = cabinet;
    if (!this.el) return;
    this.dim = document.createElement('div');
    this.dim.id = 'stopnote-dim';
    this.dim.hidden = true;
    this.el.before(this.dim);
    window.addEventListener('resize', () => { if (this.shown) this.position(true); });
  }

  update(reason: NoteReason | null, text: string, offerState = false): string | null {
    if (reason !== null) { this.setIcon(reason === 'stopped' ? HALT_ICON : null); this.setKind(reason === 'stopped' ? 'halt' : null); }
    if (reason !== 'stopped') this.dismissed.delete('stopped');
    if (!reason || this.dismissed.has(reason)) {
      if (this.shown && !this.passing) this.hide();
      this.reason = null;
      return null;
    }
    if (this.shown && this.reason === reason) return null;
    this.hideTimer?.();
    this.hideTimer = null;
    if (this.closeBtn) this.closeBtn.hidden = false;
    this.restoreButtons();
    this.closeRun = null;
    this.reason = reason;
    this.asking = reason === 'stopped';
    this.offering = offerState;
    if (this.stateBtn) this.stateBtn.hidden = !offerState;
    this.show(text);
    return text;
  }

  notice(
    text: string,
    action?: { label: string; run: () => void; icon?: string },
    onClose?: () => void,
    hideAfterMs?: number,
    icon?: NoteIcon,
    fixed = false,
  ): void {
    if (this.shown && this.reason === 'stopped') return;
    if (this.shown && this.asking && hideAfterMs !== undefined) return;
    this.reason = null;
    this.asking = !!action;
    this.setIcon(icon ?? null);
    this.setKind(icon ? icon.kind ?? 'wait' : null);
    this.closeRun = onClose ?? null;
    this.hideTimer?.();
    this.hideTimer = null;
    if (this.closeBtn) this.closeBtn.hidden = hideAfterMs !== undefined || fixed;
    if (hideAfterMs !== undefined) {
      this.hideTimer = holdClock(this.el, hideAfterMs, () => {
        this.hideTimer = null;
        if (this.shown && this.reason === null && this.lastText === text) this.hide();
      });
    }
    if (!this.buttonsBefore) {
      this.buttonsBefore = { more: this.moreBtn?.hidden ?? true, state: this.stateBtn?.hidden ?? true };
    }
    this.actRun = action?.run ?? null;
    if (this.actBtn) {
      this.actBtn.hidden = !action;
      if (action?.icon) this.actBtn.replaceChildren(rowIcon(action.icon, 'stopnote-act-icon', 16), action.label);
      else if (action) this.actBtn.textContent = action.label;
    }
    if (this.moreBtn) this.moreBtn.hidden = true;
    if (this.stateBtn) this.stateBtn.hidden = true;
    this.offering = false;
    const again = this.shown && hideAfterMs !== undefined;
    this.show(text, hideAfterMs !== undefined);
    if (again) this.pulse();
  }

  dismiss(): void {
    if (this.reason) this.dismissed.add(this.reason);
    if (this.reason === 'stopped') this.dismissed.add('unbuilt');
    this.hide();
  }

  clear(): void {
    this.dismissed.clear();
    this.reason = null;
    if (!this.passing) this.hide();
  }

  get visible(): boolean { return this.shown; }
  get passing(): boolean { return this.shown && this.hideTimer !== null; }
  get text(): string { return this.lastText; }
  get saying(): NoteReason | null { return this.shown ? this.reason : null; }
  get offeringState(): boolean { return this.shown && this.offering; }

  private setIcon(icon: { paths: string; label: string } | null): void {
    const el = this.iconEl;
    if (!el) return;
    el.hidden = !icon;
    if (!icon) { el.replaceChildren(); el.removeAttribute('aria-label'); return; }
    if (icon.label) el.setAttribute('aria-label', icon.label);
    else el.removeAttribute('aria-label');
    el.replaceChildren(rowIcon(icon.paths, 'stopnote-icon-svg', 22));
  }

  private setKind(kind: NoteKind | null): void {
    const el = this.el;
    if (!el) return;
    el.classList.remove('nb-stopbar--halt', 'nb-stopbar--wait', 'nb-stopbar--info', 'nb-stopbar--warn', 'nb-stopbar--error', 'nb-stopbar--ok');
    if (kind) el.classList.add(`nb-stopbar--${kind}`);
  }

  private show(text: string, passing = false): void {
    this.lastText = text;
    const wasUp = this.shown;
    this.shown = true;
    if (this.msg) this.msg.textContent = text;
    if (!this.el) return;
    const el = this.el;
    if (wasUp && el.classList.contains('open')) {
      this.position(false);
      return;
    }
    el.hidden = false;
    this.position(true);
    el.classList.remove('leaving', 'settled');
    if (passing) el.classList.add('passing'); else el.classList.remove('passing');
    requestAnimationFrame(() => {
      if (!this.shown) return;
      el.classList.add('open');
      this.publishHeight();
    });
    el.addEventListener?.('animationend', this.onAnnounceEnd);
  }

  private position(fresh: boolean): void {
    const el = this.el;
    if (!el) return;
    const shown = [this.actBtn, this.stateBtn, this.moreBtn].filter((b) => b && !b.hidden).length;
    if (shown === 1) el.classList.add('one-action'); else el.classList.remove('one-action');
    el.classList.remove('actions-row');
    if (shown === 1 && el.scrollWidth > el.clientWidth + 1) {
      el.classList.remove('one-action');
      el.classList.add('actions-row');
    }
    const cab = this.cabinet && window.innerWidth >= BAR_PLACED_FROM_PX ? this.cabinet() : null;
    if (!cab) {
      if (this.placed) this.unplace();
    } else {
      if (fresh || !this.anchor) this.anchor = cab;
      this.placed = true;
      el.classList.add('over-glass');
      el.classList.toggle('asking', this.asking);
      el.style.setProperty('right', 'auto');
      el.style.setProperty('bottom', 'auto');
      el.style.setProperty('margin', '0');
      const actions = el.querySelector<HTMLElement>('.nb-stopbar__actions');
      if (actions) {
        el.classList.remove('stack-actions');
        if (shown > 1 && actions.scrollWidth > actions.clientWidth) el.classList.add('stack-actions');
      }
      const at = placeBar(
        { width: window.innerWidth, height: window.innerHeight }, this.anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
      );
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
      this.showDim(this.asking ? cab : null);
      this.follow();
    }
    this.publishHeight();
  }

  private showDim(cab: CabinetBox | null): void {
    const d = this.dim;
    if (!d) return;
    if (!cab) { d.classList.remove('open'); return; }
    d.style.left = `${cab.left}px`;
    d.style.top = `${cab.top}px`;
    d.style.width = `${cab.right - cab.left}px`;
    d.style.height = `${cab.bottom - cab.top}px`;
    d.style.clipPath = cab.outline
      ? `polygon(${cab.outline.map((p) => `${p.x - cab.left}px ${p.y - cab.top}px`).join(',')})`
      : '';
    if (d.hidden) {
      d.hidden = false;
      void d.offsetWidth;
    }
    d.classList.add('open');
  }

  private follow(): void {
    if (this.following) return;
    this.following = true;
    const tick = (): void => {
      if (!this.shown || !this.placed) { this.following = false; return; }
      const cab = this.cabinet && window.innerWidth >= BAR_PLACED_FROM_PX ? this.cabinet() : null;
      if (!cab) this.position(true);
      else this.showDim(this.asking ? cab : null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private unplace(): void {
    const el = this.el;
    this.placed = false;
    this.anchor = null;
    this.showDim(null);
    if (!el) return;
    el.classList.remove('over-glass', 'asking', 'stack-actions');
    for (const p of ['left', 'right', 'top', 'bottom', 'margin']) el.style.removeProperty(p);
  }

  private publishHeight(): void {
    const el = this.el;
    if (!el) return;
    const h = `${this.placed ? barClearance(el.offsetTop + el.offsetHeight) : el.offsetHeight}px`;
    if (h === this.lastToastH) return;
    this.lastToastH = h;
    document.documentElement.style.setProperty('--toast-h', h);
  }

  private pulse(): void {
    const el = this.el;
    if (!el?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
  }

  private readonly onAnnounceEnd = (e: AnimationEvent): void => {
    const el = this.el;
    if (!el || e.target !== el || !e.animationName.startsWith('toast-')) return;
    el.removeEventListener?.('animationend', this.onAnnounceEnd);
    if (this.shown && el.classList.contains('open')) el.classList.add('settled');
  };

  private restoreButtons(): void {
    this.actRun = null;
    if (this.actBtn) this.actBtn.hidden = true;
    if (this.closeBtn) this.closeBtn.hidden = false;
    if (!this.buttonsBefore) return;
    if (this.moreBtn) this.moreBtn.hidden = this.buttonsBefore.more;
    if (this.stateBtn) this.stateBtn.hidden = this.buttonsBefore.state;
    this.buttonsBefore = null;
  }

  private hide(): void {
    this.hideTimer?.();
    this.hideTimer = null;
    this.actRun = null;
    this.closeRun = null;
    this.shown = false;
    this.lastText = '';
    this.asking = false;
    this.showDim(null);
    if (!this.el) { this.restoreButtons(); return; }
    const el = this.el;
    if (el.classList.contains('open')) el.classList.add('leaving');
    el.classList.remove('open');
    window.setTimeout(() => {
      if (this.shown || el.classList.contains('open')) return;
      el.classList.remove('leaving', 'settled');
      el.classList.remove('passing');
      el.hidden = true;
      if (this.dim) this.dim.hidden = true;
      this.setIcon(null);
      this.restoreButtons();
    }, HIDE_MS);
  }
}

const COIN_REFUSED_MS = 6000;

export function sayCoinRefused(note: StopNote | null | undefined): void {
  if (!note) return;
  const text = str('stopnote.coin_refused');
  if (note.visible && !note.passing) return;
  note.notice(text, undefined, undefined, COIN_REFUSED_MS, NOTE_WARN);
}

export function sayCoinLocked(note: StopNote | null | undefined, acceptor: { note?: number } | undefined): void {
  if (acceptor?.note !== undefined && isNoteId(acceptor.note)) return;
  sayCoinRefused(note);
}
