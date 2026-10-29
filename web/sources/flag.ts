export const ADD_FLAG = 'addsource';

const SLOT = 'fruitulator:addsource';

let on: boolean | null = null;

export function addEnabled(): boolean {
  if (on !== null) return on;
  on = false;
  try {
    const v = new URLSearchParams(location.search).get(ADD_FLAG);
    if (v === '1') localStorage.setItem(SLOT, '1');
    else if (v === '0') localStorage.removeItem(SLOT);
    on = localStorage.getItem(SLOT) === '1';
  } catch {
    on = new URLSearchParams(location.search).get(ADD_FLAG) === '1';
  }
  return on;
}
