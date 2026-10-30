import { enhanceSelect, type Dropdown } from '../ui/dropdown';
import { chip, searchBar, sectionHeading, tileCard, tileGrid } from '../ui/list';
import { showToast } from '../ui/toast';
import { loadingLine } from '../ui/progress';
import { UI_ICONS } from '../ui/icons';
import { closeSheet, confirmInSheet, sheetRow, showSheet } from '../ui/sheet';
import { str } from '../i18n';
import { revoke } from './auth';
import type { CatSet, Machine } from './catalogue';
import { SourceClient, SourceError, forgetAnswers, sourceOrigins } from './client';
import { fetchIndex, type Category, type Source, type SourceIndex } from './index';
import { templateVars } from './template';
import { SourceStore, sourceKey } from './store';
import { fetchFromSource, getFailedText } from './get';
import { versionsChip } from '../gamelist';
import { openVersionPicker } from '../versionpicker';
import { cleanTitle, titleKey } from '../versionkey';

export interface ViewHost {
  importQuietly(file: File, origin: string): Promise<string | null>;
  busy(msg: string | null, fraction?: number): void;
  originsHeld(): Promise<Map<string, string>>;
  play(hash: string): void;
  backToLibrary(): void;
  signIn(idx: SourceIndex, s: Source, button: HTMLButtonElement): void;
  addSource(returnTo: HTMLElement, then: (host: string) => void): void;
  errText(e: unknown): string;
}

export const LOCAL = 'local';
const ADD = '+add';
const CATEGORY = 'fruitulator.sources.category';
const BANNER = 'fruitulator.sources.banner';

const load = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {  }
};

export const LIBRARY_PARAM = 'library';
export const CATEGORY_PARAM = 'category';

function setParams(library: string | null, category: string | null): void {
  const u = new URL(location.href);
  if (library === null) u.searchParams.delete(LIBRARY_PARAM); else u.searchParams.set(LIBRARY_PARAM, library);
  if (category === null) u.searchParams.delete(CATEGORY_PARAM); else u.searchParams.set(CATEGORY_PARAM, category);
  if (u.href !== location.href) history.replaceState(history.state, '', u.href);
}

export const originOf = (host: string, sourceId: string, item: string): string => `${sourceKey(host, sourceId)}#${item}`;

export class SourceView {
  private chosen: { idx: SourceIndex; s: Source } | null = null;
  private readonly wrap = document.createElement('div');
  private readonly select = document.createElement('select');
  private dd: Dropdown | null = null;
  private readonly categoryWrap = document.createElement('div');
  private readonly more = document.createElement('button');
  private readonly root = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly reread = new Set<string>();
  private gen = 0;
  private readonly searchBtn = document.createElement('button');
  private readonly search = searchBar({ placeholder: str('sources.search_games'), label: str('sources.search'), onInput: (t) => this.typed(t) });
  private q = '';
  private typing: ReturnType<typeof setTimeout> | undefined;
  private listing: { c: SourceClient; category: Category | undefined } | null = null;
  private held = new Map<string, string>();
  private busy = new Set<string>();
  private waiting = new Map<string, number>();

  constructor(private readonly store: SourceStore, private readonly host: ViewHost) {
    this.wrap.id = 'source-wrap';
    this.wrap.append(this.select);
    this.categoryWrap.id = 'category-wrap';
    this.categoryWrap.hidden = true;
    this.more.type = 'button';
    this.more.className = 'nb-icon-btn upload';
    this.more.id = 'source-more';
    this.more.hidden = true;
    this.more.setAttribute('aria-label', str('sources.source_options'));
    this.more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
    this.more.addEventListener('click', () => this.sourceMenu());
    this.searchBtn.type = 'button';
    this.searchBtn.className = 'nb-icon-btn upload';
    this.searchBtn.id = 'source-search';
    this.searchBtn.hidden = true;
    this.searchBtn.setAttribute('aria-label', str('sources.search'));
    this.searchBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>';
    this.searchBtn.addEventListener('click', () => this.toggleSearch());
    this.search.wrap.id = 'source-search-wrap';
    this.search.wrap.hidden = true;
    this.search.input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      this.closeSearch();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key.toLowerCase() !== 'k' || ev.altKey || ev.shiftKey || ev.isComposing || !(ev.metaKey || ev.ctrlKey)) return;
      if (this.searchBtn.hidden || !this.root.isConnected || this.root.offsetParent === null) return;
      ev.preventDefault();
      this.toggleSearch();
    });
    this.banner.className = 'source-banner nb-notice';
    this.banner.hidden = true;
    this.root.id = 'source-tiles';
    this.root.hidden = true;
    this.select.addEventListener('change', () => {
      const v = this.select.value;
      if (v === ADD) {
        this.select.value = this.chosen ? sourceKey(this.chosen.idx.host, this.chosen.s.id) : LOCAL;
        this.host.addSource(this.more, (h) => this.showHost(h));
        return;
      }
      this.show(v);
    });
  }

  mount(meta: HTMLElement, tiles: HTMLElement, actions: HTMLElement): void {
    meta.prepend(this.wrap);
    this.wrap.after(this.categoryWrap);
    actions.prepend(this.searchBtn, this.more);
    tiles.after(this.search.wrap, this.banner, this.root);
    this.refresh();
  }

  refresh(): void {
    const opts: HTMLOptionElement[] = [new Option(str('sources.my_games'), LOCAL)];
    for (const idx of this.store.hosts()) for (const s of idx.sources) opts.push(new Option(s.name, sourceKey(idx.host, s.id)));
    opts.push(new Option(str('sources.add_source_option'), ADD));
    this.select.replaceChildren(...opts);
    this.select.value = this.chosen ? sourceKey(this.chosen.idx.host, this.chosen.s.id) : LOCAL;
    this.wrap.hidden = opts.length <= 2;
    this.dd?.root.remove();
    this.dd = enhanceSelect(this.select, {
      name: (c) => str('sources.library_n', { 0: c }),
      icons: (v) => (v === LOCAL ? UI_ICONS.library : v === ADD ? UI_ICONS.globeAdd : UI_ICONS.globe),
    });
  }

  get showing(): boolean { return !!this.chosen; }

  showHost(host: string): void {
    this.refresh();
    const idx = this.store.hosts().find((h) => h.host === host);
    if (idx?.sources[0]) this.show(sourceKey(idx.host, idx.sources[0].id));
  }

  show(key: string): void {
    const found = key === LOCAL ? null : this.find(key);
    const named = new URL(location.href).searchParams.get(LIBRARY_PARAM);
    const kept = named !== null && this.store.keyOfSlug(named) === key ? new URL(location.href).searchParams.get(CATEGORY_PARAM) : null;
    this.chosen = found;
    setParams(found ? this.store.slugOf(key) : null, kept);
    this.refresh();
    document.body.classList.toggle('source-view', !!found);
    const add = document.getElementById('addBtn');
    add?.setAttribute('aria-label', found ? str('sources.add_source') : str('index.add_games'));
    this.root.hidden = !found;
    this.more.hidden = !found;
    this.categoryWrap.hidden = true;
    this.offerSearch(false);
    this.drawBanner();
    if (!found) { this.root.replaceChildren(); this.host.backToLibrary(); return; }
    window.scrollTo(0, 0);
    void this.open();
    void this.readAgain(found.idx.host);
  }

  private drawBanner(): void {
    const b = this.chosen?.s.banner;
    const key = this.chosen ? `${BANNER}:${sourceKey(this.chosen.idx.host, this.chosen.s.id)}` : '';
    if (!b || load(key) === b.text) { this.banner.hidden = true; this.banner.replaceChildren(); return; }
    const words = document.createElement('p');
    words.className = 'source-banner-text';
    words.textContent = b.text;
    const parts: HTMLElement[] = [words];
    if (b.url) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'nb-btn nb-btn--sm';
      open.textContent = str('sources.banner_open');
      open.addEventListener('click', () => window.open(b.url, '_blank', 'noopener'));
      parts.push(open);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'nb-icon-btn source-banner-x';
    x.setAttribute('aria-label', str('sources.banner_dismiss'));
    x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
    x.addEventListener('click', () => { save(key, b.text); this.drawBanner(); });
    this.banner.replaceChildren(...parts, x);
    this.banner.hidden = false;
  }

  private async readAgain(host: string): Promise<void> {
    if (this.reread.has(host)) return;
    this.reread.add(host);
    let idx: SourceIndex;
    try { idx = await fetchIndex(host); } catch { return; }
    if (!idx.sources.length) return;
    this.store.putHost(idx);
    if (this.chosen?.idx.host !== host) return;
    const s = idx.sources.find((x) => x.id === this.chosen!.s.id);
    if (!s) return;
    const before = this.chosen.s;
    this.chosen = { idx, s };
    this.refresh();
    this.drawBanner();
    const calls = (x: Source): string => JSON.stringify([x.auth, x.authHosts, x.endpoints, x.categories]);
    if (calls(before) !== calls(s)) void this.open();
  }

  private find(key: string): { idx: SourceIndex; s: Source } | null {
    for (const idx of this.store.hosts()) for (const s of idx.sources) if (sourceKey(idx.host, s.id) === key) return { idx, s };
    return null;
  }

  private client(): SourceClient | null {
    return this.chosen ? new SourceClient(this.chosen.s, this.store.tokenBox(this.chosen.idx.host, this.chosen.s.id)) : null;
  }

  private notice(text: string, button?: HTMLButtonElement): void {
    const box = document.createElement('div');
    box.className = 'source-notice';
    const p = document.createElement('p');
    p.textContent = text;
    box.append(p);
    if (button) box.append(button);
    this.root.replaceChildren(box);
  }

  private askSignIn(): void {
    const { idx, s } = this.chosen!;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nb-btn';
    b.textContent = str('sources.sign_in');
    b.addEventListener('click', () => this.host.signIn(idx, s, b));
    this.notice(str('sources.sign_in_to', { name: s.name }), b);
  }

  private failed(e: unknown): void {
    if (e instanceof SourceError && e.why === 'signin') this.askSignIn();
    else this.notice(this.host.errText(e));
  }

  private async open(): Promise<void> {
    const gen = ++this.gen;
    const c = this.client()!;
    const { idx, s } = this.chosen!;
    if (!c.signedIn()) { this.askSignIn(); return; }
    this.root.replaceChildren(loadingLine(str('sources.loading')));
    this.held = await this.host.originsHeld();
    if (gen !== this.gen) return;
    if (!c.hasCategories()) { void this.list(c, undefined); return; }
    let categories: Category[];
    try { categories = await c.categories(); } catch (e) { if (gen === this.gen) this.failed(e); return; }
    if (gen !== this.gen) return;
    if (!categories.length) { this.notice(str('sources.nothing_here')); return; }
    const sel = document.createElement('select');
    let group: HTMLOptGroupElement | null = null;
    const byId = new Map<string, Category>();
    categories.forEach((sh, i) => {
      const v = String(i);
      byId.set(v, sh);
      const o = new Option(sh.all ? str('sources.all') : sh.name, v);
      if (sh.group && sh.group !== group?.label) { group = document.createElement('optgroup'); group.label = sh.group; sel.append(group); }
      if (!sh.group) group = null;
      (group ?? sel).append(o);
    });
    const remembered = new URL(location.href).searchParams.get(CATEGORY_PARAM) ?? load(`${CATEGORY}:${sourceKey(idx.host, s.id)}`);
    const start = [...byId].find(([, sh]) => `${sh.group ?? ''}/${sh.id}` === remembered)?.[0] ?? '0';
    sel.value = start;
    this.categoryWrap.replaceChildren(sel);
    this.categoryWrap.hidden = false;
    enhanceSelect(sel, { icon: UI_ICONS.tag, name: (c) => str('sources.category_n', { 0: c }) });
    sel.addEventListener('change', () => {
      const sh = byId.get(sel.value)!;
      save(`${CATEGORY}:${sourceKey(idx.host, s.id)}`, `${sh.group ?? ''}/${sh.id}`);
      setParams(this.store.slugOf(sourceKey(idx.host, s.id)), `${sh.group ?? ''}/${sh.id}`);
      window.scrollTo(0, 0);
      void this.list(c, sh);
    });
    void this.list(c, byId.get(start));
  }

  private async list(c: SourceClient, category: Category | undefined): Promise<void> {
    const gen = ++this.gen;
    this.listing = { c, category };
    const url = (category?.list ?? c.source.endpoints.catalogue)?.url ?? '';
    this.offerSearch(templateVars(url).includes('q'));
    this.root.replaceChildren(loadingLine(str('sources.loading')));
    const grid = tileGrid();
    const end = document.createElement('div');
    end.className = 'source-end';
    let page = 0;
    let pages = 1;
    let shown = 0;
    const groups = new Map<string, { machines: Machine[]; card: HTMLElement }>();
    let loading = false;
    const next = async (): Promise<void> => {
      if (loading || page >= pages || gen !== this.gen) return;
      loading = true;
      end.replaceChildren(loadingLine(str('sources.loading')));
      try {
        const cat = await c.catalogue(this.q, page + 1, category);
        if (gen !== this.gen) return;
        page = cat.page ?? page + 1;
        pages = cat.pages ?? page;
        if (shown === 0) this.root.replaceChildren(...(category && !category.all ? [sectionHeading(category.name)] : []), grid, end);
        for (const m of cat.machines) {
          const key = m.maker ? `${m.maker.toLowerCase()}|${titleKey(m.title)}` : `#${m.id}`;
          const had = groups.get(key);
          if (had && titleKey(m.title)) {
            had.machines.push(m);
            const card = this.card(c, had.machines);
            had.card.replaceWith(card);
            had.card = card;
          } else {
            const card = this.card(c, [m]);
            groups.set(key, { machines: [m], card });
            grid.append(card);
          }
        }
        shown += cat.machines.length;
        end.textContent = '';
        if (!shown && page >= pages) this.notice(str('sources.nothing_here'));
      } catch (e) {
        if (gen !== this.gen) return;
        if (shown === 0 || (e instanceof SourceError && e.why === 'signin')) this.failed(e);
        else end.textContent = this.host.errText(e);
        pages = page;
      } finally {
        loading = false;
      }
      if (gen === this.gen && page < pages && end.getBoundingClientRect().top < innerHeight + 400) void next();
    };
    const seen = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) void next(); }, { rootMargin: '400px' });
    seen.observe(end);
    const stop = (): void => { if (gen !== this.gen) { seen.disconnect(); clearInterval(watch); } };
    const watch = setInterval(stop, 2000);
    await next();
  }

  private offerSearch(can: boolean): void {
    this.searchBtn.hidden = !can;
    this.search.wrap.hidden = !can;
    if (!can) {
      clearTimeout(this.typing);
      this.q = '';
      this.search.input.value = '';
      this.search.close();
    }
  }

  private toggleSearch(): void {
    if (this.search.wrap.classList.contains('open') && document.activeElement === this.search.input) this.closeSearch();
    else this.search.open();
  }

  private closeSearch(): void {
    this.search.close();
    this.searchBtn.focus({ preventScroll: true });
    if (this.search.input.value || this.q) { this.search.input.value = ''; this.typed(''); }
  }

  private typed(text: string): void {
    clearTimeout(this.typing);
    this.typing = setTimeout(() => {
      if (text === this.q || !this.listing) return;
      this.q = text;
      window.scrollTo(0, 0);
      void this.list(this.listing.c, this.listing.category);
    }, 350);
  }

  private card(c: SourceClient, ms: Machine[]): HTMLElement {
    const { idx, s } = this.chosen!;
    const m = ms.find((x) => x.thumb) ?? ms[0];
    const versions = ms.flatMap((x) => x.sets.map((set) => ({ m: x, set })));
    const grouped = versions.length > 1;
    const title = ms.length > 1 ? cleanTitle(ms[0].title) : ms[0].title;
    const art = document.createElement('div');
    art.className = 'art';
    const ph = document.createElement('div');
    ph.className = 'art-placeholder';
    art.append(ph);
    if (m.thumb) {
      const back = document.createElement('img');
      back.className = 'art-blur';
      back.alt = '';
      back.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.className = 'art-img';
      img.alt = m.title;
      img.draggable = false;
      for (const i of [back, img]) { i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer'; i.src = m.thumb; }
      img.addEventListener('error', () => { back.remove(); img.remove(); ph.classList.remove('art-loading'); }, { once: true });
      img.addEventListener('load', () => {
        back.classList.add('in');
        img.classList.add('in');
        setTimeout(() => ph.remove(), 320);
      }, { once: true });
      ph.classList.add('art-loading');
      ph.after(back, img);
    }
    const tick = document.createElement('span');
    tick.className = 'card-tick';
    tick.setAttribute('aria-hidden', 'true');
    tick.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    art.append(tick);
    const sets = versions.map((v) => v.set);
    const heldHash = (): string | undefined => sets.map((x) => this.held.get(originOf(idx.host, s.id, x.id))).find(Boolean);
    const state = chip('');
    const status = (): void => {
      const h = heldHash();
      const locked = sets.length > 0 && sets.every((x) => x.canDownload === false);
      card.classList.toggle('chosen', !!h);
      card.classList.toggle('source-locked', !h && locked);
      const busy = sets.some((x) => this.busy.has(originOf(idx.host, s.id, x.id)));
      const left = sets.map((x) => this.waiting.get(originOf(idx.host, s.id, x.id))).find((n) => n !== undefined);
      const text = left !== undefined ? str('sources.wait', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })
        : busy ? str('sources.getting') : h ? str('sources.in_library') : locked ? str('sources.not_allowed')
        : !sets.length ? str('sources.on_source', { name: s.name }) : '';
      state.textContent = text;
      state.hidden = !text;
    };
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'nb-icon-btn card-more';
    more.setAttribute('aria-label', str('library.more_options'));
    more.innerHTML = this.more.innerHTML;
    const pick = (): void => this.versions(c, title, ms, status);
    more.addEventListener('click', (ev) => { ev.stopPropagation(); this.cardMenu(c, m, title, grouped ? pick : null, more); });
    const card = tileCard({
      label: title, art, title,
      chips: [...(m.authors?.length ? [chip(m.authors.join(', '))] : []),
        ...(grouped ? [versionsChip(versions.length, pick)] : []), state],
      more: m.page || grouped ? more : null,
    });
    if (grouped) card.classList.add('nb-card--stack');
    art.addEventListener('click', () => {
      if (grouped) { pick(); return; }
      const h = heldHash();
      if (h) { this.host.play(h); return; }
      if (!sets.length) { if (m.page) window.open(m.page, '_blank', 'noopener'); return; }
      const can = versions.filter((v) => v.set.canDownload !== false);
      if (can.length === 1) void this.get(c, can[0].set, can[0].m, status);
      else if (can.length > 1) pick();
    });
    status();
    return card;
  }

  private versions(c: SourceClient, title: string, ms: Machine[], status: () => void): void {
    const { idx, s } = this.chosen!;
    const versions = ms.flatMap((m) => m.sets.map((set) => ({ m, set })));
    const held = (x: CatSet): string | undefined => this.held.get(originOf(idx.host, s.id, x.id));
    const tagsOf = ({ m, set }: { m: Machine; set: CatSet }): string[] => {
      const cfg = set.config ?? {};
      return [cfg.variant, cfg.stake, cfg.jackpot, cfg.percentage, m.edition].filter((t): t is string => !!t);
    };
    const all = versions.map(tagsOf);
    const lead = versions.find((v) => held(v.set));
    openVersionPicker({
      title,
      maker: ms[0].maker ?? s.name,
      rows: versions.map((v, i) => ({
        title: v.m.title,
        tags: all[i].filter((t) => !all.every((o) => o.includes(t))),
        status: held(v.set) ? str('sources.in_library') : v.set.canDownload === false ? str('sources.not_allowed') : '',
        resume: false,
        preferred: v === lead,
        thumb: () => Promise.resolve(v.m.thumb ?? null),
      })),
      onPlay: (i) => {
        const v = versions[i];
        const h = held(v.set);
        if (h) this.host.play(h);
        else if (v.set.canDownload !== false) void this.get(c, v.set, v.m, status);
      },
    });
  }

  private cardMenu(c: SourceClient, m: Machine, title: string, versions: (() => void) | null, returnTo: HTMLElement): void {
    const rows: HTMLElement[] = [];
    if (versions) {
      const v = sheetRow(str('library.versions'), '');
      v.addEventListener('click', () => { closeSheet(); versions(); });
      rows.push(v);
    }
    if (m.page) {
      const link = sheetRow(str('sources.on_source', { name: c.source.name }), '');
      link.addEventListener('click', () => { closeSheet(); window.open(m.page, '_blank', 'noopener'); });
      rows.push(link);
    }
    showSheet(title, rows, returnTo);
  }

  private async get(c: SourceClient, x: CatSet, m: Machine, status: () => void): Promise<void> {
    const { idx, s } = this.chosen!;
    const origin = originOf(idx.host, s.id, x.id);
    if (this.busy.has(origin)) return;
    this.busy.add(origin);
    status();
    try {
      const file = await fetchFromSource(c, x, m.title, {
        busy: (t, f) => this.host.busy(t, f),
        returnTo: this.more,
        waiting: (n) => { if (n === null) this.waiting.delete(origin); else this.waiting.set(origin, n); status(); },
      });
      this.host.busy(str('main.importing_n', { 0: m.title }));
      const hash = await this.host.importQuietly(file, origin);
      this.host.busy(null);
      if (hash) { this.held.set(origin, hash); this.busy.delete(origin); status(); this.host.play(hash); return; }
    } catch (e) {
      this.host.busy(null);
      this.busy.delete(origin);
      this.waiting.delete(origin);
      status();
      if (e instanceof SourceError && e.why === 'declined') return;
      const said = getFailedText(e, m.title);
      if (e instanceof SourceError && e.why === 'signin') {
        showToast(said, { error: true, action: { label: str('sources.sign_in'), run: () => this.askSignIn() } });
        return;
      }
      showToast(said, { error: true });
      return;
    }
    this.busy.delete(origin);
    status();
  }

  private sourceMenu(): void {
    if (!this.chosen) return;
    const { idx, s } = this.chosen;
    const rows: HTMLElement[] = [];
    const box = this.store.tokenBox(idx.host, s.id);
    const fresh = sheetRow(str('sources.refresh'), '');
    fresh.addEventListener('click', () => {
      closeSheet();
      this.reread.delete(idx.host);
      void forgetAnswers(sourceOrigins(s)).then(() => this.show(sourceKey(idx.host, s.id)));
    });
    rows.push(fresh);
    if (box.get()) {
      const out = sheetRow(str('sources.sign_out'), '');
      out.addEventListener('click', () => {
        const held = box.get();
        box.set(undefined);
        if (held) void revoke(s, held);
        void forgetAnswers(sourceOrigins(s));
        closeSheet();
        this.show(sourceKey(idx.host, s.id));
      });
      rows.push(out);
    }
    const remove = sheetRow(str('sources.remove_source'), '');
    remove.addEventListener('click', () => confirmInSheet({
      ask: str('sources.remove_ask', { name: s.name }), sub: str('sources.remove_sub'), keep: str('sources.keep'), yes: str('sources.remove_source'),
      onYes: () => { this.store.removeHost(idx.host); closeSheet(); this.show(LOCAL); },
    }));
    rows.push(remove);
    showSheet(s.name, rows, this.more);
  }
}
