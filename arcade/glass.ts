import * as THREE from 'three';
import { classifyGame, gameFromConfig, machineFor, type Game, type GameConfig } from '../src/machine/registry';
import { FrameView, frameLayoutFor, type FrameLayout } from '../src/machine/framestate';
import { decodedLayout, readSetting } from '../src/layout/fmlconfig';
import { openAsHost, openPak, type ImportEvents } from '../web/importer';
import type { HostFile } from '../web/hostfiles';
import { currentLayoutProps } from '../web/gamepak';
import { usableCabinet, type Cabinet, type CabCheckbox, type CabLamp } from '../web/dat';
import { artImage, componentBounds } from '../web/cabjson';
import { createCabinetPainter, type CabinetPainter } from '../web/cabdraw';
import { ensureLegendFonts } from '../web/legendfonts';
import { ReelPeek } from '../web/play/peek';
import { capsAreSwitches } from '../web/cappulse';
import { stampCoinInputs, viewFor } from '../web/platform';
import { virtualDisplayReversed } from '../src/machine/layoutdisplay';
import { getThumb } from '../web/store';
import { contentKeys } from '../web/contentkeys';
import { decodeTrace, layoutDigest, traceLayout, traceMismatch, TracePlayer } from './trace';
import { DEFAULT_DECK, deckBand, lowerSplit } from './fold';
import { cropOf, proposeFit, quadFrac, resolveFit, wholeTextureFit, type FitDetected, type ShellFit } from './fit';
import { trimFor, type ArcadeMachine } from './machines';
import { cacheKey, needsWrite, readRec, shapeIsCurrent, writeRec, type ArcadeRec } from './cache';
import { isCoinSlot, type CoinEntry } from './coinentry';
import { trimFromArt } from './trimcolour';
import { boundsOf } from './quad';
import { str } from '../web/i18n';
import { LOGO_SRC } from '../web/ui/logo';
import { followGate } from '../web/play/gates';
import { SwitchLevels } from '../web/checkbox';

export type GlassMode = 'loading' | 'front' | 'attract' | 'still' | 'dark' | 'live' | 'failed';

const LOAD_TRIES = 3;
const LOAD_RETRY_MS = 600;
let logoImg: HTMLImageElement | null = null;
function darkLogo(): HTMLImageElement {
  if (!logoImg) {
    logoImg = new Image();
    logoImg.src = LOGO_SRC;
  }
  return logoImg;
}

export type DarkState = 'download' | 'downloading' | 'mismatch' | 'missing' | 'incomplete' | 'offline';

export function darkState(m: Pick<ArcadeMachine, 'held' | 'outOfService' | 'installing' | 'otherVersion' | 'source'>, downloading: boolean): DarkState | null {
  if (m.outOfService) return 'offline';
  if (m.installing) return 'incomplete';
  if (m.held) return null;
  if (downloading) return 'downloading';
  if (m.otherVersion) return 'mismatch';
  if (m.source) return 'download';
  return 'missing';
}

const DARK_ICONS: Record<DarkState, readonly string[]> = {
  download: ['M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14'],
  downloading: ['M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0', 'M12 7v5l3.5 2'],
  mismatch: ['M7.5 3.5 4 7l3.5 3.5M4 7h16', 'M16.5 13.5 20 17l-3.5 3.5M20 17H4'],
  missing: ['M5 19.5V4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5a1.5 1.5 0 0 0 1.5 1.5H19v-3',
    'M10 8.2a2 2 0 0 1 3.9.5c0 1.3-1.9 1.6-1.9 3', 'M12 14.6h.01'],
  incomplete: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  offline: ['M12 3v8', 'M6.3 6.8a8 8 0 1 0 11.4 0'],
};

const DARK_WORD: Record<DarkState, string> = {
  download: str('arcade.glass.download'), downloading: str('arcade.glass.downloading'), mismatch: str('arcade.glass.mismatch'),
  missing: str('arcade.glass.missing'), incomplete: str('arcade.glass.incomplete'), offline: str('arcade.glass.offline'),
};
const DARK_DESC: Record<DarkState, string> = {
  download: str('arcade.glass.download_desc'), downloading: str('arcade.glass.downloading_desc'), mismatch: str('arcade.glass.mismatch_desc'),
  missing: str('arcade.glass.missing_desc'), incomplete: str('arcade.glass.incomplete_desc'), offline: str('arcade.glass.offline_desc'),
};

const DARK_TEX_W = 1024;

let darkFonts: Promise<unknown> | null = null;
let darkFontsReady = false;
function loadDarkFonts(): Promise<unknown> {
  darkFonts ??= Promise.all([
    document.fonts.load('700 40px "Barlow Condensed"'),
    document.fonts.load('400 20px Inter'),
    document.fonts.load('500 20px Inter'),
  ]).catch(() => undefined).then(() => { darkFontsReady = true; });
  return darkFonts;
}

function balancedLines(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const wrap = (width: number): string[] => {
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && g.measureText(next).width > width) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const best = wrap(max);
  let lo = 0, hi = max;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(mid).length > best.length) lo = mid; else hi = mid;
  }
  return wrap(hi);
}

export const TEX_ATTRACT = 768;
export const TEX_WHOLE = 1024;

export const glassCost = { layoutMs: 0, copyMs: 0, n: 0, patches: 0, wholes: 0 };
export const glassTotals = { layoutMs: 0, copyMs: 0, n: 0, patches: 0, wholes: 0, patchPx: 0, bitmapMs: 0, parts: 0 };
const DEV = import.meta.env.DEV;

export const TEX_LIVE = 1024;

export interface LoadTimes {
  open: number; look: number; painter: number; trace: number; thumb: number;
  paint: number; shell: number; total: number;
  cached: number;
  openMain: number;
  traceMachine: number;
}
const newTimes = (): LoadTimes => ({
  open: 0, look: 0, painter: 0, trace: 0, thumb: 0, paint: 0, shell: 0, total: 0, cached: 0, openMain: 0, traceMachine: 0,
});

export class Glass {
  mode: GlassMode = 'loading';
  readonly peek = new ReelPeek();
  note = '';
  darkWhy = '';
  game: Game | null = null;
  cab: Cabinet | null = null;
  column: { left: number; top: number; width: number; height: number } | null = null;
  detected: FitDetected | null = null;
  readonly defaultTrim: string;
  derivedTrim: string | null = null;
  get trim(): string { return this.machine.setup.trim ?? this.derivedTrim ?? this.defaultTrim; }
  private artThumb: { img: ImageData; k: number } | null | undefined;
  aspect = 0.759;
  cabinetStyle: string | null;
  readonly texCanvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  overlaid = false;
  private paintCanvas: HTMLCanvasElement | null = null;
  painter: CabinetPainter | null = null;
  private fl: FrameLayout | null = null;
  private player: TracePlayer | null = null;
  private texSize = TEX_ATTRACT;
  readonly heldInputs = new Set<number>();
  readonly switchLevels = new SwitchLevels();
  panelRows: () => readonly { id: number; on: boolean }[] | undefined = () => undefined;
  readonly gatedOff = new Set<CabLamp>();
  private readonly gateSeenLit = new Set<number>();
  onGateSeen: ((lamps: number[]) => void) | null = null;
  lastPaint = -Infinity;
  paints = 0;
  readonly times: LoadTimes = newTimes();
  private rec: ArcadeRec | null = null;
  private recRead = false;
  private shape: FrameLayout | null = null;
  private coinEntry = false;
  readonly replaced = new Set<CabLamp>();
  private blanks: { left: number; top: number; width: number; height: number; fill: string; patch: HTMLCanvasElement | null }[] = [];
  private blanking = true;

  private whole = false;

  private omit: ((part: CabLamp | CabCheckbox) => boolean) | null = null;

  setOmit(rule: ((part: CabLamp | CabCheckbox) => boolean) | null): void {
    if (rule === this.omit) return;
    this.omit = rule;
    this.painter?.invalidate();
  }

  get wholeGlass(): boolean { return this.whole; }

  setWhole(on: boolean): void {
    if (on === this.whole) return;
    this.whole = on;
    this.painter?.invalidate();
  }

  get shown(): { left: number; top: number; width: number; height: number } | null {
    return (this.whole ? this.cab?.content : this.column) ?? this.cab?.content ?? null;
  }

  setBlanking(on: boolean): void {
    if (on === this.blanking) return;
    this.blanking = on;
    this.painter?.invalidate();
  }

  constructor(readonly machine: ArcadeMachine) {
    this.cabinetStyle = machine.cabinetStyle;
    this.defaultTrim = trimFor(machine.contentHash);
    this.texCanvas.width = 4;
    this.texCanvas.height = 4;
    this.texture = new THREE.CanvasTexture(this.texCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    if (!machine.held) {
      this.mode = 'dark';
      if (import.meta.env.DEV) {
        this.darkWhy = machine.outOfService ? 'switched off by the host'
          : machine.installing ? 'not installed yet'
            : `not in this library (no game here carries ${machine.contentHash.slice(0, 12)}…)`;
      }
      this.drawDark();
    }
  }

  get layoutCanvas(): HTMLCanvasElement | null { return this.paintCanvas; }

  applyFit(): void {
    const det = this.detected;
    if (!det) return;
    const c = cropOf(this.machine.setup, det);
    this.column = c;
    this.aspect = c.width / c.height;
    this.painter?.invalidate();
    this.readTrim();
  }

  private readTrim(): void {
    const cab = this.cab;
    const det = this.detected;
    if (!cab || !det) return;
    if (this.artThumb === undefined) this.artThumb = artThumb(cab);
    const t = this.artThumb;
    if (!t) return;
    const f = resolveFit(this.machine.setup, det, true);
    const boxes = [f.glass, f.buttons, f.deck].filter((q): q is NonNullable<typeof q> => !!q).map((q) => {
      const b = boundsOf(q);
      return { left: (b.left - cab.content.left) * t.k, top: (b.top - cab.content.top) * t.k, width: b.width * t.k, height: b.height * t.k };
    });
    const band = Math.max(3, Math.round(TRIM_BAND * Math.min(t.img.width, t.img.height)));
    this.derivedTrim = trimFromArt(t.img, boxes, band);
  }

  attachCoin(coin: CoinEntry | null): void {
    this.coinEntry = !!coin?.nodes.length;
    this.assignCoin();
  }

  assignCoin(): void {
    this.replaced.clear();
    this.blanks = [];
    const cab = this.cab;
    if (!this.coinEntry || !cab || !this.detected || !this.game) return;
    for (const lp of cab.lamps) if (isCoinSlot(lp)) this.replaced.add(lp);
    const blocks = [...this.replaced].filter((lp) => !lp.hidden).map((lp) => {
      const x = extentOf(lp);
      const pad = Math.max(BLANK_PAD, Math.round(BLANK_SHARE * Math.min(x.width, x.height)));
      return { left: x.left - pad, top: x.top - pad, width: x.width + 2 * pad, height: x.height + 2 * pad };
    });
    const read = artReader(cab, blocks);
    for (const e of blocks) this.blanks.push({ ...e, fill: surround(read, e), patch: patchOf(read, e) });
    this.painter?.invalidate();
    if (this.replaced.size) console.info(`[arcade] ${this.machine.name}: the cabinet's coin entry takes the coin`);
  }

  shellFit(): ShellFit {
    const det = this.detected;
    const crop = this.column;
    if (!det || !crop) return wholeTextureFit(this.aspect, DEFAULT_DECK);
    const set = this.machine.setup;
    const withDeck = resolveFit(set, det, true);
    return {
      aspect: crop.width / crop.height,
      glass: quadFrac(withDeck.glass, crop),
      buttons: quadFrac(withDeck.buttons!, crop),
      deck: withDeck.deck ? quadFrac(withDeck.deck, crop) : null,
      glassOnly: quadFrac(resolveFit(set, det, false).glass, crop),
      noLower: !!set.noLower,
    };
  }

  private key(): string {
    const m = this.machine;
    const held = m.hostFiles && m.gameConfig ? { ...m.held!, variant: m.gameConfig.source }
      : m.build ? { ...m.held!, variant: m.build } : m.held!;
    return cacheKey({
      held, contentHash: this.machine.contentHash, setup: this.machine.setup,
      cabinetStyle: this.machine.cabinetStyle, traceUrl: this.machine.traceUrl, texSize: TEX_ATTRACT,
    });
  }

  private async readCache(): Promise<ArcadeRec | null> {
    if (!this.recRead && this.machine.held) {
      this.recRead = true;
      this.rec = await readRec(this.machine.held.hash, this.key());
    }
    return this.rec;
  }

  forgetCache(): void {
    this.rec = null;
    this.recRead = false;
  }

  async restore(): Promise<boolean> {
    if (!this.machine.held) return false;
    const t0 = performance.now();
    try {
      const rec = await this.readCache();
      if (!rec) return false;
      const L = rec.look;
      this.detected = L.detected;
      this.column = L.column;
      this.aspect = L.aspect;
      this.cabinetStyle = L.cabinetStyle;
      this.derivedTrim = L.trim;
      this.note = rec.note;
      const bmp = await createImageBitmap(new Blob([rec.pic as Uint8Array<ArrayBuffer>], { type: rec.picType }));
      this.sizeTexture(bmp.width, bmp.height, Math.max(bmp.width, bmp.height));
      const g = this.texCanvas.getContext('2d')!;
      g.drawImage(bmp, 0, 0, this.texCanvas.width, this.texCanvas.height);
      bmp.close();
      this.texture.needsUpdate = true;
      this.mode = 'front';
      return true;
    } catch (e) {
      console.warn('[arcade] a kept machine could not be read; it is built instead', e);
      this.rec = null;
      return false;
    } finally {
      this.times.cached += performance.now() - t0;
    }
  }

  async save(): Promise<void> {
    const held = this.machine.held;
    if (!held || (this.mode !== 'attract' && this.mode !== 'still')) return;
    const key = this.key();
    if (!needsWrite(this.rec, key) && this.rec?.mode === this.mode && this.rec.note === this.note) return;
    await writeRec(held.hash, key, this.texCanvas, {
      mode: this.mode, note: this.note, shape: this.shape,
      look: {
        detected: this.detected, column: this.column,
        aspect: this.aspect, cabinetStyle: this.cabinetStyle, trim: this.trim,
      },
    });
  }

  async load(): Promise<void> {
    const held = this.machine.held;
    if (!held) return;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.loadOnce(held);
        return;
      } catch (e) {
        const why = (e as Error).message;
        if (attempt >= LOAD_TRIES) {
          this.mode = 'failed';
          this.note = why;
          if (import.meta.env.DEV) this.darkWhy = `could not be opened (${attempt} tries): ${why}`;
          this.drawDark();
          return;
        }
        if (import.meta.env.DEV) console.warn(`[arcade] ${this.machine.name}: opening it failed (${why}); trying again`);
        await new Promise((r) => setTimeout(r, LOAD_RETRY_MS * 4 ** (attempt - 1)));
      }
    }
  }

  private async loadOnce(held: NonNullable<ArcadeMachine['held']>): Promise<void> {
    const T = this.times;
    let t = performance.now();
    const lap = (k: keyof LoadTimes): void => { const n = performance.now(); T[k] += n - t; t = n; };
    try {
      const rec = await this.readCache();
      t = performance.now();
      const m = this.machine;
      const { game, cab } = await openHeld(held.hash, T, m.hostFiles ? { files: m.hostFiles, config: m.gameConfig ?? null } : null, m.build);
      lap('open');
      this.game = game;
      if (rec) {
        this.cabinetStyle = rec.look.cabinetStyle;
      } else {
        const payload = decodedLayout(game.layout);
        this.cabinetStyle = (payload ? readSetting(payload, game.system, 'Cabinet Style') : null) ?? this.cabinetStyle;
      }
      if (!cab) {
        this.note = 'no artwork';
        await this.showThumb(held.hash);
        lap('thumb');
        return;
      }
      this.cab = cab;
      const view = viewFor(game.system);
      capsAreSwitches(cab.lamps, view.nonSwitchInputs);
      stampCoinInputs(cab.lamps, view);
      if (rec?.look.detected && rec.look.column) {
        this.detected = rec.look.detected;
      } else {
        const found = componentBounds(cab) ?? cab.content;
        this.detected = proposeFit(cab.content, found, deckBand(cab, found), lowerSplit(cab, found, (l, t, w, h) => artPixels(cab, l, t, w, h)));
      }
      this.applyFit();
      const set = this.machine.setup;
      if (!this.detected.read && !set.buttons) {
        console.info(`[arcade] ${this.machine.name}: the layout has no buttons to read; the lower glass runs to the layout's foot`);
      }
      if (this.detected.split !== 'edge' && !set.buttons) {
        console.info(`[arcade] ${this.machine.name}: ${this.detected.split === 'reels'
          ? 'no painted line found above the reels; the lower glass starts just above them'
          : 'the layout has no reels; the lower glass is the button row'}`);
      }
      lap('look');
      const pc = document.createElement('canvas');
      pc.width = cab.content.width;
      pc.height = cab.content.height;
      this.paintCanvas = pc;
      this.painter = createCabinetPainter(pc, {
        inputHeld: (input) => this.heldInputs.has(input),
        checkboxTicked: (cb) => this.switchLevels.ticked(cb, this.panelRows()),
        checkboxPressed: (cb) => this.switchLevels.pressed(cb),
        omits: (part) => this.omit?.(part) ?? false,
        lampGate: (m, lp) => this.updateGate(m, lp),
        reelPeek: () => this.peek.value(),
      });
      this.painter.loadDisplay(cab, virtualDisplayReversed(game.system));
      void ensureLegendFonts([...cab.lamps, ...(cab.checkboxes ?? [])].map((l) => l.legend?.face)).then(() => this.painter?.invalidate());
      this.assignCoin();
      lap('painter');
      const art = this.whole && this.showArt(TEX_WHOLE);
      if (this.machine.traceUrl) {
        try {
          await this.loadTrace(this.machine, [...contentKeys(held), this.machine.contentHash, ...this.machine.formerContentHashes], game,
            shapeIsCurrent(rec) ? rec.shape : null);
          lap('trace');
          this.mode = 'attract';
          this.note = '';
          return;
        } catch (e) {
          lap('trace');
          this.note = `no trace: ${(e as Error).message}`;
          console.info(`[arcade] ${this.machine.name}: its attract is not played (${(e as Error).message}); the host's Edit, then Finish, records it again`);
        }
      } else {
        this.note = 'no trace recorded';
      }
      if (art) {
        this.mode = 'still';
        lap('thumb');
        return;
      }
      await this.showThumb(held.hash);
      lap('thumb');
    } finally {
    }
  }

  private async loadTrace(m: ArcadeMachine, contentHash: readonly string[], game: Game, kept: FrameLayout | null): Promise<void> {
    let bytes: Uint8Array;
    if (m.traceBytes) {
      bytes = await m.traceBytes();
    } else {
      const res = await fetch(m.traceUrl!);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const trace = decodeTrace(bytes);
    let fl = traceLayout(trace.header)
      ?? (kept && layoutDigest(kept) === trace.header.layoutDigest ? kept : null);
    if (!fl) {
      const tm = performance.now();
      const m = machineFor(game);
      fl = frameLayoutFor(game.system, m, game.layout);
      this.times.traceMachine += performance.now() - tm;
    }
    const bad = traceMismatch(trace.header, contentHash, fl);
    if (bad) throw new Error(bad);
    this.fl = fl;
    this.shape = fl;
    this.player = new TracePlayer(trace);
  }

  private showArt(max: number): boolean {
    const cab = this.cab;
    const art = cab ? artImage(cab) : null;
    if (!cab || !art) return false;
    const c = cab.content;
    this.sizeTexture(c.width, c.height, max);
    const g = this.texCanvas.getContext('2d')!;
    const w = this.texCanvas.width, h = this.texCanvas.height;
    const k = w / c.width;
    const bg = art.image;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bg, (art.x - c.left) * k, (art.y - c.top) * k, bg.width * k, bg.height * k);
    this.texture.needsUpdate = true;
    return true;
  }

  private async showThumb(hash: string): Promise<void> {
    const bytes = await getThumb(hash).catch(() => null);
    if (!bytes) {
      this.mode = 'dark';
      if (import.meta.env.DEV) this.darkWhy = `${this.note || 'no art'}, and the library has no picture of it`;
      this.drawDark();
      return;
    }
    const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    this.aspect = bmp.width / bmp.height;
    this.sizeTexture(bmp.width, bmp.height, TEX_ATTRACT);
    const g = this.texCanvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, this.texCanvas.width, this.texCanvas.height);
    bmp.close();
    this.texture.needsUpdate = true;
    this.mode = 'still';
  }

  private download: number | null = null;
  setDownload(f: number | null): void {
    const was = this.download === null ? -1 : Math.round(this.download * 100);
    this.download = f === null ? null : Math.max(0, Math.min(1, f));
    const now = this.download === null ? -1 : Math.round(this.download * 100);
    if (now !== was && (this.mode === 'dark' || this.mode === 'failed')) this.drawDark();
  }

  drawDark(): void {
    const m = this.machine;
    const state = darkState(m, this.download !== null);
    const pct = state === 'downloading' ? Math.round((this.download ?? 0) * 100) : -1;
    if (!darkFontsReady && state) void loadDarkFonts().then(() => { if (this.mode === 'dark' || this.mode === 'failed') this.drawDark(); });
    const W = DARK_TEX_W;
    this.sizeTexture(W, W / this.aspect, Math.max(W, W / this.aspect));
    const g = this.texCanvas.getContext('2d')!;
    const w = this.texCanvas.width;
    const h = this.texCanvas.height;
    g.save();
    g.translate(w * 0.5, h * 0.45);
    g.scale(w * 0.7, h * 0.55);
    const bg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    bg.addColorStop(0, '#15121F');
    bg.addColorStop(0.7, '#0A0910');
    bg.addColorStop(1, '#0A0910');
    g.fillStyle = bg;
    g.fillRect(-2, -2, 4, 4);
    g.restore();
    g.save();
    g.translate(w * 0.5, h * 0.5);
    g.scale(w * 0.75, h * 0.75);
    const vig = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    vig.addColorStop(0.55, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vig;
    g.fillRect(-2, -2, 4, 4);
    g.restore();
    const logo = darkLogo();
    if (logo.complete && logo.naturalWidth) {
      const lw = w * 0.38;
      const lh = (lw * logo.naturalHeight) / logo.naturalWidth;
      g.globalAlpha = 0.3;
      g.drawImage(logo, (w - lw) / 2, w * 0.1, lw, lh);
      g.globalAlpha = 1;
    } else {
      logo.addEventListener('load', () => { if (this.mode === 'dark' || this.mode === 'failed') this.drawDark(); }, { once: true });
    }
    if (state && darkFontsReady) this.drawDarkState(g, state, pct, w, h);
    this.texture.needsUpdate = true;
  }

  private drawDarkState(g: CanvasRenderingContext2D, state: DarkState, pct: number, w: number, h: number): void {
    const cx = w / 2;
    let y = h * 0.36;
    const r = (w * 0.178) / 2;
    const is = w * 0.083;
    g.save();
    g.translate(cx - is / 2, y + r - is / 2);
    g.scale(is / 24, is / 24);
    g.strokeStyle = 'rgba(185,178,208,0.7)';
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const d of DARK_ICONS[state]) g.stroke(new Path2D(d));
    g.restore();
    y += r * 2 + w * 0.05;
    const ws = w * 0.078;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${ws}px "Barlow Condensed", sans-serif`;
    g.letterSpacing = `${ws * 0.06}px`;
    g.fillStyle = 'rgba(230,225,242,0.9)';
    g.fillText(DARK_WORD[state].toLocaleUpperCase(), cx + (ws * 0.06) / 2, y + ws / 2, w * 0.9);
    g.letterSpacing = '0px';
    y += ws + w * 0.028;
    const ds = w * 0.039;
    const lh = ds * 1.45;
    g.font = `400 ${ds}px Inter, sans-serif`;
    g.fillStyle = '#8E87A8';
    for (const line of balancedLines(g, DARK_DESC[state], w * 0.82)) {
      g.fillText(line, cx, y + lh / 2);
      y += lh;
    }
    if (pct < 0) return;
    y += w * 0.044;
    const ps = w * 0.033;
    g.font = `500 ${ps}px Inter, sans-serif`;
    const textW = g.measureText('100%').width;
    const gap = w * 0.025;
    const rowW = w * 0.62;
    const left = cx - rowW / 2;
    const trackW = rowW - gap - textW;
    const th = w * 0.011;
    const mid = y + ps / 2;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.roundRect(left, mid - th / 2, trackW, th, th / 2);
    g.fill();
    if (pct > 0) {
      g.fillStyle = 'rgba(157,134,240,0.85)';
      g.beginPath();
      g.roundRect(left, mid - th / 2, Math.max(th, (trackW * pct) / 100), th, th / 2);
      g.fill();
    }
    g.fillStyle = '#8E87A8';
    g.textAlign = 'right';
    g.fillText(`${pct}%`, left + rowW, mid);
  }

  private sizeTexture(w: number, h: number, max: number): void {
    const k = Math.min(1, max / Math.max(w, h));
    const tw = Math.max(4, Math.round(w * k));
    const th = Math.max(4, Math.round(h * k));
    if (this.texCanvas.width !== tw || this.texCanvas.height !== th) {
      this.texCanvas.width = tw;
      this.texCanvas.height = th;
      this.texture.dispose();
    }
  }

  paintFrame(m: FrameView, texMax: number): boolean {
    if (!this.painter || !this.cab || !this.paintCanvas) return false;
    const t0 = performance.now();
    this.painter.advance(m, this.cab);
    const painted = this.painter.paint(m, this.cab);
    const t1 = performance.now();
    if (this.overlaid && this.mode === 'live' && !this.whole) {
      if (!painted) return false;
      this.paints++;
      if (DEV) { glassCost.layoutMs += t1 - t0; glassCost.n++; glassTotals.layoutMs += t1 - t0; glassTotals.n++; }
      return true;
    }
    const resized = texMax !== this.texSize;
    if (!painted && !resized) return false;
    this.texSize = texMax;
    const col = this.shown ?? this.cab.content;
    const sx = col.left - this.cab.content.left;
    const sy = col.top - this.cab.content.top;
    this.sizeTexture(col.width, col.height, texMax);
    const tw = this.texCanvas.width, th = this.texCanvas.height;
    const g = this.texCanvas.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.drawImage(this.paintCanvas, sx, sy, col.width, col.height, 0, 0, tw, th);
    if (this.blanking && this.blanks.length) {
      const kx = tw / col.width;
      const ky = th / col.height;
      for (const b of this.blanks) {
        const x = Math.floor((b.left - col.left) * kx), y = Math.floor((b.top - col.top) * ky);
        const w = Math.ceil(b.width * kx) + 1, h = Math.ceil(b.height * ky) + 1;
        if (b.patch) g.drawImage(b.patch, x, y, w, h);
        else { g.fillStyle = b.fill; g.fillRect(x, y, w, h); }
      }
    }
    if (!this.overlaid) this.texture.needsUpdate = true;
    this.paints++;
    if (DEV) {
      const t2 = performance.now();
      glassCost.layoutMs += t1 - t0;
      glassCost.copyMs += t2 - t1;
      glassCost.n++;
      glassTotals.layoutMs += t1 - t0;
      glassTotals.copyMs += t2 - t1;
      glassTotals.n++;
    }
    return true;
  }

  playAttract(t: number, texMax: number): boolean {
    if (this.mode !== 'attract' || !this.player || !this.fl) return false;
    const changed = this.player.show(this.player.indexAt(t));
    if (!changed && texMax === this.texSize) return false;
    return this.paintFrame(new FrameView(this.fl, this.player.buf), texMax);
  }

  private updateGate(m: FrameView, lp: CabLamp): void {
    if (followGate(m, lp, this.gatedOff, this.gateSeenLit)) this.onGateSeen?.([...this.gateSeenLit]);
  }

  resetGates(seen: readonly number[] = []): void {
    this.heldInputs.clear();
    this.switchLevels.clear();
    this.gatedOff.clear();
    this.gateSeenLit.clear();
    for (const n of seen) this.gateSeenLit.add(n);
  }

  standDown(): void {
    this.setOmit(null);
    this.resetGates();
    this.onGateSeen = null;
    this.painter?.invalidate();
    this.mode = this.player ? 'attract' : this.mode === 'live' ? 'still' : this.mode;
    this.lastPaint = -Infinity;
  }
}

const TRIM_THUMB = 256;
const TRIM_BAND = 0.04;

function artThumb(cab: Cabinet): { img: ImageData; k: number } | null {
  const art = artImage(cab);
  if (!art) return null;
  try {
    const k = Math.min(1, TRIM_THUMB / Math.max(cab.content.width, cab.content.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(cab.content.width * k));
    cv.height = Math.max(1, Math.round(cab.content.height * k));
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    const bg = art.image;
    g.imageSmoothingEnabled = true;
    g.drawImage(bg, (art.x - cab.content.left) * k, (art.y - cab.content.top) * k, bg.width * k, bg.height * k);
    return { img: g.getImageData(0, 0, cv.width, cv.height), k };
  } catch (e) {
    console.warn('[arcade] the layout\'s art could not be read for the trim colour', e);
    return null;
  }
}

const BLANK_PAD = 5;
const BLANK_SHARE = 0.15;

export function extentOf(lp: CabLamp): { left: number; top: number; width: number; height: number } {
  let r = lp.left + lp.width;
  let b = lp.top + lp.height;
  for (const c of [...lp.states.map((s) => s.canvas), lp.offState?.canvas, ...(lp.rgb?.faces ?? [])]) {
    if (!c) continue;
    r = Math.max(r, lp.left + c.width);
    b = Math.max(b, lp.top + c.height);
  }
  return { left: lp.left, top: lp.top, width: r - lp.left, height: b - lp.top };
}

function surround(read: ArtRead, e: { left: number; top: number; width: number; height: number }): string {
  const R = 3;
  const l = Math.floor(e.left) - R, t = Math.floor(e.top) - R;
  const w = Math.ceil(e.width) + 2 * R, h = Math.ceil(e.height) + 2 * R;
  const px = read(l, t, w, h);
  if (!px) return '#0a0a12';
  const ch: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= R && x < w - R && y >= R && y < h - R) continue;
      const i = (y * w + x) * 4;
      if (px[i + 3] < 128) continue;
      ch[0].push(px[i]); ch[1].push(px[i + 1]); ch[2].push(px[i + 2]);
    }
  }
  if (!ch[0].length) return '#0a0a12';
  const med = (a: number[]): number => a.sort((p, q) => p - q)[a.length >> 1];
  return `rgb(${med(ch[0])},${med(ch[1])},${med(ch[2])})`;
}

function patchOf(read: ArtRead, e: { left: number; top: number; width: number; height: number }): HTMLCanvasElement | null {
  const SAMPLE = 4, R = SAMPLE;
  const l = Math.floor(e.left) - R, t = Math.floor(e.top);
  const w = Math.ceil(e.width) + 2 * R, h = Math.max(1, Math.ceil(e.height));
  const px = read(l, t, w, h);
  if (!px) return null;
  const cv = document.createElement('canvas');
  cv.width = w - 2 * R;
  cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(cv.width, h);
  const side = (y: number, x0: number): number[] => {
    const c = [0, 0, 0, 0];
    for (let x = x0; x < x0 + SAMPLE; x++) for (let k = 0; k < 4; k++) c[k] += px[(y * w + x) * 4 + k];
    return c.map((v) => v / SAMPLE);
  };
  for (let y = 0; y < h; y++) {
    const a = side(y, 0), b = side(y, w - SAMPLE);
    for (let x = 0; x < cv.width; x++) {
      const f = cv.width > 1 ? x / (cv.width - 1) : 0.5;
      const o = (y * cv.width + x) * 4;
      for (let k = 0; k < 3; k++) img.data[o + k] = a[k] + (b[k] - a[k]) * f;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

function artPixels(cab: Cabinet, l: number, t: number, w: number, h: number): Uint8ClampedArray | null {
  const art = artImage(cab);
  if (!art) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(art.image, art.x - l, art.y - t);
    return g.getImageData(0, 0, w, h).data;
  } catch (e) {
    console.warn('[arcade] the layout\'s art could not be read for the lower glass', e);
    return null;
  }
}

type ArtRead = (l: number, t: number, w: number, h: number) => Uint8ClampedArray | null;

export function artReader(cab: Cabinet, blocks: readonly { left: number; top: number; width: number; height: number }[]): ArtRead {
  if (!artImage(cab) || !blocks.length) return (l, t, w, h) => artPixels(cab, l, t, w, h);
  let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
  for (const e of blocks) {
    L = Math.min(L, Math.floor(e.left) - ART_MARGIN);
    T = Math.min(T, Math.floor(e.top) - ART_MARGIN);
    R = Math.max(R, Math.floor(e.left) + Math.ceil(e.width) + ART_MARGIN);
    B = Math.max(B, Math.floor(e.top) + Math.max(1, Math.ceil(e.height)) + ART_MARGIN);
  }
  const W = R - L, H = B - T;
  const all = artPixels(cab, L, T, W, H);
  return (l, t, w, h) => {
    if (!all) return null;
    if (l < L || t < T || l + w > R || t + h > B || !Number.isInteger(l) || !Number.isInteger(t)) return artPixels(cab, l, t, w, h);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const from = ((t - T + y) * W + (l - L)) * 4;
      out.set(all.subarray(from, from + w * 4), y * w * 4);
    }
    return out;
  };
}
const ART_MARGIN = 4;

function openHeld(
  hash: string, T: LoadTimes, host: { files: HostFile[]; config: GameConfig | null } | null, build?: string,
): Promise<{ game: Game; cab: Cabinet | null }> {
  return new Promise((resolve, reject) => {
    let game: Game | null = null;
    let cab: Cabinet | null | undefined;
    const done = (): void => { if (game && cab !== undefined) resolve({ game, cab }); };
    const events: ImportEvents = {
      onFiles: (files, meta, build) => {
        const t = performance.now();
        const hasGam = files.some((f) => /\.gam$/i.test(f.name));
        const g = host?.config ? gameFromConfig(files, host.config, meta?.name)
          : classifyGame(files, hasGam ? undefined : meta?.name, build);
        g.layoutProps = currentLayoutProps(meta);
        game = g;
        T.openMain += performance.now() - t;
        done();
      },
      onCabinet: (c) => {
        const t = performance.now();
        cab = usableCabinet(c);
        T.openMain += performance.now() - t;
        done();
      },
    };
    (host ? openAsHost(hash, host.files, host.config, events) : openPak(hash, events, build, false))
      .then(() => { if (!game) reject(new Error('the record opened with no files')); done(); }, reject);
  });
}
