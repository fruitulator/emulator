import { onFloor, type ArcadeDoc, type DocMachine } from './doc';
import { uploadToLibrary, type UploadResult } from './upload';
import { listGames, type GameMeta } from '../web/store';
import { displayTitle } from '../web/gamelist';
import { parseTitle } from '../web/title';
import { closeSheet, escapeCloses, sheetLine, sheetRow, showSheet } from '../web/ui/sheet';
import { statusIcon, type Mark } from '../web/ui/status';
import { rowIcon, UI_ICONS } from '../web/ui/icons';
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
  onLanded?: (games: GameMeta[]) => void; onGo?: (ids: string[]) => void;
  returnTo?: HTMLElement;
} = {}): Promise<void> {
  const { onLanded, onGo } = o;
  const games = gamesOf(onFloor(doc));
  let lib: Holdings = holdingsOf([]);
  let byContent = new Map<string, GameMeta>();
  const readHeld = async (): Promise<void> => {
    const library = await listGames().catch(() => [] as GameMeta[]);
    lib = holdingsOf(library);
    byContent = new Map();
    for (const g of library) if (g.contentHash && !byContent.has(g.contentHash)) byContent.set(g.contentHash, g);
  };
  await readHeld();

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.setAttribute('aria-hidden', 'true');

  let addSub = '';
  let running = false;
  let problems: { name: string; reason: string }[] = [];
  const returnTo = o.returnTo ?? (document.activeElement as HTMLElement | null) ?? document.body;

  const draw = (): void => {
    const missing = countHolding(games, lib, 'none');
    const other = countHolding(games, lib, 'other');
    const lines: HTMLElement[] = [];
    const said = !games.length ? str('arcade.machinelist.this_arcade_has_no_machines')
      : missing || other ? '' : str('arcade.machinelist.you_have_every_game_here');
    if (said) lines.push(sheetLine(said, '', { quiet: true }));
    for (const { machines, shown } of games) {
      const s = machineStatus(shown, holding(shown, lib));
      const sub = machines.length > 1 ? `${s.label} · ${str('arcade.landing.n_machines', { n: machines.length })}` : s.label;
      const icon = statusIcon(s.mark, s.label);
      const name = machineTitle(shown.name, byContent.get(shown.contentHash) ?? null);
      const note = shown.name;
      if (!onGo) { lines.push(sheetLine(name, sub, { icon, note })); continue; }
      const ids = machines.filter((m) => m.status === 'installed' && !m.outOfService).map((m) => m.id);
      const row = sheetRow(name, sub, { disabled: !ids.length, icon, note });
      row.addEventListener('click', () => { closeSheet(); onGo(ids); });
      lines.push(row);
    }
    for (const p of problems) lines.push(sheetLine(p.name, p.reason, { quiet: true }));
    const add = sheetRow(str('arcade.machinelist.add_games_from_a_punnet'), addSub, { disabled: running, icon: rowIcon(UI_ICONS.plus, 'row-icon', 18) });
    add.addEventListener('click', () => input.click());
    lines.push(input);
    showSheet(doc.name || str('arcade.machinelist.machines_in_this_arcade'), lines, returnTo, { foot: [add] });
  };

  const run = async (files: File[]): Promise<void> => {
    if (running || !files.length) return;
    running = true;
    problems = [];
    addSub = str('arcade.machinelist.importing');
    draw();
    const before = games.filter((g) => holding(g.shown, lib) === 'held').length;
    let result: UploadResult;
    try {
      result = await uploadToLibrary(files, (text) => {
        addSub = text;
        const sub = document.querySelector('#sheet-foot .sheet-sub');
        if (sub) sub.textContent = text;
      });
    } catch (e) {
      result = { games: [], empty: false, problems: [{ name: files.length === 1 ? files[0].name : `${files.length} files`,
        reason: (e as Error).message || str('arcade.machinelist.the_import_failed') }] };
    }
    await readHeld();
    if (result.games.length) onLanded?.(result.games);
    running = false;
    const lit = games.filter((g) => holding(g.shown, lib) === 'held').length - before;
    addSub = result.empty ? str('arcade.machinelist.nothing_in_that_looked_like')
      : lit > 0 ? str('arcade.machinelist.n_games_can_now_be', { n: lit })
      : result.games.length ? str('arcade.machinelist.added_to_your_library_but')
      : '';
    problems = result.problems;
    draw();
  };
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void run(files);
  });

  draw();
  escapeCloses();
}
