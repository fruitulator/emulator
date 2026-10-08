import { unbuiltParts } from '../src/machine/boarddefaults';
import type { UnbuiltPart } from '../src/machine/boarddefaults';
import { str } from './i18n';
import { rowIcon } from './ui/icons';

export interface StopSample {
  lampsRaw: Uint8Array;
  reels: readonly { travel: number }[];
}

export const QUIET_MS = 25_000;

export class StopWatch {
  private lamps: Uint8Array | null = null;
  private travel = '';
  private lastMotion = 0;
  private engaged = false;
  private everMoved = false;

  constructor(private readonly quietMs = QUIET_MS) {}

  reset(now: number): void {
    this.lamps = null;
    this.travel = '';
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
      this.lastMotion = now;
      return false;
    }
    let moved = false;
    for (let i = 0; i < v.lampsRaw.length; i++) {
      if (this.lamps[i] !== v.lampsRaw[i]) { moved = true; break; }
    }
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
  'video palette': 'video palette',
  'percentage key': 'percentage key',
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
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private iconEl: HTMLElement | null = null;

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

  update(reason: NoteReason | null, text: string, offerState = false): string | null {
    if (reason !== null) this.setIcon(null);
    if (reason !== 'stopped') this.dismissed.delete('stopped');
    if (!reason || this.dismissed.has(reason)) {
      if (this.shown && !this.passing) this.hide();
      this.reason = null;
      return null;
    }
    if (this.shown && this.reason === reason) return null;
    this.restoreButtons();
    this.closeRun = null;
    this.reason = reason;
    this.offering = offerState;
    if (this.stateBtn) this.stateBtn.hidden = !offerState;
    this.show(text);
    return text;
  }

  notice(
    text: string,
    action?: { label: string; run: () => void },
    onClose?: () => void,
    hideAfterMs?: number,
    icon?: { paths: string; label: string },
  ): void {
    this.reason = null;
    this.setIcon(icon ?? null);
    this.closeRun = onClose ?? null;
    if (this.hideTimer !== null) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    if (this.closeBtn) this.closeBtn.hidden = hideAfterMs !== undefined;
    if (hideAfterMs !== undefined) {
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (this.shown && this.reason === null && this.lastText === text) this.hide();
      }, hideAfterMs);
    }
    if (!this.buttonsBefore) {
      this.buttonsBefore = { more: this.moreBtn?.hidden ?? true, state: this.stateBtn?.hidden ?? true };
    }
    this.actRun = action?.run ?? null;
    if (this.actBtn) {
      this.actBtn.hidden = !action;
      if (action) this.actBtn.textContent = action.label;
    }
    if (this.moreBtn) this.moreBtn.hidden = true;
    if (this.stateBtn) this.stateBtn.hidden = true;
    this.offering = false;
    this.show(text, hideAfterMs !== undefined);
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
    el.setAttribute('aria-label', icon.label);
    el.replaceChildren(rowIcon(icon.paths, 'stopnote-icon-svg', 22));
  }

  private show(text: string, passing = false): void {
    this.lastText = text;
    const wasUp = this.shown;
    this.shown = true;
    if (this.msg) this.msg.textContent = text;
    if (!this.el) return;
    const el = this.el;
    if (wasUp && el.classList.contains('open')) {
      document.documentElement.style.setProperty('--toast-h', `${el.offsetHeight}px`);
      return;
    }
    el.hidden = false;
    el.classList.remove('leaving', 'settled');
    if (passing) el.classList.add('passing'); else el.classList.remove('passing');
    requestAnimationFrame(() => {
      if (!this.shown) return;
      el.classList.add('open');
      document.documentElement.style.setProperty('--toast-h', `${el.offsetHeight}px`);
    });
    el.addEventListener?.('animationend', this.onAnnounceEnd);
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
    this.actRun = null;
    this.closeRun = null;
    this.shown = false;
    this.lastText = '';
    if (!this.el) { this.restoreButtons(); return; }
    const el = this.el;
    if (el.classList.contains('open')) el.classList.add('leaving');
    el.classList.remove('open');
    window.setTimeout(() => {
      if (this.shown || el.classList.contains('open')) return;
      el.classList.remove('leaving', 'settled');
      el.classList.remove('passing');
      el.hidden = true;
      this.setIcon(null);
      this.restoreButtons();
    }, HIDE_MS);
  }
}
