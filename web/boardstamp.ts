declare const __BOARD_STAMPS__: Record<string, string> | undefined;

export const NO_STAMP = 'unknown';

export function boardStamp(system: string | undefined | null): string {
  if (!system) return NO_STAMP;
  const table = typeof __BOARD_STAMPS__ === 'object' && __BOARD_STAMPS__ ? __BOARD_STAMPS__ : null;
  return table?.[system.toUpperCase()] ?? NO_STAMP;
}
