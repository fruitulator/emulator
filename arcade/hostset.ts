import { classifyGame, configOf, type Game, type GameFile } from '../src/machine/registry';
import { CONFIG_FILE } from '../src/machine/setfiles';
import { decodePak, decodeSrcs } from '../web/gamepak';
import { fingerprints } from '../web/hostfiles';
import { byContentKey, contentIdentityOf, getPak, type GameMeta } from '../web/store';
import { readCoinWiring } from '../web/coinask';
import { wiringFor } from './coinwiring';
import type { ArcadeDoc, DocMachine } from './doc';

type Definition = Pick<DocMachine, 'hostFiles' | 'versions' | 'gameConfig'>;

export function filesOfGame(game: Game): GameFile[] {
  return [...(game.setFiles ?? game.files), ...(game.effectFiles ?? [])];
}

export async function definitionOf(game: Game, files: readonly GameFile[] = filesOfGame(game)): Promise<Definition> {
  return { hostFiles: await fingerprints(files), versions: Math.max(1, game.variants.length), gameConfig: configOf(game) };
}

export function keepCoinAnswers(m: DocMachine, answers: unknown): boolean {
  if (Object.keys(readCoinWiring(m.config?.coins)).length) return false;
  const w = wiringFor(undefined, answers, null);
  if (!Object.keys(w).length) return false;
  m.config = { ...(m.config ?? {}), coins: w };
  return true;
}

async function hostsCopy(m: DocMachine, library: GameMeta[]): Promise<{ g: GameMeta; files: GameFile[] } | null> {
  const by = byContentKey(library);
  const candidates = [
    ...[m.contentHash, ...(m.formerContentHashes ?? [])].map((k) => by.get(k)),
    m.hash ? library.find((g) => g.hash === m.hash) : undefined,
  ].filter((g, i, all): g is GameMeta => !!g && all.indexOf(g) === i);
  for (const g of candidates) {
    try {
      const bytes = await getPak(g.hash);
      if (!bytes) continue;
      const pak = decodePak(bytes);
      const files = [...decodeSrcs(pak.chunk('SRCS')), ...(pak.has('SPAR') ? decodeSrcs(pak.chunk('SPAR')) : [])];
      const id = await contentIdentityOf(files);
      const keys = new Set([m.contentHash, ...(m.formerContentHashes ?? [])]);
      if ([id.contentHash, ...id.formerContentHashes].some((k) => keys.has(k))) return { g, files };
    } catch (e) {
      console.warn('[arcade] a library record could not be read for its machine', e);
    }
  }
  return null;
}

export async function defineMachines(doc: ArcadeDoc, library: GameMeta[]): Promise<boolean> {
  let changed = false;
  for (const m of doc.machines) {
    if (m.status !== 'installed' || m.hostFiles?.length) continue;
    const copy = await hostsCopy(m, library);
    if (!copy) {
      console.info(`[arcade] ${m.name}: not in this library, so it stays switched off`);
      continue;
    }
    const { g, files } = copy;
    try {
      const variant = m.gameConfig?.source ?? g.variant;
      const hasGam = files.some((f) => CONFIG_FILE.test(f.name));
      const game = classifyGame(files, hasGam ? undefined : g.name, variant || undefined);
      const def = await definitionOf(game, files);
      m.hostFiles = def.hostFiles;
      m.versions = def.versions;
      if (m.gameConfig === undefined) m.gameConfig = def.gameConfig;
      keepCoinAnswers(m, g.coinAnswers);
      changed = true;
      console.info(`[arcade] ${m.name}: switched on, as the host's copy of its set`);
    } catch (e) {
      console.warn(`[arcade] ${m.name}: could not be switched on`, e);
    }
  }
  return changed;
}
