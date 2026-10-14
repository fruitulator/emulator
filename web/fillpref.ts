import { onOffPref } from './onoffpref';

const pref = onOffPref('fruitulator.fillScreen', false);

export const FILL_SCREEN_STORE = pref.key;
export const fillScreenOn = pref.on;
export const setFillScreenOn = pref.set;
export const reloadFillScreenPref = pref.reload;
