
export const CONFIG_FILE = /\.gam$/i;

export const STATE_FILE = /\.(ram|eep|e2p|rtc|wsp)$/i;

export const STATE_ONLY = /\.(gam|ram|eep|e2p|rtc|wsp)$/i;

export function isContentFile(name: string): boolean {
  return !STATE_ONLY.test(name);
}

export function contentFiles<T extends { name: string }>(files: T[]): T[] {
  return files.filter((f) => isContentFile(f.name));
}

export const EXTRA_FILE =
  /\.(jpe?g|png|bmp|gif|webp|tiff?|pspimage|wav|mp3|mp4|m4v|avi|mkv|mov|wmv|webm|mpe?g|flv|pdf|nfo|db|ttf|bak|zip|txt|md|rtf|docx?|html?|url)$/i;

export function isSetFile(name: string): boolean {
  return !EXTRA_FILE.test(name);
}

export function setFiles<T extends { name: string }>(files: T[]): T[] {
  return files.filter((f) => isSetFile(f.name));
}

export const LAYOUT_FILE = /\.(fml|dat)$/i;

export function hasGameFile(files: readonly { name: string }[]): boolean {
  return files.some((f) => CONFIG_FILE.test(f.name) || LAYOUT_FILE.test(f.name));
}

export const NO_GAME_FILE =
  'ROMs only, no game file: there is no .gam or layout here, so nothing says which machine these ROMs are for';
