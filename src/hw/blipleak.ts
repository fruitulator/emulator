
export const V20_BUFFER_RATE = 48_000;
export const BASE_BOARD_BASS_FREQ = 1;
export const SRU_BASS_FREQ = 300;

export function blipBassShift(bassFreq: number, rate: number): number {
  if (bassFreq <= 0) return 31;
  let shift = 13;
  let f = Math.floor((bassFreq * 65536) / rate);
  while ((f >>= 1) && --shift);
  return shift;
}
export function blipPole(bassFreq: number, rate: number): number {
  return 1 - 2 ** -blipBassShift(bassFreq, rate);
}
export function blipHighPassPole(bassFreq: number, rate: number): number {
  const samples = (2 ** blipBassShift(bassFreq, V20_BUFFER_RATE) * rate) / V20_BUFFER_RATE;
  return 1 - 1 / samples;
}
