import { deleteState, getState, putState, stateHashes, type StateRec } from './store';

export interface StateStore {
  get(key: string): Promise<StateRec | null>;
  put(key: string, rec: StateRec): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<Set<string>>;
}

export const localStateStore: StateStore = {
  get: getState,
  put: (key, rec) => putState(rec.hash === key ? rec : { ...rec, hash: key }),
  delete: deleteState,
  keys: stateHashes,
};
