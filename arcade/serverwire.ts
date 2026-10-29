export const MACHINE_PATH = '/v1/machines';
export const DEV_PLAYER_HEADER = 'x-arcade-dev-player';

export type AcquireReply = { ok: true; leaseMs: number } | { ok: false; why: 'busy' | 'moved'; holderName?: string };
export interface ClaimBody { base: number; fresh: boolean; ledger?: Ledger; kept?: boolean }
export type SeedReply = { ok: true; n: number } | { ok: false; why: 'saved' | 'held' | 'not-host' };
export const SEED_OP = 'seed';
export interface RestartBody extends SaveBody { base: number; stamp: string; kept: boolean }
export type RestartReply = { ok: true; n: number } | { ok: false; why: 'held' | 'moved' | 'current' };
export const RESTART_OP = 'restart';
export type VisitReply =
  | { ok: true; holder: 'you' | 'other' | null; holderName?: string; base: number; player: string; save: SaveBody & { n: number } }
  | { ok: true; holder: 'you' | 'other' | null; holderName?: string; base: number; player: string; save: null; why?: 'none' | 'version' }
  | { ok: true; holder: 'you' | 'other' | null; holderName?: string; base: number; player: string; save: null; why: 'battery'; nvram: string };
export const VISIT_OP = 'visit';
export type RenewReply = { ok: true; leaseMs: number } | { ok: false; why: 'lost' };
export type ReleaseReply = { ok: true; released: boolean };

export interface Ledger {
  inPence: number; outPence: number; unpricedOut: number;
  tokenInPence: number; tokenOutPence: number; unpricedTokenOut: number;
  unpricedTokenIn?: number;
  unpricedIn?: number;
  euroInCents?: number;
  euroOutCents?: number;
}

export interface WalletBalance { cashPence: number; tokenPence: number; coinsSpent?: number; coinsRejected?: number; payDay?: WalletPayDay }
export interface WalletPayDay { floorPence: number; at: number }
export interface CoinTally { spent: number; rejected: number }
export const WALLET_PATH = '/v1/wallet';
export type WalletReply = { ok: true; wallet: WalletBalance };

export interface SaveBody {
  version: number;
  schema: number;
  savedAt: number;
  cycles: number;
  build?: string;
  stamp?: string;
  nvram?: string;
  data: string;
  ledger?: Ledger;
  coins?: CoinTally;
  sinceGame?: CreditSince;
  coinsStopped?: boolean;
}
export interface CreditSince { inPence: number; tokenInPence: number }
export interface LostCredit { at: number; savedAt: number; version: number; n: number; sinceGame: CreditSince | null }
export type SaveReply = { ok: true; n: number; wallet?: WalletBalance } | { ok: false; why: 'not-holder' };
export type LoadReply =
  | { ok: true; save: SaveBody & { n: number } }
  | { ok: true; save: null; why: 'none' | 'version' }
  | { ok: true; save: null; why: 'battery'; nvram: string }
  | { ok: false; why: 'not-holder' };

export interface MachineMoney {
  v: number; total: Ledger; since: number; at: number; restarts: number;
  lost?: LostCredit[];
  coinsStopped?: number;
}
export const MONEY_OP = 'money';
export type MoneyReply = { ok: true; money: MachineMoney | null } | { ok: false; why: 'not-host' };

export interface InputBody { session: string; inputs: RelayInput[] }
export type InputReply = { ok: true; kept: number } | { ok: false; why: 'not-holder' };

export const LIVE_OP = 'live';
export const DEV_PLAYER_PARAM = 'player';
export const LIVE_PING = '{"type":"ping"}';
export const LIVE_PONG = '{"type":"pong"}';

export type Standing = 'holder' | 'lapsed' | 'other';
export interface Presence {
  holder: string | null;
  holderName?: string;
  connected: string[]; watchers: string[]; paused?: boolean;
}

export type RelayInput =
  | { seq: number; cycle: number; kind: 'press' | 'release'; id: number }
  | { seq: number; cycle: number; kind: 'sw'; id: number; on: boolean }
  | { seq: number; cycle: number; kind: 'coin'; bit: number }
  | { seq: number; cycle: number; kind: 'note'; billType: number; parallel?: true };
export interface RelayBatch { session: string; inputs: RelayInput[]; upTo: number }
export interface KeyPart {
  session: string; cycle: number; seq: number; hash: string; signals: string;
  part: number; parts: number; data: string;
}
export const KEY_PART_MAX = 256 * 1024;
export const RELAY_MAX_INPUTS = 2000;

export type LiveToServer =
  | { type: 'beat' }
  | { type: 'here' }
  | { type: 'paused'; paused: boolean }
  | { type: 'watch' }
  | ({ type: 'relay' } & RelayBatch)
  | ({ type: 'key' } & KeyPart);
export type LiveToPage =
  | { type: 'standing'; you: Standing; leaseMs: number }
  | { type: 'presence'; presence: Presence }
  | { type: 'watching'; ok: true }
  | { type: 'watching'; ok: false; why: 'free' | 'yours' }
  | { type: 'key-ask' }
  | ({ type: 'relay' } & RelayBatch)
  | ({ type: 'key' } & KeyPart);

export interface ErrorReply { ok: false; why: string }

export const ARCADES_PATH = '/v1/arcades';
export const ARCADE_NAME_LIMIT = 40;
export const ARCADE_DOC_LIMIT = 8 * 1024 * 1024;
export interface PublishBody { key: string; name: string; public?: boolean; doc?: unknown }
export const ARCADES_PER_PLAYER = 1;
export type PublishReply = { ok: true; public: boolean } | { ok: false; why: 'not-owner' | 'gone' | 'bad' | 'limit' | 'taken' };
export function arcadeNameKey(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}
export interface DeleteBody { key: string }
export type DeleteReply = { ok: true } | { ok: false; why: 'not-owner' };
export interface ArcadeListing {
  id: string; name: string; machines: number; updatedAt: number; viewAt: number; rating: number; ratings: number; visits: number;
  machineIds: string[]; owner?: ArcadeOwner | null;
}
export interface ArcadeOwner { id: string; name: string; avatarAt?: number }
export const MACHINE_ID_LEN = 16;
export const ARCADE_SORTS = ['latest', 'top', 'visits'] as const;
export type ArcadeSort = typeof ARCADE_SORTS[number];
export const RATING_PRIOR = 3;
export const RATING_WEIGHT = 5;
export const VISIT_PATH = 'visit';
export const RATING_PATH = 'rating';
export interface RatingBody { stars: number }
export interface ArcadeRating { rating: number; ratings: number; mine: number }
export type RatingReply = ({ ok: true } & ArcadeRating) | { ok: false; why: 'gone' | 'bad' | 'own' | 'not-visited' | 'signed-out' };
export type ArcadeVisitReply = { ok: true } | { ok: false; why: 'gone' };
export const PLAYING_PATH = 'playing';
export const PLAYING_POLL_MS = 15_000;
export interface MachinePlayer { machine: string; id: string; name: string; avatarAt?: number }
export type PlayingReply = { ok: true; playing: MachinePlayer[] };
export const LEADERS_PATH = 'leaders';
export const LEADERS_SITE_PATH = '/v1/leaders';
export interface LeaderRow {
  id: string; name: string; avatarAt?: number; machine: string; value: number; sittings: number; at: number;
  arcadeId?: string; arcadeName?: string;
}
export type LeadersReply = { ok: true; wins: LeaderRow[]; sessions: LeaderRow[]; regulars: LeaderRow[] };
export const VIEW_KEY_HEADER = 'x-arcade-key';
export const VIEW_TYPES = ['image/webp', 'image/jpeg'] as const;
export const VIEW_LIMIT = 192 * 1024;
export type ViewReply = { ok: true; viewAt: number } | { ok: false; why: 'not-owner' | 'gone' | 'bad' };
export type ArcadeListReply = { ok: true; arcades: ArcadeListing[] };
export type ArcadeReply =
  | { ok: true; arcade: { id: string; name: string; public: boolean; doc: unknown } }
  | { ok: false; why: 'gone' };

export const ACCOUNT_PATH = '/v1/account';
export const ACCOUNT_OPS = ['new-options', 'new', 'login-options', 'login', 'logout', 'passkey-options', 'passkey', 'name', 'theme', 'delete',
  'pair-start', 'pair-wait', 'pair-find', 'pair-approve'] as const;
export type AccountOp = typeof ACCOUNT_OPS[number];
export const PLAYER_NAME_MAX = 24;
export interface AccountInfo { id: string; name: string; dev?: true; avatarAt?: number; theme?: AccountTheme }
export const ACCOUNT_THEMES = ['nebula', 'cherry', 'emerald', 'ocean'] as const;
export type AccountTheme = typeof ACCOUNT_THEMES[number];
export interface ThemeBody { theme: AccountTheme }
export type ThemeReply = { ok: true; account: AccountInfo } | { ok: false; why: 'theme' | 'signed-out' };
export interface NameBody { name: string }
export type NameReply = { ok: true; account: AccountInfo } | { ok: false; why: 'name' | 'signed-out' };
export interface DeleteAccountBody { confirm: true }
export type DeleteAccountReply = { ok: true } | { ok: false; why: 'bad' | 'signed-out' };
export const AVATAR_PATH = 'avatar';
export const AVATAR_TYPES = ['image/jpeg', 'image/webp', 'image/png'] as const;
export const AVATAR_SIZE = 192;
export const AVATAR_LIMIT = 64 * 1024;
export type AvatarReply = { ok: true; account: AccountInfo } | { ok: false; why: 'bad' | 'signed-out' };
export type AccountReply = { ok: true; account: AccountInfo; mine?: ArcadeListing[] } | { ok: false; why: 'signed-out' };
export interface NewOptionsBody { name: string }
export type OptionsReply =
  | { ok: true; options: CreateOptionsJson | GetOptionsJson }
  | { ok: false; why: 'name' | 'address' | 'insecure' | 'signed-out' };
export interface CreateOptionsJson {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  authenticatorSelection: {
    residentKey: 'required'; requireResidentKey: true; userVerification: 'required';
    authenticatorAttachment?: 'platform';
  };
  excludeCredentials?: { type: 'public-key'; id: string }[];
  attestation: 'none';
  timeout: number;
}
export interface GetOptionsJson { challenge: string; rpId: string; userVerification: 'required'; timeout: number }
export interface PasskeyJson {
  id: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string | null;
  };
}
export type SignedInReply =
  | { ok: true; account: AccountInfo; wallet?: WalletBalance }
  | { ok: false; why: 'refused' | 'unknown' | 'expired' | 'address' | 'insecure' | 'signed-out' };
export const PAIR_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PAIR_CODE_LENGTH = 8;
export const PAIR_POLL_MS = 2000;
export interface PairDevice { browser: string | null; os: string | null }
export interface PairCodeBody { code: string }
export interface PairWaitBody { token: string }
export type PairStartReply = { ok: true; code: string; token: string; expiresMs: number } | { ok: false; why: 'insecure' };
export type PairWaitReply = { ok: true; account: AccountInfo } | { ok: false; why: 'waiting' | 'expired' | 'insecure' };
export type PairFindReply = { ok: true; device: PairDevice } | { ok: false; why: 'code' | 'signed-out' };
export type PairApproveReply = { ok: true } | { ok: false; why: 'code' | 'signed-out' };
