export class BuildOnce<K> {
  private readonly runs = new Map<K, { p: Promise<void>; token: object }>();

  constructor(private readonly wanted: (k: K) => boolean = () => true) {}

  run(k: K, work: (live: () => boolean) => Promise<void>): Promise<void> {
    if (!this.wanted(k)) return Promise.resolve();
    const have = this.runs.get(k);
    if (have) return have.p;
    const token = {};
    const live = (): boolean => this.runs.get(k)?.token === token && this.wanted(k);
    const run = { p: Promise.resolve(), token };
    this.runs.set(k, run);
    let p: Promise<void>;
    try { p = work(live); } catch (e) { p = Promise.reject(e); }
    run.p = p.catch((e: unknown) => {
      if (this.runs.get(k)?.token === token) this.runs.delete(k);
      throw e;
    });
    return run.p;
  }

  has(k: K): boolean { return this.runs.has(k); }

  get size(): number { return this.runs.size; }

  forget(k: K): void { this.runs.delete(k); }
}
