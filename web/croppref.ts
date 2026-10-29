import { onOffPref } from './onoffpref';

const pref = onOffPref('fruitulator.cropView', false);

export const CROP_VIEW_STORE = pref.key;
export const cropViewOn = pref.on;
export const setCropViewOn = pref.set;
export const reloadCropViewPref = pref.reload;
