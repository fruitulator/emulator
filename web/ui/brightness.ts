import { rowIcon } from './icons';
import { str } from '../i18n';

export const BRIGHT_NEUTRAL = 100;
const BRIGHT_MIN = 40;
const BRIGHT_MAX = 160;

const SUN =
  '<circle cx="12" cy="12" r="4"/>' +
  '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';

export interface BrightnessControl {
  button: HTMLButtonElement;
  slider: HTMLInputElement;
  readonly pct: number;
  refresh(): void;
}

export function brightnessControl(o: {
  key: string; apply: (pct: number) => void; slider?: HTMLInputElement;
}): BrightnessControl {
  const slider = o.slider ?? document.createElement('input');
  if (!o.slider) {
    slider.type = 'range';
    slider.setAttribute('aria-label', str('main.brightness'));
  }
  slider.min = String(BRIGHT_MIN);
  slider.max = String(BRIGHT_MAX);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-bright';
  button.append(rowIcon(SUN).firstElementChild!);

  const apply = (): void => {
    const pct = +slider.value;
    o.apply(pct);
    const neutral = pct === BRIGHT_NEUTRAL;
    button.classList.toggle('off-neutral', !neutral);
    button.disabled = neutral;
    button.setAttribute('aria-label', neutral ? str('main.brightness') : str('main.reset_brightness'));
    button.title = neutral ? str('main.brightness_n', { 0: pct }) : str('main.brightness_n_press_to_reset', { 0: pct });
  };
  const save = (): void => {
    try { localStorage.setItem(o.key, slider.value); } catch {  }
  };
  slider.addEventListener('input', () => { apply(); save(); });
  button.addEventListener('click', () => {
    slider.value = String(BRIGHT_NEUTRAL);
    apply();
    save();
  });

  slider.value = String(BRIGHT_NEUTRAL);
  try {
    const v = Number(localStorage.getItem(o.key) ?? NaN);
    if (Number.isFinite(v) && v >= BRIGHT_MIN && v <= BRIGHT_MAX) slider.value = String(v);
  } catch {  }
  apply();

  return {
    button, slider,
    get pct() { return +slider.value; },
    refresh: apply,
  };
}
