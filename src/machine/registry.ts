import type { Machine } from './machine';
import { bfmAlphaRoute, v20AlphaServe } from './layoutdisplay';
import { ledgerOutMults } from './machine';
import { gamFromJson, gamToJson, parseGam, type Gam, type GamJson } from './gam';
import { parseDesKey } from '../hw/des';
import {
  ReelBounce, bounceProfileFor, kindCanBounce, type BounceWiring,
} from '../hw/reelbounce';
import { CONFIG_FILE, NO_GAME_FILE, hasGameFile } from './setfiles';
import { isEffectSample } from './effects';
import { Sc4 } from './sc4';
import { Sc2 } from './sc2';
import { isClassicLayout } from '../hw/steppedvolume';
import { Sc1 } from './sc1';
import { Sys85 } from './sys85';
import { Sys5 } from './sys5';
import {
  Mpu4, MPU4_ENCRYPTION, mpu4Descramble, mpu4RomImage, mpu4SampleBanks, type Mpu4ReelMux,
} from './mpu4';
import { isMfmeSamplePack } from '../hw/mfmesamples';
import { mpu4CharacteriserFor } from './mpu4chr';
import { BwbCharacteriser, bwbCharacterFor } from '../hw/bwbchr';
import { Impact } from './impact';
import {
  impactPercentKey, impactStakeKey, impactPrizeKey, impactKeyByte,
  impactPercentValue, IMPACT_STAKE_LABELS, IMPACT_PRIZE_LABELS,
  IMPACT_PERCENT_NOT_FITTED, IMPACT_STAKE_NOT_FITTED, IMPACT_PRIZE_NOT_FITTED,
} from '../hw/impactkeys';
import { AceSp } from './acesp';
import { Epoch } from './epoch';
import { M1ab } from './m1ab';
import { Mpu5 } from './mpu5';
import { Astra } from './astra';
import { cardIdentity } from './bcoscard';
import {
  dipByte, jackpotKeyCode, percentKeyCode, KEY_NOT_FITTED,
  stakeKeyCode,
} from '../hw/barcrestkeys';
import { picDriverScan, picTypeFromLayout } from '../hw/pic';
import { deviceFor, Sch2Hopper } from '../hw/cctalk';
import { Sc5, adder5ScreenSize } from './sc5';
import { Mps2 } from './mps2';
import { Sys80 } from './sys80';
import { Sru, SRU_TONE_POT_DEFAULT, SRU_COIN_ROW, sruCoinsFromCabinet } from './sru';
import { BlackBox } from './blackbox';
import { Mpu3, Mpu3DisplayPort } from './mpu3';
import { Mpu4VideoCard } from './mpu4video';
import { Sys1 } from './sys1';
import { Proconn, ProconnType } from './proconn';
import { Electrocoin, STANDARD_METER_GRID } from './electrocoin';
import { Phoenix } from './phoenix';
import { sys80PortMap } from '../layout/sys80ports';
import { reelGeometry, declaredReelChannels, type ReelGeometry } from './layoutreels';
import {
  V20_OPTIC_ARMS, MODEL_RELATIONS, MFME_OWN_SPACE, mameIndexForTab, oursFromMfme, parkAtV20PowerUp, type ModelRelation, type OpticFitFailure,
} from './v20optic';
import type { Reel } from '../hw/reel';
import { layoutSwitches, type LayoutSwitch } from './layoutswitches';
import { readSwitchNames } from './buttonnames';
import { bfmLedMode } from '../hw/bfmled';
import { noteBoardDefault } from './boarddefaults';
import { TAILORED_IDS } from './schematic';
import {
  fittedPeripheralsFrom, type FittedPeripherals,
  decodedLayout, fileLevelTags, readLayoutWord, readSetting, readCheckboxSetting, readCheckboxByte, meterMoneyMap,
  dipSwitchLabelsFrom,
  triacSlidePence, readSwitchNumber, readOperatorTag, readNumber, mpu4CharacteriserConfigFrom,
  mpu5ReelJumpersFrom, mpu5Mux5ExtendedFrom, layoutSwitchIdsFrom, m1abDongleConfig,
} from '../layout/fmlconfig';
import { parseLayout } from '../layout/fmlparse';
import { datReelChannels, datReelWiring } from '../layout/datreels';
import { cabinetCoinPence, cabinetCoinSlots, declaredCoins, parallelNoteChannels } from './layoutcoins';
import { placeRomPairs } from './pairplacer';

const MPU4_COIN_ROW = 5;
const SC4_COIN_ROW = 12;

function applyCabinetCoinPence(
  m: { setCoinLinePence(t: readonly (number | null | undefined)[]): void },
  layout: Uint8Array | undefined,
): void {
  const priced = cabinetCoinPence(layout);
  if (!priced) return;
  const table: (number | null | undefined)[] = [];
  for (const [line, pence] of priced) table[line] = pence;
  m.setCoinLinePence(table);
}

export interface GameFile {
  name: string;
  bytes: Uint8Array;
}

export interface GameVariant {
  id: string;
  label: string;
}

export interface LayoutProps {
  layout: string;
  reels: ReelGeometry[];
  peripherals: FittedPeripherals;
  switches?: LayoutSwitch[];
}

export interface Game {
  name: string;
  system: string;
  files: GameFile[];
  gam: Gam | null;
  layout?: Uint8Array;
  layoutName?: string;
  layoutProps?: LayoutProps;
  nvram?: Uint8Array;
  variant: string;
  variants: GameVariant[];
  effectFiles?: GameFile[];
}

function splitEffectFiles(files: GameFile[]): { files: GameFile[]; effectFiles?: GameFile[] } {
  const effectFiles = files.filter((f) => isEffectSample(f.name));
  return effectFiles.length
    ? { files: files.filter((f) => !isEffectSample(f.name)), effectFiles }
    : { files };
}

function fitReels(m: { setFittedReels(c: readonly number[]): unknown }, game: Game): void {
  const channels = declaredReelChannels(game.layout);
  m.setFittedReels(channels);
  if (!channels.length) {
    noteBoardDefault(m, {
      axis: 'reel',
      text: 'this cabinet does not say how many reels it has - the board\'s own bank is turning',
      ifWrong: 'The machine may drive reels it does not have, or draw a reel window against the wrong drum.',
      node: 'reels',
    });
  }
}

export function fitReelGeometry(
  m: { reels: readonly { stepsPerRevolution: number; symbols: number; refit?(s?: number, n?: number): void }[] },
  game: Game,
): void {
  const geometry = storedLayoutProps(game)?.reels ?? reelGeometry(game.layout);
  const standIn: number[] = [];
  for (const r of geometry) {
    const reel = m.reels[r.number];
    if (!reel?.refit) continue;
    const was = reel.stepsPerRevolution;
    reel.refit(r.halfSteps, r.stops);
    if (reel.stepsPerRevolution !== was) {
      console.log(`[reels] reel ${r.number}: the cabinet declares ${r.halfSteps} half-steps, the board default is ${was}`);
    }
    if (r.halfSteps <= 0 || r.stops <= 0) standIn.push(r.number);
  }
  if (standIn.length) {
    const reel = m.reels[standIn[0]];
    noteBoardDefault(m, {
      axis: 'reel',
      text: `reel steps or stops not stated - the board's ${reel.stepsPerRevolution} half-steps`
        + ` and ${reel.symbols} stops are turning`,
      ifWrong: 'A reel with another step count spins to the wrong stop and draws its band at the wrong scale.',
      node: TAILORED_IDS.reels,
    });
  }
  fitReelOpticTab(m, game.system, geometry);
}

function powerUpReels(m: { reels: readonly Reel[] }, relation: ModelRelation): void {
  parkAtV20PowerUp(m.reels, relation);
}

export function restoreGamReels(
  m: { reels: readonly { stepsPerRevolution: number }[]; setReelPosition(i: number, pos: number): void },
  game: Game,
  relation: ModelRelation,
  fitted?: ReadonlySet<number>,
): void {
  game.gam?.reels.forEach((r, i) => {
    if (fitted && !fitted.has(i)) return;
    if (i < m.reels.length) m.setReelPosition(i, oursFromMfme(relation, r.position, m.reels[i].stepsPerRevolution));
  });
}

export function layoutReelNumbers(game: Game): ReadonlySet<number> {
  const props = storedLayoutProps(game);
  return new Set((props?.reels ?? reelGeometry(game.layout)).map((g) => g.number));
}

export function fitReelOpticTab(
  m: { reels: readonly { stepsPerRevolution: number; symbols: number }[] },
  system: string,
  geometry: readonly ReelGeometry[],
): void {
  const arm = V20_OPTIC_ARMS[system];
  const unread = new Map<OpticFitFailure, number[]>();
  for (const g of geometry) {
    if (g.flip || g.optoTab <= 0) continue;
    const reel = m.reels[g.number] as Reel | undefined;
    if (!reel) continue;
    const fit = !arm || !reel.mameStepper || typeof reel.setIndexWindow !== 'function'
      ? { failed: 'not-a-mame-stepper' as OpticFitFailure }
      : mameIndexForTab(reel, arm, g.optoTab, MODEL_RELATIONS[system]);
    if (fit.window) {
      const [was0, was1] = reel.indexWindow;
      reel.setIndexWindow(fit.window[0], fit.window[1]);
      if (fit.window[0] !== was0 || fit.window[1] !== was1) {
        console.log(`[reels] reel ${g.number}: the cabinet puts its optic tab at OptoTab ${g.optoTab}`
          + ` - index window (${was0}, ${was1}) becomes (${fit.window[0]}, ${fit.window[1]})`);
      }
      continue;
    }
    const why = fit.failed ?? 'not-a-mame-stepper';
    unread.set(why, [...(unread.get(why) ?? []), g.number]);
  }
  for (const [why, reels] of unread) {
    noteBoardDefault(m, {
      axis: 'reel',
      text: `this cabinet places its reel optic tab (${reels.length === 1 ? 'reel' : 'reels'} `
        + `${reels.map((n) => n + 1).join(', ')}) and the board is not reading it`
        + (why === 'no-model-relation'
          ? ' - how this board\'s reel position lines up with the one the tab is quoted in is not measured yet'
          : why === 'anchor-mismatch'
            ? ' - this board\'s optic window does not fit the one its reel model tests'
            : why === 'empty-window'
              ? ' - the window it asks for holds no half-step on a reel this size'
              : why === 'no-gated-half-step'
                ? ' - the window it asks for holds no half-step at which this board\'s'
                  + ' reel coils let the optic read, so applying it would blind the reel'
                : ' - this board\'s reels do not read an optic window'),
      ifWrong: 'The reels may rest a step or two off, so a winning line can show with no win paid.',
      node: TAILORED_IDS.reels,
    });
  }
}

export function noteReelStandIns(m: object): void {
  const host = m as {
    reelStandIns?: readonly number[];
    reels?: readonly { stepsPerRevolution: number; symbols: number }[];
  };
  const channels = host.reelStandIns;
  if (!channels?.length) return;
  const reel = host.reels?.[channels[0]];
  const what = reel ? `${reel.stepsPerRevolution} half-steps and ${reel.symbols} stops` : 'its own geometry';
  noteBoardDefault(m, {
    axis: 'reel',
    text: `reel steps or stops not stated - the board's ${what} are turning`,
    ifWrong: 'A reel with another step count spins to the wrong stop and reads a faulty mechanism.',
    node: TAILORED_IDS.reels,
  });
}

type KeyLine = 'Stake' | 'Jackpot' | 'Percentage';

function noteKeysNotNamed(m: object, game: Game, lines: readonly KeyLine[]): void {
  const gam = game.gam;
  if (!gam) return;
  const missing = lines.filter((l) => {
    const raw = gam.settings.get(l)?.trim();
    return !raw || !Number.isFinite(Number(raw));
  }).map((l) => (l === 'Jackpot' ? 'prize' : l.toLowerCase()));
  if (!missing.length) return;
  const list = missing.length === 1 ? missing[0]
    : `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}`;
  noteBoardDefault(m, {
    axis: 'key',
    text: `the .gam names no ${list} key - none fitted`,
    ifWrong: 'A cabinet that needs the key alarms or will not play until one is fitted.',
  });
}

const BOARD_TOKEN_LINE = new Set(['SCORPION1', 'SCORPION2', 'SYS5', 'SYS85', 'IMPACT', 'M1AB', 'MPS2']);

function noteBoardTokenLine(m: object, game: Game): void {
  if (!BOARD_TOKEN_LINE.has(game.system.toUpperCase())) return;
  noteBoardDefault(m, {
    axis: 'token',
    text: 'which line counts TOKENS, and what one is worth, are the board\'s defaults',
    ifWrong: 'A token counted as cash makes the takings and the payout percentage both read high.',
    node: TAILORED_IDS.meters,
  });
}

function fitReelBounce(m: Machine, game: Game): void {
  const profile = bounceProfileFor(game.system);
  if (!profile) return;
  const geometry = storedLayoutProps(game)?.reels ?? reelGeometry(game.layout);
  if (!geometry.length) return;
  const wiring: (BounceWiring | undefined)[] = [];
  let any = false;
  for (const g of geometry) {
    if (g.number < 0 || g.number >= m.reels.length) continue;
    const script = g.bounce ?? 0;
    if (!script) continue;
    const kind: BounceWiring['kind'] = g.flip ? 3 : g.disc ? 1 : g.band ? 2 : 0;
    if (!kindCanBounce(kind)) {
      console.log(`[reels] reel ${g.number} asks for bounce script ${script} on a reel type MFME itself does not bounce — not drawn`);
      continue;
    }
    if (script > profile.scripts.length) {
      console.log(`[reels] reel ${g.number} asks for bounce script ${script}; this board has ${profile.scripts.length} — not drawn, as MFME does not draw it either`);
      continue;
    }
    wiring[g.number] = { kind, script };
    any = true;
  }
  if (any) m.reelBounce = new ReelBounce(profile, wiring);
}

function storedLayoutProps(game: Game): LayoutProps | undefined {
  const p = game.layoutProps;
  return p && game.layoutName && p.layout === game.layoutName.toLowerCase() ? p : undefined;
}

export interface Platform {
  system: string;
  build(game: Game): Machine;
}

function file(game: Game, name: string): GameFile | undefined {
  const lower = name.toLowerCase();
  return game.files.find((f) => f.name.toLowerCase() === lower);
}

function noRoms(game: Game, fallback: string): Error {
  const wanted = game.gam?.roms.length ? game.gam.roms.join(', ') : '';
  return new Error(wanted ? `missing ROM file(s): ${wanted}` : fallback);
}

function byExt(game: Game, re: RegExp): GameFile[] {
  return game.files.filter((f) => re.test(f.name.toLowerCase()));
}

function manifestRoms(game: Game): GameFile[] {
  return (game.gam?.roms ?? [])
    .map((n) => file(game, n))
    .filter((f): f is GameFile => !!f);
}

export function programRoms(game: Game): GameFile[] {
  const named = game.gam
    ? manifestRoms(game)
    : [];
  if (named.length) return named;
  return byExt(game, /\.(bin|hex|rom|p1|p2|p3|p4|evn|odd|hi|lo)$/)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sc4Pair(files: GameFile[]): [Uint8Array, Uint8Array] | null {
  const even = files.find((f) => /\.(evn|hi)$/i.test(f.name));
  const odd = files.find((f) => /\.(odd|lo)$/i.test(f.name));
  return even && odd ? [even.bytes, odd.bytes] : null;
}

function lineOneOddPair(game: Game): [Uint8Array, Uint8Array] | null {
  const slots = (game.gam?.roms ?? []).map((n) => file(game, n));
  const odd = slots[0];
  const even = slots[1];
  return even && odd ? [even.bytes, odd.bytes] : null;
}

function manifestImage(game: Game, size: number, swap: 0 | 1): Uint8Array | null {
  const names = game.gam?.roms ?? [];
  if (!names.length) return null;
  const slots = names.map((n) => file(game, n));
  if (slots.some((f) => !f)) return null;
  return placeRomPairs(slots.map((f) => f!.bytes), size, swap);
}

function layoutSecFitted(game: Game, system: string): boolean | null {
  const p = decodedLayout(game.layout);
  const v = p ? readSetting(p, system, 'SEC') : null;
  return v === 'Yes' ? true : v === 'No' ? false : null;
}

function noteSecInferred(m: object, how: 'fitted' | 'none' | 'watch'): void {
  if (how === 'fitted') {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'layout does not say if a meter security unit is fitted - fitted, as the game expects one',
      ifWrong: 'If the cabinet has plain meters instead, its meters may not count.',
      node: TAILORED_IDS.meters,
    });
  } else if (how === 'watch') {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'layout does not say if a meter security unit is fitted - fitted only if the game talks to one',
      ifWrong: 'If the cabinet has plain meters instead, its meters may not count.',
      node: TAILORED_IDS.meters,
    });
  } else {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'layout does not say if a meter security unit is fitted - none fitted',
      ifWrong: 'If the cabinet has one, it may stop with a meter alarm.',
      node: TAILORED_IDS.meters,
    });
  }
}

const scorpion4: Platform = {
  system: 'SCORPION4',
  build(game) {
    let progFiles: GameFile[];
    let sndFiles: GameFile[];
    if (game.gam) {
      progFiles = manifestRoms(game);
      sndFiles = game.gam.sound
        .map((n) => file(game, n))
        .filter((f): f is GameFile => !!f);
    } else {
      progFiles = byExt(game, /\.(evn|odd|hi|lo)$/).filter((f) => !f.name.startsWith('97'));
      sndFiles = [
        ...byExt(game, /\.(evn|odd)$/).filter((f) => f.name.startsWith('97')),
        ...byExt(game, /\.bin$/),
      ];
    }

    const image = manifestImage(game, 0x80000, 1);
    const prog = image ? null : sc4Pair(progFiles);
    if (!image && !prog) {
      if (!hasGameFile(game.files)) throw new Error(NO_GAME_FILE);
      if (!progFiles.length) throw noRoms(game, 'no SC4 program ROM pair (.evn/.odd or .hi/.lo)');
      throw new Error('no SC4 program ROM pair (.evn/.odd or .hi/.lo)');
    }

    const m = new Sc4();
    if (!hasGameFile(game.files)) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no .gam or layout - board taken as Scorpion 4 from the ROM file names',
        ifWrong: 'If these ROMs are for another board, the machine will not start properly.',
      });
    }
    m.volumeV9 = isClassicLayout(game.layoutName);
    const sc4Alpha = bfmAlphaRoute(game.layout);
    m.segmentedAlpha = !!sc4Alpha?.segmented;
    m.bd1.drawsHidden = sc4Alpha?.drawsHidden ?? true;
    if (image) m.loadRom(image);
    else m.loadRomPair(...prog!);

    const sndFirst = sndFiles.find((f) => /\.(evn|lo)$/i.test(f.name));
    const sndSecond = sndFiles.find((f) => /\.(odd|hi)$/i.test(f.name));
    const sndPair = sndFirst && sndSecond ? [sndFirst.bytes, sndSecond.bytes] as const : null;
    if (sndPair && sndPair[0].length <= 0x80000) {
      m.loadSoundRoms(...sndPair);
    } else if (sndFiles.length > 0) {
      const sample = new Uint8Array(0x400000);
      let o = 0;
      for (const s of sndFiles) {
        const n = Math.min(s.bytes.length, sample.length - o);
        sample.set(s.bytes.subarray(0, n), o);
        o += n;
        if (o >= sample.length) break;
      }
      m.ymz.loadRom(sample);
    }

    const sc4Setting = (name: string): number | undefined => {
      const v = Number(game.gam?.settings.get(name));
      return Number.isFinite(v) ? v : undefined;
    };
    if (!game.gam) {
      noteBoardDefault(m, {
        axis: 'key',
        text: 'keys are the board\'s: a £5 jackpot key, one percentage contact, no stake key - no .gam to read',
        ifWrong: 'Plays at the lowest stake against a £5 jackpot, whatever the cabinet was keyed for.',
      });
    }
    m.setConfigKeys({
      prize: game.gam ? sc4Setting('Jackpot') ?? null : undefined,
      percentage: game.gam ? sc4Setting('Percentage') ?? null : undefined,
      stake: sc4Setting('Stake'),
    });
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);

    const sc4Geometry = reelGeometry(game.layout);
    m.setReelGeometry(sc4Geometry);
    for (const g of sc4Geometry) {
      m.setReelOpticFlag(g.number, g.flip ? 0 : g.optoTab, !g.flip && g.invertedOpto);
    }
    for (const r of datReelWiring(game.layout)) {
      m.setReelOpticFlag(r.number, r.flag, r.inverted);
    }

    m.setFittedReels([
      ...sc4Geometry.map((r) => r.number),
      ...datReelChannels(game.layout),
    ]);

    m.setDips(dipLsbFirst(game.gam?.dips.get(1)), dipLsbFirst(game.gam?.dips.get(2)));
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (game.gam?.dips.get(1) === undefined && game.gam?.dips.get(2) === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no option-switch banks stated - all sixteen read as off',
        ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
      });
    }

    const sc4Doors = layoutSwitchIdsFrom(game.layout, 'SCORPION4');
    m.setDoorMasks(sc4Doors);
    if (sc4Doors.Cash === undefined || sc4Doors.Service === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'door switches: cash 8, service 6 - the layout states no numbers',
        ifWrong: 'The firmware sees a door open, or never sees one shut, and may refuse to play.',
      });
    }

    m.setLayoutSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: null,
      cash: null,
      refill: { fallback: 19, made: false, tag: false },
    });

    const sc4Protocol = Number(game.gam?.settings.get('Protocol') ?? 0);
    if (sc4Protocol) {
      const p = decodedLayout(game.layout);
      m.fitDataport(sc4Protocol, p ? readSetting(p, 'SCORPION4', 'Serial Port') : null);
    }

    const sc4Sec = layoutSecFitted(game, 'SCORPION4');
    if (sc4Sec !== null) {
      m.setSecDetect(false);
      if (sc4Sec) m.fitSec(game.gam?.sec ?? []);
    } else if (game.gam?.sec.length) {
      m.fitSec(game.gam.sec);
      noteSecInferred(m, 'fitted');
    } else {
      noteSecInferred(m, 'watch');
    }

    const sc4Layout = decodedLayout(game.layout);
    m.seg7.mode = bfmLedMode(sc4Layout ? readSetting(sc4Layout, 'SCORPION4', 'LEDs') : null);
    if (sc4Layout) {
      const hoppers = readCheckboxByte(sc4Layout, 'SCORPION4', 'Hopper 1');
      if (hoppers !== null) m.setHoppers(hoppers);
      const meters = meterMoneyMap(sc4Layout, 'SCORPION4');
      if (meters) {
        m.setSecMoneyMap(meters.secIn, meters.secOut);
        m.setMeterMoneyMap(meters.meterIn, meters.meterOut);
      }
    }

    if (sc4Layout) m.setCoinMech(readSetting(sc4Layout, 'SCORPION4', 'Coin Mech'));
    m.setCabinetCoinSlots(cabinetCoinSlots(game.layout, SC4_COIN_ROW));

    const nv4Fitted = sc4Layout ? readSetting(sc4Layout, 'SCORPION4', 'NV4 Note') === 'Yes' : false;
    m.fitNoteReader(nv4Fitted, parallelNoteChannels(game.layout));
    if (sc4Layout && readSetting(sc4Layout, 'SCORPION4', 'NV4 Note') === null
        && parallelNoteChannels(game.layout).size > 0) {
      noteBoardDefault(m, {
        axis: 'coin',
        text: 'note slots are drawn but this layout does not state whether a note reader is fitted - none is',
        ifWrong: 'Those slots refuse every note; the machine cannot take one.',
      });
    }
    const sc4NoteName = sc4Layout ? readSetting(sc4Layout, 'SCORPION5', 'Note Acceptor') : null;
    const sc4NoteType = sc4NoteName === null ? 1
      : ({ None: 0, 'JCM EBA': 1, VEGA: 2, NV11: 3 } as Record<string, number>)[sc4NoteName] ?? 0;
    const sc4Bnv = (game.gam?.settings.get('BNVkey') ?? '').trim();
    const sc4NoteFitted = m.fitNoteValidator(
      sc4NoteType,
      (sc4Layout ? readCheckboxSetting(sc4Layout, 'SCORPION5', 'Note Acceptor DES') : null) ?? false,
      /^\d{6}$/.test(sc4Bnv) ? [...sc4Bnv].map(Number) : null,
    );
    if (sc4NoteName === null && sc4NoteFitted) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'note acceptor: JCM EBA - the layout names none',
        ifWrong: 'Firmware written for another note acceptor may report it missing or faulty.',
        node: TAILORED_IDS.notes,
      });
    } else if (sc4NoteType > 1) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `note acceptor: ${sc4NoteName} is not modelled - none is fitted`,
        ifWrong: 'Firmware that opens its note reader raises a note reader alarm.',
        node: TAILORED_IDS.notes,
      });
    }

    const sc4Serial = [1, 2].map((n) => (sc4Layout ? readSetting(sc4Layout, 'SCORPION5', `Hopper ${n}`) : null));
    m.setSerialHoppers(sc4Serial);
    sc4Serial.forEach((h, i) => {
      if (h === null) {
        noteBoardDefault(m, {
          axis: 'hopper',
          text: `serial hopper ${i + 1}: SCH 2 - the layout names none`,
          ifWrong: 'Firmware written for another serial hopper may report it missing or faulty.',
          node: TAILORED_IDS.hopper,
        });
      } else if (h !== 'None' && !(deviceFor(h) instanceof Sch2Hopper)) {
        noteBoardDefault(m, {
          axis: 'hopper',
          text: `serial hopper ${i + 1}: ${h} is not modelled - none is fitted`,
          ifWrong: 'Firmware that opens that hopper raises a hopper alarm.',
          node: TAILORED_IDS.hopper,
        });
      }
    });

    if (game.nvram) m.loadNvram(game.nvram);
    m.reset();
    restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
  },
};

const scorpion2: Platform = {
  system: 'SCORPION2',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.bin$/).filter((f) => !/snd/i.test(f.name));
    if (!progFiles.length) throw noRoms(game, 'no SC2 program ROM');

    const m = new Sc2();
    m.volumeApplies = !isClassicLayout(game.layoutName);
    m.vfd.drawsHidden = bfmAlphaRoute(game.layout)?.drawsHidden ?? true;
    const props = storedLayoutProps(game);
    m.loadRom(progFiles[0].bytes);
    fitReels(m, game);

    const dotFile = game.gam?.slaveRoms
      .map((n) => file(game, n)).find((f): f is GameFile => !!f);
    if (dotFile) m.fitDotMatrix(dotFile.bytes);

    const sndFiles = game.gam
      ? game.gam.sound.map((n) => file(game, n)).filter((f): f is GameFile => !!f)
      : byExt(game, /\.bin$/).filter((f) => /snd/i.test(f.name));
    if (sndFiles.length > 0) {
      const total = sndFiles.reduce((n, f) => n + f.bytes.length, 0);
      const snd = new Uint8Array(total);
      let o = 0;
      for (const f of sndFiles) {
        snd.set(f.bytes, o);
        o += f.bytes.length;
      }
      m.loadSoundRom(snd);
    }

    m.setLayoutSwitches(props?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: 25, made: true },
      cash: { fallback: 24, made: true },
      refill: { fallback: 26, made: false },
    });
    m.setDils(game.gam?.dips.get(1), game.gam?.dips.get(2));
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    const sc2Pct = game.gam?.settings.get('Percentage');
    m.setPercentageKey(sc2Pct === undefined ? undefined : Number(sc2Pct));

    const sc2Layout = decodedLayout(game.layout);
    if (sc2Layout) {
      const slides = triacSlidePence(sc2Layout, 'SCORPION2');
      if (slides) m.setSlidePence(slides);
      const meters = meterMoneyMap(sc2Layout, 'SCORPION2');
      if (meters) m.setMeterMoneyMap(meters);
      const dmBusy = readSwitchNumber(sc2Layout, 'SCORPION2', 'DM Busy');
      if (dmBusy !== null) m.setDmBusySwitch(dmBusy);
    }

    const sc2Protocol = Number(game.gam?.settings.get('Protocol') ?? 0);
    if (sc2Protocol) m.fitDataport(sc2Protocol);

    const sc2Out = m.moneyOutMeters;
    if (sc2Out.from === 'manual') {
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'money out: Meter 3 (cash) and Meter 5 (tokens), 10p a pulse - the layout has no meter map',
        ifWrong: 'Meters wired differently book the wrong meter as money out.',
        node: TAILORED_IDS.meters,
      });
    } else if (sc2Out.meters.join() !== '3') {
      noteBoardDefault(m, {
        axis: 'meter',
        text: `money out: Meter ${sc2Out.meters.join(' and ') || '(none)'}, from the layout - the board's usual is Meter 3`,
        ifWrong: 'A mis-ticked Meters panel in the layout miscounts money out.',
        node: TAILORED_IDS.meters,
      });
    }

    if (game.nvram) m.loadNvram(game.nvram);
    fitReelGeometry(m, game);
    powerUpReels(m, MODEL_RELATIONS.SCORPION2);
    m.reset();
    restoreGamReels(m, game, MODEL_RELATIONS.SCORPION2);
    return m;
  },
};

const scorpion1: Platform = {
  system: 'SCORPION1',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|p1|p2)$|^p[12]$/).filter((f) => !/snd/i.test(f.name));
    if (!progFiles.length) throw noRoms(game, 'no SC1 program ROM');

    const m = new Sc1();
    m.vfd.drawsHidden = bfmAlphaRoute(game.layout)?.drawsHidden ?? true;
    m.loadRom(progFiles.map((f) => f.bytes));
    const props = storedLayoutProps(game);
    fitReels(m, game);

    const sndFiles = (game.gam?.sound ?? [])
      .map((n) => file(game, n)).filter((f): f is GameFile => !!f);
    if (sndFiles.length) {
      const total = sndFiles.reduce((n, f) => n + f.bytes.length, 0);
      const snd = new Uint8Array(total);
      let o = 0;
      for (const f of sndFiles) {
        snd.set(f.bytes, o);
        o += f.bytes.length;
      }
      m.loadSoundRom(snd);
    }

    m.setLayoutSwitches(props?.switches ?? layoutSwitches(game.layout));
    const dil2 = game.gam?.dips.get(2);
    m.setDils(game.gam?.dips.get(1), dil2);
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (Number(game.gam?.settings.get('Protocol')) === 1) m.fitDataport();
    const pct = Number(game.gam?.settings.get('Percentage'));
    if (Number.isInteger(pct) && pct >= 0 && pct < 15) m.setPercentKey(pct + 1);
    const sc1Layout = decodedLayout(game.layout);
    if (sc1Layout) {
      const slides = triacSlidePence(sc1Layout, 'SCORPION1');
      if (slides) m.setSlidePence(slides);
    }
    applyOperatorPresets(m, game, {
      service: { fallback: null, made: true },
      cash: { fallback: null, made: true },
      refill: { fallback: null, made: false },
    });

    if (game.nvram) m.loadNvram(game.nvram);
    fitReelGeometry(m, game);
    powerUpReels(m, MODEL_RELATIONS.SCORPION1);
    m.reset();
    restoreGamReels(m, game, MODEL_RELATIONS.SCORPION1);
    return m;
  },
};

const sys85: Platform = {
  system: 'SYS85',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.bin$/).filter((f) => !/snd|sound/i.test(f.name));
    if (!progFiles.length) throw noRoms(game, 'no System 85 program ROM');

    const m = new Sys85();
    m.loadRom(progFiles.map((f) => f.bytes));
    const sys85Alpha = bfmAlphaRoute(game.layout);
    m.bd1Drawn = !!sys85Alpha?.segmented && sys85Alpha.number === 0;
    m.bd1.drawsHidden = sys85Alpha?.drawsHidden ?? true;
    const props = storedLayoutProps(game);
    fitReels(m, game);

    m.setLayoutSwitches(props?.switches ?? layoutSwitches(game.layout));
    m.setDils(game.gam?.dips.get(1), game.gam?.dips.get(2));
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (Number(game.gam?.settings.get('Protocol'))) m.fitDataport();
    const sys85Layout = decodedLayout(game.layout);
    applyOperatorPresets(m, game, {
      service: { fallback: Sys85.serviceDoorDefault, made: true },
      cash: { fallback: Sys85.cashDoorDefault, made: true },
      refill: { fallback: Sys85.refillKeyDefault, made: false },
    });
    if (sys85Layout) {
      const slides = triacSlidePence(sys85Layout, 'SYS85');
      if (slides) m.setSlidePence(slides);
    }

    if (game.nvram) m.loadNvram(game.nvram);
    fitReelGeometry(m, game);
    powerUpReels(m, MODEL_RELATIONS.SYS85);
    m.reset();
    restoreGamReels(m, game, MODEL_RELATIONS.SYS85);
    return m;
  },
};

const sys5: Platform = {
  system: 'SYS5',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|p[1-4])$|magic dragon/i).filter((f) => !/snd|sound/i.test(f.name));
    if (!progFiles.length) throw noRoms(game, 'no System 5 program ROM');

    const m = new Sys5();
    m.loadRom(progFiles.map((f) => f.bytes));
    const props = storedLayoutProps(game);
    fitReels(m, game);

    const sndFiles = (game.gam?.sound ?? [])
      .map((n) => file(game, n)).filter((f): f is GameFile => !!f);
    if (sndFiles.length) {
      const total = sndFiles.reduce((n, f) => n + f.bytes.length, 0);
      const snd = new Uint8Array(total);
      let o = 0;
      for (const f of sndFiles) { snd.set(f.bytes, o); o += f.bytes.length; }
      m.loadSoundRom(snd);
    }

    m.setLayoutSwitches(props?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: 40, made: false },
      cash: { fallback: 41, made: false },
      refill: { fallback: null, made: false },
    });
    m.setDips(game.gam?.dips.get(1), game.gam?.dips.get(2));
    wireOptionSwitches(m, game, [1, 2], 16);
    if (Number(game.gam?.settings.get('Protocol')) === 1) m.fitDataport();
    const sys5Layout = decodedLayout(game.layout);
    if (sys5Layout) m.setCoinInterface(readSetting(sys5Layout, 'SYS5', 'Coin Interface') === 'Parallel');
    const sys5Sound = sys5Layout ? readSetting(sys5Layout, 'SYS5', 'Sound Type') : undefined;
    m.setSoundType(sys5Sound === 'Yamaha' || sys5Sound === 'Std' ? sys5Sound : null);
    if (sys5Sound !== 'Yamaha' && sys5Sound !== 'Std') {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'music board not stated by the layout - speech only',
        ifWrong: 'A cabinet fitted with a music board plays no music.',
      });
    }
    const sys5Meters = sys5Layout ? meterMoneyMap(sys5Layout, 'SYS5') : null;
    if (sys5Meters) m.setMeterMoney(sys5Meters.meterOut, sys5Meters.meterIn);
    if (game.gam?.reels.length) m.numReels = game.gam.reels.length;

    if (game.nvram) m.loadNvram(game.nvram);
    fitReelGeometry(m, game);
    powerUpReels(m, MODEL_RELATIONS.SYS5);
    m.reset();
    restoreGamReels(m, game, MODEL_RELATIONS.SYS5);
    return m;
  },
};

const MPU4_MODEL_HOME = 3;

const MPU4_REEL_MUX: Record<string, Mpu4ReelMux> = {
  '5a': 'five8to5', '5b': 'five5to8', '5c': 'five3to6', '6': 'six1to8',
  '3/4/5': 'five1to4',
  '7': 'seven',
  '6b': 'six5to8',
};

export function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function buildMpu4Board(game: Game, sys: 'MPU4' | 'MPU4VIDEO'): Mpu4 {
  const progFiles = game.gam
    ? manifestRoms(game)
    : byExt(game, /\.(bin|p1|p2|p3|p4)$/);
  if (!progFiles.length) throw noRoms(game, 'no MPU4 program ROM');

  const m = new Mpu4();
  if (sys === 'MPU4VIDEO') m.attachVideo(buildMpu4VideoCard(m, game));
  m.volumeApplies = !isClassicLayout(game.layoutName);
  let sampleCardFitted = false;
  m.fitDataPak(Number(game.gam?.settings.get('Protocol') ?? 0));
  const romLayout = decodedLayout(game.layout);
  const encryption = romLayout ? readSetting(romLayout, sys, 'Encryption') : null;
  const romImage = mpu4RomImage(progFiles.map((f) => f.bytes));
  if (encryption !== null && !(encryption in MPU4_ENCRYPTION)) {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'this cabinet declares a program-ROM encoding this build does not decode - the bytes are used as they are',
      ifWrong: 'The machine will not start: its program is unreadable until the encoding is decoded.',
      node: 'rom',
      unbuilt: 'program decoder',
    });
  } else {
    const extraXor = encryption !== null ? MPU4_ENCRYPTION[encryption] : null;
    if (extraXor !== null) mpu4Descramble(romImage, extraXor);
  }
  const ENCRYPTION_INDEX: Record<string, number> = {
    Normal: 0, Crystal: 1, 'Crystal 2': 2, None: 3,
  };
  if (encryption !== null && encryption in ENCRYPTION_INDEX) {
    m.setEncryption(ENCRYPTION_INDEX[encryption]);
  }
  const ROM_PAGING_INDEX: Record<string, number> = {
    '1/4/8 pages': 0, '2 pages': 1, '8 pages 2': 2,
  };
  const romPaging = romLayout ? readSetting(romLayout, sys, 'ROM Paging') : null;
  if (romPaging !== null && romPaging in ROM_PAGING_INDEX) {
    m.setRomPaging(ROM_PAGING_INDEX[romPaging]);
  }
  m.loadRom(romImage);
  m.okiVolumeManual = romLayout ? readSetting(romLayout, sys, 'Volume Control') === 'Manual' : false;
  if (sys === 'MPU4') {
    const chrDeclared = mpu4CharacteriserConfigFrom(game.layout);
    const chr = mpu4CharacteriserFor(chrDeclared);
    if (!chr.modelled) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `${chr.type} characteriser not built - the standard one stands in`,
        ifWrong: 'Lamps and the security handshake may read wrongly, or the cabinet may refuse to start.',
        node: 'chr',
        unbuilt: 'security chip',
      });
    }
    if (chr.modelled && chr.source === 'none') {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'the security chip\'s lamp row is not known for this cabinet - lamps it drives read as unlit',
        ifWrong: 'Lamps driven through the security chip may stay dark, or the wrong ones may light.',
        node: 'chr',
      });
    }
    m.setCharacteriser(chr.table);
    if (chr.type === 'BWB') {
      const bwb = bwbCharacterFor(chrDeclared?.character ?? null, romImage);
      m.bwbCharacteriser = new BwbCharacteriser(bwb.character);
      if (bwb.source === 'none') {
        noteBoardDefault(m, {
          axis: 'peripheral',
          text: 'the security chip\'s key is not stated by this cabinet or found in its program',
          ifWrong: 'The cabinet may raise a characteriser alarm and refuse to start.',
          node: 'chr',
        });
      }
    }
  } else {
    const family = romLayout ? readSetting(romLayout, sys, 'Character') : null;
    if (family !== null && family !== 'Barcrest') {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `${family} video security chip not built - the standard one stands in`,
        ifWrong: 'The video card may report its security chip as wrong and refuse to start.',
        node: 'chr',
        unbuilt: 'security chip',
      });
    }
  }

  const extender = fittedPeripheralsFrom(game.layout, game.gam?.system ?? '').lampExtender;
  if (extender) {
    const CARDS: Record<string, Mpu4['lampExtender']> = {
      None: 'none', Small: 'small', 'Large 1': 'large1', 'Large 2': 'large2',
      'Large 3': 'large3', 'Sml BWB': 'small', Crystal: 'crystal',
    };
    const card = CARDS[extender];
    if (card) m.lampExtender = card;
    else {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `lamp extender "${extender}" not built - the small card stands in`,
        ifWrong: 'The extended lamps on this cabinet light wrongly, or not at all.',
        node: 'lamps',
        unbuilt: 'lamp extender',
      });
    }
    if (card === 'crystal') sampleCardFitted = true;
  } else {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'lamp extender: small card on AUX1 - the layout names none',
      ifWrong: 'A cabinet built on the large card shows its extended lamps wrongly.',
      node: 'lamps',
    });
  }

  const segLayout = decodedLayout(game.layout);
  const segDriver = segLayout ? readSetting(segLayout, sys, '7 Seg Display') : null;
  const SEG_DRIVERS: Record<string, number> = {
    Barcrest: 0, Extended: 1, 'Extended 2': 2, 'Extended 3': 3,
    SWP: 4, 'Extended 4': 5, 'Extended 5': 6, 'Extended 6': 7,
  };
  const segType = segDriver !== null ? SEG_DRIVERS[segDriver] : undefined;
  if (segType !== undefined) {
    m.ledType = segType;
  } else if (segDriver !== null) {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: `seven-segment driver '${segDriver}' not recognised - the Barcrest one stands in`,
      ifWrong: 'The seven-segment digits show the wrong numbers, or none.',
      node: 'sevenseg',
      unbuilt: 'seven-segment driver',
    });
  }

  const mpu4Layout = decodedLayout(game.layout);
  const alphaCable = mpu4Layout ? readLayoutWord(mpu4Layout, 0x70) : null;
  m.alphaCableSwapped = alphaCable !== null && alphaCable !== 0;
    m.lampTestPass = sys === 'MPU4VIDEO' ? true : layoutLampTestPass(m, mpu4Layout, sys);
  let mpu4SharedCoinConnector = false;
  if (mpu4Layout) {
    const slides = triacSlidePence(mpu4Layout, sys);
    if (slides) m.setTriacSlides(slides);
    const meters = meterMoneyMap(mpu4Layout, sys);
    if (meters) m.setMeterMoneyMap(meters);
    const reelType = readSetting(mpu4Layout, sys, 'Reels');
    if (reelType && reelType !== '3/4') {
      const mux = MPU4_REEL_MUX[reelType];
      if (mux) m.setReelMux(mux);
      else {
        noteBoardDefault(m, {
          axis: 'reel',
          text: `reel type "${reelType}" not built - four reels driven`,
          ifWrong: 'Reels beyond the fourth stay still and the firmware may raise a reel fault.',
          node: TAILORED_IDS.reels,
          unbuilt: 'reel drive',
        });
      }
    }
    const payout = readSetting(mpu4Layout, sys, 'Payout');
    if (payout && payout !== 'Tube') {
      const PAYOUT_UNITS: Record<string, number> = {
        Tube: 0, 'Hopper 1': 1, 'Hopper 2': 2, 'Hopper 3': 3, 'Hopper 4': 4,
        'Hopper 5': 5, 'Global Twin': 6, Prize: 7, 'Hopper 6': 8, 'Hopper 7': 9,
        'Hopper 8': 10, 'Crystal Srl': 11, 'Prize 2': 12, 'Crystal 2': 13,
      };
      const payoutIndex = PAYOUT_UNITS[payout];
      if (payoutIndex !== undefined) m.setPayoutType(payoutIndex);
      if (payoutIndex === undefined || !Mpu4.BUILT_PAYOUTS.has(payoutIndex)) {
        noteBoardDefault(m, {
          axis: 'hopper',
          text: `payout unit "${payout}" not built - tube payout runs`,
          ifWrong: 'The payout unit is not driven, so a payout may never finish and the totals are wrong.',
          node: 'hopper',
          unbuilt: 'payout unit',
        });
      }
      mpu4SharedCoinConnector = payoutIndex === 11;
    }
    const SOUND_CARDS: Record<string, number> = {
      Sample: 0, Yamaha: 4, Crystal: 5, 'AY Only': 6, Serial: 7,
      Coinworld: 8, 'Sample Only': 9,
    };
    const sound = readSetting(mpu4Layout, sys, 'Sound');
    const soundIndex = sound ? SOUND_CARDS[sound] : undefined;
    if (soundIndex !== undefined) m.setSoundCard(soundIndex);
    if (sound && soundIndex === undefined) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `sound board "${sound}" not known - the sample board stands in`,
        ifWrong: 'This cabinet\'s sounds are wrong or missing; nothing else changes.',
        node: 'oki',
        unbuilt: 'sound board',
      });
    } else if (soundIndex === 7) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `sound board "${sound}" not built - its sample format is not read`,
        ifWrong: 'This cabinet\'s sounds are missing; nothing else changes.',
        node: 'oki',
        unbuilt: 'sound board',
      });
    } else if (soundIndex === 5 || soundIndex === 8) {
      sampleCardFitted = true;
    }
    if (!m.tokenOutPriced) {
      noteBoardDefault(m, {
        axis: 'coin',
        text: 'this cabinet prices no tokens-out meter - a token it pays out books no money',
        ifWrong: 'Tokens paid out are missing from the bookkeeping, so the payout percentage reads low. Cash figures are unaffected.',
      });
    }
    if (slides || meters || payout) {
      const slideDesc = slides
        ?.map((s, i) => (s === null ? ''
          : `T${i + 1}=${typeof s === 'number' ? `${s}p` : s === 'token' ? 'TKN' : '?'}`))
        .filter(Boolean).join(' ');
      console.log(`[mpu4] payout: ${payout ?? 'Tube'}`
        + (slideDesc ? `, slides ${slideDesc}` : '')
        + (meters ? ', meter map wired' : ''));
    }
  }
  const namedSnd = (game.gam?.sound ?? [])
    .map((n) => file(game, n))
    .filter((f): f is GameFile => !!f && !progFiles.includes(f));
  const sndFiles = namedSnd.length ? namedSnd : game.files
    .filter((f) => /snd|sound/i.test(f.name) && !progFiles.includes(f))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sndFiles.length) {
    let sndTotal = 0;
    for (const f of sndFiles) sndTotal += f.bytes.length;
    const samples = new Uint8Array(sndTotal);
    let so = 0;
    for (const f of sndFiles) {
      samples.set(f.bytes, so);
      so += f.bytes.length;
    }
    if (isMfmeSamplePack(samples)) {
      m.setSamplePack(samples);
      if (samples.length > 0x20000 && samples.length <= 0x40000 && sndFiles.length === 2) {
        noteBoardDefault(m, {
          axis: 'peripheral',
          text: 'this cabinet\'s packed sounds may be mapped to the wrong bank - a setting we do not read decides it',
          ifWrong: 'Some sounds play in the wrong place or not at all; nothing else changes.',
          node: 'oki',
        });
      }
    } else {
      m.oki.loadRom(samples);
      m.setSampleBanks(mpu4SampleBanks(sndFiles.map((f) => f.bytes)));
    }
  }
  if (sampleCardFitted && !m.oki.phraseCount && !m.samplePlayer.loaded) {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'this cabinet\'s sound board is driven but it declares no sample ROM',
      ifWrong: 'Sounds this board would play are missing; nothing else changes.',
      node: 'oki',
    });
  }

  const declaredClock = romLayout ? readNumber(romLayout, sys, 'Sample Clock Rate') : null;
  if (declaredClock) m.setSampleClock(declaredClock);

  m.setDilLabels(dipSwitchLabelsFrom(game.layout));
  if (game.gam) {
    m.setDils(game.gam.dips.get(1), game.gam.dips.get(2));
    if (game.gam.dips.get(1) === undefined && game.gam.dips.get(2) === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no option-switch banks stated - all sixteen read as off',
        ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
      });
    }
    const index = (name: string): number | undefined => {
      const raw = game.gam!.settings.get(name);
      if (raw === undefined) return undefined;
      const v = Number(raw);
      return Number.isFinite(v) ? v : undefined;
    };
    m.inputs.orange1 |= ((stakeKeyCode(index('Stake')) & 7) << (sys === 'MPU4VIDEO' ? 6 : 5)) & 0xff;
    const pctIndex = index('Percentage');
    const pct = pctIndex !== undefined ? percentKeyCode(pctIndex) : KEY_NOT_FITTED;
    m.inputs.orange2 |= (pct & 0x0f) << 4;
    m.inputs.orange2 |= jackpotKeyCode(index('Jackpot')) & 0x0f;
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);
  }

  if (mpu4Layout) {
    m.setAuxInvert(
      readCheckboxSetting(mpu4Layout, sys, 'Aux1 Invert') === true,
      readCheckboxSetting(mpu4Layout, sys, 'Aux2 Invert') === true,
    );
    m.setDoorInvert(readCheckboxByte(mpu4Layout, sys, 'Door Invert') ?? 0);
  }
  m.setSwitchIds(layoutSwitchIdsFrom(game.layout, sys));
  const unapplied = m.setLayoutSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
  if (unapplied.length) {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: `layout switch${unapplied.length > 1 ? 'es' : ''} ${unapplied.join(', ')} read from the game settings, not the panel`,
      ifWrong: 'That link is an option bank the firmware reads from the manifest; a panel box drawn on it moves nothing.',
    });
  }
  applyOperatorPresets(m, game, {
    service: { fallback: 23, made: false },
    cash: { fallback: null, made: false },
    refill: { fallback: 22, made: false },
  });

  applyCabinetCoinPence(m, game.layout);
  m.setCabinetCoinSlots(cabinetCoinSlots(game.layout, MPU4_COIN_ROW));
  if (mpu4SharedCoinConnector && !m.coinLineRead) {
    noteBoardDefault(m, {
      axis: 'hopper',
      text: 'this payout unit shares the coin connector - which line each coin uses is unread',
      ifWrong: 'A coin can land on the payout unit\'s own wire, and the machine then reports a hopper fault.',
      node: 'coinmech',
    });
  }
  if (game.nvram) m.loadNvram(game.nvram);
  fitReelGeometry(m, game);
  powerUpReels(m, MODEL_RELATIONS.MPU4);
  m.reset();
  game.gam?.reels.forEach((r, i) => {
    if (i < m.reels.length) m.setReelPosition(i, r.position + MPU4_MODEL_HOME);
  });
  return m;
}

const mpu4: Platform = {
  system: 'MPU4',
  build(game) {
    return buildMpu4Board(game, 'MPU4');
  },
};

function buildMpu4VideoCard(m: Mpu4, game: Game): Mpu4VideoCard {
  const card = new Mpu4VideoCard();
  const vidFiles = (game.gam?.vidRoms ?? [])
    .map((n) => file(game, n))
    .filter((f): f is GameFile => !!f);
  if (!vidFiles.length) throw noRoms(game, 'no MPU4 video ROM');
  card.loadVideoRoms(vidFiles.map((f) => f.bytes));
  const chrFile = game.files.find((f) => /\.chr$/i.test(f.name)) ?? null;
  card.loadCharacteriser(chrFile?.bytes ?? null);
  const payload = decodedLayout(game.layout);
  card.setXram(payload ? readSetting(payload, 'MPU4VIDEO', 'XRam') === 'Yes' : false);
  if (!chrFile) {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'no video security table in this set - the video card\'s security chip answers zero',
      ifWrong: 'The video card may report its security chip as wrong and refuse to start.',
      node: 'chr',
    });
  }
  if (payload && readSetting(payload, 'MPU4VIDEO', 'Palette Type') === 'bt481') {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'video palette chip not built - the standard one stands in',
      ifWrong: 'The screen shows wrong colours, or none.',
      node: 'palette',
      unbuilt: 'video palette',
    });
  }
  if (payload && readSetting(payload, 'MPU4VIDEO', 'PC Key Location') === 'Video Board') {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'percentage key on the video card not built - it reads as not fitted',
      ifWrong: 'The game may run at the wrong percentage or refuse to start.',
      node: 'video',
      unbuilt: 'percentage key',
    });
  }
  return card;
}

const mpu4video: Platform = {
  system: 'MPU4VIDEO',
  build(game) {
    return buildMpu4Board(game, 'MPU4VIDEO');
  },
};

function impactDsw(bits: string): number {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    if (bits[i] !== '1') v |= 1 << i;
  }
  return v;
}

interface OperatorPresetArm { fallback: number | null; made: boolean; tag?: false }
const OPERATOR_PRESETS = [
  ['service', 0x1f, 'Back door'],
  ['cash', 0x20, 'Cash door'],
  ['refill', 0x2b, 'Refill key'],
] as const;
function applyOperatorPresets(
  m: { presetOperatorSwitch(id: number, made: boolean, label: string): void },
  game: Game,
  arms: Record<'service' | 'cash' | 'refill', OperatorPresetArm | null>,
): void {
  const payload = decodedLayout(game.layout);
  for (const [control, tag, label] of OPERATOR_PRESETS) {
    const arm = arms[control];
    if (!arm) continue;
    const stored = payload && arm.tag !== false ? readOperatorTag(payload, tag) : null;
    if (stored) m.presetOperatorSwitch(stored.line, arm.made !== stored.invert, label);
    else if (arm.fallback !== null) m.presetOperatorSwitch(arm.fallback, arm.made, label);
  }
}
const DEFAULT_PRESETS = {
  service: { fallback: null, made: false },
  cash: { fallback: null, made: false },
  refill: { fallback: null, made: false },
} as const;

const impact: Platform = {
  system: 'IMPACT',
  build(game) {
    const image = manifestImage(game, 0x80000, 0);
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.bin$/).filter((f) => !/snd/i.test(f.name));
    if (!image && progFiles.length < 2) throw noRoms(game, 'no IMPACT program ROM pair');

    const m = new Impact();
    if (image) m.loadRom(image);
    else m.loadRomPair(progFiles[0].bytes, progFiles[1].bytes);
    fitReels(m, game);

    const sndFiles = game.gam
      ? game.gam.sound.map((n) => file(game, n)).filter((f): f is GameFile => !!f)
      : byExt(game, /\.bin$/).filter((f) => /snd/i.test(f.name));
    if (sndFiles.length > 0) {
      const total = sndFiles.reduce((n, f) => n + f.bytes.length, 0);
      const snd = new Uint8Array(total);
      let o = 0;
      for (const f of sndFiles) {
        snd.set(f.bytes, o);
        o += f.bytes.length;
      }
      m.loadSoundRom(snd);
    }

    const dip = game.gam?.dips.get(1);
    if (dip) m.setDsw(impactDsw(dip));
    wireOptionSwitches(m, game, [1], 8);
    m.setLayoutSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: 32, made: false },
      cash: { fallback: 61, made: false },
      refill: { fallback: 59, made: false },
    });

    const setting = (name: string): number | undefined => {
      const raw = game.gam?.settings.get(name);
      if (raw === undefined) return undefined;
      const v = Number(raw);
      return Number.isFinite(v) ? v : undefined;
    };
    const pctIndex = setting('Percentage');
    const stakeIndex = setting('Stake');
    const prizeIndex = setting('Jackpot');
    const fromGam = Boolean(game.gam);
    const pct = impactPercentKey(pctIndex) ?? (fromGam ? IMPACT_PERCENT_NOT_FITTED : undefined);
    if (pct !== undefined) m.setPercentKey(pct);
    const stake = impactStakeKey(stakeIndex) ?? (fromGam ? IMPACT_STAKE_NOT_FITTED : undefined);
    const prize = impactPrizeKey(prizeIndex) ?? (fromGam ? IMPACT_PRIZE_NOT_FITTED : undefined);
    if (stake !== undefined || prize !== undefined) {
      m.setKeys(impactKeyByte(m.keyByte, stake, prize));
    }
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);
    for (const [line, index, listed, max] of [
      ['Stake', stakeIndex, impactStakeKey(stakeIndex), IMPACT_STAKE_LABELS.length - 1],
      ['Jackpot', prizeIndex, impactPrizeKey(prizeIndex), IMPACT_PRIZE_LABELS.length - 1],
      ['Percentage', pctIndex, impactPercentKey(pctIndex), 14],
    ] as const) {
      if (index !== undefined && listed === undefined) {
        noteBoardDefault(m, {
          axis: 'key',
          text: `${line.toLowerCase()} key ${index} is not in the list - none fitted`,
          ifWrong: `The cabinet boots with no ${line.toLowerCase()} key (valid: 0-${max}).`,
        });
      }
    }
    if (pctIndex !== undefined && impactPercentKey(pctIndex) !== undefined) {
      console.log(`[impact] keys: ${IMPACT_STAKE_LABELS[stakeIndex ?? -1] ?? '?'}`
        + ` / ${IMPACT_PRIZE_LABELS[prizeIndex ?? -1] ?? '?'}`
        + ` / ${impactPercentValue(pctIndex)}%`);
    }

    const layout = decodedLayout(game.layout);
    if (layout) {
      const hoppers = readCheckboxByte(layout, 'IMPACT', 'Hopper 1');
      if (hoppers !== null) m.setHoppers(hoppers);
      const mech = readSetting(layout, 'IMPACT', 'Coin Mech');
      if (mech !== null) m.setMechType(mech === 'Binary' ? 1 : 0);
      const meters = meterMoneyMap(layout, 'IMPACT');
      if (meters) {
        m.setMeterMap(meters.meterIn, meters.meterOut);
        m.setSecMoneyMap(meters.secIn, meters.secOut);
      }
      const slides = triacSlidePence(layout, 'IMPACT');
      if (slides) m.setTriacSlides(slides);
      if (hoppers !== null || mech !== null || meters) {
        const fit = (mask: number) => (hoppers !== null && (hoppers & mask) !== 0 ? 'out' : 'in');
        console.log(`[impact] cabinet: hopper1(100p) ${fit(0x40)}, `
          + `hopper2(20p) ${fit(0x10)}, ${mech ?? 'Parallel'} mech`
          + (meters ? ', meter map wired' : ''));
      }
    }

    const impactSec = layoutSecFitted(game, 'IMPACT');
    const secFitted = impactSec ?? !!game.gam?.sec.length;
    if (impactSec === null) noteSecInferred(m, secFitted ? 'fitted' : 'none');
    if (secFitted) {
      m.fitSec(game.gam?.sec ?? []);
      if (m.secOutPriced) {
        noteBoardDefault(m, {
          axis: 'meter',
          text: 'SEC counter priced at 10p a unit - assumed for this board',
          ifWrong: 'A cabinet counting its SEC in another unit shows wrong bookkeeping totals.',
          node: TAILORED_IDS.meters,
        });
      } else {
        noteBoardDefault(m, {
          axis: 'meter',
          text: 'money out: not counted - the layout prices no SEC counter as money out',
          ifWrong: 'Payouts are not added to the money-out total.',
          node: TAILORED_IDS.meters,
        });
      }
    } else if (!m.meterMapStated) {
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'money out: Meter 2 (cash) and Meter 4 (tokens), 10p a pulse - the layout has no meter map',
        ifWrong: 'A cabinet counting cash IN on Meter 2 books money in as money out.',
        node: TAILORED_IDS.meters,
      });
    }
    m.fitDataPak(Number(game.gam?.settings.get('Protocol') ?? 0) || 0);
    if (game.nvram) m.loadNvram(game.nvram);
    fitReelGeometry(m, game);
    for (const g of reelGeometry(game.layout)) m.setReelOpticInverted(g.number, !g.flip && g.invertedOpto);
    powerUpReels(m, MODEL_RELATIONS.IMPACT);
    m.reset();
    restoreGamReels(m, game, MODEL_RELATIONS.IMPACT);
    return m;
  },
};

function dipLsbFirst(bits: string | undefined): number {
  let v = 0;
  for (let i = 0; i < 8 && i < (bits?.length ?? 0); i++) if (bits![i] === '1') v |= 1 << i;
  return v;
}

const PCP_REEL_MCU_CRC = 0x1c8019bf;

const acesp: Platform = {
  system: 'SPACE',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.bin$/);
    if (progFiles.length < 2) throw noRoms(game, 'no sp.ACE program ROM pair');

    const looksHigh = (f: GameFile): boolean => {
      const b = f.bytes;
      if (b.length < 0x8000) return false;
      const reset = (b[0x7ffe] << 8) | b[0x7fff];
      return reset >= 0x2000 && reset !== 0xffff;
    };
    const lines = (game.gam?.roms ?? []).map((n) => file(game, n));
    const byLine = game.gam && lines[0] && lines[1] ? { high: lines[0], low: lines[1] } : null;
    const high = byLine?.high ?? progFiles.find(looksHigh) ?? progFiles[0];
    const low = byLine?.low ?? progFiles.find((f) => f !== high) ?? progFiles[1];

    const m = new AceSp();
    m.loadRomPair(low.bytes, high.bytes);
    m.alphaDrawn = v20AlphaServe(game.layout, { m10937: [0] })?.decoder === '10937';

    const mcu = game.files.find((f) => f.bytes.length === 0x800
      && (crc32(f.bytes) === PCP_REEL_MCU_CRC || /pcp.*reel.*mcu|\bfcr\b/i.test(f.name)));
    if (mcu) {
      m.fitPcpReelPcb(mcu.bytes);
      console.log(`[acesp] PCP reel PCB fitted from ${mcu.name}`);
    }

    const sounds = (game.gam?.sound ?? [])
      .map((n) => file(game, n))
      .filter((f): f is GameFile => !!f);
    if (sounds.length) {
      const total = sounds.reduce((n, f) => n + f.bytes.length, 0);
      const rom = new Uint8Array(total);
      let at = 0;
      for (const f of sounds) { rom.set(f.bytes, at); at += f.bytes.length; }
      m.loadSoundRom(rom);
    }

    m.inputs.switches[2] = AceSp.standingChainByte2([]);
    const panel = storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout);
    if (!panel.length) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'the layout saves no switch panel - the cabinet\'s links and sensors are all read as open',
        ifWrong: 'The machine may run the wrong percentage program, or report a sensor it does not have.',
      });
    }
    m.setLayoutSwitches(panel);
    applyOperatorPresets(m, game, {
      service: { fallback: 32, made: false, tag: false },
      cash: { fallback: 33, made: false, tag: false },
      refill: { fallback: 34, made: false },
    });

    if (game.gam) {
      game.gam.reels.forEach((r, i) => m.setReelPosition(i, r.position));
    }
    m.dip1 = dipLsbFirst(game.gam?.dips.get(1));
    m.dip2 = dipLsbFirst(game.gam?.dips.get(2));
    wireOptionSwitches(m, game, [1, 2], 16);

    const layout = decodedLayout(game.layout);
    if (layout) {
      const meters = meterMoneyMap(layout, 'SPACE');
      if (meters) {
        m.setMeterOutPence(ledgerOutMults({ in: meters.meterIn, out: meters.meterOut })[0].map((mult) => mult * 10));
        m.setMeterInPence(meters.meterIn.map((mult) => mult * 10));
      }
      if (meters) {
        console.log(`[acesp] layout money wiring: out mult [${
          meters ? meters.meterOut.slice(0, 8).join(',') : 'none'}], in mult [${
          meters ? meters.meterIn.slice(0, 8).join(',') : 'none'}]`);
      }
    }
    if (!m.tokenInPriced) {
      noteBoardDefault(m, {
        axis: 'coin',
        text: 'this cabinet prices no tokens-in meter - a token it takes books no money',
        ifWrong: 'Tokens put back into the machine are missing from the bookkeeping. Cash figures are unaffected.',
      });
    }
    if (!m.tokenOutPriced) {
      noteBoardDefault(m, {
        axis: 'coin',
        text: 'this cabinet prices no tokens-out meter - a token it pays out books no money',
        ifWrong: 'Tokens paid out are missing from the bookkeeping, so the payout percentage reads low. Cash figures are unaffected.',
      });
    }

    applyCabinetCoinPence(m, game.layout);
    if (game.nvram) m.loadNvram(game.nvram);
    fitReelGeometry(m, game);
    fitReels(m, game);
    m.reset();
    return m;
  },
};

function m1abProgram(game: Game): GameFile[] {
  const named = manifestRoms(game);
  if (named.length) return named;
  const stand = m1abCandidates(game)[0];
  return stand ? [stand] : [];
}

function m1abCandidates(game: Game): GameFile[] {
  return game.files.filter((f) =>
    (f.bytes.length === 0x8000 || f.bytes.length === 0x10000 || f.bytes.length === 0x20000)
    && !/snd|sound|mcu|gal|\.(fml|dat|gam|ram|jpg|png|zip)$/i.test(f.name));
}

function mpu5FlatCandidates(game: Game): GameFile[] {
  return game.files.filter((f) =>
    f.bytes.length >= 0x100000 && f.bytes.length <= 0x400000
    && !/\.(fml|dat|gam|ram|jpg|png|zip)$/i.test(f.name));
}

const m1ab: Platform = {
  system: 'M1AB',
  build(game) {
    const m = new M1ab();
    const program = m1abProgram(game);
    if (!program.length) throw noRoms(game, 'no Maygay M1A/B program ROM found');
    m.loadRom(program.map((f) => f.bytes));

    const dotRoms = (game.gam?.slaveRoms ?? [])
      .map((n) => file(game, n)).filter((f): f is GameFile => !!f);
    if (dotRoms.length) m.fitDotMatrix(dotRoms.map((f) => f.bytes));

    const sounds = (game.gam?.sound ?? [])
      .map((n) => file(game, n))
      .filter((f): f is GameFile => !!f);
    const parts = sounds.length ? sounds : byExt(game, /snd.*\.bin$/);
    if (parts.length) {
      const total = parts.reduce((n, f) => n + f.bytes.length, 0);
      const rom = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { rom.set(p.bytes, at); at += p.bytes.length; }
      const lay = decodedLayout(game.layout);
      const tag54 = lay ? fileLevelTags(lay).get(0x54) : undefined;
      const sampled = tag54 && tag54.length >= 4
        ? (tag54[0] | (tag54[1] << 8) | (tag54[2] << 16) | (tag54[3] << 24)) >>> 0
        : undefined;
      m.loadSoundRom(rom, parts.length, sampled);
    }

    if (game.gam) {
      const dil = (n: number): number => {
        const s = game.gam!.dips.get(n) ?? '';
        let v = 0;
        for (let i = 0; i < 8; i++) if (s[i] === '1') v |= 1 << i;
        return v;
      };
      const stored = Number(game.gam.settings.get('Percentage'));
      const percentIndex = Number.isFinite(stored) ? stored + 1 : 0;
      m.setOptions(dil(1), dil(2), percentIndex);
      if (game.gam.dips.get(1) === undefined && game.gam.dips.get(2) === undefined) {
        noteBoardDefault(m, {
          axis: 'manifest',
          text: 'no option-switch banks stated - all sixteen read as off',
          ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
        });
      }

      const keyIndex = (name: string): number => {
        const v = Number(game.gam!.settings.get(name));
        return Number.isFinite(v) ? v + 1 : 0;
      };
      m.setKeys(keyIndex('Stake'), keyIndex('Jackpot'));

      const protocol = Number.parseInt(game.gam!.settings.get('Protocol') ?? '', 10);
      m.fitDataPak(Number.isFinite(protocol) ? protocol : 0);

      for (const g of reelGeometry(game.layout)) m.setReelOpticInverted(g.number, !g.flip && g.invertedOpto);

    }

    const props = storedLayoutProps(game);
    m.setLayoutSwitches(props?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: null, made: true },
      cash: { fallback: null, made: true },
      refill: { fallback: 25, made: false, tag: false },
    });

    {
      const layout = decodedLayout(game.layout);
      if (layout) {
        m.declareSwitch(readSwitchNumber(layout, 'M1AB', 'Refill'), 'REFILL KEY');
        m.declareSwitch(readSwitchNumber(layout, 'M1AB', 'Test'), 'TEST');

        const hoppers = readCheckboxByte(layout, 'M1AB', 'Hopper 1');
        if (hoppers !== null) m.setHoppers(hoppers);
        const meters = meterMoneyMap(layout, 'M1AB');
        if (meters) m.setMeterMap(meters.meterIn, meters.meterOut);

        const dongle = m1abDongleConfig(layout);
        if (dongle?.fitted) {
          m.fitDongle(dongle.key ?? 0);
          if (dongle.key === null) {
            noteBoardDefault(m, {
              axis: 'peripheral',
              text: 'a dongle is fitted but the layout stores no key for it - answering with key 0',
              ifWrong: 'The firmware rejects the dongle and will not run.',
            });
          }
        }

        const slides = triacSlidePence(layout, 'M1AB');
        if (slides) m.setSlidePence(slides);

        const coinMech = readSetting(layout, 'M1AB', 'Coin Mech');
        m.setCoinMech(coinMech);
        m.setCabinetCoinNotes(declaredCoins(game.layout).flatMap((c) => (c.note === null ? [] : [{
          note: c.note, label: c.named?.name ?? 'Coin', pence: c.pence, token: c.token,
        }])));
        if (coinMech === null && m.hasTransformedCoinSlot) {
          noteBoardDefault(m, {
            axis: 'coin',
            text: 'the layout does not say whether its coin mech is parallel or binary - taken as parallel',
            ifWrong: 'A coin slot may present the wrong pattern and the machine may not credit it.',
          });
        }

        const fitted = (mask: number) => hoppers !== null && (hoppers & mask) === 0;
        if (fitted(0x40) || fitted(0x10) || meters || slides) {
          const named = (slides ?? [])
            .map((p, i) => (p === null ? null
              : `${i + 1}:${typeof p === 'number' ? `${p}p` : p === 'token' ? 'TKN' : '?'}`))
            .filter(Boolean).join(' ');
          console.log(`[m1ab] cabinet: hopper1 ${fitted(0x40) ? 'in' : 'out'}, `
            + `hopper2 ${fitted(0x10) ? 'in' : 'out'}`
            + (meters ? ', meter map wired' : '')
            + (named ? `, slides ${named}` : ''));
        }
      }
    }

    m.setDilLabels(dipSwitchLabelsFrom(game.layout));

    applyCabinetCoinPence(m, game.layout);
    const nv = game.nvram;
    if (nv) m.loadNvram(nv);
    fitReelGeometry(m, game);
    powerUpReels(m, MODEL_RELATIONS.M1AB);
    m.reset();
    restoreGamReels(m, game, MODEL_RELATIONS.M1AB);
    return m;
  },
};

function layoutLampTestPass(m: object, layout: Uint8Array | null, system: string): boolean {
  const lampTest = layout ? readSetting(layout, system, 'Lamp Test') : null;
  if (lampTest === null) {
    noteBoardDefault(m, {
      axis: 'peripheral',
      text: 'lamp test: Pass - the layout does not say',
      ifWrong: 'A game that checks its bulbs may report a lamp fault, or miss one.',
    });
  }
  return lampTest !== 'Fail';
}

const mpu5: Platform = {
  system: 'MPU5',
  build(game) {
    const m = new Mpu5();
    const mpu5Alpha = v20AlphaServe(game.layout, { m10937: [0, 1, 2, 3] });
    m.alphaRoute = !mpu5Alpha || mpu5Alpha.classic ? 'barbus'
      : mpu5Alpha.decoder === '10937' && mpu5Alpha.index === 0 ? 'board'
        : mpu5Alpha.decoder === '10937' && mpu5Alpha.index === 1 ? 'barbus' : null;
    let progImage: Uint8Array;
    const named = manifestRoms(game);
    const placed = named.length > 1 ? manifestImage(game, 0x80000, 0) : null;
    if (placed) {
      const image = placed;
      m.loadRom(image);
      progImage = image;
    } else {
      const program = named[0] ?? mpu5FlatCandidates(game)[0];
      if (!program) throw noRoms(game, 'no MPU5 program ROM found');
      m.loadRom(program.bytes);
      progImage = program.bytes;
    }
    const setting = (name: string): number | undefined => {
      const raw = game.gam?.settings.get(name);
      if (raw === undefined) return undefined;
      const v = Number(raw);
      return Number.isFinite(v) ? v : undefined;
    };
    const mpu5Pct = setting('Percentage');
    m.pic.config = {
      stakeKey: stakeKeyCode(setting('Stake')),
      jackpotKey: jackpotKeyCode(setting('Jackpot')),
      percentKey: mpu5Pct !== undefined ? percentKeyCode(mpu5Pct) : KEY_NOT_FITTED,
      optionSwitches: dipByte(game.gam?.dips.get(2)),
      test: false,
    };
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);
    const props = storedLayoutProps(game);
    m.setReelGeometry(props?.reels ?? reelGeometry(game.layout));
    const peripherals = props?.peripherals
      ?? fittedPeripheralsFrom(game.layout, game.gam?.system ?? '');
    m.pic.identity = cardIdentity(m.rom) ?? peripherals.picCode ?? '';
    const statedPic = picTypeFromLayout(peripherals.picType);
    m.pic.type = statedPic ?? 1;
    if (!peripherals.picCode && picDriverScan(m.rom) !== null) m.pic.type = 2;
    if (statedPic === null && peripherals.picCode === null && m.pic.type === 1) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'program card: PIC 1 - the cabinet names no PIC type',
        ifWrong: 'A firmware written for a PIC 2 or PIC 3 card reads its keys and security answer wrongly.',
        node: 'configkey',
      });
    }
    m.setHopper(peripherals.hopperType);
    if (peripherals.hopperType === null || !Mpu5.knowsHopperType(peripherals.hopperType)) {
      noteBoardDefault(m, {
        axis: 'hopper',
        text: 'hopper: Compact hopper - the cabinet names no Hopper Type',
        ifWrong: 'Firmware timed or wired for another hopper can raise HOPPER OVER PAY, a payout timeout or an unused-input alarm.',
        node: TAILORED_IDS.hopper,
      });
    }
    m.setCoinMech(peripherals.coinMech);
    m.barbus.reelJumpers = peripherals.reelJumpers !== undefined
      ? peripherals.reelJumpers
      : mpu5ReelJumpersFrom(game.layout);
    m.barbus.mux5Extended = mpu5Mux5ExtendedFrom(game.layout);
    m.optionSwitches1 = dipByte(game.gam?.dips.get(1));
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (game.gam?.dips.get(1) === undefined && game.gam?.dips.get(2) === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no option-switch banks stated - all sixteen read as off',
        ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
      });
    }

    const mpu5Sec = layoutSecFitted(game, 'MPU5');
    if (mpu5Sec === true) m.fitSec(game.gam?.sec);
    else if (mpu5Sec === null) {
      const inferred = !!game.gam?.sec.length || programDeclaresLcdMeters(progImage);
      if (inferred) m.fitSec(game.gam?.sec);
      noteSecInferred(m, inferred ? 'fitted' : 'none');
    }
    const pence = Mpu5.meterPencePerPulseOf(m.rom);
    m.setHopperCoinPence(Mpu5.hopperCoinPenceOf(m.rom, 0x86), Mpu5.hopperCoinPenceOf(m.rom, 0x84));
    if (pence !== null) m.setMeterPencePerPulse(pence);
    else {
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'meter pulse priced at 10p - this program states none',
        ifWrong: 'A cabinet metering in another unit shows wrong bookkeeping totals.',
        node: TAILORED_IDS.meters,
      });
    }
    m.fitDataPak(setting('Protocol') ?? 0);
    const unappliedMpu5 = m.setLayoutSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
    if (unappliedMpu5.length) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `layout switch${unappliedMpu5.length > 1 ? 'es' : ''} ${unappliedMpu5.join(', ')} not wired on this board`,
        ifWrong: 'A panel box drawn there moves nothing on this board.',
      });
    }
    {
      const presetLayout = decodedLayout(game.layout);
      const lock = presetLayout && readOperatorTag(presetLayout, 0x1f) ? readOperatorTag(presetLayout, 0x56) : null;
      if (lock) m.presetOperatorSwitch(lock.line, lock.invert, 'Lock');
      applyOperatorPresets(m, game, {
        service: { fallback: 2, made: false },
        cash: { fallback: null, made: false },
        refill: { fallback: 1, made: false },
      });
    }
    if (!m.programSwitches.length) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'door and key switches: this program names none - only the layout\'s own are offered',
        ifWrong: 'A door or key switch the cabinet has cannot be opened from the Switches menu.',
      });
    }
    const mpu5Layout = decodedLayout(game.layout);
    m.nv4Fitted = mpu5Layout ? readSetting(mpu5Layout, 'MPU5', 'NV4 Note') === 'Yes' : false;
    m.lampTestPass = layoutLampTestPass(m, mpu5Layout, 'MPU5');
    const networkId = mpu5Layout ? readSetting(mpu5Layout, 'MPU5', 'Network Id') : null;
    if (networkId === null || networkId === 'None') {
      const serialHoppers = [1, 2].map((n) => (mpu5Layout ? readSetting(mpu5Layout, 'SCORPION5', `Hopper ${n}`) : null));
      m.fitVendBus(serialHoppers.map((h) => h ?? 'SCH 2'));
      serialHoppers.forEach((h, i) => {
        if (h === null) {
          noteBoardDefault(m, {
            axis: 'hopper',
            text: `serial hopper ${i + 1}: SCH 2 - the layout names none`,
            ifWrong: 'Firmware written for another serial hopper may report it missing or faulty.',
            node: TAILORED_IDS.hopper,
          });
        } else if (h !== 'None' && !deviceFor(h)) {
          noteBoardDefault(m, {
            axis: 'hopper',
            text: `serial hopper ${i + 1}: ${h} is not modelled - none is fitted`,
            ifWrong: 'Firmware that opens that hopper raises a hopper alarm.',
            node: TAILORED_IDS.hopper,
          });
        }
      });
    } else {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `machine link (${networkId}) is not modelled - the vend bus is off`,
        ifWrong: 'Firmware that expects its link partners, or its coin mech, hoppers or note reader on that line, reports them missing.',
      });
    }
    const noteName = mpu5Layout ? readSetting(mpu5Layout, 'SCORPION5', 'Note Acceptor') : null;
    const noteType = noteName === null ? 1 : ({ None: 0, 'JCM EBA': 1, VEGA: 2, NV11: 3 } as Record<string, number>)[noteName] ?? 0;
    const noteFitted = m.fitNoteValidator(noteType);
    if (noteName === null && noteFitted) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'note acceptor: JCM EBA - the layout names none',
        ifWrong: 'Firmware written for another note acceptor may report it missing or faulty.',
        node: TAILORED_IDS.notes,
      });
    } else if (noteType > 1 && m.vend) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `note acceptor: ${noteName} is not modelled - none is fitted`,
        ifWrong: 'Firmware that opens its note reader raises a note reader alarm.',
        node: TAILORED_IDS.notes,
      });
    }
    const nv = game.nvram;
    if (nv) m.loadNvram(nv);
    m.reset();
    const mpu5Fitted = layoutReelNumbers(game);
    game.gam?.reels.forEach((r, n) => {
      if (mpu5Fitted.has(n)) m.setReelPosition(n, oursFromMfme(MODEL_RELATIONS.MPU5, r.position, m.reelRevolution(n)));
    });
    return m;
  },
};

function programDeclaresLcdMeters(program: Uint8Array): boolean {
  const L = 'L'.charCodeAt(0), C = 'C'.charCodeAt(0), D = 'D'.charCodeAt(0), M = 'M'.charCodeAt(0);
  for (let i = 0; i + 3 < program.length; i++) {
    if (program[i] === L && program[i + 1] === C && program[i + 2] === D && program[i + 3] === M) return true;
  }
  return false;
}

function wireOptionSwitches(
  m: object & { setDilLabels(labels: readonly string[] | null): void },
  game: Game, banks: readonly number[], count: number,
): void {
  m.setDilLabels(dipSwitchLabelsFrom(game.layout));
  if (banks.every((n) => game.gam?.dips.get(n) === undefined)) {
    const words: Record<number, string> = { 8: 'eight', 12: 'twelve', 16: 'sixteen' };
    noteBoardDefault(m, {
      axis: 'manifest',
      text: `no option-switch ${banks.length > 1 ? 'banks' : 'bank'} stated - all ${words[count] ?? count} read as off`,
      ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
    });
  }
}

function gamDipByteLsb(line: string | undefined): number {
  let v = 0;
  let w = 1;
  for (const ch of line ?? '') {
    if (ch === '1') v |= w;
    w <<= 1;
  }
  return v & 0xff;
}

function finishScorpion5(game: Game, m: Sc5): Sc5 {

    const sounds = (game.gam?.sound ?? [])
      .map((n) => file(game, n))
      .filter((f): f is GameFile => !!f);
    if (sounds.length) m.loadSoundRoms(sounds.map((f) => f.bytes));

    const props = storedLayoutProps(game);
    m.setReelGeometry(props?.reels ?? reelGeometry(game.layout));

    const sc5Leds = decodedLayout(game.layout);
    m.seg7.mode = bfmLedMode(sc5Leds ? readSetting(sc5Leds, 'SCORPION5', 'LEDs') : null);
    m.fitBetcomAlpha((sc5Leds ? readSetting(sc5Leds, 'SCORPION5', 'Alpha Type') : null) === 'Betcom');
    const sc5Alpha = bfmAlphaRoute(game.layout);
    m.segmentedAlpha = !!sc5Alpha?.segmented;
    m.bd1.drawsHidden = sc5Alpha?.drawsHidden ?? true;

    const picWords = [0x57, 0x58].map((tag) => (sc5Leds ? readLayoutWord(sc5Leds, tag) : null));
    m.security.setLayoutWords(picWords[0] ?? 0, picWords[1] ?? 0);
    if (picWords[0] === null && picWords[1] === null) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'security cartridge: PIC type Normal - the layout names none',
        ifWrong: 'A game written for another PIC type may refuse the cartridge or offer the wrong options.',
        node: 'security',
      });
    }

    const sc5Fitted = props?.peripherals ?? fittedPeripheralsFrom(game.layout, 'SCORPION5');
    m.setPeripherals(sc5Fitted);
    const desBox = (control: string): boolean | null =>
      sc5Leds ? readCheckboxSetting(sc5Leds, 'SCORPION5', control) : null;
    const sc5Des = {
      mech: desBox('Coin Mech DES'), note: desBox('Note Acceptor DES'),
      hopper1: desBox('Hopper 1 DES'), hopper2: desBox('Hopper 2 DES'),
    };
    m.setDesFitted(sc5Des);
    if (sc5Leds && sc5Fitted.coinMech !== null && sc5Des.mech === null) {
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: 'coin mech encryption: assumed on - the layout does not say',
        ifWrong: 'A coin mech that is not encrypted may be spoken to as if it were, and the game will report it faulty.',
        node: TAILORED_IDS.coinMech,
      });
    }

    const sc5Stand: [string | null | undefined, string, string, string][] = [
      [sc5Fitted.coinMech, 'coin mech', 'SR5i', TAILORED_IDS.coinMech],
      [sc5Fitted.hoppers[0], 'hopper', 'SCH 2', TAILORED_IDS.hopper],
      [sc5Fitted.noteAcceptor, 'note acceptor', 'JCM EBA', TAILORED_IDS.notes],
    ];
    for (const [named, what, model, node] of sc5Stand) {
      if (named !== null && named !== undefined) continue;
      noteBoardDefault(m, {
        axis: 'peripheral',
        text: `${what}: ${model} - the layout names none`,
        ifWrong: `Firmware written for another ${what} may report it missing or faulty.`,
        node,
      });
    }
    if (sc5Fitted.hoppers[1] === null || sc5Fitted.hoppers[1] === undefined) {
      noteBoardDefault(m, {
        axis: 'hopper',
        text: 'hopper 2: SCH 2 - the layout names none',
        ifWrong: 'Firmware written for another second hopper may report it missing or faulty.',
        node: TAILORED_IDS.hopper,
      });
    }

    const desKey = (name: string) => parseDesKey(game.gam?.settings.get(name) ?? '');
    m.setDesKeys({
      mech: desKey('MechDeskey'), hopper: desKey('Hop1Deskey'), hopper2: desKey('Hop2Deskey'), note: desKey('BNVDeskey'),
    });
    const bnv = (game.gam?.settings.get('BNVkey') ?? '').trim();
    if (/^\d{6}$/.test(bnv)) m.setBnvKey([...bnv].map(Number));
    const partBnv = (name: string): number[] | null => {
      const v = (game.gam?.settings.get(name) ?? '').trim();
      return /^\d{6}$/.test(v) ? [...v].map(Number) : null;
    };
    m.setPartBnvKeys({ mech: partBnv('MechBNVkey'), hopper: partBnv('Hop1BNVkey'), hopper2: partBnv('Hop2BNVkey') });

    const setting = (name: string): number | undefined => {
      const v = Number(game.gam?.settings.get(name));
      return Number.isFinite(v) ? v : undefined;
    };
    const named = (name: string): number | null | undefined =>
      (game.gam ? setting(name) ?? null : undefined);
    m.setConfigKeys({
      stake: named('Stake'),
      prize: named('Jackpot'),
      percentage: named('Percentage'),
    });
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);

    m.setDips(gamDipByteLsb(game.gam?.dips.get(1)), gamDipByteLsb(game.gam?.dips.get(2)));
    wireOptionSwitches(m, game, [1, 2], 16);
    m.setLayoutSwitches(props?.switches ?? layoutSwitches(game.layout));

    m.fitSec(game.gam?.sec ?? []);
    const sc5Layout = decodedLayout(game.layout);
    const meters = sc5Layout ? meterMoneyMap(sc5Layout, 'SCORPION5') : null;
    if (meters) m.setSecMoneyMap(meters.secIn, meters.secOut);

    const eeps = byExt(game, /\.eep$/i);
    const manifests = [game.variant, ...game.files.filter((f) => CONFIG_FILE.test(f.name)).map((f) => f.name)]
      .map((n) => stem(n).toLowerCase());
    const eep = manifests.map((s) => eeps.find((f) => stem(f.name).toLowerCase() === s)).find(Boolean) ?? eeps[0];
    if (eep) m.loadEeprom(eep.bytes);

    const e2ps = byExt(game, /\.e2p$/i);
    const e2p = manifests.map((s) => e2ps.find((f) => stem(f.name).toLowerCase() === s)).find(Boolean) ?? e2ps[0];
    if (e2p) m.loadE2rom(e2p.bytes);

    const wsps = byExt(game, /\.wsp$/i);
    const wsp = manifests.map((s) => wsps.find((f) => stem(f.name).toLowerCase() === s)).find(Boolean) ?? wsps[0];
    if (wsp) m.loadGameCard(wsp.bytes);

    const nv = game.nvram;
    if (nv) m.loadNvram(nv);
    m.reset();
  restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
}

function fitSc5Video(game: Game, m: Sc5): void {
  const screens = [{ width: 600, height: 800 }, { width: 600, height: 800 }];
  const layout = decodedLayout(game.layout);
  let declared = false;
  for (const c of layout ? parseLayout(layout) : []) {
    if (c.type !== 0x1f) continue;
    declared = true;
    if (c.number !== 0 && c.number !== 1) continue;
    screens[c.number] = adder5ScreenSize(c.values.get('VideoMode') ?? -1) ?? screens[c.number];
  }
  if (game.system !== 'ADDER5' && !declared) return;
  m.fitAdder5(screens[0].width, screens[0].height, screens[1].width, screens[1].height);
}

const scorpion5: Platform = {
  system: 'SCORPION5',
  build(game) {
    const m = new Sc5();
    const named = manifestRoms(game);
    const pool = named.length ? named : game.files;
    if (named.length === 1 && !/\.(hi|lo)(gh|w)?$/i.test(named[0].name)) {
      m.loadRomFlat(named[0].bytes);
      fitSc5Video(game, m);
      return finishScorpion5(game, m);
    }
    if (named.length > 2 && named.length === game.gam?.roms.length) {
      m.loadRomFlat(placeRomPairs(named.map((f) => f.bytes), 0x80000, 1));
      fitSc5Video(game, m);
      return finishScorpion5(game, m);
    }
    const lanes = game.gam?.roms?.length ? lineOneOddPair(game) : null;
    const hi = lanes ? { bytes: lanes[0] } : pool.find((f) => /\.hi(gh)?$/i.test(f.name));
    const lo = lanes ? { bytes: lanes[1] } : pool.find((f) => /\.lo(w)?$/i.test(f.name));
    if (!hi || !lo) {
      if (!named.length) throw noRoms(game, 'no Scorpion 5 .hi/.lo ROM pair found');
      throw new Error('no Scorpion 5 .hi/.lo ROM pair found');
    }
    m.loadRomPair(hi.bytes, lo.bytes);
    fitSc5Video(game, m);
    return finishScorpion5(game, m);
  },
};

function epochProgram(game: Game): GameFile[] {
  const named = manifestRoms(game);
  const whole = named.length === 1 && game.gam?.roms.length === 1;
  return named.length >= 2 || whole ? named : byExt(game, /\.g[0-9]$/);
}

const epoch: Platform = {
  system: 'EPOCH',
  build(game) {
    const parts = epochProgram(game);
    const named = game.gam?.roms.length ? manifestRoms(game) : [];
    const whole = parts.length === 1 && named.length === 1;
    if (parts.length < 2 && !whole) throw noRoms(game, 'no Maygay Epoch program ROM pair (.g0/.g1)');

    const m = new Epoch();
    m.loadRom(placeRomPairs(parts.map((f) => f.bytes), 0, 0));

    if (!m.coinTables) {
      noteBoardDefault(m, {
        axis: 'coin',
        text: 'coin codes: this program\'s coin table was not found - coins go in as MFME\'s own Epoch codes',
        ifWrong: 'A program reading other codes takes no coin, or credits a value other than the slot shows.',
        node: TAILORED_IDS.coinMech,
      });
    }

    const setting = (name: string): number | undefined => {
      const raw = game.gam?.settings.get(name);
      const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    m.stakeKey = setting('Stake') ?? -1;
    m.jackpotKey = setting('Jackpot') ?? -1;
    m.percentKey = setting('Percentage') ?? -1;
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);

    m.fitDataPak(setting('Protocol') ?? 0);

    const bank = (n: number): number => {
      const bits = game.gam?.dips.get(n);
      if (!bits) return 0;
      let v = 0;
      for (let i = 0; i < bits.length && i < 8; i++) if (bits[i] === '1') v |= 1 << i;
      return v;
    };
    m.dips = [bank(1), bank(2)];
    wireOptionSwitches(m, game, [1, 2], 16);

    (game.gam?.sec ?? []).forEach((c, i) => {
      m.sec.counters[i] = c.value;
      if (c.label) m.sec.counterText[i] = c.label;
    });

    const snd = (game.gam?.sound ?? [])
      .map((n) => file(game, n))
      .filter((f): f is GameFile => !!f);
    const sounds = snd.length ? snd : byExt(game, /snd[0-9]?\.bin$/i);
    if (sounds.length) m.loadSoundRoms(sounds[0].bytes, sounds[1]?.bytes);

    const geometry = reelGeometry(game.layout);
    const epochPayload = decodedLayout(game.layout);
    const reelBoard = epochPayload && readSetting(epochPayload, 'EPOCH', 'Reel Board') === '6' ? 6 : 3;

    const HOPPER_TYPES = ['Coin Controls', 'Universal', 'Coin Controls II', 'Other', 'Universal II'];
    const hopperName = epochPayload ? readSetting(epochPayload, 'EPOCH', 'Hopper') : null;
    const hopperIndex = hopperName === null ? -1 : HOPPER_TYPES.indexOf(hopperName);
    m.hopperType = hopperIndex >= 0 ? hopperIndex : 0;
    if (hopperName === null) {
      noteBoardDefault(m, {
        axis: 'hopper',
        text: 'hopper wiring: Coin Controls - the layout does not say',
        ifWrong: 'The hopper motor and coin sense are on other pins; the machine cannot pay out.',
        node: TAILORED_IDS.hopper,
      });
    } else if (hopperName !== null && hopperIndex < 0) {
      noteBoardDefault(m, {
        axis: 'hopper',
        text: `hopper wiring: ${hopperName} not known - Coin Controls stands in`,
        ifWrong: 'The hopper motor and coin sense are on other pins; the machine cannot pay out.',
        node: TAILORED_IDS.hopper,
      });
    }
    if (geometry.length) m.setReelGeometry(geometry, reelBoard);
    m.lampTestPass = layoutLampTestPass(m, epochPayload, 'EPOCH');
    m.setLayoutSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
    m.clearIdleDoors();
    applyOperatorPresets(m, game, {
      service: { fallback: 24, made: true },
      cash: { fallback: 39, made: true },
      refill: { fallback: 37, made: false },
    });

    const epochMeters = epochPayload ? meterMoneyMap(epochPayload, 'EPOCH') : null;
    if (epochMeters) {
      m.setMeterMoney(epochMeters.meterOut, epochMeters.meterIn);
      m.setSecMoneyMap(epochMeters.secOut, epochMeters.secIn);
      if (m.pricesOutAtSec()) {
        noteBoardDefault(m, {
          axis: 'meter',
          text: 'SEC counter priced at 10p a unit - assumed for this board',
          ifWrong: 'A cabinet counting its SEC in another unit shows wrong bookkeeping totals.',
          node: TAILORED_IDS.meters,
        });
      }
    }

    const nv = game.nvram;
    if (nv) m.loadNvram(nv);
    m.reset();
    restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
  },
};

const mps2: Platform = {
  system: 'MPS2',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|\d)$/i).filter((f) => !/snd|sound/i.test(f.name));
    if (!progFiles.length) throw noRoms(game, 'no MPS2 program ROM');

    const m = new Mps2(progFiles.map((f) => f.bytes), game.nvram);

    const mps2Reels = reelGeometry(game.layout);
    m.setReelGeometry(mps2Reels);
    m.setDips(dipLsbFirst(game.gam?.dips.get(1)), dipLsbFirst(game.gam?.dips.get(2)));
    wireOptionSwitches(m, game, [1, 2], 16);
    m.setLayoutSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: 0, made: false, tag: false },
      cash: { fallback: null, made: false },
      refill: { fallback: 18, made: false, tag: false },
    });
    fitReels(m, game);
    const layout = decodedLayout(game.layout);
    {
      const hoppers = layout ? readCheckboxByte(layout, 'MPS2', 'Hopper 1') : null;
      const gamHoppers = game.gam?.settings.get('Hoppers');
      if (hoppers !== null) {
        m.setHoppers(hoppers);
      } else if (gamHoppers !== undefined) {
        m.setHoppers(Number(gamHoppers));
      } else {
        noteBoardDefault(m, {
          axis: 'hopper',
          text: 'hopper: none fitted - neither the layout nor the .gam says',
          ifWrong: 'A cabinet that pays from a hopper cannot pay out.',
          node: TAILORED_IDS.hopper,
        });
      }
    }
    const tubes = m.tubeSensesStoodIn;
    if (tubes.length) {
      noteBoardDefault(m, {
        axis: 'coin',
        text: `change tube level ${tubes.length > 1 ? 'senses' : 'sense'} ${tubes.join(', ')} not drawn by the layout - read as full`,
        ifWrong: 'A machine with empty tubes keeps taking coins it cannot give change for.',
      });
    }
    m.setProtocol(Number(game.gam?.settings.get('Protocol') ?? 0) || 0);

    const meters = layout ? meterMoneyMap(layout, 'MPS2') : null;
    if (meters) m.setMeterMoney(meters.meterIn, meters.meterOut);

    m.reset();
    restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
  },
};

const sys80: Platform = {
  system: 'SYSTEM80',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|p\d)$/i);
    if (!progFiles.length) throw noRoms(game, 'no System 80 program ROM');

    const m = new Sys80(progFiles.map((f) => f.bytes), game.nvram);

    m.setReelGeometry(reelGeometry(game.layout));
    m.setDips(dipLsbFirst(game.gam?.dips.get(1)), dipLsbFirst(game.gam?.dips.get(3)));
    wireOptionSwitches(m, game, [1, 3], 12);
    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, DEFAULT_PRESETS);
    m.setPortMap(sys80PortMap(game.layout));
    const payload = decodedLayout(game.layout);
    m.setRotary((payload && readNumber(payload, 'SYSTEM80', 'Rotary Switch')) ?? 0);
    const s80Meters = payload ? meterMoneyMap(payload, 'SYSTEM80') : null;
    noteBoardDefault(m, {
      axis: 'meter',
      text: 'meter pulse priced at 10p - assumed for this board',
      ifWrong: 'A cabinet metering in another unit shows wrong bookkeeping totals.',
      node: TAILORED_IDS.meters,
    });
    if (s80Meters) m.setMeterMoney(s80Meters.meterIn, s80Meters.meterOut);

    m.reset();
    game.gam?.reels.forEach((r, i) => m.setReelPosition(i, r.position));
    return m;
  },
};

const sys1: Platform = {
  system: 'SYS1',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|p\d)$/i);
    if (!progFiles.length) throw noRoms(game, 'no Ace System 1 program ROM');
    const m = new Sys1(progFiles.map((f) => f.bytes), game.nvram);
    const sys1Alpha = v20AlphaServe(game.layout, { m10937: [0], bd1: 1 });
    m.alphaRoute = sys1Alpha?.decoder ?? null;
    m.bd1.drawsHidden = sys1Alpha?.drawsHidden ?? true;
    m.setReelGeometry(reelGeometry(game.layout));
    m.setDips(dipLsbFirst(game.gam?.dips.get(1)), dipLsbFirst(game.gam?.dips.get(2)));
    wireOptionSwitches(m, game, [1, 2], 16);
    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, DEFAULT_PRESETS);
    const payload = decodedLayout(game.layout);
    m.setStepMode((payload && readNumber(payload, 'SYS1', 'Step Mode')) ?? 0);
    const sys1Slides = payload && triacSlidePence(payload, 'SYS1');
    if (sys1Slides) m.setSlidePence(sys1Slides);
    if (!sys1Slides?.some((x) => x !== null)) {
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'payout slides not named by the layout - money out not booked',
        ifWrong: 'Bookkeeping shows no money out for this machine; play is not affected.',
      });
    }
    m.reset();
    game.gam?.reels.forEach((r, i) => m.setReelPosition(i, r.position));
    return m;
  },
};

const proconn: Platform = {
  system: 'PROCONN',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|p\d)$/i);
    if (!progFiles.length) throw noRoms(game, 'no Proconn program ROM');
    const m = new Proconn(progFiles.map((f) => f.bytes), game.nvram);
    const sndFiles = (game.gam?.sound ?? []).map((n) => file(game, n)).filter((f): f is GameFile => !!f);
    if (sndFiles.length) {
      const snd = decodedLayout(game.layout);
      const tag54 = snd ? fileLevelTags(snd).get(0x54) : undefined;
      const sampled = tag54 && tag54.length >= 4
        ? (tag54[0] | (tag54[1] << 8) | (tag54[2] << 16) | (tag54[3] << 24)) >>> 0
        : undefined;
      m.loadSound(sndFiles.map((f) => f.bytes), sampled);
    }
    m.setReelGeometry(reelGeometry(game.layout));
    m.setDips(dipLsbFirst(game.gam?.dips.get(1)));
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (game.gam?.dips.get(1) === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no option-switch bank stated - all eight read as off',
        ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
      });
    }
    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: 38, made: false },
      cash: { fallback: 15, made: false },
      refill: { fallback: 16, made: false },
    });
    const payload = decodedLayout(game.layout);
    if (payload) {
      const tags = fileLevelTags(payload);

      const type = readSetting(payload, 'PROCONN', 'Type');
      m.setConfig({
        type: type === 'PC90' ? ProconnType.PC90 : type === 'PC Plus' ? ProconnType.PCPlus : ProconnType.PC92,
        displayType: readSetting(payload, 'PROCONN', 'Display Type') === 'LCD' ? 1 : 0,
        hopperBits: readCheckboxByte(payload, 'PROCONN', 'Hopper 1') ?? undefined,
        card: tags.get(5),
        protocol: Number(game.gam?.settings.get('Protocol') ?? 0) || 0,
      });
      const meters = meterMoneyMap(payload, 'PROCONN');
      if (meters) m.setMeterMoney(meters.meterIn, meters.meterOut);
    }
    m.reset();
    game.gam?.reels.forEach((r, i) => m.setReelPosition(i, r.position));
    return m;
  },
};

const electrocoin: Platform = {
  system: 'ELECTROCOIN',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(bin|hex)$/i);
    if (!progFiles.length) throw noRoms(game, 'no Electrocoin program ROM');
    const m = new Electrocoin(progFiles.map((f) => f.bytes), game.nvram);
    const sndFiles = [...(game.gam?.sound ?? []), ...(game.gam?.slaveRoms ?? [])]
      .map((n) => file(game, n)).filter((f): f is GameFile => !!f);
    if (sndFiles.length) m.loadSound(sndFiles.map((f) => f.bytes));
    m.setReelGeometry(reelGeometry(game.layout));
    m.setDips(dipLsbFirst(game.gam?.dips.get(1)));
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (game.gam?.dips.get(1) === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no option-switch bank stated - all eight read as off',
        ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
      });
    }
    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, DEFAULT_PRESETS);
    const payload = decodedLayout(game.layout);
    if (payload) {
      const line = (c: string) => {
        const n = readSwitchNumber(payload, 'ELECTROCOIN', c);
        return n === null || n >= 0x80000000 ? 0xff : n;
      };
      m.setConfig({
        segType: readSetting(payload, 'ELECTROCOIN', '7Seg') === 'Type 2' ? 1 : 0,
        hopperMotor: [line('Hopper Motor 1'), line('Hopper Motor 2')],
        hopperOpto: [line('Hopper Opto 1'), line('Hopper Opto 2')],
        protocol: Number(game.gam?.settings.get('Protocol') ?? 0) || 0,
        secKept: fileLevelTags(payload).get(5)?.[0],
      });
      const meters = meterMoneyMap(payload, 'ELECTROCOIN');
      if (meters) m.setMeterMoney(meters.meterIn, meters.meterOut);
      else {
        m.setMeterMoney(STANDARD_METER_GRID.meterIn, STANDARD_METER_GRID.meterOut);
        noteBoardDefault(m, {
          axis: 'meter',
          text: 'meters priced at the standard 10p assignment - this layout states none',
          ifWrong: 'A cabinet that meters differently shows wrong bookkeeping totals; play is not affected.',
          node: TAILORED_IDS.meters,
        });
      }
      const slides = triacSlidePence(payload, 'ELECTROCOIN');
      if (slides) m.setSlidePence(slides);
    }
    m.reset();
    game.gam?.reels.forEach((r, i) => m.setReelPosition(i, r.position));
    return m;
  },
};

function phoenixPlatform(system: 'PHOENIX' | 'PHOENIX2'): Platform {
  return {
    system,
    build(game) {
      const progFiles = game.gam
        ? manifestRoms(game)
        : byExt(game, /\.bin$/i);
      if (!progFiles.length) throw noRoms(game, 'no Phoenix program ROM');
      const m = new Phoenix(progFiles.map((f) => f.bytes), game.nvram, system === 'PHOENIX2');
      const sndFiles = (game.gam?.sound ?? []).map((n) => file(game, n)).filter((f): f is GameFile => !!f);
      if (sndFiles.length) m.loadSound(sndFiles.map((f) => f.bytes));
      m.setReelGeometry(reelGeometry(game.layout));
      m.setDips(dipLsbFirst(game.gam?.dips.get(1)), dipLsbFirst(game.gam?.dips.get(2)));
      if (system === 'PHOENIX2') wireOptionSwitches(m, game, [1], 8);
      else wireOptionSwitches(m, game, [1, 2], 16);
      const pct = Number(game.gam?.settings.get('Percentage'));
      m.setPercentage(Number.isInteger(pct) && pct >= 0 && pct < 15 ? pct + 1 : 0);
      m.setSwitches(layoutSwitches(game.layout));
      applyOperatorPresets(m, game, DEFAULT_PRESETS);
      const payload = decodedLayout(game.layout);
      if (payload) {
        const meters = meterMoneyMap(payload, system);
        noteBoardDefault(m, {
          axis: 'meter',
          text: 'meter pulse priced at 10p - assumed for this board',
          ifWrong: 'Only bookkeeping totals are affected; play is not.',
          node: TAILORED_IDS.meters,
        });
        if (meters) m.setMeterMoney(meters.meterIn, meters.meterOut);
      }
      m.reset();
      game.gam?.reels.forEach((r, i) => m.setReelPosition(i, r.position));
      return m;
    },
  };
}
const phoenix = phoenixPlatform('PHOENIX');
const phoenix2 = phoenixPlatform('PHOENIX2');

const sru: Platform = {
  system: 'SRU',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.bin$/i);
    if (!progFiles.length) throw noRoms(game, 'no SRU program ROM');
    const m = new Sru(progFiles.map((f) => f.bytes), game.nvram);
    m.setReelGeometry(reelGeometry(game.layout));
    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, DEFAULT_PRESETS);
    m.setPortMap(sys80PortMap(game.layout));
    const payload = decodedLayout(game.layout);
    m.setTonePot((payload && readNumber(payload, 'SRU', 'Sound Pitch')) ?? SRU_TONE_POT_DEFAULT);
    if (payload) {
      const slides = triacSlidePence(payload, 'SRU');
      if (slides) m.setSlidePence(slides);
    }
    const sruCoins = sruCoinsFromCabinet(cabinetCoinSlots(game.layout, SRU_COIN_ROW));
    m.setCoinPence(sruCoins);
    if (sruCoins.some((c) => c === null)) {
      if (sruCoins.every((c) => c === null)) {
        noteBoardDefault(m, {
          axis: 'coin',
          text: 'what each coin slot takes is not known for this cabinet - the player is asked once',
          ifWrong: 'Until a slot is answered, coins put in it are not booked.',
        });
      } else {
        noteBoardDefault(m, {
          axis: 'coin',
          text: 'what some coin slots take is not known for this cabinet - the player is asked once',
          ifWrong: 'Until a slot is answered, coins put in it are not booked.',
        });
      }
    }
    m.reset();
    game.gam?.reels.forEach((r, i) => m.setReelPosition(i, r.position));
    return m;
  },
};

const blackbox: Platform = {
  system: 'BLACKBOX',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.bin$/i).slice().sort((a, b) => b.name.localeCompare(a.name));
    if (!progFiles.length) throw noRoms(game, 'no Black Box program ROM');
    const m = new BlackBox(progFiles.map((f) => f.bytes), game.nvram);
    m.setReelGeometry(reelGeometry(game.layout));
    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, DEFAULT_PRESETS);
    const bbLayout = decodedLayout(game.layout);
    if (bbLayout) {
      const bbSound = readSetting(bbLayout, 'BLACKBOX', 'Sound Type');
      const bbSoundIndex = ({ NE566: 0, NE555: 1, 'NE555-2': 2 } as const)[bbSound as 'NE566'];
      m.setSoundType(bbSoundIndex ?? null);
      if (bbSoundIndex === undefined) {
        noteBoardDefault(m, {
          axis: 'peripheral',
          text: 'tone generator type not stated by the layout - no tone',
          ifWrong: 'A cabinet fitted with a tone generator plays no tones.',
        });
      }
      const meters = meterMoneyMap(bbLayout, 'BLACKBOX');
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'meter pulse priced at 2p - assumed for this board',
        ifWrong: 'A cabinet on another base coin shows wrong bookkeeping totals.',
        node: TAILORED_IDS.meters,
      });
      if (meters) m.setMeterMoney(meters.meterIn, meters.meterOut);
      const slides = triacSlidePence(bbLayout, 'BLACKBOX');
      if (slides) m.setSlidePence(slides);
    }
    m.reset();
    restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
  },
};

const mpu3: Platform = {
  system: 'MPU3',
  build(game) {
    const progFiles = game.gam
      ? manifestRoms(game)
      : byExt(game, /\.(p\d+|bin)$/i).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!progFiles.length) throw noRoms(game, 'no MPU3 program ROM');
    const m = new Mpu3(progFiles.map((f) => f.bytes), game.nvram);
    m.setReelGeometry(storedLayoutProps(game)?.reels ?? reelGeometry(game.layout));
    m.setDips(dipLsbFirst(game.gam?.dips.get(1)), dipLsbFirst(game.gam?.dips.get(2)));
    wireOptionSwitches(m, game, [1, 2], 16);
    m.setSwitches(storedLayoutProps(game)?.switches ?? layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: 8, made: false },
      cash: { fallback: null, made: false },
      refill: { fallback: 0x14, made: false },
    });
    const payload = decodedLayout(game.layout);
    if (payload) {
      const port = readSetting(payload, 'MPU3', 'Display Port');
      if (port === 'Meters') m.displayPort = Mpu3DisplayPort.Meters;
      else if (port === 'bwb') m.displayPort = Mpu3DisplayPort.Bwb;
      else if (port === null) {
        noteBoardDefault(m, {
          axis: 'peripheral',
          text: 'display port not stated by the layout - driving 7-segment digits',
          ifWrong: 'A cabinet with meters on that port shows no meter counts and may alarm.',
        });
      }
      const sense = readLayoutWord(payload, 0x10);
      if (sense !== null) m.meterSenseLine = sense === 0xffffffff ? -1 : (sense >> 8) & 0x7f;
      const senseMask = readLayoutWord(payload, 0x15);
      if (senseMask !== null) m.meterSenseMask = Math.min(senseMask, 0x3f);
      const chr = readLayoutWord(payload, 0x12);
      if (chr !== null) m.chrAddr = chr & 0xffff;
      const slides = triacSlidePence(payload, 'MPU3');
      if (slides) m.setSlidePence(slides);
      const meters = meterMoneyMap(payload, 'MPU3');
      if (meters) m.setMeterMoneyMap(meters);
    }
    if (!m.moneyPriced) {
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'meters not priced by the layout - money in and out not booked',
        ifWrong: 'Bookkeeping shows no money for this machine; play is not affected.',
        node: TAILORED_IDS.meters,
      });
    }
    m.reset();
    restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
  },
};

const adder5: Platform = {
  system: 'ADDER5',
  build: (game) => scorpion5.build(game),
};

function astraProgram(game: Game): GameFile[] {
  const named = manifestRoms(game);
  return named.length ? named : byExt(game, /\.u\d$/i);
}

const astra: Platform = {
  system: 'ASTRASYSA1',
  build(game) {
    const prog = astraProgram(game);
    if (!prog.length) throw noRoms(game, 'no Astra System A1 program ROM (.u1)');
    const m = new Astra();
    m.loadRom(prog.map((f) => f.bytes));
    const astraSnd = (game.gam?.sound ?? [])
      .map((n) => file(game, n))
      .filter((f): f is GameFile => !!f);
    if (astraSnd.length) {
      const total = astraSnd.reduce((n, f) => n + f.bytes.length, 0);
      const sample = new Uint8Array(total);
      let at = 0;
      for (const f of astraSnd) { sample.set(f.bytes, at); at += f.bytes.length; }
      m.ymz.loadRom(sample);
    }

    const payload = decodedLayout(game.layout);
    if (payload) {
      m.fpgaDesign = readSetting(payload, 'ASTRASYSA1', 'FPGA Type') === '2' ? 1 : 0;
      m.dotFitted = parseLayout(payload).some((c) => c.type === 0x1a);
      m.dot.charsetShift = (fileLevelTags(payload).get(0x8a)?.[0] ?? 0) === 1;
      m.muxType = readSetting(payload, 'ASTRASYSA1', 'Multiplex Type') === '2' ? 1 : 0;
      const opto = ['Normal', 'Inverted', 'Reversed', 'Rev Inv'].indexOf(
        readSetting(payload, 'ASTRASYSA1', 'Hopper Opto') ?? 'Normal');
      m.hopperOpto = opto < 0 ? 0 : opto;
      const astraSec = layoutSecFitted(game, 'ASTRASYSA1');
      m.secFitted = astraSec ?? !!game.gam?.sec.length;
      if (astraSec === null) noteSecInferred(m, m.secFitted ? 'fitted' : 'none');
      if (m.secFitted) {
        (game.gam?.sec ?? []).forEach((c, i) => {
          m.sec.counters[i] = c.value;
          if (c.label) m.sec.counterText[i] = c.label;
        });
      }
      const meters = meterMoneyMap(payload, 'ASTRASYSA1');
      noteBoardDefault(m, {
        axis: 'meter',
        text: 'meter pulse priced at 10p - assumed for this board',
        ifWrong: 'A cabinet metering in another unit shows wrong bookkeeping totals.',
        node: TAILORED_IDS.meters,
      });
      if (meters) {
        m.setMeterMoney(meters.meterIn, meters.meterOut);
        m.setSecMoneyMap(meters.secIn, meters.secOut);
        if (m.secFitted) {
          noteBoardDefault(m, {
            axis: 'meter',
            text: 'SEC counter priced at 10p a unit - assumed for this board',
            ifWrong: 'A cabinet counting its SEC in another unit shows wrong bookkeeping totals.',
            node: TAILORED_IDS.meters,
          });
        }
      }
    }
    const geometry = reelGeometry(game.layout);
    if (geometry.length) m.setReelGeometry(geometry);

    const bank = (n: number): number => {
      const bits = game.gam?.dips.get(n) ?? '';
      let v = 0;
      for (let i = 0; i < bits.length && i < 8; i++) if (bits[i] === '1') v |= 1 << i;
      return v;
    };
    m.dip1 = bank(1);
    m.dip2 = bank(2);
    m.setDilLabels(dipSwitchLabelsFrom(game.layout));
    if (game.gam?.dips.get(1) === undefined && game.gam?.dips.get(2) === undefined) {
      noteBoardDefault(m, {
        axis: 'manifest',
        text: 'no option-switch banks stated - all sixteen read as off',
        ifWrong: 'The firmware takes its site options from those switches, so it may run at the wrong stake or percentage.',
      });
    }
    const setting = (name: string): number | undefined => {
      const raw = game.gam?.settings.get(name);
      const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    m.stakeKey = setting('Stake') ?? -1;
    m.jackpotKey = setting('Jackpot') ?? -1;
    m.percentKey = setting('Percentage') ?? -1;
    noteKeysNotNamed(m, game, ['Stake', 'Jackpot', 'Percentage']);
    m.fitDataPak(setting('Protocol') ?? 0);

    m.setSwitches(layoutSwitches(game.layout));
    applyOperatorPresets(m, game, {
      service: { fallback: null, made: true },
      cash: { fallback: null, made: true },
      refill: { fallback: null, made: false },
    });
    if (game.nvram) m.loadNvram(game.nvram);
    m.reset();
    restoreGamReels(m, game, MFME_OWN_SPACE, layoutReelNumbers(game));
    return m;
  },
};

const PLATFORMS = new Map<string, Platform>(
  [scorpion4, scorpion2, scorpion1, sys85, sys5, mpu4, mpu4video, impact, acesp, m1ab, mpu5, scorpion5, epoch, mps2, sys80, astra, sru, blackbox, adder5, sys1, proconn, electrocoin, phoenix, phoenix2, mpu3]
    .map((p) => [p.system, p]),
);

export function buildableSystems(): string[] {
  return [...PLATFORMS.keys()];
}

export function platformFor(system: string): Platform | undefined {
  return PLATFORMS.get(system.toUpperCase());
}

export interface KnownPlatform {
  label: string;
  sets: number;
  missing: string;
}

export const UNSUPPORTED_SYSTEMS = new Map<string, KnownPlatform>([
  ['ELECTRO', {
    label: 'MFME Electro (electromechanical)',
    sets: 0,
    missing: 'a relay/cam/reel-mech circuit simulator; these cabinets have no '
      + 'CPU or ROM, so no core can be reused and MAME has no driver to port',
  }],
  ['MMM', {
    label: 'Maygay MMM',
    sets: 1,
    missing: 'a Z80 core and Z80 CTC, for a one-game library; '
      + 'its AY-3-8910 is already built',
  }],
]);

export function unsupportedSystem(system: string): KnownPlatform | undefined {
  return UNSUPPORTED_SYSTEMS.get(system.toUpperCase());
}

function absent(game: Game, wanted: string[]): string[] {
  const have = new Set(game.files.map((f) => f.name.toLowerCase()));
  return wanted.filter((n) => n && !have.has(n.toLowerCase()));
}

export function missingProgramRoms(game: Game): string[] {
  const missing = absent(game, game.gam?.roms ?? []);
  if (!missing.length) return missing;
  const allAbsent = missing.length === (game.gam?.roms.filter(Boolean).length ?? 0);
  const standIn = PROGRAM_STAND_INS[game.system.toUpperCase()];
  return standIn && standIn(game, allAbsent) ? [] : missing;
}

const PROGRAM_STAND_INS: Record<string, (game: Game, allAbsent: boolean) => boolean> = {
  M1AB: (g, allAbsent) => allAbsent && m1abProgram(g).length > 0,
  EPOCH: (g) => epochProgram(g).length >= 2
    && !epochProgram(g).every((f) => (g.gam?.roms ?? []).some((n) => n.toLowerCase() === f.name.toLowerCase())),
  ASTRASYSA1: (g, allAbsent) => allAbsent && astraProgram(g).length > 0,
};

function unnamedProgramPool(game: Game): number {
  switch (game.system.toUpperCase()) {
    case 'M1AB': return m1abCandidates(game).length;
    case 'MPU5': return mpu5FlatCandidates(game).length;
    case 'EPOCH': return byExt(game, /\.g[0-9]$/).length;
    case 'ASTRASYSA1': return byExt(game, /\.u\d$/i).length;
    case 'SCORPION5': case 'ADDER5':
      return game.files.filter((f) => /\.(hi(gh)?|lo(w)?)$/i.test(f.name)).length;
    default:
      return game.files.filter((f) =>
        /\.(bin|hex|rom|p\d|evn|odd|hi|lo)$/i.test(f.name) && !/snd|sound/i.test(f.name)).length;
  }
}

export function linkedInstances(game: Game): string[] {
  return game.gam?.instances ?? [];
}

export function missingSoundRoms(game: Game): string[] {
  return absent(game, game.gam?.sound ?? []);
}

export function missingFiles(game: Game): string[] {
  return [...missingProgramRoms(game), ...missingSoundRoms(game)];
}

interface Build {
  variant: GameVariant;
  gamFile: GameFile | null;
  gam: Gam | null;
  swap?: RomSwap;
}

interface RomSwap {
  slot: number;
  name: string;
}

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const ext = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

function commonPrefix(names: string[]): number {
  let n = names[0]?.length ?? 0;
  for (const s of names) {
    let i = 0;
    while (i < n && i < s.length && s[i] === names[0][i]) i++;
    n = i;
  }
  return n;
}

const SEPARATORS = '_-[( .';

function cutAtSeparator(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    if (SEPARATORS.includes(s[i])) return s.slice(0, i + 1);
  }
  return '';
}

const trimName = (s: string): string => s.replace(/[_\-. [(]+$/, '');

function trimLabel(s: string): string {
  let t = s.replace(/^[_\-. ]+/, '').replace(/[_\-. ]+$/, '');
  while (/[\])]$/.test(t) && !t.includes(t.endsWith(']') ? '[' : '(')) {
    t = t.slice(0, -1).replace(/[_\-. ]+$/, '');
  }
  return t;
}

function alternativeRoms(files: GameFile[], gam: Gam): RomSwap[] {
  const referenced = new Set(
    [...gam.roms, ...gam.sound, gam.layout ?? ''].map((n) => n.toLowerCase()),
  );
  const slots = gam.roms
    .map((n, slot) => ({ slot, file: files.find((f) => f.name.toLowerCase() === n.toLowerCase()) }))
    .filter((s): s is { slot: number; file: GameFile } => !!s.file);

  const out: RomSwap[] = [];
  for (const f of files) {
    if (referenced.has(f.name.toLowerCase()) || CONFIG_FILE.test(f.name)) continue;
    let best: RomSwap | null = null;
    let bestScore = 0;
    for (const s of slots) {
      if (ext(s.file.name) !== ext(f.name) || s.file.bytes.length !== f.bytes.length) continue;
      const a = stem(s.file.name).toLowerCase();
      const b = stem(f.name).toLowerCase();
      const n = commonPrefix([a, b]);
      if (n < 3 || n * 2 < Math.min(a.length, b.length)) continue;
      if (n > bestScore) {
        best = { slot: s.slot, name: f.name };
        bestScore = n;
      }
    }
    if (best) out.push(best);
  }
  return out;
}

function builds(files: GameFile[]): Build[] {
  const gams = files.filter((f) => CONFIG_FILE.test(f.name));

  if (gams.length > 1) {
    const stems = gams.map((g) => stem(g.name));
    const shared = cutAtSeparator(stems[0].slice(0, commonPrefix(stems))).length;
    let labels = stems.map((s) => trimLabel(s.slice(shared)));
    if (labels.some((l) => !l) || new Set(labels).size !== labels.length) labels = stems;
    return gams.map((g, i) => ({
      variant: { id: g.name, label: labels[i] },
      gamFile: g,
      gam: parseGam(latin1(g.bytes)),
    }));
  }

  const gamFile = gams[0] ?? null;
  const gam = gamFile ? parseGam(latin1(gamFile.bytes)) : null;
  const swaps = gam ? alternativeRoms(files, gam) : [];
  const base: Build = {
    variant: {
      id: gamFile?.name ?? '',
      label: swaps.length && gam ? stem(gam.roms[swaps[0].slot]) : stem(gamFile?.name ?? ''),
    },
    gamFile,
    gam,
  };
  return [
    base,
    ...swaps.map((swap) => ({
      variant: { id: swap.name, label: stem(swap.name) },
      gamFile,
      gam,
      swap,
    })),
  ];
}

export function gameVariants(files: GameFile[]): GameVariant[] {
  return builds(files).map((b) => b.variant);
}

function gameName(list: Build[]): string | undefined {
  const stems = [...new Set(list.map((b) => b.gamFile?.name).filter((n): n is string => !!n))]
    .map(stem);
  if (!stems.length) return undefined;
  if (stems.length === 1) return stems[0];
  return trimName(cutAtSeparator(stems[0].slice(0, commonPrefix(stems)))) || stems[0];
}

function nvramFor(files: GameFile[], chosen: Build): Uint8Array | undefined {
  return nvramFileFor(files, chosen)?.bytes;
}

function nvramFileFor(files: GameFile[], chosen: Build): GameFile | undefined {
  const rams = files.filter((f) => /\.ram$/i.test(f.name));
  const want = chosen.gamFile ? `${stem(chosen.gamFile.name).toLowerCase()}.ram` : '';
  return rams.find((f) => f.name.toLowerCase() === want) ?? rams[0];
}

export function spareRams(files: GameFile[]): GameFile[] {
  const taken = new Set(builds(files).map((b) => nvramFileFor(files, b)));
  return files.filter((f) => /\.ram$/i.test(f.name) && !taken.has(f));
}

function codepageMangledMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) > 0x7f || b.charCodeAt(i) > 0x7f) continue;
    if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  }
  return true;
}

function underscoreSubstitutedMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const word = (c: string) => /[A-Za-z0-9]/.test(c);
  for (let i = 0; i < a.length; i++) {
    const x = a[i].toLowerCase();
    const y = b[i].toLowerCase();
    if (x === y) continue;
    if ((x === '_' && !word(y)) || (y === '_' && !word(x))) continue;
    return false;
  }
  return true;
}

export function classifyGame(allFiles: GameFile[], name?: string, variant?: string): Game {
  const { files, effectFiles } = splitEffectFiles(allFiles);
  const list = builds(files);
  const chosen = list.find((b) => b.variant.id === variant) ?? list[0];

  let gam = chosen.gam;
  if (gam && chosen.swap) {
    const roms = gam.roms.slice();
    roms[chosen.swap.slot] = chosen.swap.name;
    gam = { ...gam, roms };
  }

  const layoutFile = resolveLayout(files, gam?.layout);

  return {
    name: name ?? gameName(list) ?? 'game',
    system: gam?.system || 'SCORPION4',
    files,
    gam,
    layout: layoutFile?.bytes,
    layoutName: layoutFile?.name,
    nvram: nvramFor(files, chosen),
    variant: chosen.variant.id,
    variants: list.map((b) => b.variant),
    ...(effectFiles ? { effectFiles } : {}),
  };
}

function resolveLayout(files: GameFile[], layoutName: string | undefined): GameFile | undefined {
  const layouts = files.filter((f) => /\.(dat|fml)$/i.test(f.name));
  return layoutName
    ? files.find((f) => f.name.toLowerCase() === layoutName.toLowerCase())
      ?? layouts.find((f) => codepageMangledMatch(f.name, layoutName))
      ?? layouts.find((f) => underscoreSubstitutedMatch(f.name, layoutName))
      ?? (layouts.length === 1 ? layouts[0] : undefined)
    : layouts[0];
}

export const CONFIG_VERSION = 1;

export interface GameConfig {
  version: number;
  source: string;
  system: string;
  gam: GamJson;
}

export function configOf(game: Game): GameConfig | null {
  if (!game.gam) return null;
  return {
    version: CONFIG_VERSION,
    source: game.variant,
    system: game.system,
    gam: gamToJson(game.gam),
  };
}

export function gameFromConfig(allFiles: GameFile[], config: GameConfig, name?: string): Game {
  if (typeof config.version !== 'number' || config.version > CONFIG_VERSION) {
    throw new Error(
      `configuration v${String(config.version)} is newer than this build reads (v${CONFIG_VERSION})`,
    );
  }
  const { files, effectFiles } = splitEffectFiles(allFiles);
  const gam = gamFromJson(config.gam);
  const layoutFile = resolveLayout(files, gam.layout);
  const list = builds(files);
  return {
    name: name ?? gameName(list) ?? 'game',
    system: gam.system || config.system || 'SCORPION4',
    files,
    gam,
    layout: layoutFile?.bytes,
    layoutName: layoutFile?.name,
    nvram: undefined,
    variant: config.source,
    variants: list.map((b) => b.variant),
    ...(effectFiles ? { effectFiles } : {}),
  };
}

export function machineFor(game: Game): Machine {
  const platform = platformFor(game.system);
  if (!platform) {
    const known = unsupportedSystem(game.system);
    if (known) {
      const scale = known.sets > 0 ? ` (${known.sets} sets in MAME)` : '';
      throw new Error(
        `${known.label} is not emulated yet${scale}. Needs ${known.missing}.`,
      );
    }
    throw new Error(`system not supported: ${game.system}`);
  }
  const absentProgram = missingProgramRoms(game);
  if (absentProgram.length) {
    throw new Error(
      `${game.system}: the .gam declares files this folder does not have: ${absentProgram.join(', ')}`,
    );
  }
  const absentFiles = missingFiles(game);
  if (absentFiles.length && !game.files.some((f) => /\.(bin|rom|hi|high|lo|low|evn|odd|p1|g0|g1)$/i.test(f.name))) {
    throw new Error(
      `${game.system}: the .gam declares files this folder does not have: ${absentFiles.join(', ')}`,
    );
  }
  const m = platform.build(game);
  const stoodIn = absent(game, game.gam?.roms ?? []).length;
  if (stoodIn) {
    noteBoardDefault(m, {
      axis: 'manifest',
      text: `program ROMs named but not in this folder: ${stoodIn} - another image from the set is standing in`,
      ifWrong: 'The machine runs a different firmware from the one this cabinet was set up with.',
    });
  }
  if (game.gam && !game.gam.roms.some((n) => n.trim())) {
    const pool = unnamedProgramPool(game);
    noteBoardDefault(m, {
      axis: 'manifest',
      text: `the .gam names no program ROM - the board chose its program by file name from ${pool} candidate file${pool === 1 ? '' : 's'} in this folder`,
      ifWrong: 'If the folder holds more than one firmware, the machine may run a different one from this cabinet\'s.',
    });
  }
  fitReelBounce(m, game);
  noteReelStandIns(m);
  noteBoardTokenLine(m, game);
  const outByGrid = (m as { pricesOut?: () => boolean }).pricesOut?.() === true;
  const hopperRead = (m as { hopperPriceIsDefault?: () => boolean }).hopperPriceIsDefault?.() === false;
  if (['ASTRASYSA1', 'ELECTROCOIN', 'EPOCH'].includes(game.system.toUpperCase()) && !outByGrid && !hopperRead) {
    noteBoardDefault(m, {
      axis: 'hopper',
      text: `hopper coin priced at £1, the ${game.system} board's default - the cabinet states no denomination`,
      ifWrong: 'A hopper paying 20p or 10p coins shows five or ten times the real money out.',
      node: TAILORED_IDS.hopper,
    });
  }
  const SET_PRICED = new Set(['EPOCH', 'MPU5', 'ASTRASYSA1', 'PROCONN', 'BLACKBOX', 'PHOENIX', 'PHOENIX2', 'SRU']);
  if (!SET_PRICED.has(game.system.toUpperCase()) && !cabinetCoinPence(game.layout)) {
    noteBoardDefault(m, {
      axis: 'coin',
      text: `coin and token values: the ${game.system} board's default table - the layout prices no coin line`,
      ifWrong: 'A coin mech programmed differently books the wrong money in.',
      node: TAILORED_IDS.coinMech,
    });
  }
  if (!game.gam) {
    noteBoardDefault(m, {
      axis: 'manifest',
      text: 'no .gam: DIL switches, keys and fitted parts are the board\'s defaults',
      ifWrong: 'Firmware that checks its configuration at boot may alarm, or play at the wrong stake and jackpot.',
    });
  }
  const prog = programRoms(game);
  if (prog.length) {
    const names = readSwitchNames(prog.map((r) => r.bytes));
    if (names) (m as { capNames?: typeof names }).capNames = names;
  }
  return m;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
