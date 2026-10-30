import { helpButton, openHelp } from '../web/help/help';
import { configOf } from '../src/machine/registry';
import type { CashLedger } from '../src/machine/machine';
import type { Snapshot } from '../web/snapshot';
import { UI_ICONS } from '../web/ui/icons';
import { card, checkRow } from '../web/ui/rows';
import { openAlert, type Alert } from '../web/ui/dialog';
import { actionButton, chip } from '../web/ui/list';
import { dipPackage, type OptionSwitchRow } from '../web/paneltabs';
import { checkItem, checklist, statusIcon, MARK_LABEL, type Mark } from '../web/ui/status';
import { stepHeader, type StepHeader } from '../web/ui/steps';
import { expandSection } from '../web/ui/section';
import { enhanceSelect } from '../web/ui/dropdown';
import type { ArcadeMachine } from './machines';
import { machineTitle } from './machinelist';
import { cabinetModels, styleModel } from './cabinets';
import { CABINET_STYLES, cabinetStyle, DEFAULT_STYLE, styleBody } from './cabinet-default';
import { controlNaming } from '../web/controlname';
import { viewFor } from '../web/platform';
import { invalidateRec } from './cache';
import {
  configDigest, fromBase64, fromMachineState, machineById, removeMachine, toBase64, toMachineState, type ArcadeDoc, type CheckResult, type DocMachine, type MachineConfig,
} from './doc';
import { syncArcade } from './share';
import { decodeTrace, layoutDigest } from './trace';
import { putArcade } from './docstore';
import { moneyTrust, NO_BOOKKEEPING, PAYOUT_UNVERIFIED, unpricedMoved } from './moneygate';
import type { CabLamp } from '../web/dat';
import { alarmsUnseen, attractBudgetS, buttonsOnly, hostGate, lookNext, TRACE_S, WizardMachine, type BootFrom } from './wizmachine';
import { TRACE_FPS } from './trace';
import { COINS_STOPPED_HOST_TEXT, el, exitButton, iconButton } from './host';
import { serverMoney } from './moneyrecord';
import { DressPreview, type GlassPlay } from './dresspreview';
import { TEX_WHOLE } from './glass';
import { FitView } from './fitview';
import { LiveLook, settleLook } from './looksettle';
import { addDeck, hasDeck, isSetBox, readFitSet, removeDeck, resetBox, resolveFit, withBox, type FitSet, type PanelName } from './fit';
import { clampQuad, isConvexQuad, quadOfRect, type Quad } from './quad';
import { listGames } from '../web/store';
import { contentKeys } from '../web/contentkeys';
import { PlayPointer } from '../web/play/pointer';
import { str } from '../web/i18n';
import { coinTicks } from '../web/ui/coinsetup';
import { editedSlot, markedSlots, readCoinWiring, readPayoutValues, TOKEN_VALUES, cashLabel, slotCoinLabel, unplacedCoins, type CoinWiring, type SlotCoin, type SlotWiring } from '../web/coinask';
import { markableButtons, markedCounted, slotlessToWire, slotsToWire, takesNoCoinAtAll, wiringFinder, wiringFor, type MarkableButton, type WireSlot } from './coinwiring';
import { definitionOf, keepCoinAnswers } from './hostset';

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const NOTHING: ReadonlySet<CabLamp> = new Set();

const STEPS = [str('arcade.wizard.validate_and_boot'), str('arcade.wizard.configure'), str('arcade.wizard.fill_and_money'), str('arcade.wizard.look'), str('arcade.wizard.finish')];
const FILL = 2;
const LOOK = 3;
const FINISH = 4;

const STEP_DESC = [
  str('arcade.wizard.starts_the_machine_from_cold'),
  str('arcade.wizard.choose_the_machine_s_option'),
  str('arcade.wizard.how_this_machine_books_money'),
  str('arcade.wizard.choose_how_the_cabinet_looks'),
  str('arcade.wizard.checks_the_machine_takes_a'),
];

const COINS_STOPPED_HOST_NOTE_WIZARD = str('arcade.wizard.two_coins_did_not_match');

const BOOT_CHECKS: { id: string; name: string }[] = [
  { id: 'boot', name: str('arcade.wizard.boots') },
  { id: 'attract', name: str('arcade.wizard.reaches_attract') },
  { id: 'alarm', name: str('arcade.wizard.no_alarm') },
];
const TEST_CHECKS: { id: string; name: string }[] = [
  { id: 'coin', name: str('arcade.wizard.a_coin_credits') },
  { id: 'spin', name: str('arcade.wizard.start_moves_the_reels') },
];
const ALL_CHECKS = [...BOOT_CHECKS, ...TEST_CHECKS];

const CREDIT_PENCE = 100;
const COINS_MAX = 20;
const TEST_TYPICAL_S = 8;

const pounds = (p: number): string => `£${(p / 100).toFixed(2)}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

export async function openWizard(
  root: HTMLElement, doc: ArcadeDoc, id: string, mode: 'add' | 'edit', back: () => void,
): Promise<void> {
  const row = machineById(doc, id);
  root.replaceChildren();
  root.classList.add('host-wz', 'nb-wizard');
  const top = el('div', null, { class: 'wz-head nb-wizard__head' });
  const heading = el('h2', mode === 'edit' ? str('arcade.wizard.edit_machine') : str('arcade.wizard.install_machine'), { class: 'wz-heading' });
  const title = el('div', row ? machineTitle(row.name, null) : str('arcade.wizard.this_machine_is_not_in'), { class: 'wz-title' });
  if (row) title.title = row.name;
  const sub = el('p', null, { class: 'wz-sub' });
  sub.append(title);
  if (row) sub.append(chip(row.board, 'plat'));
  const name = el('div', null, { class: 'wz-name' });
  name.append(heading, sub);
  let w: Wizard | null = null;
  let exited = false;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || ev.repeat) return;
    ev.preventDefault();
    leave();
  };
  const leave = (): void => {
    if (exited) return;
    exited = true;
    document.removeEventListener('keydown', onKey);
    w?.dispose();
    back();
  };
  document.addEventListener('keydown', onKey);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  heading.id = 'wzTitle';
  root.setAttribute('aria-labelledby', heading.id);
  top.append(name, helpButton(() => openHelp('machine', `step${w?.stepNow ?? 0}`)), exitButton(leave));
  root.append(top);
  if (!row) return;
  const library = await listGames().catch(() => []);
  if (exited) return;
  const held = library.find((g) => (g.contentHash ? contentKeys(g) : [g.hash]).includes(row.contentHash)) ?? null;
  title.textContent = machineTitle(row.name, held);
  if (!held) {
    const missing = el('div', null, { class: 'wz-missing' });
    missing.append(
      el('p', str('arcade.wizard.this_game_is_not_in')),
      actionButton(str('arcade.host.open_the_library'), 'primary', () => { location.href = '/'; }),
    );
    root.append(missing);
    return;
  }
  row.setup = readFitSet(row.setup ?? {});
  w = new Wizard(root, doc, row, mode, leave, {
    id: row.id, contentHash: row.contentHash, formerContentHashes: row.formerContentHashes ?? [], name: machineTitle(row.name, held), board: row.board, cabinetStyle: row.detected?.cabinetStyle ?? null,
    traceUrl: null, held, setup: row.setup, config: row.config,
    slot: {
      load: async () => (mode === 'edit' && row.state ? fromMachineState(row.state, held.hash) : null),
      save: async (rec) => { row.state = toMachineState(rec); },
    },
  });
  await w.start();
}

type RecState = 'waiting' | 'looking' | 'recording' | 'done' | 'needs' | 'broken';

type ViewMode = 'flat' | '3d';
type LookMode = 'fit' | 'cabinet';
const LOOK_LABEL: Record<LookMode, string> = { fit: str('arcade.wizard.fit_glass'), cabinet: str('arcade.wizard.cabinet') };
const LOOK_MODE_KEY = 'fruitulator.arcade.wizard.look';
const SIDE_W = 900;
const SIDE_H = 520;
const COLLAPSE_ICON = '<path d="M6 12h12"/>';
const VIEW_LABEL: Record<ViewMode, string> = { flat: str('arcade.wizard.flat'), '3d': '3D' };

const NEEDS_TEXT = str('arcade.wizard.the_machine_is_waiting_for');
const NEEDS_STATE = str('arcade.wizard.waiting_for_your_input');
const NEEDS_TEXT_LOOK = str('arcade.wizard.the_machine_isn_t_showing_look');
const NEEDS_STATE_LOOK = str('arcade.wizard.not_at_attract_yet');

const ATTRACT_HINT_S = 30;

function oneCheck(mark: Mark, title: string, note?: string | null): HTMLElement {
  const ul = checklist();
  ul.append(checkItem(mark, title, note));
  return ul;
}

function wizSection(name: string, body: HTMLElement): HTMLElement {
  const w = el('div', null, { class: 'wz-group nb-wizard__section' });
  w.append(el('span', name, { class: 'nb-field__label' }), body);
  return w;
}

class Wizard {
  private readonly wm: WizardMachine;
  private readonly canvas: HTMLCanvasElement;
  private readonly stage = el('div', null, { class: 'wz-view', 'data-wz': 'view' });
  private readonly flat = el('div', null, { class: 'wiz-flat' });
  private readonly flatWait = el('div', null, { class: 'wz-wait', 'aria-hidden': 'true' });
  private readonly slotMarks = el('div', null, { class: 'wz-slot-marks', 'aria-hidden': 'true' });
  private readonly tools = el('div', null, { class: 'wz-tools' });
  private readonly viewSwitch = el('div', null, { class: 'wz-seg nb-tabs', role: 'tablist', 'aria-label': str('arcade.wizard.view'), 'data-wz': 'switch' });
  private readonly segBtns = new Map<ViewMode, HTMLButtonElement>();
  private finishView: ViewMode = '3d';
  private readonly lookSwitch = el('div', null, { class: 'wz-seg nb-tabs', role: 'tablist', 'aria-label': str('arcade.wizard.view'), 'data-wz': 'look-switch' });
  private readonly lookBtns = new Map<LookMode, HTMLButtonElement>();
  private lookMode: LookMode = (() => {
    try { return localStorage.getItem(LOOK_MODE_KEY) === 'cabinet' ? 'cabinet' : 'fit'; } catch { return 'fit'; }
  })();
  private side = false;
  private readonly split = el('div', null, { class: 'wz-split', 'data-wz': 'split' });
  private readonly flatHalf = el('div', null, { class: 'wz-half wz-half-flat' });
  private readonly d3Half = el('div', null, { class: 'wz-half wz-half-3d' });
  private readonly flatLabel = el('span', str('arcade.wizard.flat'), { class: 'nb-field__label wz-half-label' });
  private readonly d3Label = el('span', VIEW_LABEL['3d'], { class: 'nb-field__label wz-half-label' });
  private readonly liveCard = el('div', null, { class: 'wz-live', 'data-wz': 'live' });
  private readonly liveView = el('div', null, { class: 'wz-live-view' });
  private readonly liveChip = el('button', VIEW_LABEL['3d'], { type: 'button', class: 'wz-live-chip', 'aria-expanded': 'false', 'data-wz': 'live-chip' });
  private liveOpen = true;
  private lookLaid = '';
  private lookArt: HTMLElement | null = null;
  private cabGroup: HTMLElement | null = null;
  private fitGroup: HTMLElement | null = null;
  private lookActive: PanelName = 'glass';
  private readonly live3d = new LiveLook(() => {
    if (this.gone() || this.step !== LOOK) return;
    this.applyLook();
    if (this.trimInput && !this.m.setup.trim) this.trimInput.value = this.wm.glass.trim;
    void this.preview?.rebuild();
  });
  private readonly strip = el('div', null, { class: 'wz-strip nb-wizard__status', 'data-wz': 'strip', role: 'status' });
  private readonly stateText = el('span', '', { class: 'wz-strip-text' });
  private stateMark: Mark = 'running';
  private readonly stripState = (() => {
    const s = el('span', null, { class: 'wz-strip-part wz-strip-state' });
    const open = (): void => {
      if (this.needHost) this.needsYou(true);
      else { const failed = this.failure(); if (failed) this.selfTestFailed(failed); }
    };
    s.addEventListener('click', () => { if (s.classList.contains('wz-reopen')) open(); });
    s.addEventListener('keydown', (ev) => {
      if (!s.classList.contains('wz-reopen') || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault(); ev.stopPropagation(); open();
    });
    return s;
  })();
  private stripMark: Mark | null = null;
  private stripIcon: HTMLElement | null = null;
  private readonly stripText = el('span', '', { class: 'wz-strip-text' });
  private readonly panelTitle = el('h3', '', { class: 'wz-panel-title', 'data-wz': 'title' });
  private readonly panelDesc = el('p', '', { class: 'wz-panel-desc' });
  private readonly panel = el('div', null, { class: 'wz-panel-body' });
  private readonly backBtn = actionButton(str('arcade.wizard.back'), 'secondary', (ev) => { if (ev.detail > 1) return; if (this.step > this.first) this.goTo(this.step - 1); }, UI_ICONS.chevLeft);
  private readonly nextBtn = actionButton(str('arcade.wizard.next'), 'primary', (ev) => { if (ev.detail > 1) return; this.onNext(); });
  private onNext: () => void = () => undefined;
  private navLabel = '';
  private navOk = true;
  private onNextCustom: (() => void) | undefined;
  private steps!: StepHeader;
  private step: number;
  get stepNow(): number { return this.step; }
  private busy = false;
  private booting = false;
  private reboot = false;
  private moving = false;
  private movingTimer = 0;
  private ledgerAtBoot: CashLedger | null = null;
  private unpriced = false;
  private booted = false;
  private settled = false;
  private rec: RecState = 'waiting';
  private recNote = '';
  private recRun = 0;
  private attractSnap: Snapshot | null = null;
  private putBacks = 0;
  private putBack = false;
  private preTest: Snapshot | null = null;
  private preview: DressPreview | null = null;
  private refillOn = false;
  private draft: MachineConfig;
  private alert: Alert | null = null;
  private needHost = false;
  private attractSkipped = false;
  private hostSawAlarm = false;
  private needsLook = false;
  private needsShown = false;
  private needsAlert: Alert | null = null;

  constructor(private readonly root: HTMLElement, private readonly doc: ArcadeDoc,
    private readonly m: DocMachine, private readonly mode: 'add' | 'edit', private readonly back: () => void,
    am: ArcadeMachine) {
    this.wm = new WizardMachine(am);
    this.canvas = this.wm.glass.texCanvas;
    this.wm.live.gateHost(() => this.hands());
    this.wm.live.onCoinsStopped = () => { if (!this.gone() && this.step === FILL) this.render(); };
    this.offs.push(() => { this.wm.live.onCoinsStopped = null; });
    this.canvas.className = 'glass';
    this.step = mode === 'edit' ? 1 : 0;
    this.draft = cloneConfig(m.config);
  }

  private async save(): Promise<void> {
    if (this.disposed) return;
    await putArcade(this.doc);
  }

  private disposed = false;
  private raf = 0;
  private readonly offs: Array<() => void> = [];

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const off of this.offs.splice(0)) off();
    const a = this.alert;
    this.alert = null;
    a?.close();
    this.wm.stopWatch();
    this.wm.live.stop();
    this.live3d.cancel();
    this.preview?.dispose();
    this.preview = null;
    this.fitView?.dispose();
    this.fitView = null;
  }

  private stoodDown(): boolean {
    if (!this.gone()) return false;
    this.wm.stopWatch();
    if (this.wm.live.running) this.wm.live.stop();
    return true;
  }

  private readonly ran = new Set<string>();

  private result(id: string): CheckResult | undefined {
    return this.ran.has(id) ? this.m.validation?.checks.find((x) => x.id === id) : undefined;
  }

  private say(t: string, mark: Mark = 'running'): void {
    this.stateMark = mark;
    this.stateText.textContent = t;
    this.renderStrip();
  }

  private gone(): boolean { return this.disposed || !this.stage.isConnected; }

  private askHost(look = false): void {
    this.needHost = true;
    this.needsLook = look;
    this.needsShown = false;
    this.renderStrip();
    this.needsYou();
    if (this.step === FINISH) this.render();
  }

  private needsYou(force = false): void {
    if (!this.needHost || this.gone() || (!force && (this.needsShown || this.alert || this.step === LOOK))) return;
    this.needsShown = true;
    this.showAlert(this.needsLook ? NEEDS_TEXT_LOOK : NEEDS_TEXT, [], [
      ...(this.needsLook ? [{ label: str('arcade.wizard.it_shows_an_alarm'), kind: 'secondary' as const, run: () => this.hostAlarm() }] : []),
      { label: str('arcade.wizard.install_without_attract'), kind: 'secondary', run: () => this.skipAttract() },
      { label: str('arcade.wizard.ok'), kind: 'primary', run: () => undefined },
    ], true, true);
    this.needsAlert = this.alert;
  }

  private skipAttract(): void {
    this.attractSkipped = true;
    this.recRun++;
    if (this.wm.recording) this.wm.dropRecording();
    this.m.trace = null;
    this.putBack = false;
    this.hostDone();
    if (this.booted) { this.rec = 'done'; this.recChanged(); } else this.render();
    void this.save();
  }

  private hostAlarm(): void {
    this.hostSawAlarm = true;
    this.hostDone();
    this.render();
  }

  private hostDone(): void {
    if (!this.needHost) return;
    this.needHost = false;
    const a = this.needsAlert;
    this.needsAlert = null;
    if (a && this.alert === a) { this.alert = null; a.close(); }
    this.renderStrip();
  }

  private get first(): number { return this.mode === 'edit' ? 1 : 0; }

  async start(): Promise<void> {
    const shown = (ev: PageTransitionEvent): void => { if (ev.persisted) location.reload(); };
    window.addEventListener('pageshow', shown);
    this.offs.push(() => window.removeEventListener('pageshow', shown));
    this.steps = stepHeader(STEPS, (i) => this.goTo(i));
    const wrap = el('div', null, { class: 'wz-body nb-wizard__body' });
    this.flat.append(this.canvas, this.slotMarks);
    this.stage.append(this.flat);
    for (const v of ['flat', '3d'] as ViewMode[]) {
      const b = el('button', VIEW_LABEL[v], { type: 'button', class: 'wz-seg-btn', role: 'tab', 'data-view': v, 'aria-selected': 'false' });
      b.addEventListener('click', () => this.setView(v));
      this.segBtns.set(v, b);
      this.viewSwitch.append(b);
    }
    this.tools.append(this.viewSwitch);
    for (const v of ['fit', 'cabinet'] as LookMode[]) {
      const b = el('button', LOOK_LABEL[v], { type: 'button', class: 'wz-seg-btn', role: 'tab', 'data-look': v, 'aria-selected': 'false' });
      b.addEventListener('click', () => this.setLookMode(v));
      this.lookBtns.set(v, b);
      this.lookSwitch.append(b);
    }
    this.flatHalf.append(this.flatLabel);
    this.d3Half.append(this.d3Label);
    this.split.append(this.flatHalf, this.d3Half);
    const liveCap = el('div', null, { class: 'wz-live-cap' });
    const collapse = iconButton(COLLAPSE_ICON, str('arcade.wizard.live_3d'), () => this.setLiveOpen(false));
    collapse.className = 'nb-mini-btn wz-live-collapse';
    collapse.setAttribute('aria-expanded', 'true');
    liveCap.append(el('span', str('arcade.wizard.live_3d'), { class: 'wz-live-name' }), collapse);
    this.liveCard.append(this.liveView, liveCap);
    this.liveChip.setAttribute('aria-label', str('arcade.wizard.live_3d'));
    this.liveChip.addEventListener('click', () => this.setLiveOpen(true));
    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { if (!this.gone()) this.measureSide(); });
      });
      ro.observe(this.stage);
      this.offs.push(() => { ro.disconnect(); cancelAnimationFrame(raf); });
    }
    const left = el('div', null, { class: 'wz-left nb-wizard__preview' });
    left.append(this.stage, this.strip);
    const panel = el('section', null, { class: 'wz-panel nb-wizard__side', 'aria-labelledby': 'wzPanelTitle' });
    this.panelTitle.id = 'wzPanelTitle';
    const foot = el('footer', null, { class: 'wz-foot nb-wizard__foot' });
    this.backBtn.setAttribute('data-wz', 'back');
    this.nextBtn.setAttribute('data-wz', 'next');
    foot.append(this.backBtn, this.nextBtn);
    panel.append(this.panelTitle, this.panelDesc, this.panel, foot);
    wrap.append(left, panel);
    const top = this.root.querySelector('.wz-head');
    if (top) top.after(this.steps.root);
    else this.root.append(this.steps.root);
    this.root.append(wrap);
    this.render();
    this.say(str('arcade.wizard.opening'));
    try {
      await this.wm.open();
    } catch (e) {
      this.say(str('arcade.wizard.cannot_open_n', { 0: (e as Error).message }), 'fail');
      return;
    }
    if (this.gone()) return;
    this.wirePointer();
    this.loop();
    await this.runBoot();
  }

  private done(i: number): boolean {
    switch (i) {
      case 0: return this.booted || (this.mode === 'edit' && this.bootPassedBefore());
      case 1: return this.settled;
      case LOOK: return this.left.has(LOOK);
      case FILL: return this.left.has(FILL);
      default: return false;
    }
  }

  private readonly left = new Set<number>();

  private bootPassedBefore(): boolean {
    const v = this.m.validation;
    return !!v && BOOT_CHECKS.every((c) => v.checks.find((x) => x.id === c.id)?.pass === true);
  }

  private canGo(i: number): boolean {
    if (this.mode === 'edit' && i === 0) return false;
    if (i <= this.step) return true;
    if (i >= 1 && !this.booted && !this.reboot && !(this.mode === 'edit' && this.bootPassedBefore())) return false;
    return i <= this.step + 1 || this.settled;
  }

  private blocked(): boolean {
    if (!this.busy) return false;
    return !(this.booting && this.reboot && !this.configChanged());
  }

  private goTo(i: number): void {
    if (this.blocked() || this.moving || !this.canGo(i)) return;
    if (this.step === 1 && i > 1 && this.configChanged()) { this.promptRestart(i); return; }
    if (this.step === 1 && i > 1) this.settle();
    if (i > this.step) this.left.add(this.step);
    if (this.step === FILL && i !== FILL) this.refillOff();
    this.step = i;
    this.panel.scrollTop = 0;
    this.moving = true;
    this.render();
    window.clearTimeout(this.movingTimer);
    this.movingTimer = window.setTimeout(() => { if (this.step !== LOOK) this.endMove(); }, 350);
  }

  private endMove(): void {
    if (!this.moving) return;
    this.moving = false;
    this.nav(this.navLabel, this.navOk, this.onNextCustom);
    this.steps.set(this.step, (i) => this.done(i), (i) => this.canGo(i) && (i < this.step || this.done(i)));
  }

  private settle(): void {
    this.settled = true;
    this.maybeRecord();
  }

  private render(): void {
    this.holdOnLook(this.step === LOOK);
    this.steps.set(this.step, (i) => this.done(i),
      (i) => !this.moving && this.canGo(i) && (i < this.step || this.done(i)));
    this.panel.replaceChildren();
    if (this.step !== FILL) this.slotMarks.replaceChildren();
    if (this.step !== LOOK) { this.fitView?.dispose(); this.fitView = null; this.dressSeq++; this.live3d.cancel(); }
    this.panelTitle.textContent = STEPS[this.step];
    this.panelDesc.textContent = STEP_DESC[this.step];
    this.nav();
    this.renderStrip();
    this.showView();
    switch (this.step) {
      case 0: this.renderBoot(); break;
      case 1: this.renderConfig(); break;
      case FILL: this.renderFill(); break;
      case LOOK: void this.renderDress().finally(() => {
        window.clearTimeout(this.movingTimer);
        this.movingTimer = window.setTimeout(() => this.endMove(), 350);
      }); break;
      case FINISH: this.renderFinish(); break;
    }
    if (this.step === FINISH) {
      if (this.rec === 'waiting') this.maybeRecord();
      this.maybeAutoTest();
    }
    this.needsYou();
  }

  private nav(nextLabel = str('arcade.wizard.next'), nextOk = true, onNext?: () => void): void {
    const hasBack = this.step > this.first;
    this.backBtn.classList.toggle('wz-placeholder', !hasBack);
    this.navLabel = nextLabel; this.navOk = nextOk; this.onNextCustom = onNext;
    this.backBtn.disabled = !hasBack || this.blocked() || this.moving;
    if (hasBack) this.backBtn.removeAttribute('aria-hidden'); else this.backBtn.setAttribute('aria-hidden', 'true');
    this.backBtn.tabIndex = hasBack ? 0 : -1;
    this.nextBtn.lastChild!.textContent = nextLabel;
    const last = this.step >= STEPS.length - 1;
    this.nextBtn.disabled = !(nextOk && (last || this.canGo(this.step + 1)) && !this.blocked() && !this.moving);
    this.onNext = onNext ?? ((): void => { if (!last) this.goTo(this.step + 1); });
  }

  private get switchStep(): typeof LOOK | typeof FINISH | null {
    return this.step === LOOK ? LOOK : this.step === FINISH ? FINISH : null;
  }

  private setView(v: ViewMode): void {
    if (this.step !== FINISH || this.finishView === v) return;
    this.finishView = v;
    this.showView();
  }

  private setLookMode(v: LookMode): void {
    if (this.lookMode === v) return;
    this.lookMode = v;
    try { localStorage.setItem(LOOK_MODE_KEY, v); } catch {  }
    this.syncLookPanel();
    this.showView();
  }

  private setLiveOpen(on: boolean): void {
    if (this.liveOpen === on) return;
    this.liveOpen = on;
    this.showView();
    (on ? this.liveCard.querySelector<HTMLElement>('.wz-live-collapse') : this.liveChip)?.focus({ preventScroll: true });
  }

  private measureSide(): void {
    const side = this.stage.clientWidth >= SIDE_W && this.stage.clientHeight >= SIDE_H;
    if (side === this.side) return;
    this.side = side;
    if (this.step !== LOOK) return;
    this.syncLookPanel();
    this.showView();
  }

  private syncLookPanel(): void {
    const mode = this.side ? null : this.lookMode;
    this.cabGroup?.classList.toggle('wz-off', mode === 'fit');
    this.fitGroup?.classList.toggle('wz-off', mode === 'cabinet');
  }

  private showView(): void {
    const at = this.switchStep;
    const mode = at === FINISH ? this.finishView : 'flat';
    for (const [v, b] of this.segBtns) {
      b.setAttribute('aria-selected', String(v === mode));
      b.classList.toggle('on', v === mode);
    }
    if (at !== null) this.ensurePreview();
    this.preview?.play(at === FINISH ? this.glassPlay : null);
    if (at === LOOK) { this.showLook(); return; }
    this.lookLaid = '';
    if (this.viewSwitch.parentElement !== this.tools) this.tools.replaceChildren(this.viewSwitch);
    let view: HTMLElement;
    if (at !== null && mode === '3d') view = this.preview!.root;
    else view = this.flat;
    const waiting = view === this.flat && !this.flat.classList.contains('shown');
    this.wm.glass.setBlanking(view !== this.flat);
    this.wm.glass.setWhole(view === this.flat);
    const want: HTMLElement[] = [view];
    if (waiting) want.push(this.flatWait);
    if (at !== null) want.push(this.tools);
    if (at !== null) {
      if (mode === '3d') this.tools.prepend(this.preview!.resetBtn); else this.preview!.resetBtn.remove();
    }
    const same = this.stage.children.length === want.length && want.every((n, i) => this.stage.children[i] === n);
    if (same) return;
    const shown3d = view === this.preview?.root && this.stage.firstElementChild !== view;
    this.stage.replaceChildren(...want);
    if (shown3d) void this.preview!.rebuild();
  }

  private showLook(): void {
    const p = this.preview!;
    this.wm.glass.setBlanking(true);
    this.wm.glass.setWhole(false);
    for (const [v, b] of this.lookBtns) {
      b.setAttribute('aria-selected', String(v === this.lookMode));
      b.classList.toggle('on', v === this.lookMode);
    }
    const art = this.fitView?.stageRoot ?? this.lookWait;
    const mode = this.side ? 'side' : this.lookMode;
    const key = `${mode}|${this.liveOpen}`;
    if (key === this.lookLaid && art === this.lookArt && art.isConnected) return;
    const was3d = p.root.parentElement;
    let want: HTMLElement[];
    if (mode === 'side') {
      this.flatHalf.replaceChildren(art, this.flatLabel);
      this.d3Half.replaceChildren(p.root, p.resetBtn, this.d3Label);
      want = [this.split];
    } else if (mode === 'cabinet') {
      this.tools.replaceChildren(p.resetBtn, this.lookSwitch);
      want = [p.root, this.tools];
    } else {
      this.tools.replaceChildren(this.lookSwitch);
      if (this.liveOpen) {
        this.liveView.replaceChildren(p.root);
        want = [art, this.liveCard, this.tools];
      } else {
        p.root.remove();
        want = [art, this.liveChip, this.tools];
      }
    }
    this.stage.replaceChildren(...want);
    this.lookLaid = key;
    this.lookArt = art;
    if (p.root.isConnected && p.root.parentElement !== was3d) void p.rebuild();
    requestAnimationFrame(() => { if (this.step === LOOK) this.fitView?.sync(); });
  }

  private readonly glassPlay: GlassPlay = {
    press: (id, hit) => { this.wm.live.pressHit(id, hit); },
    release: (id) => this.wm.live.release(id),
    touched: () => this.wm.live.startSound(),
  };

  private readonly lookWait = (() => {
    const w = el('div', null, { class: 'fit-wrap' });
    w.append(el('div', null, { class: 'wz-wait', 'aria-hidden': 'true' }));
    return w;
  })();

  private ensurePreview(): void {
    if (this.preview) return;
    this.preview = new DressPreview(this.wm.glass);
    this.preview.onBuilt = (panels) => {
      this.fitView?.setPanels(panels);
    };
    void this.preview.rebuild();
  }

  private loop(): void {
    const tick = (): void => {
      if (this.disposed) return;
      this.wm.paint(TEX_WHOLE);
      this.fitGlass();
      this.fitView?.draw(this.wm.glass.paints);
      this.paintReady();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private fitGlass(): void {
    if (this.stage.firstElementChild !== this.flat) return;
    const fw = this.stage.clientWidth;
    const fh = this.stage.clientHeight;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!fw || !fh || !cw || !ch) return;
    const k = Math.min(fw / cw, fh / ch);
    const w = `${Math.floor(cw * k)}px`;
    const h = `${Math.floor(ch * k)}px`;
    if (this.flat.style.width !== w || this.flat.style.height !== h) {
      this.flat.style.width = w;
      this.flat.style.height = h;
    }
    if (cw > 4 && this.wm.glass.paints > 0 && !this.flat.classList.contains('shown')) {
      this.flat.classList.add('shown');
      this.showView();
    }
  }

  private wirePointer(): void {
    const cv = this.canvas;
    const toLayout = (ev: { clientX: number; clientY: number }): { x: number; y: number; scale: number } | null => {
      const g = this.wm.glass;
      const col = g.shown;
      if (!col) return null;
      const r = cv.getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width;
      const fy = (ev.clientY - r.top) / r.height;
      return { x: col.left + fx * col.width, y: col.top + fy * col.height, scale: r.width / col.width };
    };
    const caps = new PlayPointer<{ x: number; y: number; scale: number }>({
      at: (ev) => toLayout(ev),
      press: (p, id) => {
        this.wm.live.startSound();
        this.wm.live.press(id, p.x, p.y, p.scale);
      },
      release: (id) => this.wm.live.release(id),
      capture: (id) => cv.setPointerCapture(id),
    });
    cv.addEventListener('pointerdown', (ev) => { caps.down(ev); });
    const up = (ev: PointerEvent): void => { caps.up(ev); };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('lostpointercapture', up);
    const typing = (ev: KeyboardEvent): boolean => ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement;
    const down = (ev: KeyboardEvent): void => { if (!typing(ev)) this.wm.live.keys.keyDown(ev); };
    const up2 = (ev: KeyboardEvent): void => { if (!typing(ev)) this.wm.live.keys.keyUp(ev); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up2);
    this.offs.push(() => window.removeEventListener('keydown', down), () => window.removeEventListener('keyup', up2));
  }

  private checkList(ids: { id: string; name: string }[], running: string | null): HTMLElement {
    const box = checklist();
    box.classList.add('wiz-checks');
    this.checkRows(box, ids, running);
    return box;
  }

  private checkRows(box: HTMLElement, ids: { id: string; name: string }[], running: string | null, pendingNote: string | null = null): void {
    for (const c of ids) {
      const r = this.result(c.id);
      const mark: Mark = r?.pass === true ? 'pass' : r?.pass === false ? 'fail' : running === c.id ? 'running' : 'pending';
      const note = r?.note || (mark === 'running' ? this.runNote : mark === 'pending' ? pendingNote : null);
      const row = checkItem(mark, c.name, note || null);
      row.classList.add('wiz-check');
      if (mark === 'fail') this.reopens(row, BOOT_CHECKS.some((b) => b.id === c.id) ? 'boot' : 'test');
      box.append(row);
    }
  }

  private reopens(node: HTMLElement, kind: 'boot' | 'test'): void {
    node.classList.add('wz-reopen');
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.title = str('arcade.wizard.show_try_again_and_reboot');
    const open = (): void => { if (this.failure() === kind) this.selfTestFailed(kind); };
    node.addEventListener('click', open);
    node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); open(); } });
  }

  private failure(): 'boot' | 'test' | null {
    const v = this.m.validation;
    if (this.busy || !v || v.config !== configDigest(this.m.config)) return null;
    const failed = (ids: { id: string }[]): boolean => ids.some((c) => this.result(c.id)?.pass === false);
    if (!this.booted && failed(BOOT_CHECKS)) return 'boot';
    if (failed(TEST_CHECKS)) return 'test';
    return null;
  }

  private failedNote(kind: 'boot' | 'test'): void {
    if (this.failure() === kind) this.panel.append(el('p', str('arcade.wizard.tap_the_failed_check_to'), { class: 'host-note' }));
  }

  private selfTestFailed(kind: 'boot' | 'test'): void {
    const ids = kind === 'boot' ? BOOT_CHECKS : TEST_CHECKS;
    const lines = ids.flatMap((c) => {
      const r = this.result(c.id);
      return r?.pass === false ? [r.note ? `${c.name}: ${r.note}` : c.name] : [];
    });
    this.showAlert(str('arcade.wizard.self_test_failed'), lines, [
      { label: str('arcade.wizard.try_again'), kind: 'primary', run: () => { void (kind === 'boot' ? this.runBoot(false) : this.runTest()); } },
      { label: str('arcade.wizard.reboot'), kind: 'secondary', run: () => { void (kind === 'boot' ? this.runBoot(true) : this.rebootAndTest()); } },
      ...(kind === 'test' && !this.noCoinSlot ? [{ label: str('arcade.wizard.skip_test'), kind: 'secondary' as const, run: () => this.skipTest() }] : []),
      { label: str('arcade.host.exit'), kind: 'secondary', run: () => this.back() },
      ...(kind === 'boot' && this.mode === 'edit' ? [{ label: str('arcade.wizard.remove'), kind: 'secondary' as const, run: () => this.askRemove() }] : []),
    ]);
  }

  private askRemove(): void {
    this.showAlert(str('arcade.host.delete_n_from_this_arcade', { 0: this.wm.glass.machine.name }), [str('arcade.host.its_settings_and_stats_go')], [
      { label: str('arcade.host.yes_delete_it'), kind: 'primary', run: () => { void this.removeAndLeave(); } },
      { label: str('arcade.host.keep_it'), kind: 'secondary', run: () => this.selfTestFailed('boot') },
    ]);
  }

  private async removeAndLeave(): Promise<void> {
    if (this.gone()) return;
    removeMachine(this.doc, this.m.id);
    await this.save();
    void syncArcade(this.doc);
    this.back();
  }

  private showAlert(message: string, lines: string[],
    buttons: { label: string; kind: 'primary' | 'secondary'; run: () => void }[], info = false, keysThrough = false): void {
    const old = this.alert;
    this.alert = null;
    old?.close();
    const a = openAlert({
      message, lines, keysThrough, info,
      buttons: buttons.map((b) => ({ button: actionButton(b.label, b.kind, () => undefined), run: () => { this.alert = null; b.run(); } })),
      onClose: () => { this.alert = null; this.render(); },
    });
    this.alert = a;
  }

  private async rebootAndTest(): Promise<void> {
    await this.runBoot(true);
    if (this.booted && this.step === FINISH && this.testCanRun()) await this.runTest();
  }

  private runNote = '';

  private running: string | null = null;

  private setCheck(id: string, pass: boolean | null, note: string): void {
    if (this.gone()) return;
    this.ran.add(id);
    const v = this.m.validation!;
    const c = v.checks.find((x) => x.id === id)!;
    c.pass = pass;
    c.note = note;
    this.running = null;
    this.runNote = '';
    this.render();
  }

  private freshValidation(ids: { id: string }[]): void {
    const cfg = configDigest(this.m.config);
    const was = this.m.validation && this.m.validation.config === cfg ? this.m.validation.checks : [];
    const keep = new Set(ids.map((c) => c.id));
    for (const id of keep) this.ran.delete(id);
    const checks: CheckResult[] = ALL_CHECKS.map((c) => (keep.has(c.id)
      ? { id: c.id, pass: null, note: '' }
      : was.find((x) => x.id === c.id) ?? { id: c.id, pass: null, note: '' }));
    this.m.validation = { at: Date.now(), build: BUILD, config: cfg, passed: false, checks };
  }

  private finishValidation(): void {
    const v = this.m.validation!;
    v.passed = v.checks.every((c) => c.pass === true);
  }

  private renderBoot(): void {
    this.panel.append(this.checkList(BOOT_CHECKS, this.running));
    this.failedNote('boot');
  }

  private startedOnce = 0;

  private async bootFrom(): Promise<BootFrom> {
    this.startedOnce++;
    if (this.startedOnce === 1) return this.mode === 'edit' ? { kind: 'saved' } : { kind: 'files' };
    return { kind: 'cycle', snap: this.wm.live.running ? await this.wm.snapshot() : null };
  }

  private async runBoot(restart = true): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.booting = true;
    this.reboot = this.mode === 'edit' && this.startedOnce === 0 && this.bootPassedBefore();
    this.booted = false;
    this.attractSnap = null;
    this.hostSawAlarm = false;
    this.freshValidation(BOOT_CHECKS);
    const wm = this.wm;
    try {
      this.running = 'boot';
      this.render();
      if (restart || !wm.live.running) {
        this.say(str('arcade.wizard.starting_the_machine'));
        let how = '';
        try {
          wm.live.startSound();
          how = await wm.boot(this.m.config, await this.bootFrom());
          if (this.stoodDown()) return;
          this.ledgerAtBoot = await wm.ledger();
          this.unpriced = false;
          this.preTest = null;
        } catch (e) {
          this.setCheck('boot', false, (e as Error).message);
          return;
        }
        const drew = await wm.until(() => !!wm.live.emu.latestFrame(), 20_000);
        const fellBack = how.startsWith('cold boot:') && (this.mode === 'edit' || !how.includes('no saved state'));
        this.setCheck('boot', drew, !drew ? str('arcade.wizard.no_picture_from_the_machine')
          : fellBack ? str('arcade.wizard.started_from_the_game_s') : '');
        if (!drew) return;
      } else {
        this.setCheck('boot', true, str('arcade.wizard.already_running'));
      }
      this.running = 'attract';
      this.render();
      const budget = attractBudgetS(this.m.board) * 1000;
      const t0 = performance.now();
      const waiting = (): boolean => {
        if (!this.needHost) {
          const s = Math.round((performance.now() - t0) / 1000);
          this.say(str('arcade.wizard.waiting_for_attract_n_s', { 0: s }));
          if (s >= ATTRACT_HINT_S && !this.runNote) {
            this.runNote = str('arcade.wizard.ensure_no_credit');
            this.render();
          }
        }
        return wm.attract() || this.attractSkipped || this.hostSawAlarm;
      };
      let found = await wm.until(waiting, budget, () => this.gone());
      while (!found && !this.gone() && wm.reading?.verdict !== 'ALARM' && !this.hostSawAlarm) {
        if (wm.selfBusy()) {
          found = await wm.until(waiting, budget, () => this.gone());
          continue;
        }
        const look = alarmsUnseen(wm.reading);
        this.runNote = look ? str('arcade.wizard.look_at_the_machine') : str('arcade.wizard.waiting_for_your_input_2');
        this.askHost(look);
        this.render();
        found = await wm.until(waiting, budget, () => this.gone());
      }
      this.hostDone();
      if (this.gone()) return;
      if (this.hostSawAlarm && !wm.attract()) {
        this.setCheck('attract', false, str('arcade.wizard.you_saw_an_alarm_on_it'));
        this.setCheck('alarm', false, str('arcade.wizard.you_saw_an_alarm_on_it'));
        return;
      }
      if (!found) {
        this.setCheck('attract', false, str('arcade.wizard.the_machine_is_showing_an', { 0: wm.reading?.matched ?? '' }));
        return;
      }
      this.setCheck('attract', true, this.attractSkipped && !wm.attract() ? str('arcade.wizard.not_found_installing_without_it') : '');
      const r = wm.reading;
      if (r?.verdict === 'ALARM') {
        this.setCheck('alarm', false, str('arcade.wizard.showing_an_alarm_n', { 0: r.matched ?? '' }));
        return;
      }
      this.setCheck('alarm', true, r?.verdict === 'CLEAR' ? '' : str('arcade.wizard.no_alarm_could_be_read', { 0: r?.unread ?? str('arcade.wizard.no_reading') }));
      this.booted = true;
      this.attractSnap = await wm.snapshot();
    } finally {
      this.running = null;
      this.busy = false;
      this.booting = false;
      this.reboot = false;
      if (!this.stoodDown()) {
        this.finishValidation();
        this.say(this.booted ? (this.attractSkipped && !wm.attract() ? str('arcade.wizard.not_found_installing_without_it') : str('arcade.wizard.in_attract')) : str('arcade.wizard.did_not_pass_step_1'), this.booted ? 'pass' : 'fail');
        this.render();
        if (!this.booted && !this.gone()) this.selfTestFailed('boot');
        await this.save();
        this.maybeRecord();
      }
    }
  }

  private renderConfig(): void {
    const info = this.wm.live.emu.info;
    if (!info) {
      this.panel.append(el('p', str('arcade.wizard.the_machine_is_not_running'), { class: 'host-note' }));
      return;
    }
    const cfg = this.draft;
    cfg.optionKeys ??= {};
    cfg.panelSwitches ??= {};
    let sections = 0;
    if (info.optionKeys.length) {
      const body = el('div', null, { class: 'wz-keys' });
      info.optionKeys.forEach((k, i) => {
        const row = el('label', null, { class: 'menu-row menu-key' });
        const sel = el('select', null, { id: `wizKey${i}`, 'aria-label': k.label });
        k.positions.forEach((p, j) => sel.append(el('option', p, { value: String(j) })));
        sel.value = String(cfg.optionKeys![k.label] ?? k.position);
        sel.addEventListener('change', () => { cfg.optionKeys![k.label] = Number(sel.value); this.nav(); });
        row.append(el('span', k.label, { class: 'row-label' }), sel);
        body.append(row);
        enhanceSelect(sel, { small: true, popover: { align: 'end', within: () => this.root, minWidth: 180, maxHeight: 280 } });
      });
      this.panel.append(expandSection(str('arcade.wizard.option_keys'), UI_ICONS.options, body, true).root);
      sections++;
    }
    const groups = new Map<string, HTMLElement>();
    const packages = new Map<string, OptionSwitchRow[]>();
    for (const sw of info.switchPanel.filter((s) => s.option)) {
      const name = sw.group || str('arcade.wizard.option_switches');
      let body = groups.get(name);
      if (!body) { body = el('div', null, { class: 'wz-dips' }); groups.set(name, body); }
      const on = cfg.panelSwitches![String(sw.id)] ?? sw.on;
      if (sw.dil) {
        const key = `${name}\u0000${sw.dil.bank}`;
        let pkg = packages.get(key);
        if (!pkg) {
          pkg = [];
          packages.set(key, pkg);
          body.append(el('div', null, { class: 'dip', 'data-pkg': key }));
        }
        pkg.push({ ...sw, on });
        continue;
      }
      const { row, box } = checkRow(sw.label, (v) => { cfg.panelSwitches![String(sw.id)] = v; this.nav(); });
      box.checked = on;
      body.append(row);
    }
    for (const body of groups.values()) {
      for (const slot of body.querySelectorAll<HTMLElement>('.dip')) {
        dipPackage(slot, packages.get(slot.dataset.pkg!)!, (row, v) => { cfg.panelSwitches![String(row.id)] = v; this.nav(); });
      }
    }
    for (const [name, body] of groups) {
      this.panel.append(expandSection(name, /dil/i.test(name) ? UI_ICONS.dil : UI_ICONS.switches, body, true).root);
      sections++;
    }
    if (!sections) this.panel.append(el('p', str('arcade.wizard.this_machine_has_no_settings'), { class: 'host-note' }));
  }

  private configChanged(): boolean {
    return configDigest(normConfig(this.draft)) !== configDigest(this.m.config);
  }

  private promptRestart(to: number): void {
    const dil = (): boolean => {
      const a = normConfig(this.draft).panelSwitches ?? {};
      const b = this.m.config.panelSwitches ?? {};
      return JSON.stringify(Object.entries(a).sort()) !== JSON.stringify(Object.entries(b).sort());
    };
    this.showAlert(dil() ? str('arcade.wizard.dil_settings_have_changed_machine') : str('arcade.wizard.option_keys_have_changed_machine'), [],
      [{ label: str('arcade.wizard.ok'), kind: 'primary', run: () => { void this.applyThenGo(to); } }], true);
  }

  private async applyThenGo(to: number): Promise<void> {
    await this.applyConfig();
    if (this.booted && this.step === 1) this.goTo(to);
  }

  private async applyConfig(): Promise<void> {
    if (this.busy) return;
    this.m.config = normConfig(this.draft);
    this.draft = cloneConfig(this.m.config);
    await this.save();
    this.recRun++;
    this.rec = 'waiting';
    this.recNote = '';
    this.putBack = false;
    this.putBacks = 0;
    this.hostDone();
    this.say(str('arcade.wizard.restarting_with_the_new_settings'));
    await this.runBoot(true);
  }

  private traceCurrent(): boolean {
    const t = this.m.trace;
    if (!t) return false;
    if ((t.config ?? configDigest(this.m.config)) !== configDigest(this.m.config)) return false;
    const fl = this.wm.layout;
    if (!fl) return true;
    try {
      return decodeTrace(fromBase64(t.data)).header.layoutDigest === layoutDigest(fl);
    } catch {
      return false;
    }
  }

  private holdOnLook(on: boolean): void {
    const wm = this.wm;
    if (on) {
      if (wm.held || this.busy || !wm.live.running) return;
      if (this.recActive()) return;
      wm.hold();
      return;
    }
    if (!wm.held) return;
    wm.carryOn();
  }

  private recActive(): boolean {
    return this.rec === 'looking' || this.rec === 'recording' || this.rec === 'needs';
  }

  private maybeRecord(): void {
    if (!this.settled || !this.booted || this.busy) return;
    if (this.wm.held && !this.traceCurrent() && this.rec !== 'broken') this.wm.carryOn();
    if (this.rec === 'looking' || this.rec === 'recording' || this.rec === 'needs') return;
    if (this.attractSkipped && !this.traceCurrent()) { this.m.trace = null; this.rec = 'done'; this.render(); return; }
    if (this.traceCurrent()) { this.rec = 'done'; return; }
    if (this.rec === 'broken') return;
    void this.record();
  }

  private renderStrip(): void {
    this.gateHands();
    const needs = this.needHost;
    const mark: Mark = needs ? 'warn' : this.stateMark;
    const text = needs ? (this.needsLook ? NEEDS_STATE_LOOK : NEEDS_STATE) : this.stateText.textContent ?? '';
    const state = this.stripState;
    if (this.stripMark !== mark) {
      const icon = mark === 'running' ? el('span', null, { class: 'nb-spinner', style: '--s: 18px', role: 'img', 'aria-label': str('arcade.wizard.machine_n', { 0: MARK_LABEL[mark] }) })
        : statusIcon(mark, str('arcade.wizard.machine_n', { 0: MARK_LABEL[mark] }));
      if (this.stripIcon) this.stripIcon.replaceWith(icon); else state.prepend(icon);
      this.stripIcon = icon;
      this.stripMark = mark;
    }
    const shown = this.stripText;
    shown.textContent = text;
    shown.title = text;
    if (!shown.isConnected) state.append(shown);
    const reopen: 'needs' | 'boot' | 'test' | null = needs ? 'needs' : this.failure();
    state.classList.toggle('wz-reopen', reopen !== null);
    if (reopen) {
      state.setAttribute('role', 'button');
      state.tabIndex = 0;
      state.title = reopen === 'needs' ? (this.needsLook ? NEEDS_TEXT_LOOK : NEEDS_TEXT) : str('arcade.wizard.show_try_again_and_reboot');
    } else {
      state.removeAttribute('role');
      state.removeAttribute('tabindex');
      state.removeAttribute('title');
    }
    if (!state.isConnected) this.strip.replaceChildren(state);
  }

  private recChanged(): void {
    this.renderStrip();
    if (this.step === FINISH) this.render();
    if (this.step === LOOK) this.holdOnLook(true);
  }

  private askStart = false;
  private askCoin = false;
  private buttonsFor: { cab: object; set: ReadonlySet<CabLamp> } | null = null;

  private hands(): ReadonlySet<CabLamp> | null {
    const g = hostGate({ rec: this.rec, testing: this.testing, askStart: this.askStart, askCoin: this.askCoin, needHost: this.needHost, putBack: this.putBack });
    if (g === 'all') return null;
    const cab = this.wm.glass.cab;
    if (g === 'none' || !cab) return NOTHING;
    if (this.buttonsFor?.cab !== cab) this.buttonsFor = { cab, set: buttonsOnly(cab.lamps) };
    return this.buttonsFor.set;
  }

  private gateHands(): void {
    this.wm.live.letGo();
  }

  private readonly readyBar = (() => {
    const track = el('div', null, { class: 'wz-ready nb-meter', 'data-wz': 'ready', role: 'progressbar', 'aria-label': str('arcade.wizard.getting_the_machine_ready'), 'aria-valuemin': '0', 'aria-valuemax': '100' });
    track.append(el('span', null, { class: 'wz-ready-fill' }));
    return track;
  })();
  private testFrom: number | null = null;

  private readiness(): number | null {
    if (this.step !== FINISH || !this.booted) return null;
    if (this.testing && this.testFrom !== null) {
      const t = (performance.now() - this.testFrom) / 1000;
      return Math.min(0.95, 1 - Math.exp(-t / TEST_TYPICAL_S));
    }
    if (this.rec === 'recording') return Math.min(1, this.wm.recorded / (TRACE_S * TRACE_FPS));
    return this.rec === 'done' ? null : 0;
  }

  private paintReady(): void {
    const bar = this.readyBar;
    if (!bar.isConnected) return;
    const f = this.readiness();
    const pct = f === null ? 100 : Math.round(f * 1000) / 10;
    const fill = bar.firstElementChild as HTMLElement;
    const w = `${pct}%`;
    if (fill.style.width !== w) {
      fill.style.width = w;
      bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
  }

  private async record(): Promise<void> {
    if (this.rec === 'looking' || this.rec === 'recording' || this.rec === 'needs') return;
    const run = ++this.recRun;
    const wm = this.wm;
    const stale = (): boolean => run !== this.recRun || this.gone();
    const set = (r: RecState, note = ''): void => {
      if (stale()) return;
      this.rec = r;
      this.recNote = note;
      if (r !== 'looking' && r !== 'recording') this.putBack = false;
      this.recChanged();
    };
    try {
      let moved = 0;
      set('looking');
      for (;;) {
        let t0 = performance.now();
        let found = false;
        for (;;) {
          found = await wm.until(() => wm.attract(), 1000, stale);
          if (stale()) return;
          if (found) break;
          const next = lookNext({
            lookedS: (performance.now() - t0) / 1000, budgetS: attractBudgetS(this.m.board),
            snapshot: !!this.attractSnap && !this.busy, putBacks: this.putBacks, hostHolding: this.refillOn, selfBusy: wm.selfBusy(),
          });
          if (next === 'wait') continue;
          if (next === 'putBack') {
            this.putBacks++;
            this.putBack = true;
            this.gateHands();
            await wm.restore(this.attractSnap!);
            if (stale()) return;
          } else if (next === 'askHost') {
            set('needs'); this.askHost();
          }
          t0 = performance.now();
        }
        this.hostDone();
        set('recording');
        const s0 = wm.secs.length;
        wm.startRecording();
        await wm.until(() => wm.secs.length - s0 >= TRACE_S, (TRACE_S + 10) * 1000, stale);
        if (stale()) { if (wm.recording) wm.dropRecording(); return; }
        const quiet = wm.quietFor(TRACE_S);
        const out = await wm.finishRecording(this.m.config);
        if (stale()) return;
        if (!quiet) {
          if (++moved >= 3) { moved = 0; set('needs'); this.askHost(); } else set('looking');
          continue;
        }
        if (!out.sameShape) { set('broken', 'This machine cannot be added to the arcade on this version of the app.'); return; }
        this.m.trace = {
          data: toBase64(out.bytes), bytes: out.bytes.length, recordedAt: Date.now(), how: 'found',
          config: configDigest(this.m.config),
        };
        await this.save();
        this.putBacks = 0;
        set('done');
        return;
      }
    } catch (e) {
      set('broken', `Something went wrong getting the machine ready: ${(e as Error).message}`);
    }
  }

  private dressSeq = 0;

  private async renderDress(): Promise<void> {
    const seq = ++this.dressSeq;
    const g = this.wm.glass;
    const det = g.detected;
    const box = card();
    box.classList.add('wiz-dress');
    const group = wizSection;
    const changed = async (): Promise<void> => {
      this.applyLook();
      await this.preview?.rebuild();
      await this.save();
    };
    const set = this.m.setup;
    const models = await cabinetModels().catch(() => []);
    if (this.step !== LOOK || seq !== this.dressSeq) return;
    const cabRow = el('label', null, { class: 'menu-row menu-key nb-kv wz-look-row' });
    const cab = el('select', null, { id: 'wizCabinet', 'aria-label': str('arcade.wizard.cabinet') });
    cab.append(el('option', str('arcade.wizard.default_cabinet'), { value: 'default' }));
    const styleNames: Record<string, string> = {
      cove: str('arcade.wizard.cabinet_style.cove'),
      topbox: str('arcade.wizard.cabinet_style.topbox'),
      wedge: str('arcade.wizard.cabinet_style.wedge'),
      classic: str('arcade.wizard.cabinet_style.classic'),
      arch: str('arcade.wizard.cabinet_style.arch'),
    };
    for (const s of CABINET_STYLES) if (s !== DEFAULT_STYLE) cab.append(el('option', styleNames[s.id] ?? s.id, { value: s.id }));
    for (const mdl of models) cab.append(el('option', mdl.id, { value: mdl.id }));
    if (set.cabinet === undefined) {
      set.cabinet = styleModel(models, g.cabinetStyle)?.id ?? 'default';
      void this.save();
    }
    cab.value = models.some((mdl) => mdl.id === set.cabinet) || (cabinetStyle(set.cabinet) && cabinetStyle(set.cabinet) !== DEFAULT_STYLE) ? set.cabinet : 'default';
    cab.addEventListener('change', () => {
      set.cabinet = cab.value;
      syncBody();
      void changed();
    });
    cabRow.append(el('span', str('arcade.wizard.model'), { class: 'row-label' }), cab);
    box.append(cabRow);
    enhanceSelect(cab, { small: true });
    const trimRow = el('div', null, { class: 'menu-row nb-kv wz-look-row' });
    const trim = el('input', null, { type: 'color', 'aria-label': str('arcade.wizard.trim_colour'), class: 'wiz-colour' });
    trim.value = g.trim;
    this.trimInput = trim;
    const trimReset = iconButton(UI_ICONS.reset, str('arcade.wizard.reset_trim_colour'), () => {
      delete set.trim;
      trim.value = g.trim;
      syncTrim();
      void changed();
    });
    trimReset.className = 'nb-mini-btn wz-trim-reset';
    const syncTrim = (): void => {
      const off = !!set.trim;
      trimReset.classList.toggle('off-neutral', off);
      trimReset.disabled = !off;
    };
    trim.addEventListener('input', () => {
      set.trim = trim.value;
      syncTrim();
      if (this.preview?.root.isConnected) void this.preview?.rebuild();
    });
    trim.addEventListener('change', () => {
      set.trim = trim.value;
      syncTrim();
      if (this.preview?.root.isConnected) void this.preview?.rebuild();
      void this.save();
    });
    const trimEnd = el('span', null, { class: 'wz-trim' });
    trimEnd.append(trimReset, trim);
    trimRow.append(el('span', str('arcade.wizard.trim_colour'), { class: 'row-label' }), trimEnd);
    syncTrim();
    box.append(trimRow);
    const bodyRow = el('div', null, { class: 'menu-row nb-kv wz-look-row' });
    const body = el('input', null, { type: 'color', 'aria-label': str('arcade.wizard.body_colour'), class: 'wiz-colour' });
    const bodyReset = iconButton(UI_ICONS.reset, str('arcade.wizard.reset_body_colour'), () => {
      delete set.body;
      syncBody();
      void changed();
    });
    bodyReset.className = 'nb-mini-btn wz-trim-reset';
    function syncBody(): void {
      body.value = set.body ?? styleBody(set.cabinet);
      const off = !!set.body;
      bodyReset.classList.toggle('off-neutral', off);
      bodyReset.disabled = !off;
      bodyRow.hidden = models.some((mdl) => mdl.id === set.cabinet);
    }
    body.addEventListener('input', () => {
      set.body = body.value;
      syncBody();
      if (this.preview?.root.isConnected) void this.preview?.rebuild();
    });
    body.addEventListener('change', () => {
      set.body = body.value;
      syncBody();
      if (this.preview?.root.isConnected) void this.preview?.rebuild();
      void this.save();
    });
    const surface = el('select', null, { 'aria-label': str('arcade.wizard.body_material') });
    surface.append(
      el('option', str('arcade.wizard.body_wood'), { value: 'wood' }),
      el('option', str('arcade.wizard.body_plastic'), { value: 'plastic' }),
    );
    surface.value = set.surface ?? 'wood';
    surface.addEventListener('change', () => {
      if (surface.value === 'plastic') set.surface = 'plastic';
      else delete set.surface;
      void changed();
    });
    const bodyEnd = el('span', null, { class: 'wz-trim' });
    bodyEnd.append(surface, bodyReset, body);
    bodyRow.append(el('span', str('arcade.wizard.body_colour'), { class: 'row-label' }), bodyEnd);
    syncBody();
    box.append(bodyRow);
    enhanceSelect(surface, { small: true });
    this.cabGroup = group(str('arcade.wizard.cabinet'), box);
    this.panel.append(this.cabGroup);
    this.fitView?.dispose();
    this.fitView = null;
    this.fitGroup = null;
    if (det && g.cab) {
      const content = g.cab.content;
      const next = (name: PanelName, q: Quad): Partial<Record<PanelName, Quad>> | null => {
        const held = clampQuad(q, content);
        if (!isConvexQuad(held)) return null;
        if (name === 'glass' || !hasDeck(set, det)) return { [name]: held };
        const both = resolveFit(set, det, true);
        return withBox({ buttons: both.buttons!, deck: both.deck! }, name, held);
      };
      const setBox = (name: PanelName, q: Quad, done: boolean): boolean => {
        const n = next(name, q);
        if (!n) return false;
        Object.assign(set, n);
        this.lookChanged(done);
        return true;
      };
      const wasActive = this.lookActive;
      const fit = new FitView({
        content,
        source: () => g.layoutCanvas,
        boxes: (hasButtons) => resolveFit(set, det, hasButtons && !set.noLower),
        isSet: (name) => isSetBox(set, det, name),
        split: det.split,
        onChange: (name, q, done) => setBox(name, q, done),
        accepts: (name, q) => !!next(name, q),
        onActive: (name) => { this.lookActive = name; },
        onReset: (name) => {
          const names: PanelName[] = name === 'all' ? ['glass', 'buttons', 'deck'] : [name];
          let s2: FitSet = { glass: set.glass, buttons: set.buttons, deck: set.deck, noDeck: set.noDeck };
          for (const n of names) s2 = resetBox(s2, det, n);
          for (const k of ['glass', 'buttons', 'deck'] as const) { if (s2[k]) set[k] = s2[k]; else delete set[k]; }
          this.lookChanged(true);
          fit.sync();
        },
        canAddDeck: () => !!addDeck({ ...set, deck: undefined }, det),
        noLower: () => !!set.noLower,
        onLower: (on) => {
          if (on) delete set.noLower; else set.noLower = true;
          this.lookChanged(true);
        },
        onDeck: (on) => {
          if (on) {
            delete set.noDeck;
            const a = addDeck({ ...set, deck: undefined }, det);
            if (!a) return;
            if (set.buttons) set.buttons = a.buttons;
            if (det.split === 'none' || !a.proposed) set.deck = a.deck; else delete set.deck;
          } else {
            const lower = removeDeck(set, det);
            set.noDeck = true;
            delete set.deck;
            if (lower) set.buttons = lower; else delete set.buttons;
          }
          this.lookChanged(true);
        },
      });
      fit.setPanels(this.preview?.panels ?? null);
      fit.setActive(wasActive);
      this.fitView = fit;
      this.fitGroup = group(str('arcade.wizard.fit'), fit.root);
      this.panel.append(this.fitGroup);
    }
    this.side = this.stage.clientWidth >= SIDE_W && this.stage.clientHeight >= SIDE_H;
    this.syncLookPanel();
    this.showView();
  }

  private fitView: FitView | null = null;

  private trimInput: HTMLInputElement | null = null;

  private lookChanged(done: boolean): void {
    if (done) this.live3d.cancel();
    else if (this.preview?.root.isConnected) this.live3d.move();
    settleLook(done, {
      apply: () => this.applyLook(),
      showTrim: () => { if (this.trimInput && !this.m.setup.trim) this.trimInput.value = this.wm.glass.trim; },
      rebuild: () => { void this.preview?.rebuild(); },
      save: () => { void this.save(); },
    });
  }

  private applyLook(): void {
    this.wm.glass.applyFit();
  }

  private refillOff(): void {
    if (!this.refillOn) return;
    this.refillOn = false;
    if (this.wm.live.running) this.wm.refillSwitch()?.set(false);
  }

  private renderFill(): void {
    const v = moneyTrust(this.m.board);
    const money = checklist();
    money.append(v.trust === 'billable'
      ? checkItem('pass', str('arcade.wizard.money_in_and_out_are'))
      : v.trust === 'untrusted' ? checkItem('warn', PAYOUT_UNVERIFIED)
        : checkItem('warn', NO_BOOKKEEPING));
    if (this.unpriced) money.append(checkItem('warn', str('arcade.wizard.some_payouts_cannot_be_counted')));
    const fill = card();
    const refill = this.wm.live.running ? this.wm.refillSwitch() : null;
    if (refill) {
      const { row: r, box } = checkRow(refill.label, (on) => { this.refillOn = on; refill.set(on); });
      box.checked = this.refillOn;
      fill.append(r);
    }
    const g = wizSection;
    this.panel.append(g(str('arcade.wizard.money'), money));
    if (fill.childElementCount) this.panel.append(g(str('arcade.wizard.fill'), fill));
    this.slotMarks.replaceChildren();
    const coins = this.renderCoins();
    if (coins) this.panel.append(g(str('arcade.wizard.coins'), coins));
    this.nav(undefined, this.coinsWired());
  }

  private wiringRun: 'no' | 'running' | 'done' = 'no';

  private serverCoinsStopped: boolean | null = null;

  private wireSlots(): WireSlot[] {
    const game = this.wm.glass.game;
    const cab = this.wm.glass.cab;
    if (!game || !cab || !this.wm.live.running) return [];
    return slotsToWire(cab.lamps, viewFor(game.system), this.wm.live.emu.info);
  }

  private wiring(): CoinWiring {
    return readCoinWiring(this.m.config.coins);
  }

  private slotless: number[] | null = null;

  private slotlessLines(): number[] {
    if (this.slotless) return this.slotless;
    const info = this.wm.live.emu.info;
    if (!this.wm.live.running || !info?.slotlessCoins?.length) return [];
    if (this.wireSlots().length && this.wiringRun !== 'done') return [];
    const f = this.wm.live.emu.latestFrame();
    if (!f) return [];
    this.slotless = slotlessToWire(info, (f.coinRefusing | f.coinLinesShut) >>> 0, this.wiring());
    return this.slotless;
  }

  private coinsWired(): boolean {
    const w = this.wiring();
    const valued = readPayoutValues(this.m.config.payouts);
    return this.wiringRun !== 'running'
      && (this.wm.live.emu.info?.tokenPayouts ?? []).every((l) => valued[String(l)])
      && this.wireSlots().every((s) => (w[String(s.line)]?.coins.some((c) => c.line !== null) ?? false))
      && this.slotlessLines().every((l) => w[String(l)] !== undefined)
      && !this.markDrafts.length
      && markedSlots(w).every(({ slot }) => slot.checked === true);
  }

  private setWiring(w: CoinWiring): void {
    const info = this.wm.live.emu.info;
    const placed = info ? wiringFinder.mapAsked(w, info) : w;
    const coins = Object.keys(placed).length ? placed : undefined;
    for (const c of [this.m.config, this.draft, this.wm.machine.config]) {
      if (coins) c.coins = structuredClone(coins);
      else delete c.coins;
    }
    this.wm.live.applyWiring(placed);
    void this.save();
  }

  private async findWiring(): Promise<void> {
    if (this.wiringRun !== 'no' || this.booting) return;
    const info = this.wm.live.emu.info;
    let need = this.wireSlots().map((s) => s.line).filter((l) => !this.wiring()[String(l)]);
    if (!info || !need.length) {
      this.wiringRun = 'done';
      if (!this.gone() && this.step === FILL) this.render();
      return;
    }
    const old = wiringFor(undefined, this.wm.machine.held?.coinAnswers, null);
    this.wiringRun = 'running';
    if (this.step === FILL) this.render();
    try {
      for (const find of [wiringFinder.detect, wiringFinder.measure]) {
        if (!need.length || this.gone()) break;
        const got = await find({ slots: need, info }, this.wm.live.emu).catch((e) => {
          console.warn('[arcade] the coin wiring could not be found', e);
          return null;
        });
        if (!got) continue;
        const w = this.wiring();
        for (const l of need) if (got[String(l)]?.coins.length) w[String(l)] = got[String(l)];
        this.setWiring(w);
        need = need.filter((l) => !w[String(l)]);
      }
      if (need.length && Object.keys(old).length) {
        const w = this.wiring();
        for (const l of need) if (old[String(l)]) w[String(l)] = old[String(l)];
        this.setWiring(w);
      }
    } finally {
      this.wiringRun = 'done';
      if (!this.gone() && this.step === FILL) this.render();
    }
  }

  private slotNotes(s: SlotWiring | undefined, found: boolean): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (found && s?.how === 'measured') out.push(el('span', str('arcade.wizard.if_one_of_these_is'), { class: 'coin-slot-note' }));
    if (!s) return out;
    const lost = unplacedCoins(s);
    if (lost.length && lost.length === s.coins.length) {
      out.push(el('span', str('arcade.wizard.this_machine_takes_one_coin'), { class: 'coin-slot-note warn' }));
    } else if (lost.length) {
      out.push(el('span', str('arcade.wizard.players_won_t_be_offered', { 0: lost.map(slotCoinLabel).join(', '), 1: lost.length === 1 ? 'it' : 'them' }), { class: 'coin-slot-note warn' }));
    }
    return out;
  }

  private renderCoins(): HTMLElement | null {
    const slots = this.wireSlots();
    const marking = this.markOffer();
    const tokenOuts = this.wm.live.emu.info?.tokenPayouts ?? [];
    if (!slots.length && !this.wm.live.emu.info?.slotlessCoins?.length && !marking && !tokenOuts.length) return null;
    if (this.wiringRun === 'no') { queueMicrotask(() => { void this.findWiring(); }); }
    const box = card();
    if (this.wiringRun !== 'done') {
      box.append(oneCheck('running', str('arcade.wizard.checking_which_coins_the_machine')));
      return box;
    }
    const w = this.wiring();
    if (this.serverCoinsStopped === null) {
      this.serverCoinsStopped = false;
      void serverMoney(this.doc.id, this.m.id).then((r) => {
        if (!r?.coinsStopped || this.gone()) return;
        this.serverCoinsStopped = true;
        if (this.step === FILL) this.render();
      });
    }
    if (this.serverCoinsStopped || this.wm.live.coinsStopped || this.wm.coinsStopped()) box.append(oneCheck('warn', COINS_STOPPED_HOST_TEXT, COINS_STOPPED_HOST_NOTE_WIZARD));
    slots.forEach((slot, i) => {
      const name = slots.length === 1 ? str('arcade.wizard.coin_slot') : str('arcade.wizard.coin_slot_n', { 0: i + 1 });
      const now = w[String(slot.line)];
      const found = now?.how === 'detected' || now?.how === 'measured';
      const head = el('div', null, { class: 'coin-slot-head' });
      head.append(
        el('span', name, { class: 'row-label' }),
        el('span', found
          ? str('arcade.wizard.found_on_the_machine_n', { 0: now.coins.map((c) => slotCoinLabel(c.coin)).join(', ') })
          : str('arcade.wizard.which_coins_does_this_slot'), { class: 'nb-meta' }),
      );
      const ticks = coinTicks({
        label: name,
        start: now?.coins.map((c) => c.coin) ?? [],
        onChange: (coins: SlotCoin[]) => {
          const next = this.wiring();
          if (coins.length) next[String(slot.line)] = editedSlot(next[String(slot.line)], slot.line, coins);
          else delete next[String(slot.line)];
          this.setWiring(next);
          if (this.serverCoinsStopped) { this.serverCoinsStopped = false; this.render(); }
          this.nav(undefined, this.coinsWired());
          this.renderStrip();
          notes.replaceChildren(...this.slotNotes(this.wiring()[String(slot.line)], found));
        },
      });
      const notes = el('div', null, { class: 'coin-slot-notes' });
      notes.append(...this.slotNotes(now, found));
      const row = el('div', null, { class: 'coin-slot' });
      row.append(head, ticks.root, notes);
      box.append(row);
      if (slots.length > 1) this.glassMark(i + 1, slot, row);
    });
    this.renderSlotless(box);
    if (marking) this.renderMarked(box);
    this.renderTokenPayouts(box, tokenOuts);
    return box.childElementCount ? box : null;
  }

  private renderTokenPayouts(box: HTMLElement, lines: readonly number[]): void {
    lines.forEach((line, i) => {
      const name = lines.length === 1 ? str('arcade.wizard.token_payout') : str('arcade.wizard.token_payout_n', { 0: i + 1 });
      const sel = document.createElement('select');
      sel.className = 'coin-token-value';
      sel.setAttribute('aria-label', name);
      const none = document.createElement('option');
      none.value = '';
      none.textContent = str('coinask.no_value');
      sel.append(none, ...TOKEN_VALUES.map((p) => {
        const o = document.createElement('option');
        o.value = String(p);
        o.textContent = cashLabel(p);
        return o;
      }));
      sel.value = String(readPayoutValues(this.m.config.payouts)[String(line)] ?? '');
      sel.addEventListener('change', () => {
        const next = readPayoutValues(this.m.config.payouts);
        if (sel.value) next[String(line)] = Number(sel.value);
        else delete next[String(line)];
        for (const c of [this.m.config, this.draft, this.wm.machine.config]) {
          if (Object.keys(next).length) c.payouts = { ...next };
          else delete c.payouts;
        }
        this.wm.live.applyPayouts(next);
        void this.save();
        this.nav(undefined, this.coinsWired());
        this.renderStrip();
      });
      const head = el('div', null, { class: 'coin-slot-head' });
      head.append(el('span', name, { class: 'row-label' }));
      const row = el('div', null, { class: 'coin-slot' });
      row.append(head, sel);
      box.append(row);
      enhanceSelect(sel, { small: true });
    });
  }

  private glassMark(n: number | string, at: { left: number; top: number; width: number; height: number }, row?: HTMLElement): HTMLElement | null {
    const col = this.wm.glass.shown;
    if (!col) return null;
    const mark = el('span', null, { class: 'wz-slot-mark', 'data-n': String(n) });
    mark.style.left = `${((at.left - col.left) / col.width) * 100}%`;
    mark.style.top = `${((at.top - col.top) / col.height) * 100}%`;
    mark.style.width = `${(at.width / col.width) * 100}%`;
    mark.style.height = `${(at.height / col.height) * 100}%`;
    this.slotMarks.append(mark);
    if (row) this.lightWith(mark, row);
    return mark;
  }

  private lightWith(mark: HTMLElement, row: HTMLElement): void {
    const lit = (on: boolean): void => { mark.classList.toggle('on', on); };
    row.addEventListener('pointerenter', () => lit(true));
    row.addEventListener('pointerleave', () => lit(row.contains(document.activeElement)));
    row.addEventListener('focusin', () => lit(true));
    row.addEventListener('focusout', () => lit(false));
  }

  private renderSlotless(box: HTMLElement): void {
    const lines = this.slotlessLines();
    if (!lines.length) return;
    const w = this.wiring();
    box.append(el('p', str('arcade.wizard.no_slot_note'), { class: 'coin-slot-note coin-slot-lead' }));
    lines.forEach((line, i) => {
      const name = lines.length === 1 ? str('arcade.wizard.slotless_coin') : str('arcade.wizard.slotless_coin_n', { 0: i + 1 });
      const now = w[String(line)];
      const head = el('div', null, { class: 'coin-slot-head' });
      head.append(
        el('span', name, { class: 'row-label' }),
        el('span', str('arcade.wizard.which_coin_is_this'), { class: 'row-sub' }),
      );
      const ticks = coinTicks({
        label: name,
        single: true,
        start: now?.coins.map((c) => c.coin) ?? [],
        unused: now !== undefined && !now.coins.length,
        onChange: (coins: SlotCoin[], unused: boolean) => {
          const next = this.wiring();
          if (coins.length) next[String(line)] = { coins: [{ coin: coins[0], line }], how: 'asked' };
          else if (unused) next[String(line)] = { coins: [], how: 'asked' };
          else delete next[String(line)];
          this.setWiring(next);
          if (this.serverCoinsStopped) { this.serverCoinsStopped = false; this.render(); }
          this.nav(undefined, this.coinsWired());
          this.renderStrip();
        },
      });
      const row = el('div', null, { class: 'coin-slot' });
      row.append(head, ticks.root);
      box.append(row);
    });
  }

  private markDrafts: { line: number | null; coin: SlotCoin | null }[] = [];
  private markChecks = new Map<number, 'running' | 'counted' | 'not-counted' | 'unmeasured'>();
  private markQueue: Promise<void> = Promise.resolve();

  private markables(): MarkableButton[] {
    const game = this.wm.glass.game;
    const cab = this.wm.glass.cab;
    if (!game || !cab || !this.wm.live.running) return [];
    return markableButtons(cab.lamps, viewFor(game.system), new Set(markedSlots(this.wiring()).map((m) => m.line)));
  }

  private markOffer(): boolean {
    if (!this.markables().length) return false;
    if (markedSlots(this.wiring()).length || this.markDrafts.length) return true;
    return !this.wireSlots().length && !this.wm.live.emu.info?.slotlessCoins?.length && !this.wm.coinSlot();
  }

  private checkMarked(line: number): void {
    if (this.markChecks.get(line) === 'running') return;
    this.markChecks.set(line, 'running');
    this.markQueue = this.markQueue.then(async () => {
      if (this.gone()) return;
      const got = await this.wm.live.emu.measureCoins([line]).catch((e) => {
        console.warn('[arcade] a marked coin button could not be checked', e);
        return null;
      });
      const verdict = markedCounted(got?.result, line);
      console.info(`[arcade] marked coin button on line ${line}: ${verdict}`);
      this.markChecks.set(line, verdict);
      if (this.gone()) return;
      const w = this.wiring();
      const s = w[String(line)];
      if (s?.how === 'marked' && !!s.checked !== (verdict === 'counted')) {
        w[String(line)] = { ...s, ...(verdict === 'counted' ? { checked: true } : {}) };
        if (verdict !== 'counted') delete w[String(line)].checked;
        this.setWiring(w);
      }
      if (this.step === FILL) this.render();
    });
  }

  private keepMarked(line: number, coin: SlotCoin): void {
    const w = this.wiring();
    const counted = this.markChecks.has(line) ? this.markChecks.get(line) === 'counted' : !!w[String(line)]?.checked;
    w[String(line)] = { coins: [{ coin, line }], how: 'marked', ...(counted ? { checked: true } : {}) };
    this.setWiring(w);
  }

  private dropMarked(line: number): void {
    const w = this.wiring();
    if (w[String(line)]?.how !== 'marked') return;
    delete w[String(line)];
    this.setWiring(w);
  }

  private renderMarked(box: HTMLElement): void {
    const buttons = this.markables();
    const game = this.wm.glass.game;
    const info = this.wm.live.emu.info;
    if (!game || !info) return;
    const view = viewFor(game.system);
    const names = new Map<number, string>();
    const marks = new Map<number, HTMLElement>();
    buttons.forEach((b, i) => {
      const letter = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
      const named = controlNaming(b.lamp, view, info.coins ?? view.coins, info.capNames, info.coinPort);
      names.set(b.line, named.source === 'none' ? str('arcade.wizard.button_letter', { 0: letter }) : str('arcade.wizard.button_letter_named', { 0: letter, 1: named.label }));
      const mark = this.glassMark(letter, b.lamp);
      if (mark) marks.set(b.line, mark);
    });
    const w = this.wiring();
    const rows: { line: number | null; coin: SlotCoin | null; draft: number | null }[] = [
      ...markedSlots(w).map(({ line, slot }) => ({ line, coin: slot.coins[0]?.coin ?? null, draft: null })),
      ...this.markDrafts.map((d, i) => ({ line: d.line, coin: d.coin, draft: i })),
    ];
    box.append(el('p', str('arcade.wizard.mark_lead'), { class: 'coin-slot-note coin-slot-lead' }));
    const taken = new Set(rows.map((r) => r.line).filter((l): l is number => l !== null));
    rows.forEach((r, i) => {
      const name = rows.length === 1 ? str('arcade.wizard.coin_button') : str('arcade.wizard.coin_button_n', { 0: i + 1 });
      if (r.line !== null && !w[String(r.line)]?.checked && !this.markChecks.has(r.line)) this.checkMarked(r.line);
      const check = r.line === null ? null : w[String(r.line)]?.checked ? 'counted' : this.markChecks.get(r.line) ?? null;
      const head = el('div', null, { class: 'coin-slot-head' });
      head.append(el('span', name, { class: 'row-label' }), el('span', str('arcade.wizard.which_button_and_coin'), { class: 'row-sub' }));
      const sel = el('select', null, { 'aria-label': str('arcade.wizard.which_button') }) as HTMLSelectElement;
      if (r.line === null) sel.append(el('option', str('arcade.wizard.choose_a_button'), { value: '' }));
      for (const b of buttons) if (b.line === r.line || !taken.has(b.line)) sel.append(el('option', names.get(b.line) ?? '', { value: String(b.line) }));
      sel.value = r.line === null ? '' : String(r.line);
      sel.addEventListener('change', () => {
        const line = Number(sel.value);
        if (!sel.value || line === r.line) return;
        if (r.draft === null && r.line !== null) {
          this.dropMarked(r.line);
          this.markDrafts.push({ line, coin: r.coin });
        } else if (r.draft !== null) this.markDrafts[r.draft] = { line, coin: r.coin };
        this.settleDrafts();
        this.render();
      });
      const pick = el('div', null, { class: 'coin-mark-pick' });
      pick.append(sel);
      enhanceSelect(sel, { small: true });
      const ticks = coinTicks({
        label: name, single: true, noUnused: true,
        start: r.coin === null ? [] : [r.coin],
        onChange: (coins: SlotCoin[]) => {
          const coin = coins[0] ?? null;
          if (r.draft === null && r.line !== null) {
            if (coin === null) { this.dropMarked(r.line); this.markDrafts.push({ line: r.line, coin: null }); } else this.keepMarked(r.line, coin);
          } else if (r.draft !== null) this.markDrafts[r.draft] = { line: r.line, coin };
          this.settleDrafts();
          this.render();
        },
      });
      const remove = actionButton(str('arcade.wizard.remove'), 'tertiary', () => {
        if (r.draft !== null) this.markDrafts.splice(r.draft, 1);
        else if (r.line !== null) this.dropMarked(r.line);
        this.render();
      });
      const row = el('div', null, { class: 'coin-slot' });
      row.append(head, pick, ticks.root);
      if (check === 'running') row.append(oneCheck('running', str('arcade.wizard.mark_checking')));
      else if (check === 'counted') row.append(oneCheck('pass', str('arcade.wizard.mark_counted')));
      else if (check === 'not-counted') row.append(oneCheck('fail', str('arcade.wizard.mark_not_counted')));
      else if (check === 'unmeasured') row.append(oneCheck('fail', str('arcade.wizard.mark_unmeasured')));
      row.append(remove);
      box.append(row);
      const mark = r.line === null ? undefined : marks.get(r.line);
      if (mark) this.lightWith(mark, row);
    });
    if (taken.size < buttons.length && !this.markDrafts.some((d) => d.line === null)) {
      const add = actionButton(str('arcade.wizard.add_a_coin_button'), 'secondary', () => {
        this.markDrafts.push({ line: null, coin: null });
        this.render();
      });
      add.classList.add('coin-slot-add');
      box.append(add);
    }
  }

  private settleDrafts(): void {
    const keep: typeof this.markDrafts = [];
    for (const d of this.markDrafts) {
      if (d.line !== null && d.coin !== null) this.keepMarked(d.line, d.coin);
      else keep.push(d);
      if (d.line !== null && !this.markChecks.has(d.line)) this.checkMarked(d.line);
    }
    this.markDrafts = keep;
  }

  private autoTestedFor: string | null = null;
  private testing = false;
  private noCoinSlot = false;

  private testPassed(): boolean {
    const v = this.m.validation;
    if (!v || v.config !== configDigest(this.m.config)) return false;
    return (!!v.skipped && !this.noCoinSlot) || TEST_CHECKS.every((c) => this.result(c.id)?.pass === true);
  }

  private skipTest(): void {
    const v = this.m.validation;
    if (!v || v.config !== configDigest(this.m.config) || this.noCoinSlot) return;
    v.skipped = true;
    this.render();
    void this.save();
  }

  private testCanRun(): boolean {
    return this.booted && this.wm.live.running && !this.busy && this.rec === 'done';
  }

  private maybeAutoTest(): void {
    if (this.step !== FINISH || !this.testCanRun() || this.testPassed()) return;
    const cfg = configDigest(this.m.config);
    if (this.autoTestedFor === cfg) return;
    this.autoTestedFor = cfg;
    queueMicrotask(() => { if (this.step === FINISH) void this.runTest(); });
  }

  private async runTest(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.testing = true;
    this.testFrom = performance.now();
    this.noCoinSlot = false;
    const wm = this.wm;
    this.freshValidation(TEST_CHECKS);
    this.render();
    let snap: Snapshot | null = null;
    try {
      this.say(str('arcade.wizard.saving_machine_state'));
      snap = await wm.snapshot();
      if (!snap) { this.setCheck('coin', false, str('arcade.wizard.the_machine_state_could_not')); return; }
      this.preTest = snap;
      await this.coinAndStart();
    } finally {
      this.running = null;
      if (!this.stoodDown()) {
        this.finishValidation();
        const now = await wm.ledger();
        if (unpricedMoved(this.ledgerAtBoot, now)) this.unpriced = true;
        if (snap && !this.gone()) {
          this.say(str('arcade.wizard.restoring_machine_state'));
          try {
            await wm.restore(snap);
            this.say(str('arcade.wizard.in_attract'), 'pass');
          } catch (e) {
            this.say(str('arcade.wizard.could_not_restore_machine_state', { 0: (e as Error).message }), 'fail');
          }
        }
      }
      this.busy = false;
      this.testing = false;
      this.askStart = false;
      this.askCoin = false;
      this.testFrom = null;
      if (!this.stoodDown()) {
        this.render();
        if (this.failure() === 'test') this.selfTestFailed('test');
        await this.save();
      }
    }
  }

  private async coinAndStart(): Promise<void> {
    const wm = this.wm;
    this.running = 'coin';
    this.render();
    const slot = wm.coinSlot();
    const noBooks = moneyTrust(this.m.board).trust === 'none';
    const before = (await wm.ledger()) ?? (noBooks ? { inPence: 0 } as CashLedger : null);
    if (!before) { this.setCheck('coin', false, str('arcade.wizard.this_machine_keeps_no_money')); return; }
    const shownBefore = new Set(wm.secs.map((s) => s.line));
    const secsAtCoin = wm.secs.length;
    let after: CashLedger | null = before;
    let coins = 0;
    let wrong: number | null = null;
    const booked = (l: CashLedger | null): number => (l ? l.inPence - before.inPence : 0);
    const newOnGlass = (): boolean => wm.secs.slice(secsAtCoin).some((s) => s.line.trim() !== '' && !shownBefore.has(s.line));
    if (!slot) {
      this.askCoin = true;
      this.say(str('arcade.wizard.put_a_coin_in_on_the_machine'), 'warn');
      this.runNote = str('arcade.wizard.put_a_coin_in_on_the_machine_2');
      this.render();
      for (const tEnd = performance.now() + 60_000; performance.now() < tEnd;) {
        await sleep(300);
        after = await wm.ledger();
        if (booked(after) > 0 || (noBooks && newOnGlass())) break;
      }
      await sleep(600);
      after = await wm.ledger();
      this.askCoin = false;
      this.renderStrip();
    } else while (coins < (noBooks ? 1 : COINS_MAX) && booked(after) < CREDIT_PENCE) {
      this.say(str('arcade.wizard.putting_a_coin_in_n', { 0: coins + 1 }));
      this.runNote = str('arcade.wizard.putting_a_coin_in_n_2', { 0: coins + 1 });
      this.render();
      const was = booked(after);
      await wm.coin(slot.line);
      coins++;
      let took = false;
      for (const tEnd = performance.now() + 10_000; performance.now() < tEnd && !took;) {
        await sleep(300);
        after = await wm.ledger();
        took = booked(after) > was;
      }
      if (!took) { if (noBooks) await sleep(1500); break; }
      await sleep(600);
      after = await wm.ledger();
      const d = booked(after) - was;
      if (slot.pence != null && d !== slot.pence) { wrong = d; break; }
    }
    if (wm.coinsStopped()) { this.setCheck('coin', false, COINS_STOPPED_HOST_TEXT); return; }
    const moneyMoved = booked(after) > 0;
    if (!moneyMoved) {
      const f = wm.live.emu.latestFrame();
      const game = wm.glass.game;
      this.noCoinSlot = !!f && takesNoCoinAtAll(wm.live.emu.info, (f.coinRefusing | f.coinLinesShut) >>> 0, game ? viewFor(game.system).coins : []);
      if (this.noCoinSlot) {
        console.info(`[arcade] no coin slot the host can price: every coin line this machine lists is refused at attract (${((f!.coinRefusing | f!.coinLinesShut) >>> 0).toString(2)}); not installed`);
        this.setCheck('coin', false, str('arcade.wizard.no_coin_slot_layout_needs_fixing'));
        return;
      }
    }
    await wm.until(() => wm.secs.length >= secsAtCoin + 2, 4000);
    const readable = wm.glassReadable();
    const glassMoved = !readable || newOnGlass();
    if (!moneyMoved && noBooks) {
      this.setCheck('coin', glassMoved, str('arcade.wizard.1_coin_n_n', { 0: NO_BOOKKEEPING, 1: (!readable ? str('arcade.wizard.no_display_on_this_cabinet') : glassMoved ? str('arcade.wizard.the_display_changed') : str('arcade.wizard.the_display_showed_nothing_new')) }));
      if (!glassMoved) return;
    } else {
      if (!moneyMoved) { this.setCheck('coin', false, str('arcade.wizard.no_money_booked_after_a')); return; }
      if (wrong !== null && slot) {
        this.setCheck('coin', false, str('arcade.wizard.a_n_coin_booked_n', { 0: pounds(slot.pence!), 1: pounds(wrong) }));
        return;
      }
      const money = !slot ? str('arcade.wizard.money_put_in_by_you', { money: pounds(booked(after)) })
        : (slot.pence == null ? str('arcade.wizard.money_from_coins_unpriced', { money: pounds(booked(after)), n: coins }) : str('arcade.wizard.money_from_coins', { money: pounds(booked(after)), n: coins }));
      this.setCheck('coin', glassMoved, !glassMoved
        ? str('arcade.wizard.n_but_the_display_showed', { 0: money })
        : readable ? money : str('arcade.wizard.n_no_display_on_this', { 0: money }));
      if (!glassMoved) return;
    }
    this.running = 'spin';
    this.runNote = str('arcade.wizard.waiting_for_the_reels_to');
    this.render();
    await wm.until(() => wm.secs.length >= 2 && wm.secs.slice(-2).every((s) => !s.reels), 15_000);
    const caps = wm.startCaps();
    let moved = false;
    let pressed: string | null = null;
    for (const cap of caps) {
      const travel0 = wm.travel;
      this.say(str('arcade.wizard.pressing_start'));
      this.runNote = str('arcade.wizard.pressing_n', { 0: cap.name });
      this.render();
      wm.resetVideoPlay();
      await wm.tap(cap.lp);
      moved = await wm.until(() => wm.travel > travel0 || wm.videoPlayed(), 12_000);
      if (moved) { pressed = cap.name; break; }
    }
    if (!moved) {
      const travel0 = wm.travel;
      this.askStart = true;
      this.say(str('arcade.wizard.press_start_on_the_machine'), 'warn');
      this.runNote = str('arcade.wizard.press_start_on_the_machine_2');
      this.render();
      wm.resetVideoPlay();
      moved = await wm.until(() => wm.travel > travel0 || wm.videoPlayed(), 60_000);
      this.askStart = false;
      this.renderStrip();
    }
    this.setCheck('spin', moved,
      moved ? (pressed ? str('arcade.wizard.pressed_n', { 0: pressed }) : str('arcade.wizard.start_pressed'))
        : caps.length ? str('arcade.wizard.the_reels_did_not_move', { 0: caps[0].name }) : str('arcade.wizard.no_start_press_moved_the'));
  }

  private trust(): DocMachine['money'] {
    const t = moneyTrust(this.m.board).trust;
    return t === 'billable' && this.unpriced ? 'untrusted' : t;
  }

  private blockers(): string[] {
    const why: string[] = [];
    const v = this.m.validation;
    if (!this.booted && !(this.mode === 'edit' && this.bootPassedBefore())) why.push(str('arcade.wizard.step_1_has_not_passed'));
    if (this.testing) why.push(str('arcade.wizard.the_test_is_running'));
    else if (this.testPassed()) {  }
    else if (!v || v.config !== configDigest(this.m.config) || TEST_CHECKS.some((c) => this.result(c.id)?.pass == null)) {
      why.push(str('arcade.wizard.the_test_has_not_run'));
    } else if (!this.testPassed()) why.push(str('arcade.wizard.the_test_has_not_passed'));
    if (!this.wm.live.running) why.push(str('arcade.wizard.the_machine_is_not_running_2'));
    return why;
  }

  private renderFinish(): void {
    const sum = checklist();
    sum.classList.add('wiz-checks');
    const line = (mark: Mark, text: string): void => { sum.append(checkItem(mark, text)); };
    line(this.booted || this.bootPassedBefore() ? 'pass' : 'fail', str('arcade.wizard.boots_into_attract_with_no'));
    line(this.settled || this.mode === 'edit' ? 'pass' : 'pending', str('arcade.wizard.settings_chosen'));
    const tm = moneyTrust(this.m.board);
    line(tm.trust === 'billable' ? 'pass' : 'warn', tm.trust === 'none' ? NO_BOOKKEEPING
      : tm.trust === 'untrusted' ? PAYOUT_UNVERIFIED : str('arcade.wizard.books_money_in_and_out'));
    this.checkRows(sum, TEST_CHECKS, this.running, !this.booted ? str('arcade.wizard.runs_once_step_1_has') : null);
    if (this.m.validation?.skipped && this.testPassed()) line('warn', str('arcade.wizard.test_skipped_installing_without_it'));
    this.panel.append(sum);
    this.failedNote('test');
    const why = this.blockers();
    this.nav(str('arcade.wizard.finish'), !why.length && this.rec === 'done', () => { void this.finish(); });
    if (this.rec === 'needs') this.panel.append(el('p', NEEDS_TEXT, { class: 'host-note' }));
    else if (this.rec === 'broken') this.panel.append(el('p', this.recNote, { class: 'host-note' }));
    else if (this.rec !== 'done' && this.booted) this.panel.append(el('p', str('arcade.wizard.getting_the_machine_ready_2'), { class: 'wiz-wait' }), this.readyBar);
    else if (this.testing) this.panel.append(this.readyBar);
    else if (why.length) this.panel.append(el('p', str('arcade.wizard.not_yet_n', { 0: why.join('; ') }), { class: 'host-note' }));
  }

  private async finish(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      if (this.preTest) {
        this.say(str('arcade.wizard.restoring_machine_state'));
        await this.wm.restore(this.preTest);
      }
      const reading = await this.wm.ledger();
      if (unpricedMoved(this.ledgerAtBoot, reading)) this.unpriced = true;
      this.say(str('arcade.wizard.saving_the_machine'));
      await this.wm.saveNow();
      const g = this.wm.glass;
      const m = this.m;
      m.status = 'installed';
      m.installedAt ??= Date.now();
      m.money = this.trust();
      m.gameConfig = g.game ? configOf(g.game) : null;
      if (g.game) {
        const def = await definitionOf(g.game);
        m.hostFiles = def.hostFiles;
        m.versions = def.versions;
      }
      keepCoinAnswers(m, this.wm.machine.held?.coinAnswers);
      m.detected = {
        glass: g.detected ? quadOfRect(g.detected.glass) : undefined,
        buttons: g.detected ? quadOfRect(g.detected.buttons) : undefined,
        deck: g.detected ? quadOfRect(g.detected.deck) : undefined,
        cabinetStyle: g.cabinetStyle,
      };
      m.balance.push({ at: Date.now(), kind: m.balance.some((b) => b.kind === 'float') ? 'reading' : 'float', ledger: reading });
      this.finishValidation();
      await this.save();
      void syncArcade(this.doc);
      const hash = this.wm.machine.held?.hash;
      if (hash) await invalidateRec(hash);
      this.preview?.dispose();
      this.back();
    } catch (e) {
      this.say(str('arcade.wizard.finish_failed_n', { 0: (e as Error).message }), 'fail');
      this.busy = false;
      this.render();
    }
  }
}

function cloneConfig(c: MachineConfig): MachineConfig {
  return {
    optionKeys: { ...(c.optionKeys ?? {}) }, panelSwitches: { ...(c.panelSwitches ?? {}) },
    ...(c.coins ? { coins: structuredClone(c.coins) } : {}),
  };
}

function normConfig(c: MachineConfig): MachineConfig {
  return {
    ...(c.optionKeys && Object.keys(c.optionKeys).length ? { optionKeys: { ...c.optionKeys } } : {}),
    ...(c.panelSwitches && Object.keys(c.panelSwitches).length ? { panelSwitches: { ...c.panelSwitches } } : {}),
    ...(c.coins && Object.keys(c.coins).length ? { coins: structuredClone(c.coins) } : {}),
  };
}
