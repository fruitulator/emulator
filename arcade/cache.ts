import { FRAME_FORMAT, type FrameLayout } from '../src/machine/framestate';
import { getArcadeRec, putArcadeRec, type GameMeta } from '../web/store';
import type { FitDetected } from './fit';
import type { MachineSetup } from './doc';

export const ARCADE_CACHE_VERSION = 6;

declare const __BUILD_ID__: string;
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const PIC_TYPE = 'image/jpeg';
const PIC_QUALITY = 0.88;

export interface CachedLook {
  detected: FitDetected | null;
  column: { left: number; top: number; width: number; height: number } | null;
  aspect: number;
  cabinetStyle: string | null;
  trim: string;
}

export interface ArcadeRec {
  hash: string;
  key: string;
  build: string;
  savedAt: number;
  mode: 'attract' | 'still';
  note: string;
  look: CachedLook;
  shape: FrameLayout | null;
  pic: Uint8Array;
  picType: string;
}

export interface KeyInputs {
  held: Pick<GameMeta, 'hash' | 'contentHash' | 'decodeVersion' | 'variant'>;
  contentHash: string;
  setup: MachineSetup;
  cabinetStyle: string | null;
  traceUrl: string | null;
  texSize: number;
}

export function cacheKey(k: KeyInputs): string {
  const s = k.setup;
  const box = (q: MachineSetup['glass']) => (q ? q.flatMap((p) => [p.x, p.y]) : null);
  const setup = [box(s.glass), box(s.buttons), box(s.deck), s.trim ?? null, s.cabinet ?? null, !!s.noDeck, !!s.noLower];
  return JSON.stringify([
    ARCADE_CACHE_VERSION, k.held.hash, k.held.contentHash ?? k.contentHash, k.held.decodeVersion,
    k.held.variant, setup, k.cabinetStyle, k.traceUrl, k.texSize,
  ]);
}

export async function readRec(hash: string, key: string): Promise<ArcadeRec | null> {
  const rec = (await getArcadeRec(hash).catch(() => null)) as ArcadeRec | null;
  return rec && rec.key === key && rec.pic instanceof Uint8Array && !!rec.look ? rec : null;
}

export function shapeIsCurrent(rec: ArcadeRec | null): rec is ArcadeRec & { shape: FrameLayout } {
  return !!rec?.shape && rec.build === BUILD && rec.shape.format === FRAME_FORMAT;
}

export function needsWrite(rec: ArcadeRec | null, key: string): boolean {
  return !rec || rec.key !== key || rec.build !== BUILD;
}

export async function writeRec(
  hash: string, key: string, canvas: HTMLCanvasElement,
  o: { mode: ArcadeRec['mode']; note: string; look: CachedLook; shape: FrameLayout | null },
): Promise<void> {
  try {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, PIC_TYPE, PIC_QUALITY));
    if (!blob) throw new Error('the glass could not be encoded');
    const pic = new Uint8Array(await blob.arrayBuffer());
    const rec: ArcadeRec = {
      hash, key, build: BUILD, savedAt: Date.now(), ...o, pic, picType: blob.type || PIC_TYPE,
    };
    await putArcadeRec(rec as unknown as ArcadeRec & { [f: string]: unknown });
  } catch (e) {
    console.warn('[arcade] could not keep this machine for the next visit', e);
  }
}

export async function invalidateRec(hash: string): Promise<void> {
  const rec = (await getArcadeRec(hash).catch(() => null)) as ArcadeRec | null;
  if (!rec) return;
  await putArcadeRec({ ...rec, key: '' } as unknown as ArcadeRec & { [f: string]: unknown });
}
