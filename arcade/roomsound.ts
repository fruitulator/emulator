import { showSpeaker, speakerButton } from '../web/ui/speaker';
import type { Live } from './live';
import { str } from '../web/i18n';

const SOUND_KEY = 'fruitulator.arcade.sound';
const VOLUME_KEY = 'fruitulator.arcade.volume';

export interface SoundView {
  button: HTMLButtonElement;
  slider: HTMLInputElement;
}

export class RoomSound {
  on = true;
  volume = 80;
  private readonly views: SoundView[] = [];

  constructor(private readonly live: Live) {
    try {
      if (localStorage.getItem(SOUND_KEY) === 'off') this.on = false;
      const v = Number(localStorage.getItem(VOLUME_KEY) ?? NaN);
      if (Number.isFinite(v) && v >= 0 && v <= 100) this.volume = v;
    } catch {  }
    live.soundOn = this.on;
    live.audio.setVolume(this.volume / 100);
  }

  view(): SoundView {
    const button = speakerButton();
    button.classList.add('ui-speaker');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.setAttribute('aria-label', str('arcade.roomsound.volume'));
    button.addEventListener('click', () => this.set(!this.on));
    slider.addEventListener('input', () => this.setVolume(Number(slider.value)));
    const v = { button, slider };
    this.views.push(v);
    this.sync();
    return v;
  }

  set(on: boolean): void {
    this.on = on;
    this.live.setSound(on);
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch {  }
    this.sync();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.live.audio.setVolume(v / 100);
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch {  }
    this.sync();
  }

  private sync(): void {
    for (const v of this.views) {
      showSpeaker(v.button, this.on);
      v.slider.value = String(this.volume);
    }
  }
}
