import { str } from '../i18n';
export const LOGO_SRC = '/icons/fruitulator-cherries.svg?v=1';

export function makeLogo(className = 'logo-img'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.src = LOGO_SRC;
  img.alt = str('ui.logo.fruitulator');
  return img;
}
