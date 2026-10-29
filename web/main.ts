import {
  classifyGame, linkedInstances, missingProgramRoms, platformFor, type Game,
} from '../src/machine/registry';
import { sources } from './sources/feature';
import { addEnabled as addSourceEnabled } from './sources/flag';
import { Presenter, planSize, uniformPlan } from './present';
import { damagedRoms } from '../src/machine/textcopy';
import { type FrameView } from '../src/machine/framestate';
import { SchematicPanel } from './schematic';
import { BulbLab } from './bulblab';
import { WorkerEmu, type AutosaveBlob, type Emu } from './emu-client';
import { InlineEmu } from './emu-inline';
import { StallWatch } from './stallwatch';
import { HwBridge } from './hwbridge';
import type { MachineInfo } from './emu-protocol';
import { ledgerPayoutPercent, type CashLedger } from './emu-protocol';
import { buildStamp, logInputLabels, saveBlob, saveFile } from './downloads';
import { aboutOpen } from './about';
import { DownloadMenu } from './panelmenu';
import { bulbTab, logTab, matrixTab, optionsTab } from './paneltabs';
import { bootValue, liveValue, setSwitch, urlValue, wasmOption } from './settings';
import {
  entriesFromDrop, filesFromDrop, punnetBytes, readFolderSetOne, setsFromFolderInput, sniffPunnetSet,
  zipGameCount, type FolderSet,
} from './ingest';
import { readZipDirectory } from './zipdir';
import { collectionEntries } from './punnetpack';
import {
  CLOUD_HINT, importFolderSet, landedFlaws, listArchives, stageText, unplayableReason,
} from './libimport';
import {
  importConcurrency, importPunnet, importUpload, libraryWriteInFlight,
  onLibraryWrite, openPak, type ImportError, type UploadSource,
} from './importer';
import { exportPunnet, punnetFileName } from './portable';
import { openExportPicker, openPackTarget, packGames, packReport } from './punnetexport';
import { openAlert } from './ui/dialog';
import { mountSettings } from './ui/settings';
import { pillButton } from './ui/list';
import { BRIGHT_NEUTRAL, brightnessControl } from './ui/brightness';
import { askClearRam } from './clearram';
import { card, checkRow, choreograph, menuRow, sliderRow, setKvValue, statRow } from './ui/rows';
import { enhanceSelect } from './ui/dropdown';
import { MenuDrawer } from './ui/drawer';
import { showSpeaker, speakerButton } from './ui/speaker';
import { fillKeyTable, type KeyTableRow } from './keytable';
import { KeyHintLayer, canvasPlace } from './keyhints';
import { PlayKeys, showKeysRow } from './play/keys';
import { answers, CLICK_SLOP_PX, HeldButtons, PlayPointer } from './play/pointer';
import { checkboxAt, SwitchLevels } from './checkbox';
import { PlayAutosave } from './play/autosave';
import { followGate, gatesOf, stampGates } from './play/gates';
import { appendItems, appendMenuFoot, menuItems, saveLog, saveState, stateDownload, type ActionId, type ActionSurface } from './play/actions';
import { machineCoins, restoreCabinetSounds } from './menupanels';
import { mustName, readCoinAnswers, withCoinAnswer } from './coinask';
import { namingSlots } from './coinslots';
import { openCoinNaming } from './ui/coinmenu';
import type { NamedCoin } from '../src/machine/machine';
import {
  THUMB_MAX_W,
  THUMB_QUALITY,
  THUMB_RULE,
  closeCabinet,
  componentBounds,
  downscaleCanvas,
} from './cabjson';
import { isQuotaError, requestStoragePersist } from './persist';
import { EraseBlockedError, eraseEverything } from './reset';
import {
  SCHEMA_VERSION, deleteGame, getMeta, getMoney, listGames,
  putMeta, putMoney, putThumb, type GameMeta,
} from './store';
import { localStateStore, type StateStore } from './statestore';
import { currentLayoutProps, isPakBytes } from './gamepak';
import {
  cancelPendingDelete, closeSheet, commitPendingDeletes, displayTitle, openAddSheet,
  libraryChooseOrbit, libraryToGrid, onBeforeOrbit, renderLibrary, showNotice, wireLibraryControls, type LibraryHandlers,
  SCREEN_FADE_MS, prefersReducedMotion, settleArtwork,
} from './library';
import { deflateSync, strToU8 } from 'fflate';
import { parseTitle } from './title';
import { layoutPoint, pickControl, type CanvasFit } from './cabhit';
import { viewFor, acceptorResolve, plainCoinDrop, stampCoinInputs, type PlatformView } from './platform';
import { virtualDisplayReversed } from '../src/machine/layoutdisplay';
import {
  reelEffectivePosition,
  reelWinLineRow,
  usableCabinet,
  type CabCheckbox,
  type CabLamp,
  type Cabinet, type Rect,
} from './dat';
import { StoreConfirm, reelDriftFault } from './reeldrift';
import { createCabinetPainter, DOT_OFF, DOT_ON } from './cabdraw';
import { ensureLegendFonts, faceAvailable, facesToAsk, legendStandIn } from './legendfonts';
import { openFontPicker } from './ui/fontpick';
import { ReelPeek, reelAt } from './play/peek';
import { reelPeekOn } from './peekpref';
import { fillScreenOn } from './fillpref';
import { cropViewOn } from './croppref';
import { reelBandsOn } from './bandspref';
import { bandsLayout, createReelBands } from './play/bands';
import { chordCaps, primaryModifier } from './shortcuts';
import { capsAreSwitches } from './cappulse';
import {
  decodeState, idleNamedInputs, readSavedOptionKeys, readSavedPanelSwitches, readSavedVirtualDisplay,
  readSavedVirtualDisplaySpot, saveOptionKeys, savePanelSwitch, saveVirtualDisplay, saveVirtualDisplaySpot,
  stateRecord, type VirtualDisplaySpot,
} from './gamestate';
import { settleSavedState } from './resumeask';
import { boardStamp } from './boardstamp';
import { addReading, emptyRecord, readMoneyTotals, type MoneyTotals } from './moneyrecord';
import { showToast } from './ui/toast';
import type { Snapshot } from './snapshot';
import { Audio } from './audio';
import { CabinetEffects } from './effects';
import {
  StopNote, StopWatch, judgeStop, noteReason, noteText, offersState, stopNoteParts, unbuiltLogText,
} from './stopnote';
import { stageBelongsOnVeil } from './busystage';
import {
  HOVER_POINTER_QUERY, Magnifier, hasHoverPointer, magnifierZoom, setMagnifierZoom,
  wheelPixels, wheelStep,
} from './magnifier';
import { platformReelOffsetSteps, platformRequiresReversal, reelIndex } from './render-index';
import { str, applyStrings } from './i18n';
import { fadeFromBlack, fadeToBlack } from './ui/fade';
import { replayOrbitCaption } from './orbit';
import { isLocked } from './kioskmode';
import { mountKioskMode } from './kioskmodeui';
import { moneyInParts, moneyOutParts } from './moneytext';

applyStrings();

const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 480;
const screenEl = document.getElementById('screen') as HTMLCanvasElement;
const screenCtx = screenEl.getContext('2d')!;
let screenDirty = true;
const smoothFit = bootValue('smooth');
const stage = document.getElementById('stage') as HTMLElement;
const ctx = canvas.getContext('2d')!;
const reelPeek = new ReelPeek();
let peekPointer: number | null = null;
const painter = createCabinetPainter(canvas, {
  inputHeld: (input) => held.holding(input),
  virtualDisplay: (m, lcdOnGlass) => setVfdStrip(m, lcdOnGlass),
  dirtyDisabled: !liveValue('dirty'),
  lampGate: (m, lp) => updateGate(m, lp),
  reelPeek: () => reelPeek.value(),
  onReelRow: (reel, row) => reelBands.row(reel, row),
  checkboxTicked: (cb) => switchLevels.ticked(cb, emu.info?.switchPanel),
});
const reelBands = createReelBands(stage);
const picker = document.getElementById('folder') as HTMLInputElement;
const zipPicker = document.getElementById('zipfile') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;
const librarySection = document.getElementById('library') as HTMLElement;
const burgerBtn = document.getElementById('burgerBtn') as HTMLButtonElement;
const schemBtn = document.getElementById('schemBtn') as HTMLButtonElement;
const soundGroup = document.getElementById('soundGroup') as HTMLElement;
const menu = document.getElementById('menu') as HTMLElement;
const menuBackdrop = document.getElementById('menuBackdrop') as HTMLElement;
const menuContent = document.getElementById('menuContent') as HTMLElement;
const menuSub = document.getElementById('menuSub') as HTMLElement;
const schemPanelEl = document.getElementById('schemPanel') as HTMLElement;
const schemBackdrop = document.getElementById('schemBackdrop') as HTMLElement;
const uploadLabels = [...document.querySelectorAll<HTMLElement>('.upload')];
const busy = document.getElementById('busy') as HTMLElement;
const busyMsg = document.getElementById('busyMsg') as HTMLElement;
const busyTitle = document.getElementById('busyTitle') as HTMLElement;
function setBusyMsg(msg: string, title?: string): void {
  (busyMsg.firstElementChild as HTMLElement).textContent = msg;
  busyTitle.textContent = title ?? '';
  busyTitle.hidden = !title;
}
const busyStop = document.getElementById('busyStop') as HTMLButtonElement;
const busyBar = document.getElementById('busyBar') as HTMLElement;
const busyFill = busyBar.firstElementChild as HTMLElement;
const cacheNote = document.getElementById('cacheNote') as HTMLElement;
const errorPopup = document.getElementById('errorPopup') as HTMLElement;
const errorMsg = document.getElementById('errorMsg') as HTMLElement;
const errorDismiss = document.getElementById('errorDismiss') as HTMLButtonElement;
const errorAction = document.getElementById('errorAction') as HTMLButtonElement;
const errorHint = document.getElementById('errorHint') as HTMLElement;
const importReport = document.getElementById('importReport') as HTMLElement;
const importReportTitle = document.getElementById('importReportTitle') as HTMLElement;
const importReportSummary = document.getElementById('importReportSummary') as HTMLElement;
const importReportSum = document.getElementById('importReportSum') as HTMLElement;
const importReportFailed = document.getElementById('importReportFailed') as HTMLDetailsElement;
const importReportFailedHead = document.getElementById('importReportFailedHead') as HTMLElement;
const importReportFailedList = document.getElementById('importReportFailedList') as HTMLElement;
const importReportOrphanNote = document.getElementById('importReportOrphanNote') as HTMLElement;
const importReportRemove = document.getElementById('importReportRemove') as HTMLButtonElement;
const importReportOk = document.getElementById('importReportOk') as HTMLButtonElement;

const BULB_LAB_AT_START = liveValue('bulbs');
let diagLogOn = liveValue('diag');

const busyCovers = [
  document.querySelector('header') as HTMLElement, librarySection, stage,
  document.getElementById('statusbar') as HTMLElement,
];

function showBusy(msg: string, title?: string): void {
  if (!errorPopup.hidden) return;
  setBusyMsg(msg, title);
  busy.classList.add('show');
  for (const el of busyCovers) el.inert = true;
}

function hideBusy(): void {
  busy.classList.remove('show');
  for (const el of busyCovers) el.inert = false;
}

interface ErrorAction { label: string; hint?: string; run: () => void; back?: () => void }

let errorActionRun: (() => void) | null = null;
let errorBackRun: (() => void) | null = null;

function showError(msg: string, action?: ErrorAction): void {
  hideBusy();
  try { localStorage.setItem(LAST_ERROR_KEY, JSON.stringify({ msg, at: new Date().toISOString() })); } catch {  }
  status.textContent = msg;
  errorMsg.textContent = msg;
  errorHint.textContent = action?.hint ?? '';
  errorHint.hidden = !action?.hint;
  errorActionRun = action?.run ?? null;
  errorBackRun = action?.back ?? null;
  errorAction.textContent = action?.label ?? '';
  errorAction.hidden = !action;
  errorPopup.hidden = false;
  (action ? errorAction : errorDismiss).focus();
}

function dismissError(): void {
  errorPopup.hidden = true;
  errorActionRun = null;
  errorBackRun = null;
}

const IMPORTING_KEY = 'fruitulator.importing';
const LAST_ERROR_KEY = 'fruitulator.last-error';
const TRACE_KEY = 'fruitulator.import-trace';
const TRACE_LINES = 40;
let traceStart = 0;
function trace(line: string): void {
  const now = Date.now();
  if (!traceStart) traceStart = now;
  const entry = `+${((now - traceStart) / 1000).toFixed(1)}s ${line}`;
  console.log(`[import] ${entry}`);
  try {
    const lines = JSON.parse(localStorage.getItem(TRACE_KEY) ?? '[]') as string[];
    lines.push(entry);
    localStorage.setItem(TRACE_KEY, JSON.stringify(lines.slice(-TRACE_LINES)));
  } catch {  }
}
function traceReset(): void {
  traceStart = 0;
  try { localStorage.removeItem(TRACE_KEY); } catch {  }
}
function markImporting(name: string): void {
  try { sessionStorage.setItem(IMPORTING_KEY, name); } catch {  }
  status.classList.add('nb-statusbar__busy');
}
function importing(): boolean {
  try { return sessionStorage.getItem(IMPORTING_KEY) !== null; } catch { return false; }
}
window.addEventListener('unhandledrejection', (ev) => {
  const why = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
  trace(`unhandled rejection: ${why}`);
  if (importing()) {
    clearImporting();
    showError(str('main.the_import_stopped_on_an', { 0: why }));
  }
});
window.addEventListener('error', (ev) => {
  trace(`error: ${ev.message}`);
  if (importing()) {
    clearImporting();
    showError(str('main.the_import_stopped_on_an', { 0: ev.message }));
  }
});
function clearImporting(): void {
  try { sessionStorage.removeItem(IMPORTING_KEY); } catch {  }
  status.classList.remove('nb-statusbar__busy');
}
const PICKER_KEY = 'fruitulator.picker-open';
function markPickerOpen(open: boolean): void {
  try {
    if (open) sessionStorage.setItem(PICKER_KEY, '1');
    else sessionStorage.removeItem(PICKER_KEY);
  } catch {  }
}
function reportInterruptedImport(): void {
  let name: string | null = null;
  let pickerOpen = false;
  try {
    name = sessionStorage.getItem(IMPORTING_KEY);
    sessionStorage.removeItem(IMPORTING_KEY);
    pickerOpen = sessionStorage.getItem(PICKER_KEY) !== null;
    sessionStorage.removeItem(PICKER_KEY);
  } catch { return; }
  if (!name && pickerOpen) {
    showError(str('main.the_page_reloaded_while_the'));
    return;
  }
  if (!name) return;
  try {
    const e = JSON.parse(localStorage.getItem(LAST_ERROR_KEY) ?? 'null') as { msg: string; at: string } | null;
    if (e) console.warn(`import interrupted by a reload; last error: "${e.msg}" (${e.at})`);
  } catch {  }
  showError(str('main.the_page_reloaded_while_n', { 0: name }));
}

errorDismiss.addEventListener('click', () => {
  const back = errorBackRun;
  dismissError();
  back?.();
});
errorAction.addEventListener('click', () => {
  const run = errorActionRun;
  dismissError();
  run?.();
});

function nextPaint(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

const emu: Emu = bootValue('worker') ? new WorkerEmu() : new InlineEmu();
const HW_URL = new URLSearchParams(location.search).get('hw');
const hwBridge = HW_URL?.startsWith('ws') ? new HwBridge(emu, HW_URL) : null;
let running = false;
const switchLevels = new SwitchLevels();
const stopWatch = new StopWatch();
let quietIsWaiting = false;
const stopNote = new StopNote(document, () => openSchematic('diagram'), () => void downloadSnapshot());
let stopParts: string[] = [];
class Session {
  boot = 0;
  paintedBoot = 0;
  framesDrawn = 0;
  game: Game | null = null;
  hash: string | null = null;
  autoSave = true;
  meta: GameMeta | null = null;
  coinAnswers: Record<string, NamedCoin> = {};
  coinUnsure = new Set<number>();
}
const session = new Session();
const stateStore: StateStore = localStateStore;
let libraryReturns = 0;
let libraryErased = false;

let cabinet: Cabinet | null = null;
let awaitingCabinet = false;

const magnifier = new Magnifier(stage, {
  canvas,
  screen: screenEl,
  get content() { return cabinet ? cabinet.content : null; },
  get stretch() { return fillScreenOn(); },
}, prefersReducedMotion);

const VFD_REVERSE_STORE = 'fruitulator.vfdReverse';
let vfdReverseOverride: boolean | null = (() => {
  try {
    const v = localStorage.getItem(VFD_REVERSE_STORE);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
})();
let vfdReverseBox: HTMLInputElement | null = null;

function setVfdReverse(on: boolean | null): void {
  vfdReverseOverride = on;
  if (vfdReverseBox && on !== null) vfdReverseBox.checked = on;
  try {
    if (on === null) localStorage.removeItem(VFD_REVERSE_STORE);
    else localStorage.setItem(VFD_REVERSE_STORE, on ? 'on' : 'off');
  } catch {
  }
  if (cabinet && !cabinet.vfd && session.game) {
    painter.vfdReversed = on ?? virtualDisplayReversed(session.game.system);
    renderVfdStrip();
  }
}

function startGame(
  game: Game,
  cabPromise: Promise<Cabinet | null>,
  snapshot?: Snapshot,
  bootFresh?: () => void,
): void {
  stopMoneyWatch();
  session.game = game;
  effects.load(game);
  const booted = ++session.boot;
  session.framesDrawn = 0;
  stage.removeAttribute('data-ready');
  fatal = '';
  running = false;
  stopWatch.reset(performance.now());
  stopNote.clear();
  stopParts = [];
  const damaged = damagedRoms(game);
  if (damaged.length) {
    showNotice(str('main.n_looks_damaged_by_a', { 0: damaged.join(', ') }), { autoClose: false });
  }
  let machineUp = false;
  let cabinetSettled = false;
  const settle = (): void => { if (machineUp && cabinetSettled) { hideBusy(); machineShown(); } };
  onFirstFrameDrawn = () => {
    if (booted !== session.boot) return;
    session.paintedBoot = booted;
    machineUp = true;
    settle();
  };
  session.coinAnswers = readCoinAnswers(session.meta?.coinAnswers);
  session.coinUnsure.clear();
  void emu.load({
    game,
    snapshot,
    optionKeys: readSavedOptionKeys(game),
    panelSwitches: readSavedPanelSwitches(game),
    namedCoins: session.coinAnswers,
    benchStep: BENCH_STEP,
    noAudio: NO_AUDIO,
    bench: BENCH,
    noRegions: NO_REGIONS,
    wasm: USE_WASM,
  })
    .then((info) => {
      if (booted !== session.boot) return;
      audio.attach(info.audioRate, info.audioLevel);
      bridgeAudio();
      console.log(`[emu] ROM optimiser: ${info.codegen ?? 'none'} (${info.system})`);
      if (info.codegen === 'regions') {
        showBusy(str('main.starting_the_machine_rom_optimiser'));
      } else if (info.codegen === 'wasm') {
        showBusy(str('main.starting_the_machine_wasm_cpu'));
      }
      status.textContent = game.name;
      machineRunning();
      if (pendingResetNotice) {
        pendingResetNotice = false;
        showToast(str('main.this_update_had_to_reset'), { sticky: true, kind: 'warn' });
      }
      if (session.hash) startMoneyWatch(session.hash);
      stopParts = stopNoteParts(info.boardDefaults);
      quietIsWaiting = info.quietIsWaiting === true;
      if (stopParts.length) console.log(`[fruitulator] ${unbuiltLogText(stopParts)}`);
      hwBridge?.gameLoaded(game.name, info.system, info.coins);
      infoBoot = booted;
      stampCabinetCoins();
      refreshKeys?.();
      idleNamedInputs(emu, game, info);
      buildMenu(info);
    })
    .catch((e: Error) => {
      if (booted !== session.boot) return;
      hideBusy();
      if (snapshot && bootFresh) {
        showError(str('main.boot_failed_n', { 0: e.message }), {
          label: str('main.start_machine_fresh'),
          hint: str('main.the_saved_state_cannot_be'),
          run: bootFresh,
          back: abandonGame,
        });
      } else {
        abandonGame();
        showError(str('main.boot_failed_n', { 0: e.message }));
      }
    });
  status.textContent = game.name;
  resetView();
  void showGame();

  awaitingCabinet = true;
  if (bulbLab.active) bulbLab.disable();
  if (cabinet) closeCabinet(cabinet);
  cabinet = null;
  layoutBox = null;
  rebuildMenu = null;
  resetReelDrift();
  playKeys.reset();
  gatedOff.clear();
  gateSeenLit.clear();
  for (const n of gatesOf(snapshot)) gateSeenLit.add(n);
  painter.resetDisplay();
  setVfdStrip(null);
  vfdStripGame = readSavedVirtualDisplay(game);
  vfdStripSpot = readSavedVirtualDisplaySpot(game);
  canvas.width = 800;
  canvas.height = 480;
  cabPromise
    .then((rawCab) => {
      if (booted !== session.boot) {
        if (rawCab) closeCabinet(rawCab);
        return;
      }
      awaitingCabinet = false;
      cabinetSettled = true;
      if (!machineUp) showBusy(str('main.starting_the_machine'));
      settle();
      const cab = usableCabinet(rawCab);
      if (!cab) {
        if (rawCab) closeCabinet(rawCab);
        cabinet = null;
        status.textContent = str('main.n_no_artwork_plain_view', { 0: game.name });
        console.log(
          game.layout
            ? '[dat] layout not decodable (v9 .fml?) - fallback view'
            : '[dat] no layout in set',
        );
        return;
      }
      const cabView = viewFor(game.system);
      capsAreSwitches(cab.lamps, cabView.nonSwitchInputs);
      layoutBox = { ...cab.content };
      cab.content = playView(cab, layoutBox);
      cabinet = cab;
      switchLevels.clear();
      void ensureLegendFonts([...cab.lamps, ...(cab.checkboxes ?? [])].map((l) => l.legend?.face)).then(() => { if (cabinet === cab) forceRedraw(); });
      offerFontChoices(cab);
      stampCabinetCoins();
      refreshKeys?.();
      rebuildMenu?.();
      if (BULB_LAB_AT_START && !bulbLab.active) {
        bulbLab.enable(cab);
        openSchematic('bulbs');
      }
      painter.loadDisplay(cab, vfdReverseOverride ?? virtualDisplayReversed(game.system));
      if (cab.content.width > 0 && cab.content.height > 0) {
        canvas.width = cab.content.width;
        canvas.height = cab.content.height;
      }
      status.textContent = game.name;
      console.log(`[dat] cabinet: ${cab.reels.length} reels, ${cab.background ? 'art' : 'no art'}`);
    })
    .catch((e) => {
      if (booted !== session.boot) return;
      awaitingCabinet = false;
      cabinetSettled = true;
      settle();
      cabinet = null;
      status.textContent = str('main.n_cabinet_extract_failed_n', { 0: game.name, 1: (e as Error).message });
    });
}

function handleUpload(src: UploadSource, fallbackName?: string): void {
  let game: Game | null = null;
  let booted = -1;
  let resolveCab: (cab: Cabinet | null) => void = () => {};
  const cabPromise = new Promise<Cabinet | null>((r) => { resolveCab = r; });

  const finished = importUpload(src, fallbackName, {
    onProgress: (stage) => {
      if (!stageBelongsOnVeil({
        left: false, startedBoot: booted, boot: session.boot, veilUp: busy.classList.contains('show'),
      })) {
        cacheNote.hidden = false;
        return;
      }
      const msg = stageText(stage, game?.name);
      if (msg) showBusy(msg);
    },
    onFiles: (files) => {
      try {
        const hasGam = files.some((f) => /\.gam$/i.test(f.name));
        game = classifyGame(files, hasGam ? undefined : fallbackName);
        if (!platformFor(game.system)) {
          showError(str('main.n_system_n_not_supported', { 0: game.name, 1: game.system }));
          game = null;
          return;
        }
        const absentRoms = missingProgramRoms(game);
        if (absentRoms.length) {
          showError(
            str('main.n_the_gam_names_program', { 0: game.name, 1: absentRoms.join(', ') }),
          );
          game = null;
          return;
        }
        const linked = linkedInstances(game);
        if (linked.length) {
          showError(
            str('main.n_this_is_the_top', { 0: game.name, n: linked.length }),
          );
          game = null;
          return;
        }
        enterGameFullscreen();
        session.hash = null;
        session.meta = null;
        session.autoSave = true;
        startGame(game, cabPromise);
        booted = session.boot;
      } catch (err) {
        showError(`${game?.name ?? fallbackName ?? 'game'} · ${(err as Error).message}`);
        game = null;
        console.warn('[library] classify failed', err);
      }
    },
    onCabinet: (cab) => {
      if (booted >= 0) resolveCab(cab);
      else if (cab) closeCabinet(cab);
    },
  });

  void finished
    .then(
      (meta) => {
        requestStoragePersist();
        console.log(`[library] cached ${meta.name} (${meta.hash.slice(0, 8)})`);
        cancelPendingDelete(meta.hash);
        if (booted === session.boot) {
          session.hash = meta.hash;
          session.meta = meta;
          session.autoSave = meta.autoSave;
          adoptCoinAnswers(meta);
        } else {
          hideBusy();
          status.textContent = str('main.n_added_tap_its_card', { 0: meta.name });
        }
      },
      (err: unknown) => {
        hideBusy();
        const e = err as ImportError;
        if (booted === session.boot && !running) abandonGame();
        showError(e.code === 'quota'
          ? str('main.n_library_full_delete_a', { 0: game?.name ?? fallbackName ?? 'game' })
          : str('main.import_failed_n', { 0: e.message }));
      },
    )
    .finally(() => { cacheNote.hidden = true; clearImporting(); });
}

async function handleArchiveBytes(bytes: Uint8Array, name: string): Promise<void> {
  if (isPakBytes(bytes)) {
    importPunnetFile(bytes, name);
    return;
  }
  let games = 1;
  let several = false;
  try {
    const listing = await readZipDirectory(new Blob([bytes as BlobPart]));
    several = collectionEntries(listing) !== null;
    games = await zipGameCount(bytes, listing);
  } catch {  }
  if (several) {
    markImporting(name);
    const file = new File([bytes as BlobPart], `${name}.punnet`);
    await importFolderSets(await listArchives([{ dir: file.name, name, entries: [file], zip: true }], { trace }));
    return;
  }
  if (games > 1) {
    markImporting(name);
    const file = new File([bytes as BlobPart], `${name}.zip`);
    await importFolderSets([{ dir: file.name, name, entries: [file], zip: true }]);
    return;
  }
  handleUpload({ zip: bytes }, name);
}

async function readArchiveFile(file: File): Promise<void> {
  dismissError();
  status.textContent = str('main.loading');
  showBusy(str('main.reading_n', { 0: file.name }));
  markImporting(file.name);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    clearImporting();
    hideBusy();
    status.textContent = '';
    showError(str('main.could_not_read_n_n', { 0: file.name, 1: (e as Error).message || str('main.the_file_could_not_be'), 2: CLOUD_HINT }));
    return;
  }
  if (bytes.length === 0) {
    clearImporting();
    hideBusy();
    status.textContent = '';
    showError(str('main.n_came_back_empty_n', { 0: file.name, 1: CLOUD_HINT }));
    return;
  }
  await handleArchiveBytes(bytes, archiveStem(file.name));
}

const archiveStem = (fileName: string): string => fileName.replace(/\.(zip|punnet)$/i, '');

function importPunnetFile(bytes: Uint8Array, name: string): void {
  dismissError();
  status.textContent = str('main.loading');
  showBusy(str('main.importing_n', { 0: name }));
  void importPunnet(bytes, name, {
    onProgress: (stage) => {
      const msg = stageText(stage, name);
      if (msg) showBusy(msg);
    },
  }).then(
    async (meta) => {
      requestStoragePersist();
      console.log(`[library] imported punnet ${meta.name} (${meta.hash.slice(0, 8)})`);
      cancelPendingDelete(meta.hash);
      const why = libraryHandlers.unplayable(meta);
      if (why) {
        hideBusy();
        showError(str('main.n_added_to_the_library', { 0: displayTitle(meta), 1: why.detail }));
        return;
      }
      await openFromLibrary(meta.hash, (await stateStore.keys()).has(meta.hash));
    },
    (err: unknown) => {
      hideBusy();
      const e = err as ImportError;
      showError(e.code === 'quota' ? str('main.n_library_full_delete_a', { 0: name })
        : e.code === 'corrupt-punnet' ? str('main.n_is_not_a_readable', { 0: name, 1: e.message })
        : str('main.import_failed_n', { 0: e.message }));
    },
  );
}

let stopBatch = false;
let batchRunning = false;

let pickGen = 0;

busyStop.addEventListener('click', () => {
  if (!batchRunning) {
    pickGen++;
    disarmPickerWait();
    clearImporting();
    busyStop.hidden = true;
    hideBusy();
    trace('pick stopped before import');
    status.textContent = str('main.stopped_nothing_was_added');
    return;
  }
  stopBatch = true;
  busyStop.disabled = true;
  setBusyMsg(str('main.finishing_the_sets_in_progress'));
});

function offerPickStop(): void {
  busyStop.hidden = false;
  busyStop.disabled = false;
}

async function importFolderSets(sets: FolderSet[]): Promise<void> {
  stopBatch = false;
  batchRunning = true;
  busyStop.hidden = false;
  busyStop.disabled = false;
  busyBar.hidden = false;
  busyFill.style.width = '0%';
  let added = 0;
  let known = 0;
  let unrunnable = 0;
  let silent = 0;
  let quota = false;
  let completed = 0;
  const inFlight = new Map<string, Promise<GameMeta>>();
  const failed: { name: string; reason: string; hash?: string }[] = [];
  const orphans: string[] = [];
  const landed = (name: string, meta: GameMeta, hash: string): void => {
    cancelPendingDelete(hash);
    const flaws = landedFlaws(meta);
    if (flaws.length) {
      failed.push({ name, reason: flaws.join('; '), hash });
      return;
    }
    added++;
    if (meta.missingSound?.length) silent++;
    if (!platformFor(meta.system)) unrunnable++;
  };
  try {
    const importSet = async (set: FolderSet, i: number): Promise<void> => {
      const setAdded: string[] = [];
      trace(`set ${i + 1}/${sets.length}: ${set.name}`);
      try {
        await importFolderSet(set, {
          inFlight, landed, setAdded, trace,
          known: (hashes) => { known += hashes.length; },
        });
      } catch (e) {
        trace(`failed ${set.name}: ${(e as Error).message || 'import error'}`);
        failed.push({ name: set.name, reason: (e as Error).message || str('main.import_error') });
        orphans.push(...setAdded);
        console.warn(`[library] import failed: ${set.name}`, e);
        if ((e as ImportError).code === 'quota') {
          stopBatch = true;
          quota = true;
        }
      }
    };
    let cursor = 0;
    showBusy(sets.length === 1
      ? str('main.importing_n', { 0: parseTitle(sets[0].name).title || sets[0].name })
      : str('main.importing_n_sets', { 0: sets.length }));
    const runner = async (): Promise<void> => {
      for (;;) {
        if (stopBatch) return;
        const i = cursor++;
        if (i >= sets.length) return;
        await importSet(sets[i], i);
        completed++;
        showBusy(str('main.imported_n_n_of_n', { 0: parseTitle(sets[i].name).title || sets[i].name, 1: completed, 2: sets.length }));
        busyFill.style.width = `${Math.round((completed / sets.length) * 100)}%`;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(importConcurrency(), sets.length) }, runner),
    );
  } finally {
    trace(`batch done: ${added} added, ${known} known, ${failed.length} failed`);
    clearImporting();
    batchRunning = false;
    busyStop.hidden = true;
    busyBar.hidden = true;
    hideBusy();
    if (!librarySection.hidden) {
      await renderLibrary(libraryHandlers)
        .catch((e) => console.warn('[library] refresh after batch failed', e));
    }
  }

  showImportReport({
    total: sets.length, added, known, unrunnable, silent, failed, orphans,
    quota, stopped: stopBatch && !quota,
  });
  status.textContent = added === 0 && known === 0 && failed.length
    ? str('main.import_failed') : str('main.n_added', { 0: added });
}

interface FailedImport {
  name: string;
  reason: string;
  hash?: string;
}

interface ImportReport {
  total: number;
  added: number;
  known: number;
  unrunnable: number;
  silent: number;
  failed: FailedImport[];
  orphans: string[];
  quota: boolean;
  stopped: boolean;
}

let reportRemovable: string[] = [];

function showImportReport(r: ImportReport): void {
  importReportTitle.textContent = r.stopped ? str('main.import_stopped')
    : r.quota ? str('main.import_stopped_library_full')
    : str('main.import_finished');
  const stat = (n: number, label: string, cls = ''): HTMLElement => {
    const s = document.createElement('div');
    s.className = 'nb-stat';
    const l = document.createElement('span');
    l.className = 'nb-stat__label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = `nb-stat__value ${cls}`.trim();
    v.textContent = String(n);
    s.append(l, v);
    return s;
  };
  importReportSum.replaceChildren(
    stat(r.total, str('main.report_scanned', { n: r.total })),
    stat(r.added, str('main.report_added'), r.added ? 'nb-pos' : ''),
    stat(r.failed.length, str('main.report_failed'), r.failed.length ? 'nb-neg' : ''),
  );
  const line = (text: string, cls?: string): void => {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    importReportSummary.append(li);
  };
  importReportSummary.replaceChildren();
  if (r.unrunnable) line(str('main.n_on_boards_this_build', { 0: r.unrunnable }));
  if (r.silent) line(str('main.n_missing_sound_roms_will', { 0: r.silent }), 'nb-meta');
  if (r.known) line(str('main.n_already_in_the_library', { 0: r.known }), 'nb-meta');
  if (r.quota) line(str('main.the_library_is_full_delete'), 'nb-neg');
  importReportSummary.hidden = !importReportSummary.childElementCount;
  if (r.failed.length) {
    importReportFailedHead.textContent = str('main.n_failed_missing_roms_no', { 0: r.failed.length });
    importReportFailedList.replaceChildren(...r.failed.map((f) => {
      const li = document.createElement('li');
      const why = document.createElement('small');
      why.textContent = f.reason;
      li.append(f.name, why);
      return li;
    }));
    importReportFailed.open = true;
  }
  importReportFailed.hidden = !r.failed.length;
  const removable = [...new Set([
    ...r.failed.flatMap((f) => (f.hash ? [f.hash] : [])),
    ...r.orphans,
  ])];
  importReportOrphanNote.textContent = r.orphans.length
    ? str('main.sets_that_failed_part_way', { n: r.orphans.length })
    : '';
  importReportOrphanNote.hidden = !r.orphans.length;
  reportRemovable = removable;
  importReportRemove.hidden = !removable.length;
  importReport.hidden = false;
  importReportOk.focus();
}

function closeImportReport(): void {
  importReport.hidden = true;
  reportRemovable = [];
}

importReportOk.addEventListener('click', closeImportReport);
importReportRemove.addEventListener('click', async () => {
  const doomed = reportRemovable;
  closeImportReport();
  showBusy(str('main.removing_failed_imports'));
  try {
    for (const hash of doomed) await deleteGame(hash);
    status.textContent = str('main.n_removed', { 0: doomed.length });
  } catch (e) {
    showError(str('main.remove_failed_n', { 0: (e as Error).message }));
  } finally {
    hideBusy();
    if (!librarySection.hidden) {
      await renderLibrary(libraryHandlers)
        .catch((e) => console.warn('[library] refresh after remove failed', e));
    }
  }
});

async function importPicked(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const gen = pickGen;
  const stopped = (): boolean => gen !== pickGen;
  if (files.length === 1 && /\.punnet$/i.test(files[0].name)) {
    const probe: FolderSet = { dir: files[0].name, name: archiveStem(files[0].name), entries: [files[0]], punnet: true };
    await sniffPunnetSet(probe);
    if (probe.punnet) {
      await readArchiveFile(files[0]);
      return;
    }
  }
  dismissError();
  status.textContent = str('main.loading');
  showBusy(files.length === 1 ? str('main.reading_n', { 0: files[0].name }) : str('main.reading_n_files', { 0: files.length }));
  markImporting(files.length === 1 ? files[0].name : 'a game folder');
  offerPickStop();
  const picked = setsFromFolderInput(files);
  trace(`split into ${picked.length} set(s), ${picked.filter((s) => s.zip).length} archive(s)`);

  if (picked.length === 0) {
    clearImporting();
    busyStop.hidden = true;
    hideBusy();
    status.textContent = str('main.no_game_files_in_that');
    return;
  }

  const sets = await listArchives(picked, {
    onEach: (i, n, set) => { if (!stopped()) showBusy(n > 1
      ? str('main.looking_inside_n_n_of', { 0: set.name, 1: i + 1, 2: n }) : str('main.looking_inside_n', { 0: set.name })); },
    stop: stopped,
    trace,
  });
  if (stopped()) return;
  busyStop.hidden = true;

  if (sets.length === 1) {
    const set = sets[0];
    if (set.punnet) {
      try {
        importPunnetFile(await punnetBytes(set), set.name);
      } catch (e) {
        clearImporting();
        hideBusy();
        showError(`${set.name} · ${(e as Error).message || str('main.the_file_could_not_be')}.`);
      }
      return;
    }
    try {
      trace(`reading ${set.name}`);
      const one = await readFolderSetOne(set);
      trace(`read ${set.name}: ${one.files.length} file(s)`);
      handleUpload(one, set.name);
    } catch (e) {
      const why = (e as Error).message || str('main.the_file_could_not_be');
      trace(`read failed ${set.name}: ${why}`);
      if (/multiple games/.test(why)) {
        await importFolderSets(sets);
      } else {
        clearImporting();
        showError(`${set.name} · ${why}.${set.zip ? CLOUD_HINT : ''}`);
      }
    }
    return;
  }
  await importFolderSets(sets);
}

for (const input of [picker, zipPicker]) {
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    markPickerOpen(false);
    if (files.length === 0) disarmPickerWait();
    else if (pickerWait) { if (pickerWait.timer > 0) clearTimeout(pickerWait.timer); pickerWait = null; }
    trace(`picker answered: ${files.length} file(s), ${files.reduce((n, f) => n + f.size, 0)} bytes`);
    if (pickerGen !== pickGen) { trace('pick was stopped: dropped'); return; }
    status.textContent = files.length === 1 ? str('main.1_file_picked') : str('main.n_files_picked', { 0: files.length });
    void importPicked(files);
  });
  input.addEventListener('cancel', () => {
    markPickerOpen(false);
    disarmPickerWait();
    trace('picker cancelled');
    status.textContent = str('main.nothing_picked');
  });
}

function captureCanvasThumb(maxW = THUMB_MAX_W): Uint8Array | null {
  if (!emu.latestFrame() || canvas.width <= 0 || canvas.height <= 0) return null;
  const parts = componentBox();
  let src: HTMLCanvasElement = canvas;
  if (parts && parts.w > 0 && parts.h > 0) {
    const crop = document.createElement('canvas');
    crop.width = Math.round(parts.w);
    crop.height = Math.round(parts.h);
    crop.getContext('2d')!.drawImage(
      canvas, Math.round(parts.x), Math.round(parts.y), crop.width, crop.height,
      0, 0, crop.width, crop.height,
    );
    src = crop;
  }
  const c = downscaleCanvas(src, maxW);
  const url = c.toDataURL('image/webp', THUMB_QUALITY);
  const b64 = url.split(',')[1];
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function updateThumb(reason: string, hash: string | null = session.hash): void {
  if (!hash || libraryErased) return;
  const thumb = captureCanvasThumb();
  if (!thumb) return;
  void putThumb(hash, thumb)
    .then(() => {
      const flagged = (m: GameMeta): boolean =>
        m.hasThumb && !!m.thumbFromPlay && m.thumbRule === THUMB_RULE;
      const flag = (m: GameMeta): GameMeta =>
        ({ ...m, hasThumb: true, thumbFromPlay: true, thumbRule: THUMB_RULE });
      if (session.meta && !flagged(session.meta)) {
        session.meta = flag(session.meta);
        return putMeta(session.meta);
      }
      if (session.meta) return undefined;
      return getMeta(hash).then((m) => (m && !flagged(m) ? putMeta(flag(m)) : undefined));
    })
    .catch((e) => console.warn('[library] thumb write failed', e));
  console.log(`[library] thumbnail refreshed (${reason})`);
}

function writeAutosave(cached: AutosaveBlob, hash: string, reason: string): void {
  if (libraryErased) return;
  const now = Date.now();
  const rec = stateRecord(cached, hash, now, session.game?.system);
  const data = rec.data;
  void stateStore.put(hash, rec)
    .catch((e) => {
      console.warn('[library] auto-save write failed', e);
      if (isQuotaError(e)) {
        status.textContent = str('main.library_full_state_not_saved');
      }
    });
  console.log(
    `[library] auto-saved on ${reason} (${Math.round(data.length / 1024)} kB, `
      + `${((now - cached.at) / 1000).toFixed(1)}s old)`,
  );
}

let pendingResetNotice = false;

const MONEY_WATCH_MS = 1000;
const moneyWatch = {
  hash: '', rec: null as MoneyTotals | null, last: null as CashLedger | null, timer: 0, busy: false,
};
function startMoneyWatch(hash: string): void {
  stopMoneyWatch();
  const w = moneyWatch;
  w.hash = hash;
  w.rec = null;
  w.last = null;
  getMoney(hash).then((kept) => {
    if (w.hash !== hash) return;
    w.rec = readMoneyTotals(kept, Date.now()) ?? emptyRecord(Date.now());
    w.timer = window.setInterval(() => { if (running) void moneyReading(hash); }, MONEY_WATCH_MS);
    void moneyReading(hash);
  }, (e: unknown) => console.warn('[library] money record read failed', e));
}
async function moneyReading(hash: string): Promise<void> {
  const w = moneyWatch;
  if (w.hash !== hash || w.busy || !w.rec) return;
  w.busy = true;
  try {
    const l = await emu.ledger();
    if (w.hash !== hash || !l || !w.rec) return;
    if (w.last) {
      const next = addReading(w.rec, w.last, l, Date.now());
      if (next.at !== w.rec.at || next.restarts !== w.rec.restarts) {
        w.rec = next;
        await putMoney(hash, next);
      }
    }
    w.last = l;
  } catch (e) {
    console.warn('[library] money record write failed', e);
  } finally {
    w.busy = false;
  }
}
function stopMoneyWatch(): void {
  const w = moneyWatch;
  if (!w.hash) return;
  const hash = w.hash;
  window.clearInterval(w.timer);
  w.timer = 0;
  void moneyReading(hash).finally(() => { if (w.hash === hash) { w.hash = ''; w.rec = null; w.last = null; } });
}

const autosave = new PlayAutosave<AutosaveBlob>({
  canSave: () => !!session.game && !!session.hash && running,
  leaving: (m) => {
    const reason = appReason(m);
    if (m === 'pagehide') {
      updateThumb(reason);
    } else {
      const hash = session.hash;
      const boot = session.boot;
      window.setTimeout(() => {
        if (session.boot === boot) updateThumb(reason, hash);
      }, SCREEN_FADE_MS + 80);
    }
  },
  keeps: () => session.autoSave,
  cached: () => emu.cachedAutosave(),
  takesPush: () => !!session.game && !!session.hash && session.autoSave,
  write: (blob, reason) => {
    if (session.hash) writeAutosave(blob, session.hash, appReason(reason));
  },
}, { debounceMs: 1000 });
function appReason(r: string): string {
  return r === 'leave' ? 'menu' : r;
}
emu.onAutosave = (blob, trigger) => autosave.pushed(blob, trigger);

emu.onCoins = () => {
  stampCabinetCoins();
  refreshKeys?.();
  rebuildMenu?.();
};

let infoBoot = 0;
let noSlotCheckedBoot = 0;

function stampCabinetCoins(): void {
  const game = session.game;
  if (!cabinet || !game) return;
  const view = viewFor(game.system);
  const info = infoBoot === session.boot ? emu.info : null;
  const n = stampCoinInputs(cabinet.lamps, view, info?.coins ?? view.coins);
  const lines = view.coinLineInputs;
  const onLine = lines ? cabinet.lamps.some((lp) => lp.button !== undefined && lines.includes(lp.button)) : false;
  if (!info || n || onLine || noSlotCheckedBoot === session.boot) return;
  noSlotCheckedBoot = session.boot;
  if (machineCoins(info, view).length && !damagedRoms(game).length) showNotice(str('main.this_cabinet_s_layout_draws'));
}

autosave.watchPage(window);

async function openFromLibrary(hash: string, resume: boolean, variant?: string): Promise<void> {
  cancelPendingDelete(hash);
  enterGameFullscreen();
  autosave.moment('switch');
  dismissError();
  status.textContent = str('main.opening');
  await showGame();
  showBusy(str('main.opening_from_library'));

  let game: Game | null = null;
  let resolveCab: (cab: Cabinet | null) => void = () => {};
  const cabPromise = new Promise<Cabinet | null>((r) => { resolveCab = r; });

  const statePromise = resume ? stateStore.get(hash).catch(() => null) : Promise.resolve(null);
  const returnsAtOpen = libraryReturns;
  let openedBoot = -1;

  const finished = openPak(hash, {
    onProgress: (stage) => {
      if (!stageBelongsOnVeil({
        left: libraryReturns !== returnsAtOpen,
        startedBoot: openedBoot,
        boot: session.boot,
        veilUp: busy.classList.contains('show'),
      })) {
        cacheNote.hidden = false;
        return;
      }
      const msg = stage === 'decoding' && game
        ? str('main.updating_n_artwork', { 0: game.name })
        : stageText(stage, game?.name);
      if (msg) showBusy(msg);
      else cacheNote.hidden = false;
    },
    onFiles: (files, storedMeta, build) => {
      void (async () => {
        try {
          const hasGam = files.some((f) => /\.gam$/i.test(f.name));
          game = classifyGame(files, hasGam ? undefined : storedMeta?.name, build);
          game.layoutProps = currentLayoutProps(storedMeta);
          if (!platformFor(game.system)) {
            hideBusy();
            showError(str('main.n_system_n_not_supported', { 0: game.name, 1: game.system }));
            return;
          }

          let snapshot: Snapshot | undefined;
          const settled = await settleSavedState(await statePromise, boardStamp(game.system), { dropState: (h) => stateStore.delete(h) });
          if (settled.kind === 'resume') {
            showBusy(str('main.restoring_saved_state'));
            await nextPaint();
            snapshot = decodeState(settled.rec);
          } else if (settled.kind === 'battery') {
            game.nvram = settled.nvram;
          } else if (settled.hadSave) {
            pendingResetNotice = true;
          }

          session.hash = hash;
          session.autoSave = storedMeta?.autoSave ?? true;
          session.meta = storedMeta ?? null;
          const chosenBuild = game.variant;
          startGame(game, cabPromise, snapshot, () => {
            void selectVariant(hash, chosenBuild);
          });
          openedBoot = session.boot;
        } catch (err) {
          hideBusy();
          showError(str('main.open_failed_n', { 0: (err as Error).message }));
        }
      })();
    },
    onCabinet: (cab) => resolveCab(cab),
  }, variant);

  void finished
    .then(
      (meta) => {
        if (session.hash === hash) {
          session.meta = meta;
          session.autoSave = meta.autoSave;
          adoptCoinAnswers(meta);
          if (!onFirstFrameDrawn) hideBusy();
        }
        requestStoragePersist();
      },
      (err: unknown) => {
        resolveCab(null);
        hideBusy();
        const e = err as ImportError;
        if (e.code === 'corrupt-srcs') {
          showError(str('main.cache_corrupt_please_delete_and'));
        } else if (!game) {
          showError(str('main.open_failed_n', { 0: e.message }));
        } else {
          console.warn('[library] refresh failed', err);
        }
      },
    )
    .finally(() => { cacheNote.hidden = true; clearImporting(); });
}

async function selectVariant(hash: string, variant: string): Promise<void> {
  await stateStore.delete(hash).catch((e) => console.warn('[library] state drop failed', e));
  await openFromLibrary(hash, false, variant);
}

const libraryHandlers: LibraryHandlers = {
  onOpen: (hash, resume) => void openFromLibrary(hash, resume),
  unplayable: unplayableReason,
  onUnplayable: (name, detail) => showError(`${name} · ${detail}`),
  onDelete: async (hash) => {
    await deleteGame(hash);
    await renderLibrary(libraryHandlers);
  },
  onEraseAll: async () => {
    libraryErased = true;
    showBusy(str('main.starting_over'));
    try {
      await eraseEverything();
    } catch (e) {
      libraryErased = false;
      showError(e instanceof EraseBlockedError
        ? str('main.could_not_delete_the_library')
        : str('main.could_not_delete_the_library_2', { 0: e instanceof Error ? e.message : String(e) }));
      return;
    }
    location.reload();
  },
  onToggleAutoSave: (hash, on) => {
    if (hash === session.hash) {
      session.autoSave = on;
      if (session.meta) session.meta = { ...session.meta, autoSave: on };
    }
    void getMeta(hash).then((m) => (m ? putMeta({ ...m, autoSave: on }) : undefined));
  },
  onRename: (hash, title) => {
    if (hash === session.hash && session.meta) {
      session.meta = { ...session.meta, title: title || undefined };
    }
    void getMeta(hash)
      .then((m) => (m ? putMeta({ ...m, title: title || undefined }) : undefined))
      .then(() => renderLibrary(libraryHandlers))
      .catch((e) => console.warn('[library] rename failed', e));
  },
  onExport: async (hash) => {
    if (libraryWriteInFlight()) {
      status.textContent = str('main.still_saving_to_the_library');
      return;
    }
    const meta = await getMeta(hash);
    if (!meta) return;
    const title = displayTitle(meta);
    showBusy(str('main.packing_n', { 0: title }));
    try {
      const out = await exportPunnet(hash);
      if (!out) {
        showError(str('main.n_not_in_the_library', { 0: title }));
        return;
      }
      saveFile(out.bytes, punnetFileName(title), 'application/octet-stream');
      status.textContent = str('main.n_exportedn', { 0: title, 1: out.hasState ? str('main.with_its_saved_state') : '' });
    } catch (e) {
      showError(str('main.n_export_failed_n', { 0: title, 1: (e as Error).message }));
    } finally {
      hideBusy();
    }
  },
  onExportMany: () => {
    if (libraryWriteInFlight()) {
      status.textContent = str('main.still_saving_to_the_library');
      return;
    }
    void Promise.all([listGames(), stateStore.keys()]).then(([games, saved]) => {
      openExportPicker({
        games, saved, unplayable: unplayableReason,
        onSave: (chosen) => {
          const target = openPackTarget(punnetFileName(`${chosen.length} games`));
          void exportMany(chosen, target);
        },
      });
    }).catch((e) => showError(str('main.could_not_read_the_library', { 0: (e as Error).message })));
  },
  isSaving: libraryWriteInFlight,
};

async function exportMany(
  chosen: GameMeta[], pending: ReturnType<typeof openPackTarget>,
): Promise<void> {
  let target: Awaited<typeof pending>;
  try {
    target = await pending;
  } catch (e) {
    showError(str('main.could_not_open_the_file', { 0: (e as Error).message }));
    return;
  }
  if (!target) return;
  stopBatch = false;
  busyStop.hidden = false;
  busyStop.disabled = false;
  busyBar.hidden = false;
  busyFill.style.width = '0%';
  showBusy(str('main.packing_n_games', { 0: chosen.length }));
  let result: Awaited<ReturnType<typeof packGames>>;
  try {
    result = await packGames(chosen, target, {
      stop: () => stopBatch,
      onGame: (i, n, title) => {
        setBusyMsg(str('main.packing_n_n_of_n', { 0: title, 1: i + 1, 2: n }));
        busyFill.style.width = `${Math.round((i / n) * 100)}%`;
      },
    });
    if (!result.stopped && result.written.length) {
      busyFill.style.width = '100%';
      setBusyMsg(str('main.saving_the_file'));
      const blob = await target.close();
      if (blob) saveBlob(blob, punnetFileName(`${result.written.length} games`));
    }
  } catch (e) {
    await target.abort().catch(() => undefined);
    showError(str('main.export_failed_n', { 0: (e as Error).message }));
    return;
  } finally {
    busyStop.hidden = true;
    busyBar.hidden = true;
    hideBusy();
  }
  trace(`exported ${result.written.length} games (${result.bytes} bytes, ${target.streamed ? 'streamed' : 'blob'}), ${result.failed.length} failed${result.stopped ? ', stopped' : ''}`);
  const n = result.written.length;
  const { message, lines, clean } = packReport(result);
  if (n && !result.stopped) status.textContent = str('main.n_games_exported', { 0: n });
  if (clean) {
    showNotice(message);
    return;
  }
  openAlert({ message, lines, buttons: [{ button: pillButton(str('main.ok'), () => undefined), run: () => undefined }] });
}

onLibraryWrite(() => {
  if (librarySection.hidden || batchRunning) return;
  void renderLibrary(libraryHandlers)
    .catch((e) => console.warn('[library] refresh after write failed', e));
});

const GAME_HISTORY_STATE = { fruitulator: 'game' };

function inGameHistoryEntry(): boolean {
  return (history.state as { fruitulator?: string } | null)?.fruitulator === 'game';
}

const fade = document.getElementById('fade') as HTMLElement;

let libScrollY = 0;

const onPlayScreen = (): boolean => document.body.classList.contains('nb-play');

async function showGame(): Promise<void> {
  if (onPlayScreen()) return;
  await fadeToBlack(fade);
  libScrollY = window.scrollY;
  librarySection.hidden = true;
  stage.removeAttribute('data-ready');
  stage.hidden = false;
  document.body.classList.remove('nb-page', 'nb-stars');
  document.body.classList.add('nb-play');
  wakePlayMenu();
  burgerBtn.hidden = false;
  soundGroup.hidden = false;
  for (const l of uploadLabels) l.hidden = true;
  if (!inGameHistoryEntry()) history.pushState(GAME_HISTORY_STATE, '');
  resetView();
  fadeFromBlack(fade);
}

function machineShown(): void {
  stage.setAttribute('data-ready', '');
}

const PLAY_IDLE_MS = 3000;
let playIdleTimer = 0;
function wakePlayMenu(): void {
  document.body.removeAttribute('data-idle');
  window.clearTimeout(playIdleTimer);
  if (onPlayScreen()) {
    playIdleTimer = window.setTimeout(() => document.body.setAttribute('data-idle', ''), PLAY_IDLE_MS);
  }
}
window.addEventListener('pointermove', wakePlayMenu, { passive: true });

async function showLibrary(): Promise<void> {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {  });
  }
  autosave.moment('leave');
  stopMoneyWatch();
  emu.pause();
  running = false;
  if (onFirstFrameDrawn) {
    onFirstFrameDrawn = null;
    ++session.boot;
  }
  libraryReturns++;
  hideBusy();
  effects.silence();
  audio.silence();
  hwBridge?.gameUnloaded();
  closeMenu();
  if (bulbLab.active) bulbLab.disable();
  setVfdStrip(null);
  const toOrbit = document.body.classList.contains('orbit-mode');
  await fadeToBlack(fade);
  stage.hidden = true;
  stage.removeAttribute('data-ready');
  document.body.classList.remove('nb-play');
  document.body.classList.add('nb-page', 'nb-stars');
  wakePlayMenu();
  burgerBtn.hidden = true;
  soundGroup.hidden = true;
  magnifier.setActive(false);
  for (const l of uploadLabels) l.hidden = false;
  if (errorPopup.hidden) {
    status.textContent = session.game ? str('main.paused_pick_a_game') : str('main.no_game_loaded');
  }
  librarySection.hidden = false;
  await renderLibrary(libraryHandlers);
  window.scrollTo(0, libScrollY);
  if (toOrbit) replayOrbitCaption();
  else await settleArtwork();
  fadeFromBlack(fade);
}

function exitToLibrary(): void {
  closeMenu();
  schemPanel.reset();
  stopNote.clear();
  stopParts = [];
  if (inGameHistoryEntry()) history.back();
  else void showLibrary();
}

function abandonGame(): void {
  stopMoneyWatch();
  session.game = null;
  session.hash = null;
  session.meta = null;
  running = false;
  if (stage.hidden) return;
  exitToLibrary();
}

let touchStolenAt = -Infinity;

window.addEventListener('popstate', () => {
  if (stage.hidden) return;
  if (touches.size > 0 || performance.now() - touchStolenAt < 3000) {
    history.pushState(GAME_HISTORY_STATE, '');
    status.textContent = str('main.to_leave_the_game_open');
    window.setTimeout(() => {
      if (!stage.hidden && session.game) status.textContent = session.game.name;
    }, 4000);
    return;
  }
  void showLibrary();
});

window.addEventListener('resize', () => {
  if (!stage.hidden) resetView();
});

new ResizeObserver(() => {
  if (!stage.hidden) resetView();
}).observe(screenEl);

let refreshMenuLive: (() => void) | null = null;
let menuLiveTimer = 0;
let refreshKeys: (() => void) | null = null;
let rebuildMenu: (() => void) | null = null;

const menuFly = document.getElementById('menuFly') as HTMLElement;
const drawer = new MenuDrawer({ menu, backdrop: menuBackdrop, content: menuContent, sub: menuSub, fly: menuFly });
drawer.onOpen = () => {
  refreshMenuLive?.();
  if (!menuLiveTimer) menuLiveTimer = window.setInterval(() => refreshMenuLive?.(), 1000);
};
drawer.onClose = () => {
  window.clearInterval(menuLiveTimer);
  menuLiveTimer = 0;
};

function openMenu(): void {
  drawer.open();
}

function closeMenu(): void {
  drawer.close();
}

function closeSubmenu(): void {
  drawer.closeSubmenu();
}

function closeFlyout(): void {
  drawer.closeFlyout();
}

burgerBtn.addEventListener('click', openMenu);

const schemPanel = new SchematicPanel(
  schemPanelEl,
  schemBackdrop,
  () => emu.ioActivity(),
  () => ({
    fps: uiFps,
    tickHz: emu.benchStats()?.tickHz ?? 0,
    stepMs: emu.benchStats()?.stepMs ?? 0,
    clockHz: emu.info?.clockHz ?? 0,
    droppedMs: emu.benchStats()?.droppedMs ?? 0,
    buildId: __BUILD_ID__,
  }),
);

function openSchematic(tab?: string): void {
  if (!emu.info) return;
  closeMenu();
  schemPanel.open(emu.info.schematic ?? null, session.game?.name ?? '', tab);
}

function toggleSchematic(): void {
  if (schemPanel.isOpen) schemPanel.close();
  else openSchematic();
}
function closeAbout(): void {
  aboutOpen()?.close();
}

mountSettings(document.getElementById('settingsBtn') as HTMLButtonElement);

function toggleMagnifier(): void {
  magnifier.setActive(!magnifier.active);
}

try {
  matchMedia(HOVER_POINTER_QUERY).addEventListener('change', (ev) => {
    if (!ev.matches) magnifier.setActive(false);
  });
} catch {
}
schemBtn.addEventListener('click', toggleSchematic);
schemPanel.onToggle = (open) => schemBtn.setAttribute('aria-pressed', String(open));

let optionSwitchRows: MachineInfo['switchPanel'] = [];
const schemMenu = new DownloadMenu(() => [
  stateDownload(appActions),
  { label: str('main.game_as_a_punnet'), run: downloadPunnet },
]);
schemPanel.menu = schemMenu;

function testTone(): void {
  audio.testTone().then(
    () => {
      syncSoundButton();
      console.log('[fruitulator] test tone sent,', audio.describe());
    },
    (err) => console.error('[fruitulator] test tone failed', err),
  );
}

schemPanel.tabs = [
  optionsTab({
    rows: () => optionSwitchRows.map((sw) => ({ ...sw })),
    set: (row, on) => {
      const said = throwPanelSwitch(row, on);
      const held = optionSwitchRows.find((sw) => sw.id === row.id);
      if (held) held.on = on;
      return said;
    },
  }),
  logTab({
    entries: () => emu.diagLog(),
    recording: () => ({ on: diagLogOn, locked: urlValue('diag') !== undefined }),
    setRecording: (on) => {
      if (!setSwitch('diag', on)) return;
      diagLogOn = on;
      emu.setDiagLog(on);
    },
    clear: () => emu.clearDiagLog(),
    download: () => void downloadDiagLog(),
    testTone,
    clearRam: clearRamNow,
  }),
  bulbTab({
    active: () => bulbLab.active,
    setActive: (on) => {
      if (!on) { if (bulbLab.active) bulbLab.disable(); return true; }
      if (!cabinet) return false;
      if (!bulbLab.active) bulbLab.enable(cabinet);
      return true;
    },
    setHost: (host) => bulbLab.setHost(host),
    windows: () => bulbLab.windowCount,
  }),
  matrixTab({
    size: () => viewFor(session.game?.system ?? '').matrix,
    press: (id, on) => emu.input(id, on),
  }),
];

const mobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function enterGameFullscreen(): void {
  if (!mobileDevice || !document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    .catch((e: Error) => console.warn('[fruitulator] auto full screen refused', e.message));
}

function throwPanelSwitch(
  sw: { id: number; label: string; bootOnly?: boolean }, on: boolean,
): string {
  emu.input(sw.id, on);
  switchLevels.set(sw.id, on);
  if (session.game) savePanelSwitch(session.game, sw.id, on);
  const said = `${sw.label} ${on ? 'on' : 'off'}`;
  if (!sw.bootOnly) return said;
  emu.reset();
  stopWatch.reset(performance.now());
  stopNote.clear();
  return `${said} - machine rebooted`;
}

function throwSwitchFromPage(sw: { id: number; label: string; bootOnly?: boolean }, on: boolean): void {
  const said = throwPanelSwitch(sw, on);
  if (sw.bootOnly) status.textContent = said;
}

async function clearRamNow(): Promise<string | null> {
  if (!(await askClearRam())) return null;
  const game = session.game;
  if (!game || !running) return str('main.no_game_is_running');
  const why = await emu.clearRam({
    optionKeys: readSavedOptionKeys(game),
    panelSwitches: readSavedPanelSwitches(game),
    namedCoins: session.coinAnswers,
  });
  if (why) return str('main.not_cleared_n', { 0: why });
  if (session.hash && !session.autoSave) {
    await stateStore.delete(session.hash).catch((e) => console.warn('[library] state drop failed', e));
  }
  stopWatch.reset(performance.now());
  stopNote.clear();
  resetReelDrift();
  status.textContent = str('main.ram_cleared_machine_restarted');
  return str('main.ram_cleared_the_machine_restarted');
}

function buildMenu(info: MachineInfo): void {
  rebuildMenu = () => buildMenu(info);
  const view = viewFor(session.game?.system ?? '');
  menuContent.replaceChildren();
  menuSub.replaceChildren();
  closeSubmenu();
  closeFlyout();

  {
    const sound = card();
    const row = sliderRow(soundBtn, volSlider);
    const bright = sliderRow(brightBtn, brightSlider, 'menu-bright');
    sound.append(row, bright);
    menuContent.append(sound);
  }

  {
    const book = card();
    book.hidden = true;
    coinMoney.hidden = true;
    const stat = (label: string): HTMLSpanElement => statRow(book, label);
    const inV = stat(str('main.money_in'));
    const outV = stat(str('main.money_out'));
    const tokOutV = stat(str('main.tokens_out'));
    const tokOutRowEl = tokOutV.parentElement!;
    const tokInV = stat(str('main.tokens_in'));
    const tokInRowEl = tokInV.parentElement!;
    const pctV = stat(str('main.payout'));
    const money = (p: number): string =>
      `${p < 0 ? '-' : ''}£${(Math.abs(p) / 100).toFixed(2)}`;
    refreshMenuLive = () => {
      void emu.ledger().then((l) => {
        if (!l) return;
        book.hidden = false;
        coinMoney.hidden = false;
        const rec = moneyWatch.rec;
        const t = rec ? rec.total : l;
        const mIn = moneyInParts(t), mOut = moneyOutParts(t);
        for (const v of [inV, coinInV]) setKvValue(v, mIn.head, mIn.sub);
        for (const v of [outV, coinOutV]) setKvValue(v, mOut.head, mOut.sub);
        const tokParts: string[] = [];
        if (t.tokenOutPence) tokParts.push(money(t.tokenOutPence));
        if (t.unpricedTokenOut) {
          tokParts.push(str('main.n_tokens', { n: t.unpricedTokenOut }));
        }
        tokOutV.textContent = tokParts.join(' + ');
        tokOutRowEl.hidden = tokParts.length === 0;
        const tokInParts: string[] = [];
        if (t.tokenInPence) tokInParts.push(money(t.tokenInPence));
        const tokInCount = t.unpricedTokenIn ?? 0;
        if (tokInCount) tokInParts.push(str('main.n_tokens', { n: tokInCount }));
        tokInV.textContent = tokInParts.join(' + ');
        tokInRowEl.hidden = tokInParts.length === 0;
        const pct = ledgerPayoutPercent(t);
        pctV.textContent = pct === null ? '\u2014' : `${pct.toFixed(1)}%`;
      });
    };
    refreshMenuLive();
    menuContent.append(book);
  }

  {
    const { labels, coinNames } = logInputLabels(view, info, cabinet?.lamps ?? []);
    emu.setInputLabels(labels, coinNames);
    if (diagLogOn) emu.setDiagLog(true);
  }

  optionSwitchRows = info.switchPanel.filter((sw) => sw.option === true);
  appendItems(menuContent, menuItems(appActions, { info, view, system: session.game?.system }, APP_MENU), navRow);

  appendMenuFoot(menuContent);

  choreograph(menuContent, 90);
}

const APP_MENU: readonly ActionId[] = ['coins', 'switches', 'options', 'keyboard', 'system', 'reboot', 'quit'];

function appOptionRows(info: MachineInfo): Node[] {
  const rows: Node[] = [];
  info.optionKeys.forEach((k, index) => {
    const row = document.createElement('label');
    row.className = 'menu-row menu-key';
    const text = document.createElement('span');
    text.className = 'row-label';
    text.textContent = k.label;
    const sel = document.createElement('select');
    sel.id = `option-key-${index}`;
    sel.setAttribute('aria-label', k.label);
    k.positions.forEach((name, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = name;
      sel.append(o);
    });
    sel.value = String(k.position);
    sel.addEventListener('change', () => {
      void emu.fitKey(index, Number(sel.value)).then((positions) => {
        if (session.game) saveOptionKeys(session.game, info, positions);
      });
      status.textContent = str('main.n_refitted_machine_restarted', { 0: k.label });
    });
    row.append(text, sel);
    enhanceSelect(sel, { small: true });
    rows.push(row);
  });

  const game = session.game;
  if (game && game.variants.length > 1) {
    const row = document.createElement('label');
    row.className = 'menu-row menu-key';
    const text = document.createElement('span');
    text.className = 'row-label';
    text.textContent = str('main.build');
    const sel = document.createElement('select');
    sel.id = 'build-select';
    sel.setAttribute('aria-label', str('main.build'));
    for (const v of game.variants) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.label;
      sel.append(o);
    }
    sel.value = game.variant;
    sel.addEventListener('change', () => {
      const chosen = sel.value;
      if (chosen === game.variant) return;
      void (async () => {
        const hash = session.hash;
        if (!hash) {
          sel.value = game.variant;
          dd.refresh();
          status.textContent = str('main.still_saving_to_the_library');
          return;
        }
        const hasState = (await stateStore.keys()).has(hash);
        if (hasState
          && !confirm(str('main.switching_build_discards_the_saved', { 0: game.name }))) {
          sel.value = game.variant;
          dd.refresh();
          return;
        }
        closeMenu();
        await selectVariant(hash, chosen);
      })();
    });
    row.append(text, sel);
    const dd = enhanceSelect(sel, { small: true });
    rows.push(row);
  }

  vfdStripBox = null;
  vfdReverseBox = null;
  if (cabinet && (!cabinet.vfd || vfdStripLcd)) {
    const { row: vdRow, box: vdBox } = checkRow(str('main.virtual_display'), setVfdStripOn);
    vdBox.checked = vfdStripShown();
    vfdStripBox = vdBox;
    rows.push(vdRow);
    const { row: rvRow, box: rvBox } = checkRow(str('main.reverse_virtual_display'), (on) => setVfdReverse(on));
    rvBox.checked = painter.vfdReversed;
    rvRow.title = str('main.tick_if_the_virtual_display');
    vfdReverseBox = rvBox;
    rows.push(rvRow);
  }

  return rows;
}

const appActions: ActionSurface = {
  get emu() { return emu; },
  game: () => session.game,
  sound: () => audio.describe(),
  running: () => running,
  closeMenu,
  coin: (c) => {
    nameThen(c.bit, () => {
      const booted = session.boot;
      effects.coinDrop(undefined, () => {
        if (booted !== session.boot) return null;
        emu.coin(c.bit);
        stopWatch.engage();
        return 'accepted';
      });
    });
  },
  coinMoney: () => coinMoney,
  coinNaming: {
    slots: () => namingSlots(cabinet?.lamps ?? [], viewFor(session.game?.system ?? ''), emu.info, session.coinAnswers),
    change: (line, at, done) => {
      openCoinNaming({
        at,
        current: session.coinAnswers[String(line)] ?? null,
        onName: (coin) => { setCoinAnswer(line, coin); done(); },
      });
    },
  },
  throwSwitch: (sw, checked) => throwSwitchFromPage(sw, checked),
  namedSwitch: (id, level) => emu.input(id, level),
  get effects() { return effects; },
  refit: () => { if (!stage.hidden) resetView(); },
  fontRows: (options) => {
    const cab = cabinet;
    if (!cab) return [];
    const faces = [...new Set(shownCaptionFaces(cab).filter((f) => !faceAvailable(f)))];
    if (!faces.length) return [];
    const row: HTMLButtonElement = menuRow(str('main.font'), '', () => {
      closeMenu();
      pickFonts(cab, faces, showFont);
    }, true);
    const meta = document.createElement('span');
    meta.className = 'nb-meta row-meta';
    const showFont = (): void => {
      meta.textContent = [...new Set(faces.map((f) => legendStandIn(f)).filter(Boolean))].join(', ');
    };
    showFont();
    row.querySelector('.row-chev')?.before(meta);
    return [row];
  },
  redraw: () => forceRedraw(),
  optionRows: (m) => appOptionRows(m.info),
  fillKeys: (root) => {
    refreshKeys = () => fillKeys(root);
    refreshKeys();
  },
  openSystem: () => openSchematic(),
  reboot: () => {
    emu.reset();
    stopWatch.reset(performance.now());
    stopNote.clear();
    status.textContent = str('main.machine_rebooted');
  },
  leave: exitToLibrary,
  stateSaved: (snap) => { status.textContent = str('main.n_snapshot_saved', { 0: snap.game }); },
};

function fillKeys(root: HTMLElement): void {
  const alt = (key: string): string[] => chordCaps(['alt'], key);
  const own: KeyTableRow[] = [
    showKeysRow(),
    { label: str('main.close_menu'), chords: [chordCaps([], 'Esc')] },
    { label: str('main.save_snapshot'), chords: [chordCaps(['mod'], 'S'), alt('S')] },
    { label: str('main.load_snapshot'), chords: [chordCaps(['mod'], 'O'), alt('L')] },
    { label: str('main.system_status'), chords: [alt('Y')] },
  ];
  if (hasHoverPointer()) own.push({ label: str('main.magnifier'), chords: [['Wheel'], alt('M')] });
  own.push(
    { label: str('main.quit_game'), chords: [alt('Q')] },
    { label: str('main.dump_reels_to_console'), chords: [alt('D')] },
    { label: str('main.bulb_lab'), chords: [alt('B')] },
  );
  fillKeyTable(root, [{ title: str('main.fruitulator'), rows: own }]);
}

function navRow(label: string, icon: string, panel: HTMLElement): HTMLButtonElement {
  return drawer.navRow(label, icon, panel);
}

const audio = new Audio();

const effects = new CabinetEffects(audio);
effects.onReport = (text) => emu.diagAudio(text);

restoreCabinetSounds(effects);

function bridgeAudio(): void {
  const port = audio.bridge();
  if (port) emu.attachAudioPort(port);
}

const volSlider = document.getElementById('volSlider') as HTMLInputElement;
const SOUND_KEY = 'fruitulator.sound';
const VOLUME_KEY = 'fruitulator.volume';

const coinMoney = card();
coinMoney.hidden = true;
const coinInV = statRow(coinMoney, str('main.money_in'));
const coinOutV = statRow(coinMoney, str('main.money_out'));

const soundBtn = speakerButton();
soundBtn.id = 'soundBtn';

function syncSoundButton(): void {
  showSpeaker(soundBtn, audio.running, Number(volSlider.value) === 0);
}

let soundSavedOn = false;

function saveSound(on: boolean): void {
  soundSavedOn = on;
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch {  }
}

let soundStarting = false;
function startSound(): Promise<void> {
  soundStarting = true;
  return audio.resume().then(
    () => {
      bridgeAudio();
      syncSoundButton();
      console.log('[fruitulator]', audio.describe());
    },
    (err) => {
      syncSoundButton();
      const msg = str('main.audio_failed_to_start_n', { 0: (err as Error).message });
      status.textContent = msg;
      console.error('[fruitulator]', msg, err);
      emu.diagAudio(`sound failed to start: ${(err as Error).message}`);
    },
  ).finally(() => { soundStarting = false; });
}

soundBtn.addEventListener('click', () => {
  if (audio.running) {
    audio.suspend();
    syncSoundButton();
    saveSound(false);
    return;
  }
  startSound().then(() => {
    if (!audio.running) return;
    saveSound(true);
    testTone();
  });
});

volSlider.addEventListener('input', () => {
  audio.setVolume(+volSlider.value / 100);
  syncSoundButton();
  try { localStorage.setItem(VOLUME_KEY, volSlider.value); } catch {  }
});
volSlider.addEventListener('change', () => {
  if (audio.running) testTone();
});

try {
  const v = Number(localStorage.getItem(VOLUME_KEY) ?? NaN);
  if (Number.isFinite(v) && v >= 0 && v <= 100) {
    volSlider.value = String(v);
    audio.setVolume(v / 100);
  }
  soundSavedOn = localStorage.getItem(SOUND_KEY) === 'on';
} catch {  }

let soundRestoreArmed = false;
function armSoundRestore(): void {
  if (soundRestoreArmed) return;
  soundRestoreArmed = true;
  const events = ['pointerdown', 'pointerup', 'keydown'] as const;
  const onGesture = (e: Event): void => {
    if (audio.running) { disarm(); return; }
    if (soundStarting || soundBtn.contains(e.target as Node)) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    startSound().then(() => { if (audio.running) disarm(); });
  };
  const disarm = (): void => {
    soundRestoreArmed = false;
    for (const t of events) window.removeEventListener(t, onGesture, true);
  };
  for (const t of events) window.addEventListener(t, onGesture, true);
}
if (soundSavedOn) armSoundRestore();

audio.onStateChange = (state) => {
  syncSoundButton();
  const wanted = audio.isWanted;
  emu.diagAudio(`sound output ${state}${state !== 'running' && wanted ? ' (sound is switched on)' : ''}`);
  if (state !== 'running' && wanted) armSoundRestore();
};

const soundNote = document.getElementById('soundnote') as HTMLElement | null;
const SOUND_NOTE_DELAY_MS = 1500;
let soundBlockedSince = 0;
let soundNoteDismissed = false;
function updateSoundNote(now: number): void {
  if (!soundNote) return;
  if (audio.running) soundNoteDismissed = false;
  const blocked = running && !stage.hidden && document.visibilityState === 'visible'
    && (audio.isWanted || soundSavedOn) && !audio.running;
  if (!blocked) soundBlockedSince = 0;
  else if (!soundBlockedSince) soundBlockedSince = now;
  const show = blocked && !soundNoteDismissed && now - soundBlockedSince >= SOUND_NOTE_DELAY_MS;
  if (show === !soundNote.hidden) return;
  soundNote.hidden = !show;
  if (show) emu.diagAudio(`sound note shown: output ${audio.state}`);
}
document.getElementById('soundnote-go')?.addEventListener('click', () => {
  if (soundStarting || audio.running) return;
  startSound().then(() => { if (audio.running) saveSound(true); });
});
document.getElementById('soundnote-close')?.addEventListener('click', () => {
  soundNoteDismissed = true;
  if (soundNote) soundNote.hidden = true;
});

syncSoundButton();

function applyBrightness(pct = brightness.pct): void {
  const filter = pct === BRIGHT_NEUTRAL ? '' : `brightness(${pct / 100})`;
  stage.style.filter = filter;
  const strip = document.getElementById('vfd-strip');
  if (strip) strip.style.filter = filter;
}

const brightness = brightnessControl({
  key: 'fruitulator.brightness',
  slider: document.getElementById('brightSlider') as HTMLInputElement,
  apply: (pct) => applyBrightness(pct),
});
const brightSlider = brightness.slider;
const brightBtn = brightness.button;

let fatal = '';

emu.onHalted = (message) => {
  fatal = str('main.machine_halted_n', { 0: message });
  console.error('[fruitulator]', fatal);
  status.textContent = fatal;
  running = false;
  stopNote.clear();
};

const BENCH = bootValue('bench');

const BENCH_STEP = !bootValue('benchStep');

const NO_AUDIO = !bootValue('audio');

const NO_REGIONS = !bootValue('regions');
const USE_WASM: boolean | undefined = wasmOption();

const BENCH_REPORT_S = 5;

let uiFps = 0;
let uiFrameCount = 0;
let uiFpsAt = 0;

function countFrame(now: number): void {
  uiFrameCount++;
  const dt = now - uiFpsAt;
  if (dt >= 1000) {
    uiFps = (uiFrameCount * 1000) / dt;
    uiFrameCount = 0;
    uiFpsAt = now;
  }
}

const bench = {
  drawMs: 0,
  frames: [] as { draw: number }[],
  lastReport: 0,
};

function benchSample(t0: number): void {
  const total = performance.now() - t0;
  void total;
  bench.frames.push({ draw: bench.drawMs });
  if (!bench.lastReport) bench.lastReport = performance.now();
  if (performance.now() - bench.lastReport < BENCH_REPORT_S * 1000) return;

  const fs = bench.frames;
  const draws = fs.map((f) => f.draw).sort((a, b) => a - b);
  const p95Draw = draws[Math.min(draws.length - 1, Math.floor(draws.length * 0.95))] ?? 0;
  const meanDraw = fs.reduce((a, f) => a + f.draw, 0) / (fs.length || 1);
  const secs = (performance.now() - bench.lastReport) / 1000;
  const loop = emu.benchStats();
  const report = {
    fps: +(fs.length / secs).toFixed(1),
    stepMs: +(loop?.stepMs ?? 0).toFixed(2),
    drawMs: +meanDraw.toFixed(2),
    pumpMs: 0,
    totalMs: +((loop?.stepMs ?? 0) + meanDraw).toFixed(2),
    p95: {
      step: +(loop?.p95StepMs ?? 0).toFixed(2),
      draw: +p95Draw.toFixed(2),
      pump: 0,
      total: +((loop?.p95StepMs ?? 0) + p95Draw).toFixed(2),
    },
    stepsPerFrame: loop?.steps ?? 0,
    budgetPct: +((((loop?.stepMs ?? 0) + meanDraw) / 16.67) * 100).toFixed(1),
    droppedMs: Math.round(loop?.droppedMs ?? 0),
    tickHz: +(loop?.tickHz ?? 0).toFixed(1),
    maxGapMs: +(loop?.maxGapMs ?? 0).toFixed(1),
    autosaveMs: +(loop?.autosaveMs ?? 0).toFixed(1),
    calibMs: +(loop?.calibMs ?? 0).toFixed(1),
    stepPerCalib: loop?.calibMs ? +((loop.stepMs) / loop.calibMs).toFixed(2) : 0,
    regions: { compiled: loop?.regionsCompiled ?? 0, refused: loop?.regionsRefused ?? 0 },
  };
  console.log('[bench]', JSON.stringify(report));
  benchLast = report;
  benchOverlay(report);
  bench.frames = [];
  bench.lastReport = performance.now();
}

declare const __BUILD_ID__: string;

let benchEl: HTMLDivElement | null = null;

function benchOverlay(r: {
  fps: number; stepMs: number; drawMs: number;
  p95: { step: number; draw: number };
  droppedMs: number; tickHz: number; maxGapMs: number; autosaveMs: number;
  calibMs: number; stepPerCalib: number;
}): void {
  if (!benchEl) {
    benchEl = document.createElement('div');
    benchEl.style.cssText =
      'position:fixed;top:0;left:0;z-index:9999;pointer-events:none;' +
      'background:rgba(0,0,0,0.7);color:#0f0;padding:4px 8px;' +
      'font:12px/1.5 monospace;white-space:pre;';
    document.body.appendChild(benchEl);
  }
  benchEl.textContent =
    str('main.fps_n_tick_n_hz', { 0: r.fps, 1: r.tickHz, 2: __BUILD_ID__, 3: r.stepMs, 4: r.p95.step, 5: r.drawMs, 6: r.p95.draw, 7: r.droppedMs, 8: r.maxGapMs, 9: r.autosaveMs, 10: r.calibMs, 11: r.stepPerCalib });
}

let benchLast: unknown = null;

let onFirstFrameDrawn: (() => void) | null = null;

const bulbLab = new BulbLab(() => painter.invalidate());

const screenStalls = new StallWatch('screen');
let stoodDown = false;
let longTasks: Array<[number, number]> = [];
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: false });
} catch {  }
let lastFrameAt = 0;

function longTaskNote(from: number, to: number): string {
  longTasks = longTasks.filter(([start]) => start > to - 10_000);
  const inGap = longTasks.filter(([start]) => start >= from && start < to).map(([, d]) => d);
  if (!inGap.length) return '(no long task of the page\'s own in the gap)';
  const n = inGap.length;
  const longest = Math.round(Math.max(...inGap));
  return `(the page ran ${n} long task${n === 1 ? '' : 's'} in the gap, the longest ${longest} ms)`;
}

function frame(now: number): void {
  countFrame(now);
  const t0 = BENCH ? performance.now() : 0;
  const tFrame = performance.now();
  let tDraw = 0;
  if (running && !stoodDown) {
    const stall = screenStalls.beat(tFrame);
    if (stall) {
      const from = lastFrameAt;
      window.setTimeout(() => {
        const line = `${stall} ${longTaskNote(from, tFrame)}`;
        emu.diagSpeed(line);
        console.log('[speed]', line);
      }, 250);
    }
  } else {
    screenStalls.forget();
  }
  lastFrameAt = tFrame;
  if (running) {
    const real = emu.latestFrame();
    const view = real && bulbLab.active ? bulbLab.view(real, now) : real;
    const tView = BENCH ? performance.now() : t0;
    try {
      if (view) {
        const tv = performance.now();
        draw(view);
        tDraw = performance.now() - tv;
        session.framesDrawn++;
        if (schemPanel.isOpen) schemPanel.sampleFrame(view);
        {
          const stopped = judgeStop(stopWatch, view, now, { paused: stoodDown, quietIsWaiting });
          const reason = noteReason(stopped, stopParts);
          const put = stopNote.update(
            reason, reason ? noteText(reason, stopParts) : '', offersState(reason, stopParts));
          if (put) {
            console.log(`[fruitulator] ${put}${
              stopParts.length ? ` ${unbuiltLogText(stopParts)}` : ''}`);
          }
        }
        if (onFirstFrameDrawn) {
          const cb = onFirstFrameDrawn;
          onFirstFrameDrawn = null;
          cb();
        }
      }
    } catch (err) {
      fatal = str('main.render_error_n', { 0: (err as Error).message });
      console.error('[fruitulator] render error', err);
      running = false;
      onFirstFrameDrawn = null;
      showError(str('main.the_machine_could_not_be', { 0: (err as Error).message }));
    }
    if (BENCH) bench.drawMs = performance.now() - tView;
    audio.nudge();
  }
  updateSoundNote(now);
  if (fatal) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    ctx.fillStyle = '#ff5252';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fatal, canvas.width / 2, canvas.height / 2);
    screenDirty = true;
  }
  presentScreen();
  magnifier.present();
  if (BENCH) benchSample(t0);
  screenStalls.charge('drawing the machine', tDraw);
  screenStalls.charge('the rest of the frame', performance.now() - tFrame - tDraw);
  if (import.meta.env.DEV) frameScriptTotal += performance.now() - tFrame;
  requestAnimationFrame(frame);
}

let frameScriptTotal = 0;

if (import.meta.env.DEV) {
  void import('./trace').then(({ PLAIN_PAGE_NOTE, Recorder, TRACE_KEY }) => {
    const totals = { n: 0, patches: 0, wholes: 0, layoutMs: 0, copyMs: 0, patchPx: 0, bitmapMs: 0, parts: 0 };
    let seenT = 0;
    const recorder = new Recorder({
      emu,
      running: () => running,
      gpuMs: () => null,
      glass: () => {
        for (const d of painter.drawLog) {
          if (d.t <= seenT) continue;
          totals.n++;
          if (d.rects === 'full') { totals.wholes++; totals.patchPx += canvas.width * canvas.height; }
          else { totals.patches++; for (const r of d.rects) totals.patchPx += (r.right - r.left) * (r.bottom - r.top); }
        }
        const last = painter.drawLog[painter.drawLog.length - 1];
        if (last) seenT = last.t;
        return totals;
      },
      scriptMs: () => frameScriptTotal,
      describe: () => `${canvas.width}x${canvas.height}@${+devicePixelRatio.toFixed(2)}, ${PLAIN_PAGE_NOTE}`,
    }, 'app-trace');
    recorder.start();
    window.addEventListener('keydown', (ev) => {
      if (ev.key !== TRACE_KEY) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const name = recorder.dump((t) => console.log(t));
      if (name) status.textContent = str('main.trace_saved_n', { 0: name });
    }, true);
  });
}

if (import.meta.env.DEV) {
  (window as unknown as { versionGroups: () => Promise<string> }).versionGroups =
    () => import('./versionreport').then((m) => m.run());
}

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return;
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    console.warn('[fruitulator] evicted a leftover service worker and its cache '
      + '(it was shadowing the dev server); reloading once');
    try {
      if (!sessionStorage.getItem('fruitulator.sw-evicted')) {
        sessionStorage.setItem('fruitulator.sw-evicted', '1');
        location.reload();
      }
    } catch {
    }
  });
}
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const reportAssets = (): void => {
    const sw = navigator.serviceWorker.controller;
    if (!sw) return;
    const urls = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.startsWith(location.origin));
    if (urls.length) sw.postMessage({ type: 'cache-assets', urls });
  };
  const offlineNotes = ['offlineNote', 'lib-offline']
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el);
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; done?: number; total?: number; failed?: number } | null;
    if (d?.type !== 'precache-progress' || typeof d.done !== 'number' || typeof d.total !== 'number') return;
    const over = d.done + (d.failed ?? 0) >= d.total;
    for (const el of offlineNotes) {
      el.textContent = str('main.saving_for_offline_n_n', { 0: d.done, 1: d.total });
      el.hidden = over;
    }
  });
  navigator.serviceWorker.startMessages();
  const register = (): void => {
    void navigator.serviceWorker.register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => reportAssets())
      .catch((e: Error) => console.warn('[fruitulator] service worker not registered', e.message));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reportAssets();
  });
}

let frameLoopRunning = false;
function startFrameLoop(): void {
  if (frameLoopRunning) return;
  frameLoopRunning = true;
  requestAnimationFrame(frame);
}
startFrameLoop();

function shownCaptionFaces(cab: Cabinet): string[] {
  const c = cab.content;
  return cab.lamps.flatMap((l) => {
    const g = l.legend;
    if (!g?.face || !((g.off ?? '').trim() || (g.on ?? '').trim())) return [];
    const inView = l.left < c.left + c.width && c.left < l.left + l.width
      && l.top < c.top + c.height && c.top < l.top + l.height;
    return inView ? [g.face.trim()] : [];
  });
}

function offerFontChoices(cab: Cabinet): void {
  pickFonts(cab, facesToAsk(shownCaptionFaces(cab)));
}

function pickFonts(cab: Cabinet, faces: string[], picked?: () => void): void {
  const ask = [...faces];
  const next = (): void => {
    const face = ask.shift();
    if (!face || cabinet !== cab) return;
    openFontPicker({ face, onPick: () => { picked?.(); if (cabinet === cab) forceRedraw(); }, onClose: next });
  };
  next();
}

function forceRedraw(): void {
  painter.invalidate();
  const v = emu.latestFrame();
  if (v) draw(v);
}

function draw(m: FrameView): void {
  effects.frame(m);
  const cab = cabinet;
  if (!cab) {
    painter.forget();
    if (!awaitingCabinet) {
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      painter.drawFallback(m);
      screenDirty = true;
    }
    return;
  }
  painter.advance(m, cab);
  numberReelDiagnostic(m, cab);
  mainReelDriftWatch(m, cab);
  if (painter.paint(m, cab)) screenDirty = true;
  if (reelBandsOn()) {
    reelBands.machine(m);
    reelBands.paint();
  }
}

function numberReelDiagnostic(m: FrameView, cab: Cabinet): void {
  if (!import.meta.env.DEV) return;
  const fr = cab.featureReel;
  if (!fr || m.layout.system !== 'SCORPION4') return;
  const ri = reelIndex(m, fr);
  const rN = m.reels[ri];
  if (!rN || painter.stillFrames[ri] !== 8) return;
  const posPerStop = rN.stepsPerRevolution / fr.stops;
  const k = ((Math.round((5 - rN.position) / posPerStop) % fr.stops) + fr.stops) % fr.stops;
  const fw = ri < m.diagRam.length ? String(m.diagRam[ri]) : '?';
  console.log(
    `[nreel] pos=${rN.position} k=${k}`
    + ` offDetent=${(((rN.position - 5) % posPerStop) + posPerStop) % posPerStop} stop=${k} fw=${fw}`
    + ` travel=${rN.travel}`,
  );
}

const reelDrift: {
  events: { when: string; reel: number; pos: number; sub: number; row: number; fw: number }[];
  store: { system: string; base: number | null; state: string; settles: number };
  before: unknown; after: unknown;
} = { events: [], store: { system: '', base: null, state: 'unreadable', settles: 0 }, before: null, after: null };
let reelDriftDirty = false;
let reelDriftPending: { pos: number[] } | null = null;

let reelDriftStore: StoreConfirm | null = null;

function resetReelDrift(): void {
  reelDriftStore = null;
  reelDriftDirty = false;
  reelDriftPending = null;
  reelDrift.events.length = 0;
  reelDrift.before = null;
  reelDrift.after = null;
  reelDrift.store = { system: '', base: null, state: 'unreadable', settles: 0 };
}

function mainReelDriftWatch(m: FrameView, cab: Cabinet): void {
  const mains = cab.reels.filter((r) => r.stops === 16 && reelIndex(m, r) <= 2);
  if (mains.length !== 3) return;
  if (!reelDriftStore) {
    reelDriftStore = new StoreConfirm(m.diagRam.length >= 3);
    reelDrift.store = {
      system: m.layout.system,
      base: m.diagRam.length >= 3 ? m.layout.diagRamBase : null,
      state: reelDriftStore.state,
      settles: 0,
    };
  }
  if (reelDrift.store.state === 'unreadable') return;
  const ticks = mains.map((r) => painter.stillFrames[reelIndex(m, r)]);
  const minTick = Math.min(...ticks);
  if (minTick < 8) { reelDriftPending = null; return; }
  const reels = mains.map((r) => m.reels[reelIndex(m, r)]);
  if (reels.some((r) => !r)) return;
  if (reels.some((r) => Math.abs(r!.travel) < 96)) return;
  const posNow = reels.map((r) => ((r!.position % 96) + 96) % 96);
  const faults = posNow.map((pos, k) => {
    const w = mains[k];
    const ri = reelIndex(m, w);
    return reelDriftFault(m.layout.system, {
      reel: ri, pos, stops: w.stops || 16, bandOffset: w.bandOffset ?? 0, reversed: w.reversed,
    }, m.diagRam[ri]);
  });
  if (minTick === 8) {
    const clean = faults.every((f) => !f);
    const trusted = reelDriftStore.settle(clean, mains.map((w) => m.diagRam[reelIndex(m, w)]).join(','));
    reelDrift.store.state = reelDriftStore.state;
    reelDrift.store.settles = reelDriftStore.settles;
    if (clean) {
      reelDriftPending = null;
      if (!reelDriftDirty) void emu.snapshot().then((sn) => { if (sn) reelDrift.before = sn; });
      return;
    }
    if (!trusted) { reelDriftPending = null; return; }
    reelDriftPending = { pos: posNow };
    return;
  }
  if (minTick !== 48 || !reelDriftPending) return;
  if (reelDriftPending.pos.some((p, k) => p !== posNow[k])) { reelDriftPending = null; return; }
  reelDriftPending = null;
  if (reelDriftStore.state !== 'confirmed') return;
  for (const f of faults) {
    if (!f) continue;
    reelDriftDirty = true;
    reelDrift.events.push({ when: new Date().toISOString(), ...f });
    if (reelDrift.events.length > 32) reelDrift.events.shift();
    if (!reelDrift.after) void emu.snapshot().then((sn) => { if (sn) reelDrift.after = sn; });
    if (import.meta.env.DEV) {
      console.warn(
        `[reeldrift] ${reelDrift.store.system} store $${(reelDrift.store.base ?? 0).toString(16)}`
        + ` reel ${f.reel} settled pos=${f.pos} (sub ${f.sub}) drawn row=${f.row} fw=${f.fw}`
        + ' — model/firmware drift; press s to save a snapshot, or read window.__emu.reelDrift',
      );
    }
  }
}

const held = new HeldButtons({
  down: (input) => {
    emu.input(input, true);
    effects.button(true);
    stopWatch.engage();
  },
  up: (input) => {
    emu.input(input, false);
    effects.button(false);
  },
});

function pressInput(pointerId: number, input: number): void {
  if (input < 0 || !running) return;
  held.hold(pointerId, input);
}
function releaseInput(pointerId: number): void {
  held.release(pointerId);
}

function checkboxHit(clientX: number, clientY: number): CabCheckbox | null {
  if (!cabinet?.checkboxes || !running) return null;
  const { x, y } = layoutPoint(screenFit(cabinet), clientX, clientY);
  return checkboxAt(cabinet.checkboxes, x, y);
}

function cabinetHit(clientX: number, clientY: number): CabLamp | null {
  if (!cabinet) return null;
  const { x, y, scale } = layoutPoint(screenFit(cabinet), clientX, clientY);
  return pickControl(cabinet.lamps, x, y, scale, clickable);
}

function screenFit(cab: Cabinet): CanvasFit {
  return {
    rect: screenEl.getBoundingClientRect(),
    canvas: { width: canvas.width, height: canvas.height },
    content: cab.content,
    stretch: fillScreenOn(),
  };
}

function reelWindowHit(clientX: number, clientY: number): { reel: { angle?: number }; pitch: number } | null {
  if (!cabinet || !reelPeekOn()) return null;
  const { x, y, sy } = layoutPoint(screenFit(cabinet), clientX, clientY);
  const hit = reelAt(cabinet.reels, x, y);
  return hit && { reel: hit.reel, pitch: hit.pitch * sy };
}

const gatedOff = new Set<CabLamp>();
const gateSeenLit = new Set<number>();

function clickable(lp: CabLamp): boolean {
  return answers(lp, gatedOff);
}

function updateGate(m: FrameView, lp: CabLamp): void {
  if (followGate(m, lp, gatedOff, gateSeenLit)) emu.gateSeen([...gateSeenLit]);
}

const MAX_ZOOM = 4;
let zoom = 1;
let panX = 0;
let panY = 0;

const touches = new Map<number, { x: number; y: number }>();
let pinch: { a: number; b: number; dist: number; zoom: number; x: number; y: number; panX: number; panY: number } | null = null;
let drag: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;

function clampPan(): void {
  const s = stage.getBoundingClientRect();
  const maxX = Math.max(0, (screenEl.offsetWidth * zoom - s.width) / 2);
  const maxY = Math.max(0, (screenEl.offsetHeight * zoom - s.height) / 2);
  panX = Math.min(maxX, Math.max(-maxX, panX));
  panY = Math.min(maxY, Math.max(-maxY, panY));
}

function applyView(): void {
  clampPan();
  screenEl.style.transform = zoom === 1 && panX === 0 && panY === 0
    ? ''
    : `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom.toFixed(4)})`;
}

let screenCss = {
  w: 0, h: 0, lw: 0, lh: 0, sw: 0, sh: 0, fill: false,
  bands: 0, bandsVersion: 0, cab: null as Cabinet | null,
};

function fitScreen(): void {
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const lw = canvas.width;
  const lh = canvas.height;
  if (sw <= 0 || sh <= 0 || lw <= 0 || lh <= 0) return;
  const fill = fillScreenOn();
  const cab = reelBandsOn() ? cabinet : null;
  reelBands.sync(cab);
  const bands = cab ? reelBands.count : 0;
  const bandsVersion = reelBands.version;
  const c = screenCss;
  if (c.sw === sw && c.sh === sh && c.lw === lw && c.lh === lh && c.fill === fill
    && c.bands === bands && c.bandsVersion === bandsVersion && c.cab === cab) return;
  if (bands > 0) {
    const l = bandsLayout({ width: sw, height: sh }, { width: lw, height: lh }, bands, TOUCH_DEVICE, fill, (colH) => reelBands.wholeCap(colH));
    screenCss = { w: l.screen.width, h: l.screen.height, lw, lh, sw, sh, fill, bands, bandsVersion, cab };
    screenEl.style.inset = 'auto';
    screenEl.style.margin = '0';
    screenEl.style.left = `${l.screen.left}px`;
    screenEl.style.top = `${l.screen.top}px`;
    reelBands.place(l);
  } else {
    const k = Math.min(1, sw / lw, sh / lh);
    screenCss = fill
      ? { w: sw, h: sh, lw, lh, sw, sh, fill, bands, bandsVersion, cab }
      : { w: lw * k, h: lh * k, lw, lh, sw, sh, fill, bands, bandsVersion, cab };
    screenEl.style.inset = '';
    screenEl.style.margin = '';
    screenEl.style.left = '';
    screenEl.style.top = '';
    reelBands.place(null);
  }
  screenEl.style.width = `${screenCss.w}px`;
  screenEl.style.height = `${screenCss.h}px`;
  screenEl.style.objectFit = fill ? 'fill' : '';
  if (vfdStrip && !vfdStrip.hidden && vfdStripSpot) placeVfdStrip();
}

function presentScreen(): void {
  if (stage.hidden) return;
  fitScreen();
  if (screenCss.w <= 0) return;
  const lw = canvas.width;
  const lh = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const zq = 2 ** (Math.ceil(Math.log2(Math.max(1, zoom)) * 8) / 8);
  const need = screenCss.w * dpr * zq;
  const tw = Math.min(lw, Math.ceil(need));
  const th = tw === lw ? lh : Math.max(1, Math.ceil((lh * tw) / lw));
  const plan = uniformPlan(lw, lh, tw, smoothFit);
  const { w: bw, h: bh } = planSize(plan, lw, lh, tw, th);
  if (screenEl.width !== bw || screenEl.height !== bh) {
    screenEl.width = bw;
    screenEl.height = bh;
    screenDirty = true;
  }
  if (!screenDirty) return;
  screenDirty = false;
  screenPresenter.run(screenCtx, canvas, 0, 0, lw, lh, plan, bw, bh);
}

const screenPresenter = new Presenter();

function componentBox(): { x: number; y: number; w: number; h: number } | null {
  const cab = cabinet;
  if (!cab || canvas.width <= 0 || canvas.height <= 0) return null;
  const b = componentBounds(cab);
  if (!b) return null;
  return { x: b.left - cab.content.left, y: b.top - cab.content.top, w: b.width, h: b.height };
}

function resetView(): void {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyView();
  fitScreen();
}

const TOUCH_DEVICE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

let layoutBox: Rect | null = null;

function recropView(): void {
  const cab = cabinet;
  if (!cab || !layoutBox) return;
  cab.content = playView(cab, layoutBox);
  if (cab.content.width > 0 && cab.content.height > 0) {
    canvas.width = cab.content.width;
    canvas.height = cab.content.height;
  }
  forceRedraw();
  if (!stage.hidden) resetView();
}
if (!TOUCH_DEVICE) appActions.recrop = recropView;

function playView(cab: Cabinet, box: Rect): Rect {
  if (TOUCH_DEVICE || cropViewOn()) return { ...(cab.column ?? box) };
  const base = cab.trimmed ?? box;
  let l = base.left;
  let t = base.top;
  let r = base.left + base.width;
  let b = base.top + base.height;
  for (const lp of cab.lamps) {
    if (lp.button === undefined && !lp.acceptor) continue;
    if (lp.hidden || !(lp.width > 0 && lp.height > 0)) continue;
    l = Math.min(l, Math.max(box.left, lp.left));
    t = Math.min(t, Math.max(box.top, lp.top));
    r = Math.max(r, Math.min(box.left + box.width, lp.left + lp.width));
    b = Math.max(b, Math.min(box.top + box.height, lp.top + lp.height));
  }
  return r > l && b > t ? { left: l, top: t, width: r - l, height: b - t } : { ...box };
}

function freePointers(): number[] {
  return [...touches.keys()].filter((id) => !held.has(id));
}

function pointerPair(): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (!pinch) return null;
  const a = touches.get(pinch.a);
  const b = touches.get(pinch.b);
  return a && b ? [a, b] : null;
}

function beginPinch(idA: number, idB: number): void {
  const a = touches.get(idA);
  const b = touches.get(idB);
  if (!a || !b) return;
  drag = null;
  pinch = {
    a: idA,
    b: idB,
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    zoom,
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    panX,
    panY,
  };
}

function updatePinch(): void {
  const pair = pointerPair();
  if (!pinch || !pair) return;
  const [a, b] = pair;
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  zoom = Math.min(MAX_ZOOM, Math.max(1, pinch.zoom * (dist / pinch.dist)));
  panX = pinch.panX + ((a.x + b.x) / 2 - pinch.x);
  panY = pinch.panY + ((a.y + b.y) / 2 - pinch.y);
  applyView();
}

const pointerHost: HTMLElement = stage;

pointerHost.addEventListener('contextmenu', (ev) => ev.preventDefault());
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (ev) => {
    if (!stage.hidden) ev.preventDefault();
  }, { passive: false });
}
document.addEventListener('touchmove', (ev) => {
  if (!stage.hidden && ev.touches.length > 1) ev.preventDefault();
}, { passive: false });
const capPointer = new PlayPointer<CabLamp>({
  at: (ev) => cabinetHit(ev.clientX, ev.clientY),
  press: (lp, id) => activate(lp, id),
  release: (id) => releaseInput(id),
  capture: (id) => pointerHost.setPointerCapture(id),
  momentary: (lp) => !!lp.acceptor,
});
pointerHost.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const box = checkboxHit(ev.clientX, ev.clientY);
  if (box) {
    ev.preventDefault();
    const row = emu.info?.switchPanel.find((sw) => sw.id === box.id);
    throwSwitchFromPage(row ?? { id: box.id, label: box.legend.off ?? '' }, !switchLevels.ticked(box, emu.info?.switchPanel));
    return;
  }
  touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (!capPointer.down(ev)) {
    if (pinch) return;
    const free = freePointers();
    if (free.length === 2) {
      ev.preventDefault();
      if (peekPointer !== null) { reelPeek.release(); peekPointer = null; }
      beginPinch(free[0], free[1]);
      return;
    }
    const peekAt = reelWindowHit(ev.clientX, ev.clientY);
    if (peekAt && peekPointer === null) {
      peekPointer = ev.pointerId;
      reelPeek.begin(ev.clientX, ev.clientY, peekAt.pitch, peekAt.reel.angle ?? 0);
      pointerHost.setPointerCapture(ev.pointerId);
      return;
    }
    drag = { x: ev.clientX, y: ev.clientY, panX, panY, moved: false };
    pointerHost.setPointerCapture(ev.pointerId);
  }
});
pointerHost.addEventListener('pointermove', (ev) => {
  const t = touches.get(ev.pointerId);
  if (!t) return;
  t.x = ev.clientX;
  t.y = ev.clientY;
  if (pinch && (ev.pointerId === pinch.a || ev.pointerId === pinch.b)) {
    ev.preventDefault();
    updatePinch();
    return;
  }
  if (ev.pointerId === peekPointer) {
    if (reelPeek.drag(ev.clientX, ev.clientY)) ev.preventDefault();
    return;
  }
  if (drag && !held.has(ev.pointerId)) {
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    ev.preventDefault();
    panX = drag.panX + dx;
    panY = drag.panY + dy;
    applyView();
  }
}, { passive: false });

function endPeek(ev: PointerEvent): void {
  if (ev.pointerId !== peekPointer) return;
  peekPointer = null;
  reelPeek.release();
}

function endTouch(ev: PointerEvent): void {
  endPeek(ev);
  capPointer.up(ev);
  touches.delete(ev.pointerId);
  if (pinch && (ev.pointerId === pinch.a || ev.pointerId === pinch.b)) pinch = null;
  if (touches.size === 0) drag = null;
}

pointerHost.addEventListener('pointerup', endTouch);
pointerHost.addEventListener('pointercancel', (ev) => {
  touchStolenAt = performance.now();
  endTouch(ev);
});
pointerHost.addEventListener('lostpointercapture', (ev) => { endPeek(ev); capPointer.up(ev); });
let wheelTravel = 0;
pointerHost.addEventListener('wheel', (ev) => {
  if (!magnifier.active && !hasHoverPointer()) return;
  const r = wheelStep(
    magnifier.active, magnifierZoom(), wheelTravel, wheelPixels(ev.deltaY, ev.deltaMode),
  );
  wheelTravel = r.travel;
  if (!r.handled) return;
  ev.preventDefault();
  setMagnifierZoom(r.zoom);
  if (r.on !== magnifier.active) {
    if (r.on) magnifier.moveTo(ev.clientX, ev.clientY);
    magnifier.setActive(r.on);
  }
}, { passive: false });

function releaseAllInputs(): void {
  held.releaseAll();
}
function standDown(
  save = true,
): void {
  stoodDown = true;
  releaseAllInputs();
  if (save) autosave.moment('hidden');
  if (running) emu.pause();
  audio.machinePaused();
}

function machineRunning(): void {
  running = true;
  if (!stoodDown) return;
  emu.pause();
  audio.machinePaused();
}

function standTo(): void {
  stoodDown = false;
  if (running) emu.resume();
  audio.machineResumed();
  stopWatch.resumed(performance.now());
  audio.nudge();
}

window.addEventListener('blur', () => {
  releaseAllInputs();
  window.setTimeout(() => { if (!document.hasFocus()) standDown(); }, 0);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) standDown();
  else standTo();
});
window.addEventListener('focus', standTo);

const RESIZE_SETTLE_MS = 250;
let resizeTimer = 0;
let resizeStoodDown = false;
window.addEventListener('resize', () => {
  if (stage.hidden) return;
  if (!stoodDown) {
    standDown(false);
    resizeStoodDown = true;
  }
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (!resizeStoodDown) return;
    resizeStoodDown = false;
    if (!document.hidden && document.hasFocus()) standTo();
  }, RESIZE_SETTLE_MS);
});

function downloadSnapshot(): Promise<boolean> {
  return saveState(appActions);
}

async function downloadPunnet(): Promise<boolean> {
  const hash = session.hash;
  if (!running || !hash) return false;
  if (libraryWriteInFlight()) {
    status.textContent = str('main.still_saving_to_the_library');
    return false;
  }
  const meta = await getMeta(hash);
  if (!meta) return false;
  const title = displayTitle(meta);
  try {
    const snap = await emu.snapshot();
    let live: Parameters<typeof exportPunnet>[1];
    if (snap) {
      const { diag: _diag, ...state } = snap;
      live = {
        schema: SCHEMA_VERSION,
        savedAt: Date.now(),
        cycles: snap.cycles,
        data: deflateSync(strToU8(JSON.stringify(state))),
      };
    }
    const out = await exportPunnet(hash, live);
    if (!out) return false;
    saveFile(out.bytes, punnetFileName(title), 'application/octet-stream');
    status.textContent = str('main.n_exportedn', { 0: title, 1: out.hasState ? str('main.with_its_state') : '' });
    return true;
  } catch (e) {
    showError(str('main.n_export_failed_n', { 0: title, 1: (e as Error).message }));
    return false;
  }
}

function loadSnapshotFile(file: File): void {
  dismissError();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const snap = JSON.parse(String(reader.result)) as Snapshot;
      const game = session.game;
      if (!game || !running) {
        showError(str('main.load_the_game_folder_first'));
        return;
      }
      const booted = ++session.boot;
      for (const n of gatesOf(snap)) gateSeenLit.add(n);
      stampGates(snap, [...gateSeenLit]);
      void emu.load({ game, snapshot: snap, optionKeys: readSavedOptionKeys(game), panelSwitches: readSavedPanelSwitches(game), namedCoins: session.coinAnswers, bench: BENCH, noRegions: NO_REGIONS, wasm: USE_WASM })
        .then((info) => {
          if (booted !== session.boot) return;
          audio.attach(info.audioRate, info.audioLevel);
          bridgeAudio();
          machineRunning();
          status.textContent = str('main.n_snapshot_restored', { 0: snap.game });
        })
        .catch((e: Error) => showError(str('main.snapshot_load_failed_n', { 0: e.message })));
    } catch (e) {
      showError(str('main.snapshot_load_failed_n', { 0: (e as Error).message }));
    }
  };
  reader.readAsText(file);
}

function dropCoinAt(bit: number, acceptor?: CabLamp['acceptor'], gate?: CabLamp): void {
  if (!emu.latestFrame()) return;
  const booted = session.boot;
  effects.coinDrop(acceptor, () => {
    const f = emu.latestFrame();
    if (!f || booted !== session.boot) return null;
    if (gate && gatedOff.has(gate)) return 'locked';
    if (f.coinBusy) {
      return 'refused';
    }
    emu.coin(bit);
    if ((f.coinRefusing >>> bit) & 1) return 'refused';
    stopWatch.engage();
    return 'accepted';
  });
}

let lastPress: { x: number; y: number; t: number } | null = null;
addEventListener('pointerdown', (ev) => { lastPress = { x: ev.clientX, y: ev.clientY, t: performance.now() }; }, true);

function pressPoint(): { x: number; y: number } | null {
  return lastPress && performance.now() - lastPress.t < 1000 ? { x: lastPress.x, y: lastPress.y } : null;
}

function nameThen(line: number, go: () => void): void {
  if (session.coinUnsure.has(line) || !mustName(line, emu.info, session.coinAnswers)) { go(); return; }
  const booted = session.boot;
  const still = (): boolean => booted === session.boot && running;
  openCoinNaming({
    at: pressPoint(),
    onName: (coin) => {
      if (!still()) return;
      setCoinAnswer(line, coin);
      go();
    },
    onUnsure: () => {
      if (!still()) return;
      session.coinUnsure.add(line);
      go();
    },
  });
}

function setCoinAnswer(line: number, coin: NamedCoin): void {
  session.coinAnswers = withCoinAnswer(session.coinAnswers, line, coin);
  session.coinUnsure.delete(line);
  emu.nameCoin(line, coin);
  if (session.hash) saveCoinAnswers(session.hash);
}

function saveCoinAnswers(hash: string): void {
  const answers = session.coinAnswers;
  if (session.meta?.hash === hash) session.meta = { ...session.meta, coinAnswers: answers };
  void getMeta(hash)
    .then((m) => (m ? putMeta({ ...m, coinAnswers: answers }) : undefined))
    .catch((e) => console.warn('[library] coin name not saved', e));
}

function adoptCoinAnswers(meta: GameMeta): void {
  const stored = readCoinAnswers(meta.coinAnswers);
  for (const [line, coin] of Object.entries(stored)) {
    if (!(line in session.coinAnswers)) emu.nameCoin(Number(line), coin);
  }
  const unsaved = Object.keys(session.coinAnswers).some((k) => stored[k] !== session.coinAnswers[k]);
  session.coinAnswers = { ...stored, ...session.coinAnswers };
  if (unsaved) saveCoinAnswers(meta.hash);
}

function coinsMenuHint(view: PlatformView): string {
  return machineCoins(emu.info, view).length ? str('main.menu_coins_puts_money_in') : '';
}

function activate(lp: CabLamp, pointerId: number): void {
  if (lp.acceptor) {
    if (gatedOff.has(lp)) {
      effects.coin(lp.acceptor, 'locked');
      return;
    }
    const view = viewFor(session.game?.system ?? '');
    const got = acceptorResolve(view, lp, emu.info?.coins, emu.info?.coinPort);
    if (got.kind === 'note') {
      if (got.line < 0) {
        showNotice(str('main.this_cabinet_draws_a_note', { 0: coinsMenuHint(view) }));
        return;
      }
      emu.note(got.line, got.parallel === true);
      effects.coin(lp.acceptor);
      stopWatch.engage();
      return;
    }
    const bit = got.line;
    if (bit < 0) {
      showNotice(str('main.this_slot_is_drawn_on', { 0: coinsMenuHint(view) }));
      return;
    }
    nameThen(bit, () => dropCoinAt(bit, lp.acceptor, lp));
    return;
  }
  if (lp.coinInput !== undefined && lp.coinInput >= 0 && emu.info?.namesCoins && emu.info.unnamedCoins?.includes(lp.coinInput)) {
    const line = lp.coinInput;
    nameThen(line, () => dropCoinAt(line, undefined, lp));
    return;
  }
  const dropLine = plainCoinDrop(viewFor(session.game?.system ?? ''), lp);
  if (dropLine >= 0) {
    dropCoinAt(dropLine, undefined, lp);
    return;
  }
  if (lp.button !== undefined) pressInput(pointerId, lp.button);
}

const playKeys = new PlayKeys({
  lamps: () => cabinet?.lamps ?? null,
  running: () => running,
  onScreen: () => !stage.hidden,
  hasKeyboard: () => !stage.hidden && !aboutOpen() && importReport.hidden && errorPopup.hidden,
  pressable: (lp) => clickable(lp),
  press: (lp, id) => activate(lp, id),
  release: (id) => releaseInput(id),
  hints: () => (cabinet ? {
    machine: {
      lamps: cabinet.lamps, content: cabinet.content, view: viewFor(session.game?.system ?? ''),
      vfd: cabinet.vfd,
      opts: {
        coins: emu.info?.coins, nameCoins: emu.info?.coins,
        coinPort: emu.info?.coinPort, capNames: emu.info?.capNames,
      },
    },
    place: canvasPlace(screenFit(cabinet)),
  } : null),
}, new KeyHintLayer(stage));
window.addEventListener('keyup', (ev) => playKeys.keyUp(ev));
playKeys.watchWindow();

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (aboutOpen()) {
      closeAbout();
      return;
    }
    if (!importReport.hidden) {
      closeImportReport();
      return;
    }
    if (schemMenu.isOpen) {
      schemMenu.close(true);
      return;
    }
    if (schemPanel.isOpen) {
      schemPanel.close();
      return;
    }
    closeSheet();
    closeMenu();
    return;
  }
  if (playKeys.keyDown(ev)) return;
  if (primaryModifier(ev) && !ev.altKey && !ev.shiftKey) {
    const k = ev.key.toLowerCase();
    if (k === 's' && running) {
      ev.preventDefault();
      void downloadSnapshot();
      return;
    }
    if (k === 'o') {
      ev.preventDefault();
      snapPicker.click();
      return;
    }
  }
  if (ev.ctrlKey || ev.metaKey) return;
  const tool = ev.code.startsWith('Key') ? ev.code.slice(3).toLowerCase() : ev.key.toLowerCase();
  if (tool === 's') void downloadSnapshot();
  if (tool === 'l') snapPicker.click();
  if (tool === 'y') toggleSchematic();
  if (tool === 'm' && !stage.hidden) toggleMagnifier();
  if (tool === 'q' && ev.altKey && !stage.hidden) exitToLibrary();
  if (ev.altKey && tool === 'd') dumpReels();
  if (ev.altKey && tool === 'b' && !stage.hidden && cabinet) {
    if (bulbLab.active && schemPanel.isOpen && schemPanel.tab === 'bulbs') bulbLab.disable();
    else {
      if (!bulbLab.active) bulbLab.enable(cabinet);
      openSchematic('bulbs');
    }
  }
});

const bandSampler = document.createElement('canvas');

function bandSymbol(band: CanvasImageSource & { width: number; height: number }, stops: number, row: number): string {
  bandSampler.width = band.width;
  bandSampler.height = band.height;
  const cx = bandSampler.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(band as CanvasImageSource, 0, 0);
  const symH = band.height / stops;
  const cy = Math.floor((((row % stops) + stops) % stops) * symH + symH / 2);
  const d = cx.getImageData(Math.floor(band.width * 0.35), cy, Math.floor(band.width * 0.3), 1).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  r = (r / n) | 0; g = (g / n) | 0; b = (b / n) | 0;
  if (r > 150 && g < 95 && b < 95) return '7';
  if (r > 150 && g > 120 && b < 95) return 'BARx3';
  if (r > 140 && g < 120 && b > 105) return 'BAR1';
  if (g > 140 && b > 150 && r < 130) return 'cherry';
  if (r > 190 && g > 190 && b > 190) return 'blank';
  return `?(${r},${g},${b})`;
}

function dumpReels(): void {
  const m = emu.latestFrame();
  const cab = cabinet;
  if (!m || !cab) { console.log('[reeldump] no game loaded'); return; }
  console.log('%c[reeldump] ' + new Date().toISOString(), 'font-weight:bold');
  console.log('  VFD: ' + JSON.stringify(painter.displayText(m)));
  void emu.diagRam([0x2e8, 0x2e9, 0x2ea, 0x2eb, 0x1d1, 0x1d2, 0x1d3, 0x1d4, 0x2fd,
    0x37e, 0x37f, 0x380, 0x381, 0x382, 0x390, 0x391, 0x392, 0x393, 0x394]).then((v) => {
    if (v.some((x) => x < 0)) return;
    console.log('  RAM $2e8-$2eb (SC2 address set A: band positions): ' + v.slice(0, 4).join(','));
    console.log('  RAM $1d1-$1d3 (set A: main win-line symbols): '
      + v.slice(4, 7).map((x) => x & 7).join(',') + `  mask $1d4=%${(v[7] & 7).toString(2)}`);
    console.log('  RAM $2fd (set A: die face): ' + v[8]);
    console.log('  RAM $37e-$382 (SC2 address set B: reel positions): ' + v.slice(9, 14).join(','));
    console.log('  RAM $390-$394 (set B: win-line symbols, $393 = clock): '
      + v.slice(14, 19).join(','));
  });
  const mains = cab.reels.filter((r) => r.stops === 16).sort((a, b) => a.left - b.left);
  mains.forEach((reel, col) => {
    const r = m.reels[reelIndex(m, reel)];
    if (!r) return;
    const pos = ((r.position % 96) + 96) % 96;
    const sym = Math.floor(pos / 6) % reel.stops;
    const base = reel.reversed ? reel.stops - sym : sym;
    const sweep = [-3, -2, -1, 0, 1, 2, 3]
      .map((c) => `${c >= 0 ? '+' : ''}${c}:${bandSymbol(reel.canvas, reel.stops, base + c)}`)
      .join('  ');
    console.log(`  reel${col} (mIdx ${reelIndex(m, reel)}) pos=${pos} sym=${sym} bandOff=${reel.bandOffset} rev=${reel.reversed}`);
    console.log(`     sweep ${sweep}`);
  });
  for (const reel of cab.reels.filter((r) => r.stops !== 16)) {
    const r = m.reels[reelIndex(m, reel)];
    if (!r) continue;
    const stops = reel.stops || 16;
    const pos = ((r.position % 96) + 96) % 96;
    const strip = m.layout.reelStripOffsets?.[reelIndex(m, reel)] ?? 0;
    const row = reelWinLineRow(
      reelEffectivePosition(pos, reel.reversed !== platformRequiresReversal(m.layout.system),
        platformReelOffsetSteps(m.layout.system, reel.reversed) + strip * (96 / stops)),
      stops,
    );
    console.log(`  spinner (mIdx ${reelIndex(m, reel)}) stops=${stops} pos=${pos} row=${row}`
      + ` bandOff=${reel.bandOffset} strip=${strip} rev=${reel.reversed}`);
  }
}

const snapPicker = document.createElement('input');
snapPicker.type = 'file';
snapPicker.accept = '.json';
snapPicker.style.display = 'none';
snapPicker.addEventListener('change', () => {
  const f = snapPicker.files?.[0];
  if (f) loadSnapshotFile(f);
});
document.body.appendChild(snapPicker);
pointerHost.addEventListener('pointermove', (ev) => {
  if (ev.pointerType !== 'mouse') return;
  magnifier.moveTo(ev.clientX, ev.clientY);
  if (ev.pointerId === peekPointer) {
    pointerHost.style.cursor = 'grabbing';
  } else if (!held.has(ev.pointerId)) {
    pointerHost.style.cursor = cabinetHit(ev.clientX, ev.clientY) ? 'pointer'
      : reelWindowHit(ev.clientX, ev.clientY) ? 'grab' : 'default';
  }
});
pointerHost.addEventListener('pointerleave', () => magnifier.hide());

let vfdStrip: HTMLElement | null = null;
let vfdStripCanvas: HTMLCanvasElement | null = null;
let vfdStripKey = '';
let vfdStripLatest: {
  text: string; cells: (readonly number[])[]; duty: number;
  lcd: { width: number; height: number; bits: Uint8Array } | null;
} | null = null;
let vfdStripFlip: HTMLButtonElement | null = null;
let vfdStripSeen = false;
let vfdStripBox: HTMLInputElement | null = null;

const VFD_STRIP_POS = 'fruitulator.vfdStripPos';
let vfdStripPos: { x: number; y: number } | null = (() => {
  try {
    const p = JSON.parse(localStorage.getItem(VFD_STRIP_POS) ?? 'null') as unknown;
    if (p && typeof p === 'object' && Number.isFinite((p as { x: unknown }).x)
      && Number.isFinite((p as { y: unknown }).y)) {
      return p as { x: number; y: number };
    }
  } catch {
  }
  return null;
})();

const VFD_STRIP_STORE = 'fruitulator.vfdStrip';
let vfdStripOn = (() => {
  try {
    return localStorage.getItem(VFD_STRIP_STORE) !== 'off';
  } catch {
    return true;
  }
})();

let vfdStripGame: boolean | undefined;
let vfdStripSpot: VirtualDisplaySpot | undefined;
let vfdStripLcd = false;

function vfdStripShown(): boolean {
  return vfdStripGame ?? (vfdStripLcd || vfdStripOn);
}

function setVfdStripOn(on: boolean): void {
  vfdStripGame = on;
  if (vfdStripBox) vfdStripBox.checked = on;
  if (session.game) saveVirtualDisplay(session.game, on);
  renderVfdStrip();
}

function setVfdStrip(m: FrameView | null, lcdOnGlass = false): void {
  if (!m) {
    vfdStripLatest = null;
    vfdStripSeen = false;
    vfdStripLcd = false;
  } else {
    const text = painter.displayText(m);
    const cells: (readonly number[])[] = [];
    for (let cell = 0; cell < 16; cell++) cells.push(painter.cellColumns(m, text, cell));
    const g = lcdOnGlass ? null : m.graphicLcd();
    const lcd = g ? { width: g.width, height: g.height, bits: g.bits.slice() } : null;
    if (!vfdStripSeen) vfdStripSeen = !!lcd || cells.some((cols) => cols.some((c) => c !== 0));
    if (lcd) vfdStripLcd = true;
    vfdStripLatest = { text, cells, duty: m.display?.duty ?? 31, lcd };
  }
  renderVfdStrip();
}

function renderVfdStrip(): void {
  const d = vfdStripLatest;
  if (!vfdStripShown() || !vfdStripSeen || !d) {
    if (vfdStrip) vfdStrip.hidden = true;
    return;
  }
  const panel = vfdStrip ?? createVfdStrip();
  const appearing = panel.hidden;
  panel.hidden = false;
  const dpr = window.devicePixelRatio || 1;
  if (vfdStripFlip) vfdStripFlip.hidden = !!d.lcd;
  panel.classList.toggle('lcd', !!d.lcd);
  panel.classList.toggle('bare', !!vfdStripSpot?.bare);
  if (d.lcd) {
    const pitch = LCD_STRIP_PITCH;
    let h = 0;
    for (let i = 0; i < d.lcd.bits.length; i++) h = (Math.imul(h, 31) + d.lcd.bits[i]) | 0;
    const key = `lcd:${pitch}:${dpr}:${d.lcd.width}x${d.lcd.height}:${h}`;
    if (key !== vfdStripKey) {
      vfdStripKey = key;
      drawLcdStrip(d.lcd, pitch, dpr);
      vfdStripCanvas?.setAttribute('aria-label', str('main.graphic_lcd'));
    }
  } else {
    const pitch = vfdStripPitch();
    const key = `${pitch}:${dpr}:${d.duty}:${d.cells.map((c) => c.join('.')).join(',')}`;
    if (key !== vfdStripKey) {
      vfdStripKey = key;
      drawVfdStripDots(d.cells, d.duty, pitch, dpr);
      vfdStripCanvas?.setAttribute('aria-label', d.text.trimEnd());
    }
  }
  if (appearing) placeVfdStrip();
}

function vfdStripPitch(): number {
  return Math.max(2, Math.min(4, Math.floor((window.innerWidth - 90) / 95)));
}

const LCD_STRIP_PITCH = 1;

function drawLcdStrip(lcd: { width: number; height: number; bits: Uint8Array }, pitch: number, dpr: number): void {
  const cv = vfdStripCanvas;
  const g = cv?.getContext('2d');
  if (!cv || !g) return;
  const w = lcd.width * pitch;
  const h = lcd.height * pitch;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = 'rgb(128,142,120)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgb(44,50,70)';
  const stride = lcd.width >> 3;
  for (let y = 0; y < lcd.height; y++) {
    for (let x = 0; x < lcd.width; x++) {
      if (lcd.bits[y * stride + (x >> 3)] & (0x80 >> (x & 7))) g.fillRect(x * pitch, y * pitch, pitch, pitch);
    }
  }
}

function drawVfdStripDots(
  cells: (readonly number[])[], duty: number, pitch: number, dpr: number,
): void {
  const cv = vfdStripCanvas;
  const g = cv?.getContext('2d');
  if (!cv || !g) return;
  const w = (16 * 6 + 1) * pitch;
  const h = 9 * pitch;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const r = pitch * 0.4;
  const pass = (lit: boolean): void => {
    g.beginPath();
    cells.forEach((cols, cell) => {
      for (let c = 0; c < 5; c++) {
        for (let row = 0; row < 7; row++) {
          if ((((cols[c] ?? 0) >> row) & 1) !== +lit) continue;
          const x = (cell * 6 + c + 1.5) * pitch;
          const y = (row + 1.5) * pitch;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    });
    g.fill();
  };
  g.fillStyle = DOT_OFF;
  pass(false);
  g.globalAlpha = Math.min(31, duty) / 31;
  g.fillStyle = DOT_ON;
  g.shadowColor = DOT_ON;
  g.shadowBlur = pitch * 1.5;
  pass(true);
  g.globalAlpha = 1;
  g.shadowBlur = 0;
}

function placeVfdStrip(x?: number, y?: number): void {
  const panel = vfdStrip;
  if (!panel) return;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  if (x === undefined || y === undefined) {
    const r = screenEl.getBoundingClientRect();
    if (vfdStripSpot && r.width > 0 && r.height > 0) {
      x = r.left + vfdStripSpot.fx * r.width;
      y = r.top + vfdStripSpot.fy * r.height;
    } else {
      x = vfdStripPos ? vfdStripPos.x : (window.innerWidth - w) / 2;
      y = vfdStripPos ? vfdStripPos.y : 64;
    }
  }
  x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w));
  y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h));
  panel.style.left = `${Math.round(x)}px`;
  panel.style.top = `${Math.round(y)}px`;
}

const DOUBLE_TAP_MS = 400;

function saveVfdStripSpot(bare: boolean): void {
  const panel = vfdStrip;
  const r = screenEl.getBoundingClientRect();
  if (!panel || !session.game || r.width <= 0 || r.height <= 0) return;
  vfdStripSpot = { fx: (panel.offsetLeft - r.left) / r.width, fy: (panel.offsetTop - r.top) / r.height, bare };
  saveVirtualDisplaySpot(session.game, vfdStripSpot);
}

function toggleVfdStripBare(): void {
  const bare = !vfdStripSpot?.bare;
  saveVfdStripSpot(bare);
  vfdStrip?.classList.toggle('bare', bare);
}

function createVfdStrip(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'vfd-strip';
  panel.hidden = true;
  panel.title = str('main.drag_to_move');
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vfd-close';
  close.textContent = '×';
  close.title = str('main.hide_options_virtual_display_brings');
  close.setAttribute('aria-label', str('main.hide_virtual_display'));
  close.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  close.addEventListener('click', () => setVfdStripOn(false));
  const flip = document.createElement('button');
  flip.type = 'button';
  flip.className = 'vfd-close vfd-flip';
  flip.textContent = '⇄';
  flip.title = str('main.reverse_the_text_if_it');
  flip.setAttribute('aria-label', str('main.reverse_virtual_display_text'));
  flip.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  flip.addEventListener('click', () => setVfdReverse(!painter.vfdReversed));
  panel.append(cv, flip, close);
  vfdStripFlip = flip;

  let grab: { dx: number; dy: number; x: number; y: number; moved: boolean } | null = null;
  let lastTap = -Infinity;
  panel.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    grab = { dx: ev.clientX - panel.offsetLeft, dy: ev.clientY - panel.offsetTop, x: ev.clientX, y: ev.clientY, moved: false };
    panel.setPointerCapture(ev.pointerId);
    panel.classList.add('dragging');
    ev.preventDefault();
  });
  panel.addEventListener('pointermove', (ev) => {
    if (!grab) return;
    if (!grab.moved && Math.hypot(ev.clientX - grab.x, ev.clientY - grab.y) < CLICK_SLOP_PX) return;
    grab.moved = true;
    placeVfdStrip(ev.clientX - grab.dx, ev.clientY - grab.dy);
  });
  const drop = (ev: PointerEvent): void => {
    if (!grab) return;
    const moved = grab.moved;
    grab = null;
    panel.classList.remove('dragging');
    if (!moved) {
      if (ev.type === 'pointerup' && ev.timeStamp - lastTap < DOUBLE_TAP_MS) {
        lastTap = -Infinity;
        toggleVfdStripBare();
      } else lastTap = ev.timeStamp;
      return;
    }
    vfdStripPos = { x: panel.offsetLeft, y: panel.offsetTop };
    try {
      localStorage.setItem(VFD_STRIP_POS, JSON.stringify(vfdStripPos));
    } catch {
    }
    saveVfdStripSpot(vfdStripSpot?.bare ?? false);
  };
  panel.addEventListener('pointerup', drop);
  panel.addEventListener('pointercancel', drop);
  window.addEventListener('resize', () => {
    if (panel.hidden) return;
    renderVfdStrip();
    if (vfdStripSpot) placeVfdStrip();
    else placeVfdStrip(panel.offsetLeft, panel.offsetTop);
  });

  document.body.append(panel);
  vfdStrip = panel;
  vfdStripCanvas = cv;
  applyBrightness();
  return panel;
}

ctx.fillStyle = '#0a0a12';
ctx.fillRect(0, 0, canvas.width, canvas.height);

if (inGameHistoryEntry()) history.replaceState(null, '');
void showLibrary();

function downloadDiagLog(): Promise<number> {
  return saveLog(appActions);
}

Object.assign(window, {
  diagLog: downloadDiagLog,
  __emu: {
    get machine() {
      const v = emu.latestFrame();
      if (!v) return null;
      return {
        display: v.display,
        reels: v.reels,
        lamps: v.lampsRaw,
        dots: v.dotsRaw,
        coinBusy: v.coinBusy,
        layoutLamp: (n: number) => v.layoutLamp(n),
        layoutLampLevel: (n: number) => v.layoutLampLevel(n),
        layoutDigit: (n: number) => v.layoutDigit(n),
        layoutDigitLevel: (n: number) => v.layoutDigitLevel(n),
        layoutDigitSegLevel: (n: number, seg: number) => v.layoutDigitSegLevel(n, seg),
      };
    },
    emu,
    audio,
    forceRedraw,
    get drawLog() { return painter.drawLog; },
    get reelDrift() { return reelDrift; },
    get cabinet() { return cabinet; },
    get canvas() { return canvas; },
    get screen() { return screenEl; },
    get pointerHost() { return pointerHost; },
    get game() { return session.game; },
    hitTest: (x: number, y: number) => {
      const lp = cabinetHit(x, y);
      if (!lp) return null;
      return { button: lp.button, ...(lp.acceptor ? { acceptor: lp.acceptor } : {}) };
    },
    get bench() { return benchLast; },
    get boot() { return session.boot; },
    get paintedBoot() { return session.paintedBoot; },
    get framesDrawn() { return session.framesDrawn; },
    bulbLab,
    schematic: schemPanel,
    magnifier,
  },
});

wireLibraryControls(libraryHandlers);

mountKioskMode(() => {
  libraryChooseOrbit();
  if (!librarySection.hidden) void renderLibrary(libraryHandlers);
});

window.addEventListener('pagehide', () => commitPendingDeletes(libraryHandlers));

function loadFromUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw, location.href);
  } catch {
    showError(str('main.n_is_not_a_valid', { 0: raw }));
    return;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    showError(str('main.n_urls_are_not_supported', { 0: url.protocol }));
    return;
  }
  const name = archiveStem(decodeURIComponent(url.pathname.split('/').pop() || 'game'));
  status.textContent = str('main.loading');
  showBusy(str('main.fetching_n', { 0: name }));
  fetch(url.href, { credentials: 'omit', redirect: 'follow' })
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.arrayBuffer();
    })
    .then((buf) => handleArchiveBytes(new Uint8Array(buf), name))
    .catch((e: Error) => {
      hideBusy();
      const why = e instanceof TypeError
        ? str('main.could_not_be_fetched_blocked')
        : e.message;
      showError(`${url.href} ${why}`);
    });
}

const fromUrl = new URLSearchParams(location.search).get('fromUrl');
if (fromUrl && !isLocked()) loadFromUrl(fromUrl);

const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
function openPicker(which: 'folder' | 'files'): void {
  status.textContent = str('main.waiting_for_the_picker');
  traceReset();
  trace(`picker opened: ${which}`);
  markPickerOpen(true);
  pickerGen = pickGen;
  armPickerWait(which);
  (which === 'folder' ? picker : zipPicker).click();
}

let pickerGen = 0;
let pickerWait: { which: 'folder' | 'files'; left: boolean; timer: number } | null = null;
function armPickerWait(which: 'folder' | 'files'): void {
  disarmPickerWait();
  pickerWait = { which, left: false, timer: 0 };
}
function disarmPickerWait(): void {
  if (!pickerWait) return;
  const shown = pickerWait.timer === -1;
  if (pickerWait.timer > 0) clearTimeout(pickerWait.timer);
  pickerWait = null;
  if (shown) { busyStop.hidden = true; hideBusy(); }
}
function pickerLeft(): void {
  if (pickerWait) pickerWait.left = true;
}
function pickerBack(): void {
  const w = pickerWait;
  if (!w || !w.left || w.timer !== 0) return;
  w.timer = window.setTimeout(() => {
    if (pickerWait !== w) return;
    w.timer = -1;
    showBusy(w.which === 'folder'
      ? str('main.reading_the_folder')
      : str('main.opening_the_files'));
    offerPickStop();
  }, 250);
}
window.addEventListener('blur', pickerLeft);
window.addEventListener('focus', pickerBack);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pickerLeft(); else pickerBack();
});
function openAdd(ev: Event): void {
  if (isLocked()) return;
  const returnTo = ev.currentTarget as HTMLElement;
  const canAdd = addSourceEnabled();
  if (canAdd && sources.inSource()) { sources.addSource(returnTo); return; }
  void openAddSheet(returnTo, openPicker, canAdd ? [sources.addGamesRow(returnTo)] : []);
}
addBtn.addEventListener('click', openAdd);

async function importFromSource(file: File, origin: string): Promise<string | null> {
  if (/\.zip$/i.test(file.name)) {
    try {
      const meta = await importUpload({ zip: new Uint8Array(await file.arrayBuffer()) }, archiveStem(file.name), {}, true);
      const now = await getMeta(meta.hash);
      if (now) await putMeta({ ...now, origin });
      return meta.hash;
    } catch (e) {
      trace(`source import fell back to a pick: ${(e as Error).message}`);
    }
  }
  await importPicked([file]);
  return null;
}

sources.mount({
  importQuietly: importFromSource,
  originsHeld: async () => new Map((await listGames()).filter((g) => g.origin).map((g) => [g.origin!, g.hash])),
  play: (hash) => libraryHandlers.onOpen(hash, true),
  backToLibrary: () => void renderLibrary(libraryHandlers),
  toGrid: libraryToGrid,
  returnTo: addBtn,
  busy: (msg, fraction) => {
    if (msg === null) { busyBar.hidden = true; hideBusy(); return; }
    busyBar.hidden = fraction === undefined;
    if (fraction !== undefined) busyFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    showBusy(msg);
  },
});
onBeforeOrbit(() => sources.leave());
if (!isLocked()) void sources.start();
document.getElementById('emptyAdd')!.addEventListener('click', openAdd);

let internalDrag = false;
document.addEventListener('dragstart', () => { internalDrag = true; }, true);
document.addEventListener('dragend', () => { internalDrag = false; }, true);

function hasFiles(ev: DragEvent): boolean {
  if (internalDrag) return false;
  return [...(ev.dataTransfer?.items ?? [])].some((i) => i.kind === 'file');
}

let dragDepth = 0;
const showDrop = (on: boolean): void => { document.getElementById('drop')!.hidden = !on; };
window.addEventListener('dragenter', (ev) => {
  if (!hasFiles(ev)) return;
  if (isLocked()) { ev.preventDefault(); return; }
  ev.preventDefault();
  if (dragDepth++ === 0) showDrop(true);
});
window.addEventListener('dragover', (ev) => {
  if (hasFiles(ev)) ev.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; showDrop(false); }
});
window.addEventListener('drop', (ev) => {
  if (!hasFiles(ev)) return;
  ev.preventDefault();
  dragDepth = 0;
  showDrop(false);
  if (isLocked()) return;
  if (!ev.dataTransfer) return;
  const entries = entriesFromDrop(ev.dataTransfer.items);
  if (entries.length === 0) return;
  void filesFromDrop(entries)
    .then(importPicked)
    .catch((e) => showError(str('main.could_not_read_the_dropped', { 0: (e as Error).message })));
});

console.info(`[fruitulator] build ${buildStamp()}`);

reportInterruptedImport();
startFrameLoop();
