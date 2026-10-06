import {
  classifyGame, linkedInstances, missingProgramRoms, missingSoundRoms, type GameFile,
} from '../src/machine/registry';
import { CONFIG_FILE } from '../src/machine/setfiles';
import {
  decodePak, decodeSrcs, decodeStat, encodeMeta, encodeSrcs, encodeStat, readMeta, repackPak,
  type PakChunkIn, type PakMeta, type PakRecord,
} from './gamepak';
import { batteriesOf, storedSpares } from './persist';
import { readCoinAnswers } from './coinask';
import {
  CONTENT_RULE, SCHEMA_VERSION, contentHashOf, getMeta, getPak, getThumb,
  hashGameFiles, inSpareDir, playCountOf, putMeta, putPak, putThumb, type GameMeta,
} from './store';
import { localStateStore } from './statestore';

export const PUNNET_EXT = '.punnet';

export function punnetFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return `${clean || 'game'}${PUNNET_EXT}`;
}

export function recordForExport(meta: GameMeta): PakRecord {
  return {
    hash: meta.hash,
    schema: meta.schema,
    exportedAt: Date.now(),
    addedAt: meta.addedAt,
    variant: meta.variant,
    autoSave: meta.autoSave,
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.coinAnswers !== undefined ? { coinAnswers: meta.coinAnswers } : {}),
    ...(meta.sourceName !== undefined ? { sourceName: meta.sourceName } : {}),
    ...(meta.playCount !== undefined ? { playCount: meta.playCount } : {}),
    ...(meta.playedAt !== undefined ? { playedAt: meta.playedAt } : {}),
    ...(meta.thumbFromPlay !== undefined ? { thumbFromPlay: meta.thumbFromPlay } : {}),
    ...(meta.layoutProps !== undefined ? { layoutProps: meta.layoutProps } : {}),
    ...(meta.contentHash !== undefined ? { contentHash: meta.contentHash } : {}),
    ...(meta.contentRule !== undefined ? { contentRule: meta.contentRule } : {}),
  };
}

export async function exportPunnet(
  hash: string,
  liveState?: { schema: number; savedAt: number; cycles: number; data: Uint8Array },
): Promise<{ bytes: Uint8Array; hasState: boolean } | null> {
  const [pak, meta] = await Promise.all([getPak(hash), getMeta(hash)]);
  if (!pak || !meta) return null;
  const [thumb, stored_] = await Promise.all([getThumb(hash), localStateStore.get(hash)]);
  const state = liveState ?? stored_;
  const stored = readMeta(decodePak(pak)) ?? metaFor(meta);
  const edits: Partial<Record<'META' | 'THMB' | 'STAT', PakChunkIn>> = {
    META: {
      type: 'META',
      bytes: encodeMeta({ ...stored, record: recordForExport(meta) }),
      deflate: true,
    },
  };
  if (thumb) edits.THMB = { type: 'THMB', bytes: thumb };
  if (state) {
    edits.STAT = {
      type: 'STAT',
      bytes: encodeStat({
        schema: state.schema, savedAt: state.savedAt, cycles: state.cycles, data: state.data,
      }),
    };
  }
  return { bytes: repackPak(pak, edits), hasState: !!state };
}

function metaFor(meta: GameMeta): PakMeta {
  return {
    name: meta.name,
    system: meta.system,
    created: meta.addedAt,
    decodeStatus: meta.decodeStatus,
    ...(meta.decode ? { decode: meta.decode } : {}),
    files: [],
    variant: meta.variant,
    ...(meta.contentHash !== undefined ? { contentHash: meta.contentHash } : {}),
  };
}

export type PunnetStage = 'hashing' | 'caching';

function listOrDrop(key: string, list: string[]): Record<string, string[]> {
  return list.length ? { [key]: list } : {};
}

export async function importPunnet(
  bytes: Uint8Array,
  fallbackName?: string,
  onStage?: (stage: PunnetStage) => void,
): Promise<GameMeta> {
  const pak = decodePak(bytes);
  const files = decodeSrcs(pak.chunk('SRCS'));
  const stored = readMeta(pak);
  const record = stored?.record;

  onStage?.('hashing');
  const hash = await hashGameFiles(files);
  const contentHash = await contentHashOf(files);
  const mismatch = record !== undefined && record.hash !== hash;

  const hasGam = files.some((f) => CONFIG_FILE.test(f.name));
  const game = classifyGame(
    files,
    hasGam ? undefined : record?.sourceName ?? stored?.name ?? fallbackName,
    record?.variant ?? stored?.variant,
  );
  const prev = await getMeta(hash);
  const spares: GameFile[] = pak.has('SPAR') ? decodeSrcs(pak.chunk('SPAR'))
    : prev?.batteries?.some(inSpareDir) ? await storedSpares(hash) : [];

  onStage?.('caching');
  const meta: PakMeta = {
    ...(stored ?? {
      name: game.name,
      system: game.system,
      created: Date.now(),
      decodeStatus: 'fallback' as const,
      files: game.files.map((f) => ({ name: f.name, size: f.bytes.length })),
      variant: game.variant,
    }),
    contentHash,
  };
  delete meta.record;
  if (mismatch) {
    meta.decodeStatus = 'fallback';
    delete meta.decode;
  }
  const storedPak = repackPak(bytes, {
    META: { type: 'META', bytes: encodeMeta(meta), deflate: true },
    STAT: null,
    ...(mismatch ? { CABJ: null, IMGS: null } : {}),
    ...(spares.length && !pak.has('SPAR')
      ? { SPAR: { type: 'SPAR' as const, bytes: encodeSrcs(spares), deflate: true } }
      : {}),
  });
  await putPak(hash, storedPak);

  let hasThumb = prev?.hasThumb ?? false;
  let thumbFromPlay = prev?.thumbFromPlay;
  if (pak.has('THMB') && (!prev?.thumbFromPlay || record?.thumbFromPlay)) {
    await putThumb(hash, pak.chunk('THMB'));
    hasThumb = true;
    thumbFromPlay = record?.thumbFromPlay;
  }

  if (pak.has('STAT')) {
    const stat = decodeStat(pak.chunk('STAT'));
    const local = await localStateStore.get(hash);
    if (!local || local.savedAt < stat.savedAt) await localStateStore.put(hash, { hash, ...stat });
  }

  const out: GameMeta = {
    hash,
    schema: SCHEMA_VERSION,
    name: game.name,
    system: game.system,
    addedAt: prev?.addedAt ?? record?.addedAt ?? Date.now(),
    lastPlayedAt: Date.now(),
    decodeVersion: pak.decodeVersion,
    decodeStatus: meta.decodeStatus,
    ...(meta.decode ? { decode: meta.decode } : {}),
    autoSave: prev?.autoSave ?? record?.autoSave ?? true,
    sizeBytes: storedPak.length,
    variants: game.variants,
    variant: game.variant,
    sourceName: prev?.sourceName ?? record?.sourceName,
    title: prev?.title ?? record?.title,
    ...((prev?.coinAnswers ?? record?.coinAnswers) ? { coinAnswers: prev?.coinAnswers ?? readCoinAnswers(record?.coinAnswers) } : {}),
    hasThumb,
    thumbFromPlay,
    playedAt: prev?.playedAt ?? record?.playedAt,
    playCount: prev ? playCountOf(prev) : record?.playCount ?? 0,
    ...listOrDrop('missingRoms', missingProgramRoms(game)),
    ...listOrDrop('missingSound', missingSoundRoms(game)),
    ...listOrDrop('linkedInstances', linkedInstances(game)),
    layoutProps: (record?.layoutProps
      && record.layoutProps.layout === game.layoutName?.toLowerCase()
      ? record.layoutProps : undefined) ?? prev?.layoutProps,
    contentHash,
    contentRule: CONTENT_RULE,
    ...listOrDrop('batteries', batteriesOf(files, spares)),
  };
  await putMeta(out);
  return out;
}
