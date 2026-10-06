import { rowIcon } from './icons';
import { str } from '../i18n';

const SPEAKER_BODY = '<path d="M11 5 6 9H3v6h3l5 4z"/>';
const SPEAKER_ON =
  `${SPEAKER_BODY}<path d="M15.5 8.7a4.5 4.5 0 0 1 0 6.6"/><path d="M18.4 5.8a8.5 8.5 0 0 1 0 12.4"/>`;
const SPEAKER_OFF = `${SPEAKER_BODY}<path d="M15.5 8.7a4.5 4.5 0 0 1 0 6.6"/><path d="m3 3 18 18"/>`;

export function speakerButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.append(rowIcon(SPEAKER_OFF).firstElementChild!);
  return b;
}

export function showSpeaker(b: HTMLButtonElement, on: boolean): void {
  b.querySelector('svg')!.innerHTML = on ? SPEAKER_ON : SPEAKER_OFF;
  b.setAttribute('aria-pressed', String(on));
  const action = on ? str('ui.speaker.turn_sound_off') : str('ui.speaker.turn_sound_on');
  b.setAttribute('aria-label', action);
  b.title = action;
}
