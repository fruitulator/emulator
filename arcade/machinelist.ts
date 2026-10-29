import { onFloor, type ArcadeDoc, type DocMachine } from './doc';
import { listGames, type GameMeta } from '../web/store';
import { displayTitle } from '../web/gamelist';
import { parseTitle } from '../web/title';
import { closeSheet, escapeCloses, sheetLine, sheetRow, showSheet } from '../web/ui/sheet';
import { statusIcon, type Mark } from '../web/ui/status';
import { str } from '../web/i18n';

export function machineTitle(name: string, held: GameMeta | null): string {
  return held ? displayTitle(held) : parseTitle(name).title || name;
}

export interface Holdings { content: ReadonlySet<string>; program: ReadonlySet<string> }

export function holdingsOf(library: readonly Pick<GameMeta, 'contentHash' | 'programHash'>[]): Holdings {
  const content = new Set<string>();
  const program = new Set<string>();
  for (const g of library) {
    if (g.contentHash) content.add(g.contentHash);
    if (g.programHash) program.add(g.programHash);
  }
  return { content, program };
}

export type Holding = 'held' | 'other' | 'none';

export function holding(m: Pick<DocMachine, 'contentHash' | 'programHash'>, lib: Holdings): Holding {
  if (lib.content.has(m.contentHash)) return 'held';
  return m.programHash && lib.program.has(m.programHash) ? 'other' : 'none';
}

export function machineStatus(m: Pick<DocMachine, 'status' | 'outOfService'>, held: Holding): { mark: Mark; label: string } {
  if (m.status !== 'installed') return { mark: 'pending', label: str('arcade.machinelist.not_set_up_yet') };
  if (m.outOfService) return { mark: 'pending', label: str('arcade.machinelist.out_of_service') };
  if (held === 'held') return { mark: 'pass', label: str('arcade.machinelist.in_your_library') };
  if (held === 'other') return { mark: 'warn', label: str('arcade.machinelist.different_version') };
  return { mark: 'warn', label: str('arcade.machinelist.not_in_your_library') };
}

type Listed = Pick<DocMachine, 'status' | 'outOfService' | 'contentHash' | 'programHash' | 'name'>;

export interface ListedGame<M extends Listed = Listed> { machines: M[]; shown: M }

export function gamesOf<M extends Listed>(machines: readonly M[]): ListedGame<M>[] {
  const by = new Map<string, M[]>();
  for (const m of machines) by.set(m.contentHash, [...(by.get(m.contentHash) ?? []), m]);
  return [...by.values()].map((ms) => ({
    machines: ms,
    shown: ms.find((m) => m.status === 'installed' && !m.outOfService) ?? ms.find((m) => m.status === 'installed') ?? ms[0],
  }));
}

export function countHolding(games: readonly ListedGame[], lib: Holdings, as: Holding): number {
  return games.filter(({ shown: m }) => m.status === 'installed' && !m.outOfService && holding(m, lib) === as).length;
}

export async function openMachineList(doc: ArcadeDoc, o: {
  onGo?: (ids: string[]) => void;
  returnTo?: HTMLElement;
} = {}): Promise<void> {
  const { onGo } = o;
  const games = gamesOf(onFloor(doc));
  const library = await listGames().catch(() => [] as GameMeta[]);
  const lib = holdingsOf(library);
  const byContent = new Map<string, GameMeta>();
  for (const g of library) if (g.contentHash && !byContent.has(g.contentHash)) byContent.set(g.contentHash, g);
  const returnTo = o.returnTo ?? (document.activeElement as HTMLElement | null) ?? document.body;

  const draw = (): void => {
    const missing = countHolding(games, lib, 'none');
    const other = countHolding(games, lib, 'other');
    const lines: HTMLElement[] = [];
    const said = !games.length ? str('arcade.machinelist.this_arcade_has_no_machines')
      : missing || other ? '' : str('arcade.machinelist.you_have_every_game_here');
    if (said) lines.push(sheetLine(said, '', { quiet: true }));
    const titled = games.map((g) => ({ ...g, name: machineTitle(g.shown.name, byContent.get(g.shown.contentHash) ?? null) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const { machines, shown, name } of titled) {
      const s = machineStatus(shown, holding(shown, lib));
      const sub = machines.length > 1 ? `${s.label} · ${str('arcade.landing.n_machines', { n: machines.length })}` : s.label;
      const icon = statusIcon(s.mark, s.label);
      const note = shown.name;
      if (!onGo) { lines.push(sheetLine(name, sub, { icon, note })); continue; }
      const ids = machines.filter((m) => m.status === 'installed' && !m.outOfService).map((m) => m.id);
      const row = sheetRow(name, sub, { disabled: !ids.length, icon, note });
      row.addEventListener('click', () => { closeSheet(); onGo(ids); });
      lines.push(row);
    }
    showSheet(doc.name || str('arcade.machinelist.machines_in_this_arcade'), lines, returnTo);
  };

  draw();
  escapeCloses();
}
