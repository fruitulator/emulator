import {
  classifyGame, linkedInstances, missingProgramRoms, missingSoundRoms, spareRams,
  type Game, type GameFile, type LayoutProps,
} from '../src/machine/registry';
import type { Cabinet } from './dat';
import { MAKER_RULE, makerOf } from './maker';
import { THUMB_RULE, dehydrateCabinet, encodePng, makeThumb } from './cabjson';
import {
  DECODE_VERSION, decodePak, decodeSrcs, encodeImgs, encodeMeta, encodePak, encodeSrcs,
  type PakChunkIn, type PakMeta,
} from './gamepak';
import {
  CONTENT_RULE, MISSING_ROM_RULE, SCHEMA_VERSION, contentHashOf, deleteGame, getMeta, getPak, inSpareDir,
  playCountOf, putMeta, putPak, putThumb, type GameMeta,
} from './store';

export function batteriesOf(files: GameFile[], spares: GameFile[]): string[] {
  return [
    ...spares.filter((f) => /\.ram$/i.test(f.name)).map((f) => f.name),
    ...spareRams(files).map((f) => f.name),
  ];
}

export async function storedSpares(hash: string): Promise<GameFile[]> {
  try {
    const bytes = await getPak(hash);
    if (!bytes) return [];
    const pak = decodePak(bytes);
    return pak.has('SPAR') ? decodeSrcs(pak.chunk('SPAR')) : [];
  } catch (e) {
    console.warn('[library] stored spare state unreadable', e);
    return [];
  }
}

function decodeStatusOf(cab: { decode?: { clean: number; total: number } } | null):
'ok' | 'partial' | 'fallback' {
  if (!cab) return 'fallback';
  const d = cab.decode;
  return d && d.total > 0 && d.clean < d.total ? 'partial' : 'ok';
}

export function pakMetaOf(
  game: Game,
  cab: { decode?: { clean: number; total: number } } | null,
  contentHash: string,
  pending = false,
): PakMeta {
  return {
    name: game.name,
    system: game.system,
    created: Date.now(),
    decodeStatus: pending && !cab ? 'pending' : decodeStatusOf(cab),
    ...(cab?.decode ? { decode: cab.decode } : {}),
    files: game.files.map((f) => ({ name: f.name, size: f.bytes.length })),
    variant: game.variant,
    ...(cab && game.layoutName ? { layout: game.layoutName.toLowerCase() } : {}),
    contentHash,
  };
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}

function makerFields(
  files: GameFile[], system: string, sourceName: string | undefined,
): Pick<GameMeta, 'maker' | 'makerRule'> {
  const maker = makerOf(files, system, sourceName);
  return { ...(maker ? { maker } : {}), makerRule: MAKER_RULE };
}

function listOrDrop(key: string, list: string[]): Record<string, string[]> {
  return list.length ? { [key]: list } : {};
}

export type PersistStage = 'encoding' | 'caching';

let persistRequested = false;

export function requestStoragePersist(): void {
  if (persistRequested) return;
  persistRequested = true;
  void (navigator.storage as { persist?: () => Promise<boolean> } | undefined)
    ?.persist?.().catch(() => undefined);
}

function carriedHistory(prev: GameMeta | null): { playedAt: number | undefined; playCount: number } {
  return {
    playedAt: prev?.playedAt ?? (prev && prev.schema < 5 ? prev.lastPlayedAt : undefined),
    playCount: prev ? playCountOf(prev) : 0,
  };
}

export async function persistGame(
  hash: string,
  game: Game,
  cab: Cabinet<ImageData> | Cabinet<ImageBitmap> | null,
  onStage?: (stage: PersistStage) => void,
  sourceName?: string,
  layoutProps?: LayoutProps,
  played = true,
  spares?: GameFile[],
  pendingArtwork = false,
): Promise<GameMeta> {
  const enc = new TextEncoder();
  const prev = await getMeta(hash);
  const spare = spares?.length ? spares
    : prev?.batteries?.some(inSpareDir) ? await storedSpares(hash) : [];
  const contentHash = await contentHashOf(game.files);
  const chunks: PakChunkIn[] = [
    { type: 'META', bytes: encodeMeta(pakMetaOf(game, cab, contentHash, pendingArtwork)), deflate: true },
    { type: 'SRCS', bytes: encodeSrcs(game.files) },
  ];
  if (spare.length) chunks.push({ type: 'SPAR', bytes: encodeSrcs(spare), deflate: true });
  let thumb: Uint8Array | null = null;
  if (cab) {
    onStage?.('encoding');
    const { geo, assets } = dehydrateCabinet<ImageData | ImageBitmap>(cab);
    const imgs = await Promise.all(
      assets.map(async (a) => ({ id: a.id, bytes: await encodePng(a.image) })),
    );
    chunks.push({ type: 'CABJ', bytes: enc.encode(JSON.stringify(geo)), deflate: true });
    chunks.push({ type: 'IMGS', bytes: encodeImgs(imgs) });
    thumb = await makeThumb(cab);
    if (thumb) chunks.push({ type: 'THMB', bytes: thumb });
  }
  onStage?.('caching');
  const pak = encodePak(chunks);
  await putPak(hash, pak);
  requestStoragePersist();
  const history = carriedHistory(prev);
  const meta: GameMeta = {
    hash,
    schema: SCHEMA_VERSION,
    name: game.name,
    system: game.system,
    addedAt: prev?.addedAt ?? Date.now(),
    lastPlayedAt: Date.now(),
    decodeVersion: DECODE_VERSION,
    decodeStatus: pendingArtwork && !cab ? 'pending' : decodeStatusOf(cab),
    ...(cab?.decode ? { decode: cab.decode } : {}),
    autoSave: prev?.autoSave ?? true,
    sizeBytes: pak.length,
    variants: game.variants,
    variant: game.variant,
    sourceName: sourceName ?? prev?.sourceName,
    title: prev?.title,
    ...(prev?.coinAnswers ? { coinAnswers: prev.coinAnswers } : {}),
    hasThumb: prev?.hasThumb || !!thumb,
    thumbFromPlay: prev?.thumbFromPlay,
    thumbRule: thumb && !prev?.thumbFromPlay ? THUMB_RULE : prev?.thumbRule,
    playedAt: played ? Date.now() : history.playedAt,
    playCount: history.playCount + (played ? 1 : 0),
    ...listOrDrop('missingRoms', missingProgramRoms(game)),
    ...listOrDrop('missingSound', missingSoundRoms(game)),
    ...listOrDrop('linkedInstances', linkedInstances(game)),
    layoutProps: layoutProps ?? prev?.layoutProps,
    contentHash,
    contentRule: CONTENT_RULE,
    ...listOrDrop('batteries', batteriesOf(game.files, spare)),
    ...makerFields(game.files, game.system, sourceName ?? prev?.sourceName),
  };
  try {
    if (thumb && !prev?.thumbFromPlay) await putThumb(hash, thumb);
    await putMeta(meta);
  } catch (e) {
    if (!prev) await deleteGame(hash).catch(() => undefined);
    throw e;
  }
  return meta;
}

export async function backfillContentHash(hash: string): Promise<GameMeta | null> {
  const meta = await getMeta(hash);
  if (!meta) return null;
  const hashCurrent = meta.contentHash !== undefined && meta.contentRule === CONTENT_RULE;
  const missingCurrent = !meta.missingRoms?.length || meta.missingRule === MISSING_ROM_RULE;
  if (hashCurrent && meta.makerRule === MAKER_RULE && missingCurrent) return meta;
  const bytes = await getPak(hash);
  if (!bytes) return meta;
  const files = decodeSrcs(decodePak(bytes).chunk('SRCS'));
  const missing = missingCurrent ? null
    : missingProgramRoms(classifyGame(files, meta.name, meta.variant));
  const stamped: GameMeta = {
    ...meta,
    schema: SCHEMA_VERSION,
    ...carriedHistory(meta),
    contentHash: hashCurrent ? meta.contentHash : await contentHashOf(files),
    contentRule: CONTENT_RULE,
    ...makerFields(files, meta.system, meta.sourceName),
    ...(missing ? { missingRoms: missing.length ? missing : undefined } : {}),
    ...(meta.missingRoms?.length ? { missingRule: MISSING_ROM_RULE } : {}),
  };
  await putMeta(stamped);
  return stamped;
}
