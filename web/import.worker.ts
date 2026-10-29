import {
  classifyGame, linkedInstances, missingProgramRoms, missingSoundRoms,
  type Game, type GameFile, type LayoutProps,
} from '../src/machine/registry';
import { damagedRoms } from '../src/machine/textcopy';
import { CONFIG_FILE } from '../src/machine/setfiles';
import { reelGeometryFromPayload } from '../src/machine/layoutreels';
import { layoutSwitchesFromPayload } from '../src/machine/layoutswitches';
import { fittedPeripherals, hasGameConfig } from '../src/layout/fmlconfig';
import { assembleCabinet, dehydrateCabinet, type CabGeometry } from './cabjson';
import { extractCabinetFromPayload, readLayout, usableCabinet, type Cabinet } from './dat';
import { strFromU8 } from 'fflate';
import {
  DECODE_VERSION, PakError, decodeImgs, decodePak, decodeSrcs, loadPlan, readMeta,
} from './gamepak';
import type { ImportErrorCode, ImportRequest, ImportResponse } from './import-protocol';
import { gameFromZip } from './ingest';
import { batteriesOf, isQuotaError, persistGame } from './persist';
import { importPunnet } from './portable';
import {
  CONTENT_RULE, SCHEMA_VERSION, contentHashOf, getMeta, getPak, hashGameFiles, playCountOf, programHashOf,
  putMeta, type GameMeta,
} from './store';

class CodedError extends Error {
  constructor(message: string, readonly code: ImportErrorCode) {
    super(message);
  }
}

const post = (msg: ImportResponse, transfer: Transferable[] = []): void => {
  (self as unknown as {
    postMessage(m: ImportResponse, t: Transferable[]): void;
  }).postMessage(msg, transfer);
};

async function decodeLayout(game: Game): Promise<{
  cab: Cabinet<ImageData> | null; props: LayoutProps | undefined;
}> {
  if (!game.layout) return { cab: null, props: undefined };
  const payload = readLayout(game.layout);
  const system = game.gam?.system ?? '';
  const cab = usableCabinet(await extractCabinetFromPayload(payload, system));
  let props: LayoutProps | undefined;
  if (game.layoutName) {
    try {
      props = {
        layout: game.layoutName.toLowerCase(),
        reels: reelGeometryFromPayload(payload),
        switches: layoutSwitchesFromPayload(payload),
        peripherals: hasGameConfig(system)
          ? fittedPeripherals(payload, system)
          : {
            coinMech: null, hoppers: [null, null], noteAcceptor: null,
            picType: null, picCode: null, lampExtender: null, hopperType: null,
          },
      };
    } catch (e) {
      console.warn('[library] layout props parse failed', e);
    }
  }
  return { cab, props };
}

async function decodeLayoutOrNone(game: Game): Promise<Awaited<ReturnType<typeof decodeLayout>>> {
  try {
    return await decodeLayout(game);
  } catch (e) {
    console.warn('[library] layout could not be decoded; no artwork until it is opened', e);
    return { cab: null, props: undefined };
  }
}

async function postCabinet(id: number, cab: Cabinet<ImageData> | null): Promise<void> {
  if (!cab) {
    post({ id, kind: 'cabinet', geo: null, bitmaps: [] });
    return;
  }
  const { geo, assets } = dehydrateCabinet(cab);
  const bitmaps = await Promise.all(
    assets.map(async (a): Promise<[number, ImageBitmap]> => [a.id, await createImageBitmap(a.image)]),
  );
  post({ id, kind: 'cabinet', geo, bitmaps }, bitmaps.map(([, b]) => b));
}

async function importUpload(
  req: Extract<ImportRequest, { op: 'importUpload' }>,
  setPhase: (p: string) => void,
): Promise<void> {
  const { id } = req;
  let files = req.files;
  let spares = req.spares;
  if (!files) {
    setPhase('unpacking');
    post({ id, kind: 'progress', stage: 'unpacking' });
    ({ files, spares } = await gameFromZip(req.zip ?? new Uint8Array()));
  }
  const setFiles = spares?.length ? [...files, ...spares] : files;
  if (!req.background) post({ id, kind: 'files', files: setFiles });

  setPhase('classify');
  const hasGam = files.some((f) => CONFIG_FILE.test(f.name));
  const game = classifyGame(setFiles, hasGam ? undefined : req.fallbackName);

  setPhase('hashing');
  post({ id, kind: 'progress', stage: 'hashing' });
  const hash = (req.files && req.hash) || await hashGameFiles(files);

  if (req.deferArtwork) {
    setPhase('decoding');
    if (game.layout) post({ id, kind: 'progress', stage: 'decoding' });
    const { cab, props } = await decodeLayoutOrNone(game);
    setPhase('caching');
    const meta = await persistGame(hash, game, cab, (stage) => {
      setPhase(stage);
      post({ id, kind: 'progress', stage });
    }, req.fallbackName, props, !req.background, spares, 'thumb');
    post({ id, kind: 'cached', hash, meta });
    return;
  }

  setPhase('decoding');
  if (game.layout) post({ id, kind: 'progress', stage: 'decoding' });
  const { cab, props } = await decodeLayout(game);
  if (!req.background) await postCabinet(id, cab);

  setPhase('caching');
  const meta = await persistGame(hash, game, cab, (stage) => {
    setPhase(stage);
    post({ id, kind: 'progress', stage });
  }, req.fallbackName, props, !req.background, spares);
  post({ id, kind: 'cached', hash, meta });
}

async function openPak(
  req: Extract<ImportRequest, { op: 'openPak' }>,
  setPhase: (p: string) => void,
): Promise<void> {
  const { id, hash } = req;
  setPhase('read');
  const bytes = await getPak(hash);
  if (!bytes) throw new CodedError('game missing from library', 'missing-pak');
  const pak = decodePak(bytes);

  let files: GameFile[];
  try {
    files = decodeSrcs(pak.chunk('SRCS'));
  } catch (e) {
    console.warn('[library] source chunk unreadable', e);
    throw new CodedError('cached source files unreadable', 'corrupt-srcs');
  }
  let spares: GameFile[] = [];
  try {
    if (pak.has('SPAR')) spares = decodeSrcs(pak.chunk('SPAR'));
  } catch (e) {
    console.warn('[library] spare state unreadable', e);
  }
  const storedMeta = (await getMeta(hash)) ?? undefined;
  const variant = req.variant ?? storedMeta?.variant;
  const setFiles = spares.length ? [...files, ...spares] : files;
  post({ id, kind: 'files', files: setFiles, storedMeta, variant });

  setPhase('classify');
  const hasGam = files.some((f) => CONFIG_FILE.test(f.name));
  const game = classifyGame(setFiles, hasGam ? undefined : storedMeta?.name, variant);

  let cached: { geo: CabGeometry; imgs: Map<number, Uint8Array> } | null = null;
  if (pak.decodeVersion === DECODE_VERSION && pak.has('CABJ')) {
    try {
      cached = {
        geo: JSON.parse(strFromU8(pak.chunk('CABJ'))) as CabGeometry,
        imgs: decodeImgs(pak.chunk('IMGS')),
      };
    } catch (e) {
      console.warn('[library] cached cabinet unreadable, re-decoding', e);
    }
  }
  const stamp = readMeta(pak);
  const plan = loadPlan({
    decodeVersion: pak.decodeVersion,
    current: DECODE_VERSION,
    hasCab: pak.has('CABJ'),
    cabReadable: cached !== null,
    srcsReadable: true,
    cabVariant: stamp?.variant ?? null,
    variant: game.variant,
    variantCount: game.variants.length,
    cabLayout: stamp?.layout ?? null,
    layout: game.layoutName?.toLowerCase() ?? null,
  });

  if (plan === 'fast' && cached && storedMeta && storedMeta.system === game.system) {
    try {
      setPhase('rehydrate');
      assembleCabinet(cached.geo, cached.imgs);
      const bitmaps = await Promise.all(
        [...cached.imgs].map(async ([assetId, png]): Promise<[number, ImageBitmap]> => [
          assetId,
          await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' })),
        ]),
      );
      post({ id, kind: 'cabinet', geo: cached.geo, bitmaps }, bitmaps.map(([, b]) => b));
      const roms = missingProgramRoms(game);
      const sound = missingSoundRoms(game);
      const damaged = damagedRoms(game);
      const linked = linkedInstances(game);
      const stamped = storedMeta.contentHash !== undefined
        && storedMeta.contentRule === CONTENT_RULE;
      const batteries = batteriesOf(files, spares);
      const bumped: GameMeta = {
        ...storedMeta,
        schema: SCHEMA_VERSION,
        ...(req.play === false ? {} : {
          lastPlayedAt: Date.now(),
          playedAt: Date.now(),
          playCount: playCountOf(storedMeta) + 1,
        }),
        variant: game.variant,
        variants: game.variants,
        missingRoms: roms.length ? roms : undefined,
        missingSound: sound.length ? sound : undefined,
        damagedRoms: damaged.length ? damaged : undefined,
        linkedInstances: linked.length ? linked : undefined,
        contentHash: stamped ? storedMeta.contentHash : await contentHashOf(files),
        contentRule: CONTENT_RULE,
        programHash: storedMeta.programHash ?? await programHashOf(files) ?? undefined,
        batteries: batteries.length ? batteries : undefined,
      };
      await putMeta(bumped);
      post({ id, kind: 'done', meta: bumped });
      return;
    } catch (e) {
      console.warn('[library] rehydrate failed, re-decoding', e);
    }
  }

  setPhase('decoding');
  if (game.layout) post({ id, kind: 'progress', stage: 'decoding' });
  const { cab, props } = await decodeLayout(game);
  await postCabinet(id, cab);

  setPhase('caching');
  const meta = await persistGame(hash, game, cab, (stage) => {
    setPhase(stage);
    post({ id, kind: 'progress', stage });
  }, undefined, props, req.play !== false, spares);
  post({ id, kind: 'cached', hash, meta });
  console.log(storedMeta?.cabinetDeferred && pak.decodeVersion === DECODE_VERSION
    ? `[library] built the cabinet cache for ${game.name} on its first open`
    : `[library] refreshed ${game.name} to decode v${DECODE_VERSION}`);
}

function errorCode(e: unknown): ImportErrorCode | undefined {
  if (e instanceof CodedError) return e.code;
  if (isQuotaError(e)) return 'quota';
  if (e instanceof Error && /multiple games/.test(e.message)) return 'multiple-games';
  return undefined;
}

async function handle(req: ImportRequest): Promise<void> {
  let phase = 'start';
  const setPhase = (p: string): void => { phase = p; };
  try {
    if (req.op === 'importUpload') {
      await importUpload(req, setPhase);
    } else if (req.op === 'openPak') {
      await openPak(req, setPhase);
    } else if (req.op === 'importPunnet') {
      setPhase('read');
      let meta: GameMeta;
      try {
        meta = await importPunnet(req.bytes, req.fallbackName, (stage) => {
          setPhase(stage);
          post({ id: req.id, kind: 'progress', stage });
        });
      } catch (e) {
        if (e instanceof PakError) throw new CodedError(e.message, 'corrupt-punnet');
        throw e;
      }
      post({ id: req.id, kind: 'cached', hash: meta.hash, meta });
    } else {
      throw new Error(`unknown import op ${(req as { op: string }).op}`);
    }
  } catch (e) {
    post({
      id: req.id,
      kind: 'error',
      phase,
      code: errorCode(e),
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

let chain: Promise<void> = Promise.resolve();
self.addEventListener('message', (ev) => {
  const req = (ev as MessageEvent<ImportRequest>).data;
  chain = chain.then(() => handle(req));
});
