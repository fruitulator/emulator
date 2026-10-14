import { onOffPref } from './onoffpref';

const pref = onOffPref('fruitulator.reelPeek', true);

export const REEL_PEEK_STORE = pref.key;
export const storedReelPeekOn = pref.stored;
export const reelPeekOn = pref.on;
export const setReelPeekOn = pref.set;
export const reloadReelPeekPref = pref.reload;
