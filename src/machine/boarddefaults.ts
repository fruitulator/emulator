export type BoardDefaultAxis =
  | 'manifest' | 'key' | 'coin' | 'token' | 'meter' | 'hopper' | 'peripheral' | 'reel' | 'button';

export type UnbuiltPart =
  | 'payout unit'
  | 'sound board'
  | 'security chip'
  | 'lamp extender'
  | 'reel drive'
  | 'reel controller'
  | 'seven-segment driver'
  | 'program decoder'
  | 'video palette'
  | 'percentage key';

export interface BoardDefault {
  axis: BoardDefaultAxis;
  text: string;
  ifWrong: string;
  node?: string;
  unbuilt?: UnbuiltPart;
}

export interface HasBoardDefaults {
  boardDefaults?: BoardDefault[];
  boardDefaultsStated?: BoardDefaultAxis[];
}

export function markStatedBySet(m: object, axis: BoardDefaultAxis): void {
  const host = m as HasBoardDefaults;
  (host.boardDefaultsStated ?? (host.boardDefaultsStated = [])).push(axis);
}

export function noteBoardDefault(m: object, d: BoardDefault): void {
  const host = m as HasBoardDefaults;
  if (host.boardDefaultsStated?.includes(d.axis)) return;
  const list = host.boardDefaults ?? (host.boardDefaults = []);
  if (!list.some((x) => x.axis === d.axis && x.text === d.text)) list.push(d);
}

export function boardDefaultsOf(m: object): readonly BoardDefault[] {
  return (m as HasBoardDefaults).boardDefaults ?? [];
}

export function unbuiltParts(
  list: readonly { unbuilt?: string }[],
): string[] {
  const out: string[] = [];
  for (const d of list) if (d.unbuilt && !out.includes(d.unbuilt)) out.push(d.unbuilt);
  return out;
}

export function noteRomCut(m: object, imageBytes: number, windowBytes: number): void {
  if (imageBytes <= windowBytes) return;
  const kb = (n: number): string => `${Math.round(n / 1024)} KB`;
  noteBoardDefault(m, {
    axis: 'manifest',
    text: `program image ${kb(imageBytes)} exceeds the ${kb(windowBytes)} window - the rest is cut`,
    ifWrong: 'The machine runs a truncated program and may fail in ways that look like a hardware fault.',
    node: 'rom',
  });
}
