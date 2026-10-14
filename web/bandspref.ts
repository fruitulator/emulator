import { onOffPref } from './onoffpref';

const pref = onOffPref('fruitulator.reelBands', false);

export const REEL_BANDS_STORE = pref.key;
export const storedReelBandsOn = pref.stored;
export const reelBandsOn = pref.on;
export const setReelBandsOn = pref.set;
export const reloadReelBandsPref = pref.reload;
