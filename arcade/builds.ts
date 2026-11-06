import type { GameVariant } from '../src/machine/registry';
import type { GameMeta } from '../web/store';
import type { DocMachine } from './doc';

type Record_ = Pick<GameMeta, 'variants' | 'variant'>;
type Built = Pick<DocMachine, 'build' | 'gameConfig'>;

export function buildsOf(g: Pick<GameMeta, 'variants'> | null | undefined): GameVariant[] {
  const list = g?.variants ?? [];
  return list.length > 1 ? list : [];
}

export function libraryBuild(g: Record_): GameVariant | undefined {
  return g.variants.find((v) => v.id === g.variant) ?? g.variants[0];
}

export function machineBuildId(m: Built): string | undefined {
  return m.build?.id ?? m.gameConfig?.source;
}

export function buildToAdd(g: Record_, copies: readonly Built[]): GameVariant | null {
  const builds = buildsOf(g);
  if (!builds.length) return null;
  const here = new Set(copies.map(machineBuildId));
  const own = libraryBuild(g);
  if (own && !here.has(own.id)) return own;
  return builds.find((v) => !here.has(v.id)) ?? null;
}

export function buildsHere(g: Record_, copies: readonly Built[]): number {
  const here = new Set(copies.map(machineBuildId));
  return buildsOf(g).filter((v) => here.has(v.id)).length;
}

export function labelledBuild(m: Built, g: Pick<GameMeta, 'variants'>): GameVariant | undefined {
  const id = machineBuildId(m);
  return id === undefined ? undefined : buildsOf(g).find((v) => v.id === id);
}

export function buildName(name: string, build: GameVariant | undefined): string {
  return build ? `${name} · ${build.label}` : name;
}
