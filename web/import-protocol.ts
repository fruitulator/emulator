import type { GameFile } from '../src/machine/registry';
import type { CabGeometry } from './cabjson';
import type { GameMeta } from './store';

export type VariantId = string;

export type ImportRequest =
  | {
      id: number;
      op: 'importUpload';
      zip?: Uint8Array;
      files?: GameFile[];
      spares?: GameFile[];
      hash?: string;
      fallbackName?: string;
      background?: boolean;
      deferArtwork?: boolean;
    }
  | {
      id: number;
      op: 'openPak';
      hash: string;
      variant?: VariantId;
      play?: boolean;
    }
  | {
      id: number;
      op: 'contentHash';
      hash: string;
    }
  | {
      id: number;
      op: 'decodeArtwork';
      hash: string;
    }
  | {
      id: number;
      op: 'refreshThumb';
      hash: string;
    }
  | {
      id: number;
      op: 'importPunnet';
      bytes: Uint8Array;
      fallbackName?: string;
    };

export type ImportStage = 'unpacking' | 'hashing' | 'decoding' | 'encoding' | 'caching';

export type ImportErrorCode =
  | 'corrupt-srcs' | 'missing-pak' | 'quota' | 'multiple-games' | 'corrupt-punnet';

export type ImportResponse =
  | { id: number; kind: 'progress'; stage: ImportStage }
  | {
      id: number;
      kind: 'files';
      files: GameFile[];
      storedMeta?: GameMeta;
      variant?: VariantId;
    }
  | { id: number; kind: 'cabinet'; geo: CabGeometry | null; bitmaps: [number, ImageBitmap][] }
  | { id: number; kind: 'cached'; hash: string; meta: GameMeta }
  | { id: number; kind: 'done'; meta: GameMeta }
  | { id: number; kind: 'stamped'; meta: GameMeta }
  | { id: number; kind: 'error'; phase: string; code?: ImportErrorCode; message: string };
