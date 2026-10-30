import { WorkerEmu, type AutosaveBlob } from '../web/emu-client';
import { getMeta, playCountOf, putMeta } from '../web/store';
import { coinChoices, slotCoinLabel, slotCoinPence, slotlessChoices, isTokenCoin, wiredCoinOn, type CoinChoice, type CoinWiring } from '../web/coinask';
import type { OwnCoins } from '../web/menupanels';
import { coinsForLoad, markedChutes, takesACoin, unsetCoinLine, wiringFor } from './coinwiring';
import { openCoinMenu } from '../web/ui/coinmenu';
import { UI_ICONS } from '../web/ui/icons';
import {
  decodeState, deflatedRecord, idleNamedInputs, stateRecord,
} from '../web/gamestate';
import { boardStamp } from '../web/boardstamp';
import { resumesOn, versionOf } from '../web/play/savedversion';
import type { StateRec } from '../web/store';
import { cabinetSurfaces, classifyGlassCore, readGlass, type CabinetSurfaces } from '../src/machine/alarmread';
import { SNAPSHOT_VERSION, type Snapshot } from '../web/snapshot';
import { gatesOf } from '../web/play/gates';
import { Audio } from '../web/audio';
import { CabinetEffects } from '../web/effects';
import { restoreCabinetSounds } from '../web/menupanels';
import type { FrameView } from '../src/machine/framestate';
import { pickControl } from '../web/cabhit';
import { checkboxAt } from '../web/checkbox';
import { PlayKeys, type KeySurface } from '../web/play/keys';
import { answers, HeldButtons } from '../web/play/pointer';
import { PlayAutosave, type AutosaveSurface, type SaveMoment } from '../web/play/autosave';

import type { HintPlace } from '../web/keyhints';
import { acceptorResolve, stampCoinInputs, viewFor } from '../web/platform';
import { hasInput, type CabLamp } from '../web/dat';
import {
  HALT_NOTE_TEXT, StopWatch, judgeStop, noteReason, noteText, offersState, stopNoteParts, type StopNote,
} from '../web/stopnote';
import { liveValue } from '../web/settings';
import { logInputLabels } from '../web/downloads';
import { inflateSync, strFromU8 } from 'fflate';
import type { CheckResult } from '../web/relay';
import type { Glass } from './glass';
import type { ClaimEvents, ClaimResult, MoneyHooks, SlotKeyframe, StateSlot, Visit, WatchHandle } from './machines';
import type { RelayBatch } from './serverwire';
import { isToken, payForCoin, penceOf, unpriced, type Wallet } from './wallet';
import { unknownMoneyMoved } from './moneygate';
import { attractBudgetS, BootDoor, BootWatch } from './bootdoor';
import type { CashLedger, CoinChute } from '../src/machine/machine';
import type { MachineInfo } from '../web/emu-protocol';
import { SettleSave, reelPose } from './savepoint';
import { CreditWatch } from './moneyrecord';
import { ClaimTrigger, moneyMoved, walkUpStart } from './visit';
import { CARRY_ON_BUTTON, CreditSign, IdleClock, idleLimitsFrom, stillPlayingText } from './idle';
import { str } from '../web/i18n';

type StartOpts = { cold?: boolean; stampPlay?: boolean; saveOnLeave?: boolean; snapshot?: Snapshot; powerCycle?: boolean };

const VISIT_POLL_MS = 250;

const MONEY_WATCH_MS = 1000;

const UPDATED_WHY = 'cold boot: its last save was made by an older version';

export type HostRule = () => ReadonlySet<CabLamp> | null;

export const MACHINE_BUSY_TEXT = str('arcade.live.someone_is_playing_this_machine');
export function machineBusyText(holderName: string | null): string {
  return holderName ? str('arcade.live.n_is_playing_this_machine', { 0: holderName }) : MACHINE_BUSY_TEXT;
}

export function connectionLostText(holdMs: number): string {
  const s = Math.max(1, Math.round(holdMs / 1000));
  const span = s % 60 === 0 ? (s === 60 ? '1 minute' : `${s / 60} minutes`) : `${s} seconds`;
  return str('arcade.live.connection_lost_hold_on_your', { 0: span });
}

export const WATCH_BUTTON = str('arcade.live.watch');
export const WATCHING_TEXT = str('arcade.live.watching');
export const WALK_AWAY_BUTTON = str('arcade.live.walk_away');
export const MACHINE_FREE_TEXT = str('arcade.live.the_machine_is_free');
export const PLAY_BUTTON = str('arcade.live.play');
export const PLAYER_PAUSED_TEXT = str('arcade.live.the_player_has_paused');

export const MACHINE_UPDATED_TEXT = str('arcade.live.this_machine_has_been_updated');
const UPDATED_HOURGLASS = { paths: UI_ICONS.hourglass, label: str('arcade.room.getting_ready') };

export const COINS_STOPPED_TEXT = str('arcade.live.this_machine_has_stopped_recording');

export const SLOT_NOT_SET_UP_TEXT = str('arcade.live.this_coin_slot_is_not');
export const NOT_ENOUGH_MONEY_TEXT = str('arcade.live.not_enough_money_for_that');
export const NOT_ENOUGH_TOKENS_TEXT = str('arcade.live.not_enough_tokens');
const NO_COIN_WITHIN_BALANCE_TEXT = str('arcade.live.no_coin_within_balance');
const NOT_TAKING_COINS_TEXT = str('arcade.live.not_taking_coins_now');
const NOT_ENOUGH_MONEY_MS = 2500;
export const TOKENS_UNCOUNTED_TEXT = str('arcade.live.this_machine_does_not_count');

export const COIN_VALUE_UNKNOWN_TEXT = str('arcade.live.coin_value_not_set');

export const PAYOUT_VALUE_UNKNOWN_TEXT = str('arcade.live.payout_value_not_set');

export function watcherLine(w: { free: boolean; paused: boolean }): 'free' | typeof PLAYER_PAUSED_TEXT | typeof WATCHING_TEXT {
  if (w.free) return 'free';
  return w.paused ? PLAYER_PAUSED_TEXT : WATCHING_TEXT;
}

export const WATCH_BUFFER_MS = 1000;

export const KEYFRAME_EVERY_MS = 10_000;

const NOTHING: ReadonlySet<CabLamp> = new Set();

function keyframeRecord(k: { data: Uint8Array; cycles: number; nvram?: Uint8Array }, hash: string, system: string | undefined): StateRec {
  const rec = deflatedRecord(k.data, k.cycles, hash, Date.now(), system);
  return k.nvram && k.nvram.length > 0 ? { ...rec, nvram: k.nvram } : rec;
}

function newSession(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class Live {
  readonly emu = new WorkerEmu();
  readonly audio = new Audio();
  readonly effects = new CabinetEffects(this.audio);
  soundOn = true;
  onFrame: ((v: FrameView) => void) | null = null;
  private readonly stopWatch = new StopWatch();
  stopNote: StopNote | null = null;
  private stopParts: string[] = [];
  private quietIsWaiting = false;
  glass: Glass | null = null;
  running = false;
  private get buttons(): HeldButtons {
    return (this.buttonsMade ??= new HeldButtons({
      down: (b) => {
        this.emu.input(b, true);
        this.effects.button(true);
        this.glass?.heldInputs.add(b);
      },
      up: (b) => {
        this.emu.input(b, false);
        this.effects.button(false);
        this.glass?.heldInputs.delete(b);
      },
    }));
  }
  private buttonsMade?: HeldButtons;
  private loadSeq = 0;
  get keys(): PlayKeys {
    return (this.keysMade ??= new PlayKeys(this.keySurface()));
  }
  private keysMade?: PlayKeys;
  hintPlace: (() => HintPlace | null) | null = null;
  error = '';
  private loaded: { hash: string; slot: StateSlot | null; save: boolean } | null = null;
  private halted = false;
  private saving: Promise<void> = Promise.resolve();
  private claimed: StateSlot | null = null;
  private cutOff: { holdMs: number; pausedForIt: boolean } | null = null;
  get autosave(): PlayAutosave<AutosaveBlob> {
    return (this.autosaveMade ??= new PlayAutosave<AutosaveBlob>(this.autosaveSurface(), { awaitPush: true }));
  }
  private autosaveMade?: PlayAutosave<AutosaveBlob>;
  lastStart: { t0: number; resumed: boolean; why: string; loadedAt?: number; paintedAt?: number } | null = null;

  private relaying: {
    slot: StateSlot; session: string; forwarding: boolean; timer: ReturnType<typeof setInterval> | null;
    asking: boolean; again: boolean;
  } | null = null;
  private relayEnding: Live['relaying'] = null;
  private watchersNow = 0;
  private updatedNote = false;
  private keyWanted = false;

  private watching: {
    glass: Glass; slot: StateSlot; hash: string; handle: WatchHandle | null;
    session: string | null; loading: string | null;
    pending: RelayBatch[];
    queued: SlotKeyframe | null;
    resync: boolean;
    free: boolean;
    paused: boolean;
  } | null = null;
  wallet: Wallet | null = null;
  private bootWatch: BootWatch | null = null;
  get coinDoorOpen(): boolean { return !this.bootWatch || this.bootWatch.door.open; }
  get coinDoorSeconds(): readonly unknown[] { return this.bootWatch?.door.seconds ?? []; }
  private readonly settle = new SettleSave();
  private moneyWatch: { timer: ReturnType<typeof setInterval> | null; busy: boolean; pose: string } | null = null;
  private readonly credit = new CreditWatch();
  private settleWatch: {
    timer: ReturnType<typeof setInterval> | null; pose: string; last: FrameView | null;
    ledger: string; alarm: boolean; surf: CabinetSurfaces | null; board: string; layout: Uint8Array | undefined;
    busy: boolean;
  } | null = null;
  readonly settleStats = { asked: 0, saved: 0, failed: 0, lastMs: 0, money: 0 };
  private saveChain: Promise<void> = Promise.resolve();

  readonly watchStats = { keys: 0, loads: 0, checks: 0, matched: 0, drifted: 0, last: null as CheckResult | null, why: [] as string[] };

  get isWatching(): boolean { return !!this.watching; }

  private freeVisit: {
    slot: StateSlot; o: StartOpts; visit: Visit; base: number; fresh: boolean;
    kept: boolean;
    restarting: Promise<void> | null;
    trigger: ClaimTrigger; claiming: boolean; start: CashLedger | null; last: CashLedger | null; pose: string;
    timer: ReturnType<typeof setInterval> | null; busy: boolean;
    inputs: RelayBatch[];
  } | null = null;
  get isVisiting(): boolean { return !!this.freeVisit; }
  private idle: { clock: IdleClock; credit: CreditSign; timer: ReturnType<typeof setInterval> | null; slot: StateSlot; asked: boolean } | null = null;
  get stillPlayingAsked(): boolean { return !!this.idle?.asked; }
  private revisitWhenShown: { glass: Glass; o: StartOpts; seq: number } | null = null;
  private startOpts: StartOpts = {};
  readonly claimStats = { claims: 0, lost: 0, moved: 0, idleAsked: 0, idleReleased: 0 };

  private coinsStoppedNow = false;
  private ledgerAtStart: CashLedger | null = null;
  private coinsNoteAway = false;
  onCoinsStopped: ((stopped: boolean) => void) | null = null;
  onWalkAway: (() => void) | null = null;
  get coinsStopped(): boolean { return this.coinsStoppedNow; }

  private oldCoinAnswers: unknown = undefined;
  private lastDown: { x: number; y: number; t: number } | null = null;

  constructor() {
    restoreCabinetSounds(this.effects);
    this.effects.onReport = (text) => this.emu.diagAudio(text);
    window.addEventListener('pointerdown', (ev) => { this.lastDown = { x: ev.clientX, y: ev.clientY, t: performance.now() }; }, true);
    this.keys.watchWindow();
    window.addEventListener('blur', () => this.focusLost());
    this.emu.onAutosave = (blob, trigger) => this.autosave.pushed(blob, trigger);
    this.emu.onRelay = (inputs, upTo) => {
      const r = this.relaying ?? this.relayEnding;
      if (!r) return;
      const fv = this.freeVisit;
      if (fv && r === this.relaying) { fv.inputs.push({ session: r.session, inputs, upTo }); return; }
      r.slot.log?.({ session: r.session, inputs, upTo });
      if (r.forwarding) r.slot.relay?.({ session: r.session, inputs, upTo });
    };
    this.emu.onFollowReport = (r) => this.followReport(r);
    this.emu.onCoinRejected = (bit) => this.wallet?.rejected(bit);
    this.emu.onHalted = () => {
      this.halted = true;
      if (this.running) this.stopNote?.update('stopped', HALT_NOTE_TEXT, true);
    };
    document.addEventListener('visibilitychange', () => {
      const rv = this.revisitWhenShown;
      if (rv && !document.hidden) {
        this.revisitWhenShown = null;
        if (rv.seq === this.loadSeq && !this.running) void this.start(rv.glass, rv.o);
        return;
      }
      if (!this.running || this.paused) return;
      if (document.hidden) {
        for (const [p] of this.buttons.entries()) this.release(p);
        this.leaveSave('hidden');
        this.emu.pause();
        this.audio.silence();
        this.effects.silence();
        this.claimed?.paused?.(true);
      } else {
        this.emu.resume();
        this.claimed?.paused?.(false);
        this.stopWatch.resumed(performance.now());
        this.settle.gap();
      }
    });
  }

  private autosaveSurface(): AutosaveSurface<AutosaveBlob> {
    return {
      canSave: () => !!this.loaded?.save && !this.halted,
      takesPush: () => {
        const m = this.loaded;
        return !!m && m.save && !!m.slot && !this.cutOff;
      },
      claimPush: (blob) => {
        const m = this.loaded;
        const forced = this.forced;
        this.forced = null;
        if (!m || !forced) return null;
        if (!m.slot) { forced.reject(new Error('this machine has nowhere to keep its state')); return Promise.resolve(); }
        const rec = stateRecord(blob, m.hash, undefined, this.emu.info?.system);
        return m.slot.save(rec).then(() => forced.resolve(), (e) => forced.reject(e));
      },
      write: (blob) => {
        const m = this.loaded!;
        const slot = m.slot!;
        const money = this.emu.ledger().catch(() => null);
        if (slot.left) void money.then((l) => slot.left!(l));
        const rec = stateRecord(blob, m.hash, undefined, this.emu.info?.system);
        this.settle.saved();
        return this.queueSave(slot, rec, money)
          .then(() => console.log(`[arcade] saved the machine as it was left (${Math.round(rec.data.length / 1024)} kB)`))
          .catch((e) => console.warn('[arcade] save failed', e));
      },
    };
  }

  private queueSave(slot: StateSlot, rec: StateRec, money?: CashLedger | null | Promise<CashLedger | null>): Promise<void> {
    const wallet = this.wallet;
    const credit = this.credit.value;
    const ws = this.emu.coinWiringStatus;
    const stopped = ws?.state === 'disagrees' ? true : ws?.state === 'calibrated' ? false : undefined;
    const p = this.saveChain.then(async () => {
      const l = (await money) ?? null;
      const coins = wallet && l ? wallet.takeCoins() : undefined;
      try {
        const r = await slot.save(rec, l, coins, credit, stopped);
        if (r?.wallet) wallet?.settled(r.wallet, l);
      } catch (e) {
        if (coins) wallet?.putBackCoins(coins);
        throw e;
      }
    });
    this.saveChain = p.catch(() => undefined);
    return p;
  }

  private startMoneyWatch(hooks: MoneyHooks | undefined): void {
    this.stopMoneyWatch();
    const seq = this.loadSeq;
    const w = { timer: null as ReturnType<typeof setInterval> | null, busy: false, pose: '' };
    this.moneyWatch = w;
    void this.emu.ledger().then((l) => {
      if (this.moneyWatch !== w || seq !== this.loadSeq) return;
      hooks?.start(l);
      this.ledgerAtStart = l;
      this.credit.mark(l);
      w.pose = reelPose(this.emu.latestFrame()?.reels ?? []);
      w.timer = setInterval(() => {
        if (this.moneyWatch !== w || w.busy) return;
        w.busy = true;
        void this.emu.ledger().then((r) => {
          if (this.moneyWatch !== w) return;
          const v = this.emu.latestFrame();
          const pose = v ? reelPose(v.reels) : w.pose;
          if (pose !== w.pose) { w.pose = pose; this.credit.mark(r); } else this.credit.reading(r);
          hooks?.reading(r);
          this.checkWiring(r);
        }, () => undefined).finally(() => { w.busy = false; });
      }, MONEY_WATCH_MS);
    }, () => undefined);
  }

  private stopMoneyWatch(): void {
    if (this.moneyWatch?.timer) clearInterval(this.moneyWatch.timer);
    this.moneyWatch = null;
  }

  private startSettleWatch(glass: Glass): void {
    this.stopSettleWatch();
    this.settle.reset();
    const layout = glass.game?.layout;
    const w: NonNullable<Live['settleWatch']> = {
      timer: null, pose: '', last: null, ledger: '', alarm: false,
      surf: layout ? cabinetSurfaces(layout, glass.machine.board) : null, board: glass.machine.board, layout, busy: false,
    };
    this.settleWatch = w;
    void this.emu.ledger().then((l) => { w.ledger = JSON.stringify(l ?? null); }, () => undefined);
    w.timer = setInterval(() => this.settleSecond(w), 1000);
  }

  private stopSettleWatch(): void {
    if (this.settleWatch?.timer) clearInterval(this.settleWatch.timer);
    this.settleWatch = null;
  }

  private settleSecond(w: NonNullable<Live['settleWatch']>): void {
    if (this.settleWatch !== w || w.busy || this.paused || this.cutOff || document.hidden) return;
    w.busy = true;
    void this.emu.ledger().then((l) => {
      if (this.settleWatch !== w) return;
      const now = JSON.stringify(l ?? null);
      const moved = w.ledger !== '' && now !== w.ledger;
      if (moved && w.ledger && l && this.idle) {
        const p = JSON.parse(w.ledger) as CashLedger | null;
        if (p && moneyIn(p, l)) this.idle.credit.moneyIn(Date.now());
      }
      w.ledger = now;
      const v = this.emu.latestFrame();
      if (v && w.layout) w.alarm = classifyGlassCore(w.board, readGlass(v, w.layout, w.surf ?? undefined)).verdict === 'ALARM';
      const at = performance.now();
      this.wallet?.reading(l);
      if (moved) this.settle.sample(at, { reels: false, money: true, mech: false, alarm: w.alarm, held: false });
      if (this.settle.money(at, moved, !!v?.coinBusy)) this.saveAfterGame('money');
    }, () => undefined).finally(() => { w.busy = false; });
  }

  private settleFrame(v: FrameView): void {
    const w = this.settleWatch;
    if (!w || v === w.last) return;
    w.last = v;
    const pose = reelPose(v.reels);
    const reels = w.pose !== '' && pose !== w.pose;
    w.pose = pose;
    if (reels) this.idle?.credit.reels(Date.now());
    const due = this.settle.sample(performance.now(), {
      reels, money: false, mech: v.coinBusy, alarm: w.alarm, held: this.buttons.size > 0,
    });
    if (due) this.saveAfterGame('game');
  }

  private saveAfterGame(why: 'game' | 'money' | 'claim'): void {
    const r = this.relaying;
    const m = this.loaded;
    if (!r || !m?.save || !m.slot || !this.running || this.paused || this.cutOff || this.halted) return;
    const slot = m.slot;
    const t0 = performance.now();
    this.settleStats.asked++;
    void this.emu.keyframe().then((k) => {
      if (!k || this.relaying !== r || this.cutOff) return;
      if (r.forwarding) {
        r.slot.keyframe?.({ session: r.session, cycle: k.cycle, seq: k.seq, hash: k.hash, signals: k.signals, data: k.data });
      }
      const rec = keyframeRecord(k, m.hash, this.emu.info?.system);
      return this.queueSave(slot, rec, k.ledger).then(() => {
        this.settleStats.saved++;
        this.settleStats.lastMs = performance.now() - t0;
        if (why === 'money') this.settleStats.money++;
        const after = why === 'money' ? 'after money moved' : why === 'claim' ? 'as it was claimed' : 'after a game';
        console.log(`[arcade] saved the machine ${after} (${Math.round(rec.data.length / 1024)} kB)`);
      });
    }).catch((e) => {
      this.settleStats.failed++;
      console.warn('[arcade] the save after a game failed', e);
    });
  }

  private leaveSave(m: SaveMoment): void {
    const owed = this.autosave.moment(m);
    if (owed) this.saving = Promise.all([this.saving, owed]).then(() => undefined);
  }

  private forced: { resolve: () => void; reject: (e: unknown) => void } | null = null;

  saveNow(): Promise<void> {
    if (!this.running || !this.loaded) return Promise.reject(new Error('no machine is running'));
    if (this.halted) return Promise.reject(new Error('the machine stopped'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.forced = null; reject(new Error('the machine did not hand over its state')); }, 10_000);
      this.forced = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      void this.autosave.expectPush();
      this.emu.pause();
    });
  }

  paused = false;

  private hostRule: HostRule | null = null;

  gateHost(only: HostRule | ReadonlySet<CabLamp> | null): void {
    this.hostRule = typeof only === 'function' ? only : only === null ? null : () => only;
    this.letGo();
  }

  letGo(): void {
    const only = this.hostNow();
    if (!only) return;
    const buttons = new Set([...only].map((lp) => lp.button));
    for (const [id, b] of this.buttons.entries()) if (!this.own.has(id) && !buttons.has(b)) this.release(id);
  }

  private hostNow(): ReadonlySet<CabLamp> | null {
    if (this.cutOff || this.watching) return NOTHING;
    return this.hostRule?.() ?? null;
  }

  private hostCan(lp: CabLamp): boolean {
    const only = this.hostNow();
    return !only || only.has(lp);
  }

  private readonly own = new Set<number>();

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    for (const [p] of this.buttons.entries()) this.release(p);
    this.emu.pause();
    this.audio.machinePaused();
    this.effects.silence();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.running || document.hidden) return;
    this.emu.resume();
    this.audio.machineResumed();
    this.stopWatch.resumed(performance.now());
    this.settle.gap();
  }

  async start(glass: Glass, o: StartOpts = {}): Promise<void> {
    const game = glass.game;
    const hash = glass.machine.held?.hash;
    if (!game || !glass.cab || !hash) throw new Error('not held');
    const stamp = boardStamp(game.system);
    const t0 = performance.now();
    this.stop();
    this.paused = false;
    this.glass = glass;
    this.startOpts = o;
    glass.resetGates();
    glass.panelRows = () => (this.glass === glass ? this.emu.info?.switchPanel : undefined);
    glass.mode = 'live';
    const seq = ++this.loadSeq;
    this.error = '';
    let visit: Visit | null = null;
    try {
      await this.saving;
      if (seq !== this.loadSeq) return;
      const slot = glass.machine.slot ?? null;
      if (slot?.claim) {
        this.watchersNow = 0;
        this.keyWanted = false;
        if (slot.visit && !o.cold && !o.snapshot) {
          visit = await slot.visit({ holder: (h, name) => this.visitHolder(slot, h, name ?? null) }, stamp);
          if (seq !== this.loadSeq) { visit.stop(); return; }
          if (visit.holder === 'other') {
            visit.stop();
            console.log('[arcade] another player has this machine');
            glass.standDown();
            this.glass = null;
            this.busyNotice(glass, slot, visit.holderName ?? null);
            return;
          }
          if (visit.holder === 'you') { visit.stop(); visit = null; }
        }
        if (!visit) {
          const mine = await slot.claim(this.claimEvents(slot, o));
          if (seq !== this.loadSeq) {
            if (mine === true) void slot.release?.().catch((e) => console.warn('[arcade] could not let the machine go', e));
            return;
          }
          if (mine !== true) {
            console.log('[arcade] another player has this machine');
            glass.standDown();
            this.glass = null;
            this.busyNotice(glass, slot, typeof mine === 'object' ? mine.holderName : null);
            return;
          }
          this.claimed = slot;
        }
      }
      const fromVisit = (v: Visit) => v.why === 'version' ? 'version' as const : v.why === 'battery' && v.nvram ? { battery: v.nvram } : v.rec;
      const [got, meta] = await Promise.all([
        o.cold || o.snapshot || !slot ? null : visit ? fromVisit(visit) : slot.load(stamp).catch(() => null),
        getMeta(hash).catch(() => null),
      ]);
      if (seq !== this.loadSeq) return;
      let battery: Uint8Array | null = got && typeof got === 'object' && 'battery' in got ? got.battery : null;
      let rec = got === 'version' || battery ? null : got as StateRec | null;
      if (rec && !o.snapshot) {
        const judged = walkUpStart(rec, stamp);
        if (judged === 'battery') { battery = rec.nvram!; rec = null; }
        else if (judged === 'fresh') { rec = null; }
      }
      let otherVersion = false;
      const versions = glass.machine.hostFiles ? glass.machine.versions ?? 1 : 1;
      if (!o.snapshot && versions > 1) {
        if (battery) { battery = null; otherVersion = true; }
        if (rec) {
          let made: string | null = game.variant;
          try { made = versionOf(decodeState(rec)); } catch {  }
          if (!resumesOn(made, game.variant, versions)) { rec = null; otherVersion = true; }
        }
      }
      const setAside = !!got && got !== 'version' && !battery && !rec;
      let snapshot: Snapshot | undefined = o.snapshot;
      let updated = got === 'version' || !!battery || setAside;
      let why = o.snapshot ? 'restored' : rec ? 'resumed' : o.cold ? 'cold boot'
        : otherVersion ? 'cold boot: its save was not made on the version of the game it runs'
        : battery ? 'restarted from its battery: another emulation wrote its save'
        : updated ? UPDATED_WHY : 'cold boot: no saved state for this machine yet';
      if (o.powerCycle && (o.snapshot || rec)) why = `${why}, then restarted with its memory kept`;
      let thrown: { version: number | null } | null = setAside ? { version: null } : null;
      if (rec) {
        try {
          snapshot = decodeState(rec);
          if ((snapshot.version ?? 0) !== SNAPSHOT_VERSION) {
            thrown = { version: snapshot.version ?? 0 };
            snapshot = undefined;
            updated = true;
            why = UPDATED_WHY;
          }
        } catch (e) {
          thrown = { version: null };
          why = `cold boot: the saved state could not be read (${(e as Error).message})`;
        }
      }
      glass.resetGates(gatesOf(snapshot));
      glass.onGateSeen = (lamps) => { if (this.glass === glass && seq === this.loadSeq) this.emu.gateSeen(lamps); };
      const cfg = glass.machine.config;
      const ownAnswers = glass.machine.hostFiles ? undefined : meta?.coinAnswers;
      const opts = {
        game: battery ? { ...game, nvram: battery } : game,
        optionKeys: cfg.optionKeys,
        panelSwitches: cfg.panelSwitches,
        ...coinsForLoad(cfg.coins, ownAnswers, null),
      };
      this.oldCoinAnswers = ownAnswers;
      this.lastStart = { t0, resumed: !!snapshot, why };
      this.loaded = null;
      this.halted = false;
      this.stopWatch.reset(performance.now());
      this.stopNote?.clear();
      this.stopParts = [];
      this.quietIsWaiting = false;
      this.updatedNote = updated;
      this.setCoinsStopped(false);
      this.ledgerAtStart = null;
      this.coinsNoteAway = false;
      if (updated) this.stopNote?.notice(MACHINE_UPDATED_TEXT, undefined, undefined, undefined, UPDATED_HOURGLASS, true);
      const relay = (this.claimed === slot || visit) && slot?.relay ? { at: Date.now() } : undefined;
      let info;
      try {
        info = await this.emu.load({ ...opts, snapshot, powerCycle: !!snapshot && !!o.powerCycle, relay });
      } catch (e) {
        if (seq !== this.loadSeq || !snapshot) throw e;
        why = `cold boot: the saved state cannot be restored by this build (${(e as Error).message})`;
        if (rec) thrown = { version: snapshot.version ?? null };
        snapshot = undefined;
        glass.resetGates();
        this.lastStart = { t0, resumed: false, why };
        info = await this.emu.load({ ...opts, relay });
      }
      if (seq !== this.loadSeq) return;
      console.log(`[arcade] ${why}`);
      this.resendWiring(opts.coinWiring, info);
      this.stampCoins();
      this.lastStart.loadedAt = performance.now();
      idleNamedInputs(this.emu, game, info);
      this.stopParts = stopNoteParts(info.boardDefaults);
      this.quietIsWaiting = info.quietIsWaiting === true;
      {
        const { labels, coinNames } = logInputLabels(viewFor(game.system), info, glass.cab.lamps);
        this.emu.setInputLabels(labels, coinNames);
        if (liveValue('diag')) this.emu.setDiagLog(true);
      }
      this.effects.load(game);
      this.loaded = { hash, slot, save: o.saveOnLeave !== false && !!slot && !visit };
      if (o.stampPlay !== false) slot?.visited?.();
      if (meta && o.stampPlay !== false) {
        const now = Date.now();
        void putMeta({ ...meta, lastPlayedAt: now, playedAt: now, playCount: playCountOf(meta) + 1 })
          .catch((e) => console.warn('[arcade] play stamp failed', e));
      }
      this.audio.attach(info.audioRate, info.audioLevel);
      this.bridgeAudio();
      this.running = true;
      this.watchBoot(glass, !o.cold && !this.watching && (!this.lastStart?.resumed || !!o.powerCycle));
      if (relay && slot && visit) {
        this.relaying = { slot, session: newSession(), forwarding: false, timer: null, asking: false, again: false };
        this.beginVisit(slot, visit, o, !snapshot, !!battery && !snapshot);
      } else if (relay && slot) {
        this.relaying = { slot, session: newSession(), forwarding: false, timer: null, asking: false, again: false };
        if (this.watchersNow > 0 || this.keyWanted) this.forward(true);
        if (this.keyWanted) this.sendKeyframe();
        if (this.loaded.save) {
          this.startSettleWatch(glass);
          this.startIdle(slot);
        }
        const wallet = this.wallet;
        if (wallet) void this.emu.ledger().then((l) => { if (seq === this.loadSeq) wallet.started(l); }, () => undefined);
      }
      if (slot && o.saveOnLeave !== false) this.startMoneyWatch(this.loaded.save ? slot.money : undefined);
      if (thrown && this.loaded.save && slot?.money) {
        slot.money.lost(thrown.version);
        console.log('[arcade] credit left on the machine went with its last save (noted in its money record)');
      }
      if (this.cutOff) this.holdForConnection(this.cutOff.holdMs);
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.error = (e as Error).message;
      glass.standDown();
      this.glass = null;
    } finally {
      if (visit && this.freeVisit?.visit !== visit) visit.stop();
    }
  }

  startSound(): void {
    if (!this.soundOn) return;
    void this.audio.resume().then(() => this.bridgeAudio(), () => undefined);
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (on) this.startSound();
    else this.audio.suspend();
  }

  payCoin(line: number, chosen?: CoinChoice): boolean {
    if (!this.running || this.watching) return false;
    if (!this.coinDoorOpen) {
      this.wallet?.turnedAway();
      return false;
    }
    if (this.coinsStoppedNow) {
      this.showCoinsStopped();
      return false;
    }
    if (this.wallet && this.emu.info?.unpricedPayouts?.length) {
      this.wallet.turnedAway();
      this.stopNote?.notice(PAYOUT_VALUE_UNKNOWN_TEXT, undefined, undefined, 6000);
      return false;
    }
    const g = this.glass;
    if (chosen) return this.pays({ label: chosen.label, bit: line, pence: chosen.pence, token: chosen.token });
    const w = this.coinWiring();
    const wired = wiredCoinOn(w, line);
    if (wired) {
      return this.pays({ label: slotCoinLabel(wired), bit: line, pence: slotCoinPence(wired), token: isTokenCoin(wired) });
    }
    if (wired === null || this.unsetSlot(line, w)) {
      this.wallet?.turnedAway();
      if (wired === undefined) this.stopNote?.notice(SLOT_NOT_SET_UP_TEXT, undefined, undefined, 6000);
      return false;
    }
    if (this.wallet && this.emu.info?.uncountedCoins?.includes(line)) {
      this.wallet.turnedAway();
      this.stopNote?.notice(TOKENS_UNCOUNTED_TEXT, undefined, undefined, 6000);
      return false;
    }
    const coins: readonly CoinChute[] = this.emu.info?.coins ?? (g?.game ? viewFor(g.game.system).coins : []);
    return this.pays(coins.find((c) => c.bit === line) ?? { label: '', bit: line });
  }

  private pays(coin: Parameters<Wallet['pay']>[0]): boolean {
    if (payForCoin(this.wallet, coin)) return true;
    if (this.wallet && unpriced(coin)) this.stopNote?.notice(COIN_VALUE_UNKNOWN_TEXT, undefined, undefined, 6000);
    else this.sayNotEnough(isToken(coin));
    return false;
  }

  private sayNotEnough(tokens = false): void {
    if (!this.wallet || !this.wallet.shown()) return;
    this.stopNote?.notice(tokens ? NOT_ENOUGH_TOKENS_TEXT : NOT_ENOUGH_MONEY_TEXT, undefined, undefined, NOT_ENOUGH_MONEY_MS);
  }

  private unsetSlot(line: number, w: CoinWiring): boolean {
    return !!this.wallet && unsetCoinLine(w, this.emu.info, line);
  }

  takesCoins(): boolean {
    if (!this.wallet) return true;
    const g = this.glass;
    return takesACoin(this.coinWiring(), this.emu.info, g?.game ? viewFor(g.game.system).coins : []);
  }

  private resendWiring(sent: CoinWiring | undefined, info: MachineInfo): void {
    const g = this.glass;
    if (!g) return;
    const now = wiringFor(g.machine.config.coins, this.oldCoinAnswers, info);
    if (!Object.keys(now).length || JSON.stringify(now) === JSON.stringify(sent ?? {})) return;
    this.applyWiring(now);
  }

  applyWiring(w: CoinWiring): void {
    if (!this.running || this.watching) return;
    const { coinWiring, namedCoins } = coinsForLoad(w, undefined, null);
    if (coinWiring) this.emu.setCoinWiring(coinWiring);
    for (const [line, coin] of Object.entries(namedCoins)) this.emu.nameCoin(Number(line), coin);
    this.setCoinsStopped(false);
    void this.emu.ledger().then((l) => { if (this.running) this.ledgerAtStart = l; }, () => undefined);
    this.stampCoins();
  }

  private stampCoins(): void {
    const g = this.glass;
    const info = this.emu.info;
    if (!g?.cab || !g.game || !info) return;
    const view = viewFor(g.game.system);
    stampCoinInputs(g.cab.lamps, view, [...(info.coins ?? view.coins), ...markedChutes(this.coinWiring(), info)]);
  }

  private checkWiring(r?: CashLedger | null): void {
    if (this.watching) return;
    const s = this.emu.coinWiringStatus;
    const unknown = !!this.wallet && unknownMoneyMoved(this.ledgerAtStart, r ?? null);
    if (unknown && !this.coinsStoppedNow) console.warn('[arcade] the machine booked money of no known value; it takes no more coins');
    this.setCoinsStopped(s?.state === 'disagrees' || unknown);
  }

  private setCoinsStopped(on: boolean): void {
    if (on === this.coinsStoppedNow) {
      if (on) this.showCoinsStopped();
      return;
    }
    this.coinsStoppedNow = on;
    if (on) {
      console.warn('[arcade] the machine has stopped recording money; it takes no more coins');
      this.showCoinsStopped();
    }
    this.onCoinsStopped?.(on);
  }

  private showCoinsStopped(): void {
    if (this.coinsNoteAway || !this.stopNote || this.idle?.asked) return;
    if (this.stopNote.visible && this.stopNote.text === COINS_STOPPED_TEXT) return;
    this.stopNote.notice(COINS_STOPPED_TEXT, undefined, () => { this.coinsNoteAway = true; });
  }

  coinWiring(): CoinWiring {
    const g = this.glass;
    return wiringFor(g?.machine?.config?.coins, this.oldCoinAnswers, this.emu.info);
  }

  private chooseCoin(line: number, acceptor: CabLamp['acceptor'], gate?: CabLamp): boolean {
    const slot = this.coinWiring()[String(line)];
    if (!slot) return false;
    const balance = this.wallet ? this.wallet.shown() : null;
    const choices = coinChoices(slot, this.wallet ? (balance ?? { cashPence: 0, tokenPence: 0 }) : null);
    const drop = (c: CoinChoice): void => {
      if (!this.running || this.watching) return;
      const f = this.emu.latestFrame();
      if (f?.coinBusy || !this.payCoin(c.line, c)) { this.effects.coin(acceptor, 'refused'); return; }
      this.landCoin(c.line, acceptor, gate);
    };
    if (!choices.length) {
      const wired = slot.coins.filter((c) => c.line !== null);
      if (balance && wired.length && wired.every((c) => slotCoinPence(c.coin) === null)) {
        this.stopNote?.notice(COIN_VALUE_UNKNOWN_TEXT, undefined, undefined, 6000);
      } else if (balance && wired.length) this.sayNotEnough(wired.every((c) => isTokenCoin(c.coin)));
      this.effects.coin(acceptor, 'refused');
      return true;
    }
    if (slot.coins.length === 1) { drop(choices[0]); return true; }
    const d = this.lastDown;
    const at = d && performance.now() - d.t < 1000 ? { x: d.x, y: d.y } : null;
    openCoinMenu({ rows: choices.map((c) => ({ label: c.label })), at, onPick: (i) => drop(choices[i]) });
    return true;
  }

  menuCoins(): OwnCoins | null {
    const info = this.emu.info;
    if (!info?.slotlessCoins?.length) return null;
    const w = this.coinWiring();
    const f = this.emu.latestFrame();
    const refusing = f ? (f.coinRefusing | f.coinLinesShut) >>> 0 : 0;
    const any = slotlessChoices(w, info.slotlessCoins, null, refusing);
    if (any === null) return null;
    const have = this.wallet ? (this.wallet.shown() ?? { cashPence: 0, tokenPence: 0 }) : null;
    const now = slotlessChoices(w, info.slotlessCoins, have, refusing) ?? [];
    return {
      coins: now.map((c) => ({ label: c.label, bit: c.line })),
      ...(now.length ? {} : { note: any.length ? NO_COIN_WITHIN_BALANCE_TEXT : NOT_TAKING_COINS_TEXT }),
    };
  }

  dropCoin(line: number): void {
    if (!this.running || this.watching) return;
    this.landCoin(line, undefined);
    this.stopWatch.engage();
    this.settle.played(performance.now());
    this.idleActive();
  }

  private landCoin(line: number, acceptor: CabLamp['acceptor'], gate?: CabLamp): void {
    const seq = this.loadSeq;
    const here = (): boolean => seq === this.loadSeq && this.running && !this.watching;
    this.effects.coinDrop(acceptor, () => {
      if (seq !== this.loadSeq) return null;
      if (!here()) { this.wallet?.rejected(line); return null; }
      if (gate && this.glass?.gatedOff.has(gate)) { this.wallet?.rejected(line); return 'locked'; }
      const f = this.emu.latestFrame();
      if (f?.coinBusy) { this.wallet?.rejected(line); return 'refused'; }
      this.emu.coin(line);
      this.stopWatch.engage();
      this.settle.played(performance.now());
      return f && ((f.coinRefusing >>> line) & 1) ? 'refused' : 'accepted';
    }, () => {
      if (seq === this.loadSeq) this.wallet?.rejected(line);
    });
  }

  powerCycle(): void {
    if (!this.running || this.watching) return;
    for (const [p] of this.buttons.entries()) this.release(p);
    this.emu.powerCycle();
    if (this.glass) this.watchBoot(this.glass, true);
    if (this.relaying?.forwarding) this.sendKeyframe();
    this.stopWatch.reset(performance.now());
    this.stopNote?.clear();
  }

  private watchBoot(glass: Glass, booting: boolean): void {
    this.bootWatch?.stop();
    const layout = glass.game?.layout;
    this.bootWatch = new BootWatch(
      new BootDoor(booting, attractBudgetS(glass.machine.board)), this.emu, glass.machine.board, layout,
      layout ? cabinetSurfaces(layout, glass.machine.board) : undefined,
      () => this.paused || !!this.cutOff || document.hidden,
      () => {
        console.log('[arcade] the machine is in attract: it takes coins now');
        if (this.freeVisit) this.restartSave(this.freeVisit);
      },
    );
    if (booting) {
      console.log('[arcade] the machine is booting: it takes no coins until its attract');
      this.bootWatch.start();
    }
  }

  private bridgeAudio(): void {
    const port = this.audio.bridge();
    if (port) this.emu.attachAudioPort(port);
  }

  stop(): void {
    this.loadSeq++;
    this.revisitWhenShown = null;
    const fv = this.freeVisit;
    if (fv) {
      this.endVisit(fv);
      void this.wallet?.forfeit();
    }
    this.stopIdle();
    this.stopSettleWatch();
    this.stopMoneyWatch();
    this.bootWatch?.stop();
    this.bootWatch = null;
    this.updatedNote = false;
    this.endRelay();
    if (this.watching) {
      this.watching.handle?.stop();
      this.watching = null;
    }
    for (const [p] of this.buttons.entries()) this.release(p);
    this.keys.reset();
    this.keys.hideHints();
    if (this.running) {
      this.leaveSave('leave');
      this.emu.pause();
      this.audio.silence();
    }
    this.effects.silence();
    this.stopNote?.clear();
    this.running = false;
    this.paused = false;
    this.cutOff = null;
    this.glass?.standDown();
    this.glass = null;
    const claimed = this.claimed;
    this.claimed = null;
    if (claimed?.release) {
      this.saving = this.saving
        .then(() => claimed.release!())
        .catch((e) => console.warn('[arcade] could not let the machine go', e));
    }
    const wallet = this.wallet;
    if (claimed && wallet) void this.saving.then(() => this.saveChain).then(() => wallet.ended());
  }

  settled(): Promise<void> {
    return this.saving.then(() => this.saveChain);
  }

  private lost(slot: StateSlot): void {
    if (this.claimed !== slot) return;
    this.claimed = null;
    if (this.loaded) this.loaded.save = false;
    console.warn('[arcade] the machine was lost to another player');
    const glass = this.glass;
    this.stop();
    const name = this.holderNames.get(slot) ?? null;
    if (glass) this.busyNotice(glass, slot, name);
    else this.stopNote?.notice(machineBusyText(name));
  }

  private readonly holderNames = new Map<StateSlot, string | null>();
  private busyUp: { slot: StateSlot; named: boolean } | null = null;

  private onHolderName(slot: StateSlot, name: string | null): void {
    this.holderNames.set(slot, name);
    const b = this.busyUp;
    if (!b || b.slot !== slot || b.named || !name) return;
    if (this.stopNote?.text !== MACHINE_BUSY_TEXT) return;
    this.busyUp = { slot, named: true };
    const glass = this.busyGlass;
    this.stopNote.notice(machineBusyText(name), slot.watch && glass
      ? { label: WATCH_BUTTON, run: () => { this.startSound(); this.watch(glass); } }
      : undefined);
  }

  private busyNotice(glass: Glass, slot: StateSlot, holderName: string | null): void {
    this.busyUp = { slot, named: !!holderName };
    this.busyGlass = glass;
    this.stopNote?.notice(machineBusyText(holderName), slot.watch
      ? { label: WATCH_BUTTON, run: () => { this.startSound(); this.watch(glass); } }
      : undefined);
  }
  private busyGlass: Glass | null = null;

  private onWatchers(slot: StateSlot, n: number): void {
    if (this.claimed !== slot) return;
    this.watchersNow = n;
    if (this.relaying) this.forward(n > 0);
  }

  private onKeyAsk(slot: StateSlot): void {
    if (this.claimed !== slot) return;
    this.keyWanted = true;
    if (!this.relaying) return;
    this.forward(true);
    this.sendKeyframe();
  }

  private forward(on: boolean): void {
    const r = this.relaying;
    if (!r) return;
    r.forwarding = on;
    if (on && r.timer === null) r.timer = setInterval(() => this.sendKeyframe(), KEYFRAME_EVERY_MS);
    if (!on && r.timer !== null) { clearInterval(r.timer); r.timer = null; }
  }

  private sendKeyframe(): void {
    const r = this.relaying;
    if (!r || !this.running) return;
    if (r.asking) { r.again = true; return; }
    r.asking = true;
    this.keyWanted = false;
    void this.emu.keyframe().then((k) => {
      r.asking = false;
      if (k && this.relaying === r) r.slot.keyframe?.({ session: r.session, ...k });
      if (r.again && this.relaying === r) { r.again = false; this.sendKeyframe(); }
    }, () => { r.asking = false; });
  }

  private endRelay(): void {
    const r = this.relaying;
    if (r?.timer) clearInterval(r.timer);
    if (r) r.timer = null;
    this.relayEnding = r;
    this.relaying = null;
  }

  watch(glass: Glass): void {
    const slot = glass.machine.slot;
    const hash = glass.machine.held?.hash;
    if (!slot?.watch || !glass.game || !glass.cab || !hash) return;
    this.stop();
    this.paused = false;
    this.glass = glass;
    glass.resetGates();
    glass.onGateSeen = null;
    glass.mode = 'live';
    const w: NonNullable<Live['watching']> = {
      glass, slot, hash, handle: null, session: null, loading: null, pending: [], queued: null, resync: false, free: false,
      paused: false,
    };
    this.watching = w;
    this.watchNotice(WATCHING_TEXT);
    w.handle = slot.watch({
      holder: (p) => this.watchHolder(w, p),
      paused: (on) => this.watchPaused(w, on),
      watching: (why) => {
        if (why === 'free') this.offerFree(w);
        else if (why === 'yours') this.playInstead(w);
      },
      relay: (b) => this.watchRelay(w, b),
      key: (k) => { void this.watchKey(w, k); },
      dropped: () => undefined,
      back: () => { w.resync = true; },
    });
    console.log('[arcade] watching');
  }

  private watchHolder(w: NonNullable<Live['watching']>, holder: string | null): void {
    if (this.watching !== w) return;
    if (holder === null) { this.offerFree(w); return; }
    if (w.free) {
      w.free = false;
      w.paused = false;
      this.watchNotice(WATCHING_TEXT);
    }
  }

  private watchNotice(line: string): void {
    this.stopNote?.notice(line, { label: WALK_AWAY_BUTTON, run: () => this.onWalkAway?.() });
  }

  private watchPaused(w: NonNullable<Live['watching']>, on: boolean): void {
    if (this.watching !== w || w.paused === on) return;
    w.paused = on;
    const line = watcherLine(w);
    if (line !== 'free') this.watchNotice(line);
  }

  private offerFree(w: NonNullable<Live['watching']>): void {
    if (this.watching !== w || w.free) return;
    w.free = true;
    w.paused = false;
    this.stopNote?.notice(MACHINE_FREE_TEXT, { label: PLAY_BUTTON, run: () => this.playInstead(w) });
  }

  private playInstead(w: NonNullable<Live['watching']>): void {
    if (this.watching !== w) return;
    this.startSound();
    void this.start(w.glass);
  }

  private watchRelay(w: NonNullable<Live['watching']>, b: RelayBatch): void {
    if (this.watching !== w) return;
    if (b.session === w.loading) w.pending.push(b);
    else if (b.session === w.session) this.emu.followFeed(b.inputs, b.upTo);
  }

  private async watchKey(w: NonNullable<Live['watching']>, k: SlotKeyframe): Promise<void> {
    if (this.watching !== w) return;
    this.watchStats.keys++;
    if (w.loading) { w.queued = k; return; }
    if (w.session === k.session && !w.resync) {
      this.emu.followCheck({ cycle: k.cycle, seq: k.seq, hash: k.hash, signals: k.signals }, k.data);
      return;
    }
    w.loading = k.session;
    w.pending = [];
    w.resync = false;
    const g = w.glass;
    const game = g.game;
    try {
      if (!game) throw new Error('not held');
      const snapshot = JSON.parse(strFromU8(inflateSync(k.data))) as Snapshot;
      const meta = await getMeta(w.hash).catch(() => null);
      if (this.watching !== w) return;
      const cfg = g.machine.config;
      const info = await this.emu.load({
        game,
        optionKeys: cfg.optionKeys,
        panelSwitches: cfg.panelSwitches,
        ...coinsForLoad(cfg.coins, g.machine.hostFiles ? undefined : meta?.coinAnswers, null),
        snapshot,
        follow: { cycle: k.cycle, seq: k.seq, bufferMs: WATCH_BUFFER_MS },
      });
      if (this.watching !== w) return;
      w.session = k.session;
      w.loading = null;
      for (const b of w.pending) if (b.session === w.session) this.emu.followFeed(b.inputs, b.upTo);
      w.pending = [];
      this.watchStats.loads++;
      if (!this.running) {
        const { labels, coinNames } = logInputLabels(viewFor(game.system), info, g.cab!.lamps);
        this.emu.setInputLabels(labels, coinNames);
        this.effects.load(game);
        this.loaded = { hash: w.hash, slot: w.slot, save: false };
        this.halted = false;
        this.audio.attach(info.audioRate, info.audioLevel);
        this.bridgeAudio();
        this.running = true;
      }
      const q = w.queued;
      w.queued = null;
      if (q) void this.watchKey(w, q);
    } catch (e) {
      if (this.watching !== w) return;
      w.loading = null;
      console.warn('[arcade] could not start watching', e);
    }
  }

  private followReport(r: { result: CheckResult | null; drift?: string; diff?: string[] }): void {
    const w = this.watching;
    if (!w) return;
    if (r.result) {
      this.watchStats.checks++;
      this.watchStats.last = r.result;
      if (r.result.ok) { this.watchStats.matched++; return; }
    }
    this.watchStats.drifted++;
    const why = r.drift ?? `differs at ${r.result?.cycle}: ${(r.diff ?? []).join(', ') || 'the whole-machine hash'}`;
    this.watchStats.why.push(why);
    console.warn(`[arcade] the watched machine went out of step (${why}); starting again from the next keyframe`);
    w.resync = true;
    w.handle?.again();
  }

  private dropped(slot: StateSlot, holdMs: number): void {
    if (this.claimed !== slot || this.cutOff) return;
    console.warn('[arcade] the connection to the arcade server was lost');
    this.cutOff = { holdMs, pausedForIt: false };
    this.holdForConnection(holdMs);
  }

  private holdForConnection(holdMs: number): void {
    if (!this.cutOff) return;
    if (this.running && !this.paused) {
      this.cutOff.pausedForIt = true;
      this.pause();
    }
    this.stopNote?.notice(connectionLostText(holdMs));
  }

  private back(slot: StateSlot): void {
    if (this.claimed !== slot || !this.cutOff) return;
    const c = this.cutOff;
    this.cutOff = null;
    console.log('[arcade] the connection is back: play carries on');
    this.stopNote?.update(null, '');
    if (c.pausedForIt) this.resume();
  }

  private lapsed(slot: StateSlot, o: Parameters<Live['start']>[1]): void {
    if (this.claimed !== slot) return;
    this.claimed = null;
    if (this.loaded) this.loaded.save = false;
    const glass = this.glass;
    console.log('[arcade] the hold ran out: the machine goes back to its last save');
    this.stop();
    if (glass) this.revisit(glass, { ...o, stampPlay: false });
  }

  private claimEvents(slot: StateSlot, o: StartOpts): ClaimEvents {
    return {
      lost: () => this.lost(slot),
      holderName: (name) => this.onHolderName(slot, name),
      dropped: (holdMs) => this.dropped(slot, holdMs),
      back: () => this.back(slot),
      lapsed: () => this.lapsed(slot, o),
      watchers: (n) => this.onWatchers(slot, n),
      keyAsk: () => this.onKeyAsk(slot),
    };
  }

  private revisit(glass: Glass, o: StartOpts): void {
    if (document.hidden) { this.revisitWhenShown = { glass, o, seq: this.loadSeq }; return; }
    void this.start(glass, o);
  }

  private beginVisit(slot: StateSlot, visit: Visit, o: StartOpts, fresh: boolean, kept: boolean): void {
    const v: NonNullable<Live['freeVisit']> = {
      slot, o, visit, base: visit.base, fresh, kept, restarting: null, trigger: new ClaimTrigger(), claiming: false,
      start: null, last: null, pose: '', timer: null, busy: false, inputs: [],
    };
    this.freeVisit = v;
    console.log('[arcade] the machine is free: the first coin claims it');
    void this.emu.ledger().then((l) => {
      if (this.freeVisit !== v) return;
      v.start = l;
      v.last = l;
      this.wallet?.started(l);
      v.timer = setInterval(() => this.visitReading(v), VISIT_POLL_MS);
      this.restartSave(v);
    }, () => undefined);
  }

  private restartSave(v: NonNullable<Live['freeVisit']>): void {
    if (this.freeVisit !== v || !v.fresh || v.restarting || v.claiming || !v.start || !v.slot.restart) return;
    if (!this.coinDoorOpen || this.halted) return;
    const m = this.loaded;
    if (!m) return;
    const system = this.emu.info?.system;
    v.restarting = this.emu.keyframe().then(async (k) => {
      if (!k || this.freeVisit !== v || v.claiming || moneyMoved(v.start, k.ledger)) return;
      const n = await v.slot.restart!(keyframeRecord(k, m.hash, system), { base: v.base, kept: v.kept, ledger: k.ledger });
      if (n === null || this.freeVisit !== v) return;
      v.base = n;
      v.fresh = false;
      v.kept = false;
      console.log('[arcade] the machine is in attract on this build: kept as its save for the next walk-up');
    }).catch((e) => console.warn('[arcade] the restarted machine could not be kept as its save', e));
  }

  private visitReading(v: NonNullable<Live['freeVisit']>): void {
    if (this.freeVisit !== v || v.busy) return;
    v.busy = true;
    void this.emu.ledger().then((l) => {
      if (this.freeVisit !== v || !l) return;
      this.wallet?.reading(l);
      const moved = moneyMoved(v.last, l);
      v.last = l;
      if (moved) void this.claimVisit(v, 'money');
    }, () => undefined).finally(() => { v.busy = false; });
  }

  private visitFrame(v: NonNullable<Live['freeVisit']>, f: FrameView): void {
    const pose = reelPose(f.reels);
    const moved = v.pose !== '' && pose !== v.pose;
    v.pose = pose;
    if (v.trigger.reels(performance.now(), moved, this.coinDoorOpen)) void this.claimVisit(v, 'play');
  }

  private async claimVisit(v: NonNullable<Live['freeVisit']>, why: 'money' | 'play'): Promise<void> {
    if (this.freeVisit !== v || v.claiming) return;
    v.claiming = true;
    if (v.restarting) await v.restarting;
    let r: ClaimResult | 'error';
    try {
      r = await v.slot.claim!(this.claimEvents(v.slot, v.o), {
        base: v.base, fresh: v.fresh, ...(v.kept ? { kept: true } : {}),
        ...(v.start ? { ledger: v.start } : {}),
      });
    } catch (e) {
      console.warn('[arcade] the machine could not be claimed', e);
      r = 'error';
    }
    if (this.freeVisit !== v) {
      if (r === true) void v.slot.release?.().catch((e) => console.warn('[arcade] could not let the machine go', e));
      return;
    }
    if (r === true) { this.claimedFromVisit(v, why); return; }
    if (typeof r === 'object') this.holderNames.set(v.slot, r.holderName);
    this.loseVisit(v, typeof r === 'object' ? 'busy' : 'moved');
  }

  private claimedFromVisit(v: NonNullable<Live['freeVisit']>, why: 'money' | 'play'): void {
    this.endVisit(v);
    this.claimed = v.slot;
    this.claimStats.claims++;
    const m = this.loaded;
    if (m) m.save = v.o.saveOnLeave !== false;
    console.log(`[arcade] ${why === 'money' ? 'the machine took money' : 'a game started'}: it is this player's now`);
    for (const b of v.inputs) v.slot.log?.(b);
    if (this.watchersNow > 0 || this.keyWanted) this.forward(true);
    if (this.keyWanted) this.sendKeyframe();
    const glass = this.glass;
    if (m?.save && glass) {
      this.startSettleWatch(glass);
      this.startIdle(v.slot);
      if (v.start && v.last && moneyIn(v.start, v.last)) this.idle?.credit.moneyIn(Date.now());
    }
    this.saveAfterGame('claim');
  }

  private loseVisit(v: NonNullable<Live['freeVisit']>, why: 'busy' | 'moved'): void {
    if (this.freeVisit !== v) return;
    this.claimStats[why === 'busy' ? 'lost' : 'moved']++;
    console.log(why === 'busy'
      ? '[arcade] another player took the machine first'
      : '[arcade] the machine was saved since this page walked up: walking up again');
    const glass = this.glass;
    this.stop();
    if (!glass) return;
    if (why === 'busy') this.busyNotice(glass, v.slot, this.holderNames.get(v.slot) ?? null);
    else void this.start(glass, { ...v.o, stampPlay: false });
  }

  private visitHolder(slot: StateSlot, h: 'you' | 'other' | null, name: string | null): void {
    if (h === 'other') this.holderNames.set(slot, name);
    const v = this.freeVisit;
    if (v?.slot === slot && h === 'other') this.loseVisit(v, 'busy');
  }

  private endVisit(v: NonNullable<Live['freeVisit']>): void {
    if (this.freeVisit === v) this.freeVisit = null;
    if (v.timer) clearInterval(v.timer);
    v.timer = null;
    v.visit.stop();
  }

  private startIdle(slot: StateSlot): void {
    this.stopIdle();
    const limits = idleLimitsFrom(globalThis.location?.search ?? '', !!import.meta.env?.DEV);
    const s: NonNullable<Live['idle']> = { clock: new IdleClock(limits, Date.now()), credit: new CreditSign(), timer: null, slot, asked: false };
    this.idle = s;
    s.timer = setInterval(() => this.idleSecond(s), 1000);
  }

  private stopIdle(): void {
    if (this.idle?.timer) clearInterval(this.idle.timer);
    this.idle = null;
  }

  private idleActive(): void {
    const s = this.idle;
    if (!s) return;
    s.clock.active(Date.now());
    if (s.asked) {
      s.asked = false;
      this.stopNote?.update(null, '');
    }
  }

  private idleSecond(s: NonNullable<Live['idle']>): void {
    if (this.idle !== s || !this.running) return;
    const now = Date.now();
    if (this.cutOff) { s.clock.active(now); s.asked = false; return; }
    const st = s.clock.tick(now, s.credit.credit);
    if (st.kind === 'playing') return;
    if (st.kind === 'ask') {
      if (!s.asked) {
        s.asked = true;
        this.claimStats.idleAsked++;
        console.log('[arcade] nobody has played the machine for a while: still playing?');
      }
      this.stopNote?.notice(stillPlayingText(st.leftMs), { label: CARRY_ON_BUTTON, run: () => this.carryOn(s) }, () => this.carryOn(s));
      return;
    }
    this.claimStats.idleReleased++;
    console.log('[arcade] nobody answered: the machine is saved and let go');
    const glass = this.glass;
    const o = this.startOpts;
    this.stop();
    if (glass) this.revisit(glass, { ...o, stampPlay: false });
  }

  private carryOn(s: NonNullable<Live['idle']>): void {
    if (this.idle !== s) return;
    s.clock.carryOn(Date.now());
    s.asked = false;
    this.stopNote?.update(null, '');
    s.slot.here?.();
  }

  frame(texMax: number): boolean {
    if (!this.running || !this.glass) return false;
    const v = this.emu.latestFrame();
    if (!v) return false;
    if (!this.paused) {
      this.effects.frame(v);
      this.onFrame?.(v);
      if (!this.cutOff) this.settleFrame(v);
      if (this.freeVisit) this.visitFrame(this.freeVisit, v);
    }
    if (!this.halted && !this.paused && !this.watching) {
      const reason = noteReason(judgeStop(this.stopWatch, v, performance.now(), { paused: false, quietIsWaiting: this.quietIsWaiting }), this.stopParts);
      if (this.updatedNote && this.coinDoorOpen) this.updatedNote = false;
      if (!this.idle?.asked && !this.updatedNote && !(this.coinsStoppedNow && !reason)) this.stopNote?.update(reason, reason ? noteText(reason, this.stopParts) : '', offersState(reason, this.stopParts));
    }
    const painted = this.glass.paintFrame(v, texMax);
    if (painted && this.lastStart && this.lastStart.paintedAt === undefined) {
      this.lastStart.paintedAt = performance.now();
    }
    return painted;
  }

  private clickable(p: CabLamp): boolean {
    return answers(p, this.glass?.gatedOff);
  }

  press(pointerId: number, x: number, y: number, scale: number, skip?: ReadonlySet<CabLamp>): CabLamp | null {
    const g = this.glass;
    if (!this.running || !g?.cab) return null;
    const box = checkboxAt(g.cab.checkboxes, x, y);
    if (box) {
      if (!this.hostNow()) {
        const row = this.emu.info?.switchPanel.find((sw) => sw.id === box.id);
        this.throwSwitch(row ?? { id: box.id }, !g.switchLevels.ticked(box, this.emu.info?.switchPanel));
      }
      return null;
    }
    const lp = pickControl(g.cab.lamps, x, y, scale, (p) => this.clickable(p) && this.hostCan(p) && !skip?.has(p));
    if (lp) this.activate(lp, pointerId);
    return lp;
  }

  throwSwitch(sw: { id: number; bootOnly?: boolean }, on: boolean): void {
    this.emu.input(sw.id, on);
    this.glass?.switchLevels.set(sw.id, on);
    if (sw.bootOnly) this.powerCycle();
  }

  pressHit(pointerId: number, hit: { x: number; y: number; scale: number; coin?: boolean }): CabLamp | null {
    if (!this.running || !this.glass?.cab) return null;
    if (hit.coin) return this.coinEntry(pointerId);
    return this.press(pointerId, hit.x, hit.y, hit.scale, this.glass.replaced);
  }

  coinEntry(pointerId: number): CabLamp | null {
    const g = this.glass;
    if (!this.running || !g?.cab || !g.game || this.hostNow()) return null;
    const view = viewFor(g.game.system);
    const coins: readonly { label: string; bit: number; pence?: number | null; token?: boolean }[] = this.emu.info?.coins ?? view.coins;
    const pence = (line: number): number => { const c = coins.find((k) => k.bit === line); return c ? penceOf(c) : -1; };
    const slots = g.cab.lamps.flatMap((lp) => {
      if (lp.acceptor) {
        const r = acceptorResolve(view, lp, this.emu.info?.coins, this.emu.info?.coinPort);
        return r.kind === 'note' || r.line < 0 ? [] : [{ lp, line: r.line }];
      }
      return lp.coinInput !== undefined && hasInput(lp) ? [{ lp, line: lp.coinInput }] : [];
    });
    const best = slots.sort((a, b) => pence(b.line) - pence(a.line))[0];
    if (best) {
      const f = this.emu.latestFrame();
      if (g.gatedOff.has(best.lp)) { if (best.lp.acceptor) this.effects.coin(best.lp.acceptor, 'locked'); return null; }
      if (f?.coinBusy) { this.effects.coin(best.lp.acceptor, 'refused'); return null; }
      this.activate(best.lp, pointerId);
      return best.lp;
    }
    const own = [...coins].filter((c) => !c.token && penceOf(c) > 0).sort((a, b) => penceOf(b) - penceOf(a))[0];
    const line = own ? own.bit : acceptorResolve(view, {}, this.emu.info?.coins, this.emu.info?.coinPort).line;
    if (line < 0) return null;
    const f = this.emu.latestFrame();
    if (f?.coinBusy || !this.payCoin(line)) { this.effects.coin(undefined, 'refused'); return null; }
    this.dropCoin(line);
    return null;
  }

  private keySurface(): KeySurface {
    return {
      lamps: () => this.glass?.cab?.lamps ?? null,
      running: () => this.running,
      onScreen: () => this.running,
      hasKeyboard: () => this.running,
      pressable: (lp) => this.clickable(lp) && this.hostCan(lp),
      press: (lp, id) => this.activate(lp, id),
      release: (id) => this.release(id),
      hints: () => {
        const g = this.glass;
        const place = this.hintPlace?.() ?? null;
        if (!g?.cab || !g.game || !place) return null;
        const info = this.emu.info;
        return {
          machine: {
            lamps: g.cab.lamps, content: g.cab.content, view: viewFor(g.game.system), vfd: g.cab.vfd,
            opts: { coins: info?.coins, nameCoins: info?.coins, coinPort: info?.coinPort, capNames: info?.capNames },
          },
          place,
        };
      },
    };
  }

  hold(lp: CabLamp, pointerId: number): void {
    if (!this.running || this.watching) return;
    this.activate(lp, pointerId);
    this.own.add(pointerId);
  }

  private activate(lp: CabLamp, pointerId: number): void {
    const g = this.glass;
    if (!g?.game) return;
    this.stopWatch.engage();
    this.settle.played(performance.now());
    this.idleActive();
    if (lp.acceptor) {
      if (g.gatedOff.has(lp)) {
        this.effects.coin(lp.acceptor, 'locked');
        return;
      }
      const got = acceptorResolve(viewFor(g.game.system), lp, this.emu.info?.coins, this.emu.info?.coinPort);
      if (got.kind === 'note') {
        if (got.line >= 0 && !this.coinDoorOpen) {
          this.wallet?.turnedAway();
          this.effects.coin(lp.acceptor, 'refused');
          return;
        }
        if (got.line >= 0 && !this.pays({ label: '', pence: null })) {
          this.effects.coin(lp.acceptor, 'refused');
          return;
        }
        if (got.line >= 0) {
          this.emu.note(got.line);
          this.effects.coin(lp.acceptor);
        }
        return;
      }
      if (got.line >= 0) this.slotCoin(got.line, lp.acceptor, lp);
      return;
    }
    if (lp.coinInput !== undefined && lp.coinInput >= 0) {
      this.slotCoin(lp.coinInput, undefined, lp);
      return;
    }
    if (lp.button !== undefined && lp.button >= 0) {
      this.freeVisit?.trigger.pressed(performance.now());
      this.release(pointerId);
      this.buttons.hold(pointerId, lp.button);
    }
  }

  private slotCoin(line: number, acceptor: CabLamp['acceptor'], gate?: CabLamp): void {
    if (this.coinDoorOpen && this.chooseCoin(line, acceptor, gate)) return;
    const f = this.emu.latestFrame();
    if (!f) return;
    if (f.coinBusy || !this.payCoin(line)) { this.effects.coin(acceptor, 'refused'); return; }
    this.landCoin(line, acceptor, gate);
  }

  release(pointerId: number): void {
    this.own.delete(pointerId);
    this.buttons.release(pointerId);
  }

  private focusLost(): void {
    for (const [p] of this.buttons.entries()) if (!this.own.has(p)) this.release(p);
  }
}

function moneyIn(from: CashLedger, to: CashLedger): boolean {
  return to.inPence > from.inPence || to.tokenInPence > from.tokenInPence || (to.unpricedTokenIn ?? 0) > (from.unpricedTokenIn ?? 0)
    || (to.unpricedIn ?? 0) > (from.unpricedIn ?? 0) || (to.euroInCents ?? 0) > (from.euroInCents ?? 0);
}
