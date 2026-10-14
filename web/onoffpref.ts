
export interface OnOffPref {
  readonly key: string;
  on(): boolean;
  set(next: boolean): void;
  stored(): boolean;
  reload(): void;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function onOffPref(key: string, byDefault: boolean): OnOffPref {
  const stored = (): boolean => {
    try {
      const v = store()?.getItem(key);
      return byDefault ? v !== 'off' : v === 'on';
    } catch {
      return byDefault;
    }
  };
  let value = stored();
  return {
    key,
    on: () => value,
    set(next: boolean): void {
      value = next;
      try {
        store()?.setItem(key, next ? 'on' : 'off');
      } catch {
      }
    },
    stored,
    reload(): void {
      value = stored();
    },
  };
}
