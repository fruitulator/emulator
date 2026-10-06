
interface KeySpec {
  code?: string;
  key?: string;
}

function keySpec(vk: number): KeySpec | null {
  if (vk >= 0x41 && vk <= 0x5a) return { key: String.fromCharCode(vk) };
  if (vk >= 0x30 && vk <= 0x39) return { code: `Digit${vk - 0x30}` };
  if (vk >= 0x60 && vk <= 0x69) return { code: `Numpad${vk - 0x60}` };
  const named: Record<number, KeySpec> = {
    0x08: { key: 'Backspace' },
    0x09: { key: 'Tab' },
    0x0d: { key: 'Enter' },
    0x20: { code: 'Space' },
    0x25: { key: 'ArrowLeft' },
    0x26: { key: 'ArrowUp' },
    0x27: { key: 'ArrowRight' },
    0x28: { key: 'ArrowDown' },
    0x6a: { code: 'NumpadMultiply' },
    0x6b: { code: 'NumpadAdd' },
    0x6d: { code: 'NumpadSubtract' },
    0x6e: { code: 'NumpadDecimal' },
    0x6f: { code: 'NumpadDivide' },
    0xba: { code: 'Semicolon', key: ';' },
    0xbb: { code: 'Equal', key: '=' },
    0xbc: { code: 'Comma', key: ',' },
    0xbd: { code: 'Minus', key: '-' },
    0xbe: { code: 'Period', key: '.' },
    0xbf: { code: 'Slash', key: '/' },
    0xc0: { code: 'Quote', key: '\'' },
    0xdb: { code: 'BracketLeft', key: '[' },
    0xdc: { code: 'Backslash', key: '\\' },
    0xdd: { code: 'BracketRight', key: ']' },
    0xde: { code: 'Backslash', key: '#' },
    0xdf: { code: 'Backquote', key: '`' },
    0xe2: { code: 'IntlBackslash', key: '\\' },
  };
  return named[vk] ?? null;
}

export function matchesShortcut(vk: number, ev: KeyboardEvent): boolean {
  const spec = keySpec(vk);
  if (!spec) return false;
  if (spec.code && ev.code === spec.code) return true;
  if (spec.key && ev.key.toUpperCase() === spec.key.toUpperCase()) return true;
  return false;
}

export function shortcutLabel(vk: number): string {
  const spec = keySpec(vk);
  if (!spec) return '';
  if (vk === 0x20) return 'SPACE';
  if (vk >= 0x30 && vk <= 0x39) return String(vk - 0x30);
  if (vk >= 0x60 && vk <= 0x69) return `NUM ${vk - 0x60}`;
  const printed: Record<number, string> = {
    0x08: '⌫', 0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓',
    0x6a: 'NUM *', 0x6b: 'NUM +', 0x6d: 'NUM -', 0x6e: 'NUM .', 0x6f: 'NUM /',
  };
  if (printed[vk]) return printed[vk];
  return (spec.key ?? spec.code ?? '').toUpperCase();
}

export function shortcutKnown(vk: number): boolean {
  return keySpec(vk) !== null;
}

export function keyBelongsToTheMachine(
  ev: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  bound: Iterable<number>,
): boolean {
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return false;
  if (ev.code === 'Space') return true;
  for (const vk of bound) if (matchesShortcut(vk, ev as KeyboardEvent)) return true;
  return false;
}

const ACTIVATED_BY_KEY = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file']);

export function browserActivatesOnKey(el: HTMLInputElement): boolean {
  return ACTIVATED_BY_KEY.has(el.type);
}

export function enterWorksTheControl(
  ev: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return ev.key === 'Enter' && !ev.altKey && !ev.ctrlKey && !ev.metaKey;
}

export const APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export type Modifier = 'alt' | 'mod';

export function chordCaps(mods: readonly Modifier[], key: string, apple = APPLE): string[] {
  if (apple) {
    const glyphs = (['alt', 'mod'] as const).filter((m) => mods.includes(m)).map((m) => (m === 'alt' ? '⌥' : '⌘'));
    return [glyphs.join('') + (key === 'Esc' ? 'esc' : key)];
  }
  return [...mods.map((m) => (m === 'alt' ? 'Alt' : 'Ctrl')), key];
}

export function chordText(mods: readonly Modifier[], key: string, apple = APPLE): string {
  return chordCaps(mods, key, apple).join(apple ? '' : '+');
}

export function primaryModifier(ev: KeyboardEvent, apple = APPLE): boolean {
  return apple ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
}
