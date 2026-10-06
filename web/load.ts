import { Sc4 } from '../src/machine/sc4';
import { classifyGame, machineFor, type Game, type GameFile } from '../src/machine/registry';

export type { Game, GameFile };

export function classify(files: GameFile[], variant?: string): Game {
  return classifyGame(files, undefined, variant);
}

export function machineFrom(game: Game): Sc4 {
  const m = machineFor(game);
  if (!(m instanceof Sc4)) {
    throw new Error(`expected a Scorpion 4 game, got ${game.system}`);
  }
  return m;
}
