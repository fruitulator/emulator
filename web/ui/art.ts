import { getThumb, onThumbChange } from '../store';
import { imageMime } from '../cabjson';

export function artwork(
  hash: string | null, alt: string, onTap: () => void,
  awaiting?: string,
): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'art';
  frame.addEventListener('click', onTap);
  frame.append(placeholder(!!hash));
  if (!hash) {
    if (awaiting) { frame.dataset.hash = awaiting; frame.dataset.alt = alt; }
    return frame;
  }
  frame.dataset.hash = hash;
  frame.dataset.alt = alt;
  artObserver?.observe(frame);
  if (recentUrls.has(hash)) void fillArtwork(frame);
  return frame;
}

function placeholder(loading: boolean): HTMLElement {
  const ph = document.createElement('div');
  ph.className = loading ? 'art-placeholder art-loading' : 'art-placeholder';
  return ph;
}

const frameUrls = new WeakMap<HTMLElement, string>();
const inflight = new WeakMap<HTMLElement, Promise<void>>();

const URL_KEEP = 300;
const recentUrls = new Map<string, string>();

function takeUrl(hash: string): string | undefined {
  const url = recentUrls.get(hash);
  if (url) { recentUrls.delete(hash); recentUrls.set(hash, url); }
  return url;
}

function keepUrl(hash: string, url: string): string {
  recentUrls.set(hash, url);
  for (const [h, u] of recentUrls) {
    if (recentUrls.size <= URL_KEEP) break;
    recentUrls.delete(h);
    URL.revokeObjectURL(u);
  }
  return url;
}

function forgetUrl(hash: string | null): void {
  for (const [h, u] of [...recentUrls]) {
    if (hash !== null && h !== hash) continue;
    recentUrls.delete(h);
    URL.revokeObjectURL(u);
  }
}

onThumbChange(forgetUrl);

export function fillArtwork(frame: HTMLElement): Promise<void> {
  const pending = inflight.get(frame);
  if (pending) return pending;
  const run = fillArtworkNow(frame).finally(() => { inflight.delete(frame); });
  inflight.set(frame, run);
  return run;
}

async function fillArtworkNow(frame: HTMLElement): Promise<void> {
  const hash = frame.dataset.hash;
  if (!hash || frameUrls.has(frame)) return;
  let url = takeUrl(hash);
  if (!url) {
    if (!frame.querySelector(':scope > .art-placeholder')) frame.prepend(placeholder(true));
    const bytes = await getThumb(hash);
    if (!bytes || !frame.isConnected || frameUrls.has(frame) || frame.dataset.hash !== hash) return;
    url = takeUrl(hash)
      ?? keepUrl(hash, URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(bytes) })));
  }
  frameUrls.set(frame, url);
  const back = document.createElement('img');
  back.className = 'art-blur';
  back.alt = '';
  back.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.className = 'art-img';
  img.alt = frame.dataset.alt ?? '';
  back.draggable = false;
  img.draggable = false;
  back.src = url;
  img.src = url;
  const ph = frame.querySelector<HTMLElement>(':scope > .art-placeholder');
  if (img.complete && img.naturalWidth > 0) {
    back.classList.add('in');
    img.classList.add('in');
    if (ph) ph.after(back, img);
    else frame.prepend(back, img);
    if (ph?.classList.contains('art-loading')) ph.remove();
    return;
  }
  if (ph) ph.after(back, img);
  else frame.prepend(back, img);
  await img.decode().catch(() => undefined);
  back.classList.add('in');
  img.classList.add('in');
  if (ph) setTimeout(() => { if (frameUrls.get(frame) === url) ph.remove(); }, 320);
}

export function showTile(frame: HTMLElement): Promise<void> {
  frame.querySelector(':scope > .art-placeholder')?.classList.add('art-loading');
  if (frame.dataset.hash) forgetUrl(frame.dataset.hash);
  clearArtwork(frame);
  artObserver?.observe(frame);
  return fillArtwork(frame);
}

export function clearArtwork(frame: HTMLElement): void {
  const url = frameUrls.get(frame);
  if (!url) return;
  frameUrls.delete(frame);
  for (const img of frame.querySelectorAll('.art-blur, .art-img')) img.remove();
  if (!frame.querySelector(':scope > .art-placeholder')) frame.prepend(placeholder(true));
}

const artObserver = typeof IntersectionObserver === 'undefined' ? null
  : new IntersectionObserver((entries) => {
    for (const e of entries) {
      const frame = e.target as HTMLElement;
      if (e.isIntersecting) void fillArtwork(frame);
      else clearArtwork(frame);
    }
  }, { rootMargin: '200% 400px' });

export function hasArtwork(frame: HTMLElement): boolean {
  return frameUrls.has(frame);
}

export function releaseArtwork(frame: HTMLElement): void {
  artObserver?.unobserve(frame);
  clearArtwork(frame);
}

export function thumbStack(hashes: string[], alt: (hash: string) => string, max = 3): HTMLElement | null {
  if (!hashes.length) return null;
  const stack = document.createElement('div');
  stack.className = 'ui-thumbstack';
  for (const h of hashes.slice(0, max)) stack.append(artwork(h, alt(h), () => undefined));
  return stack;
}

export function thumbMosaic(hashes: string[], alt: string, onTap: () => void): HTMLElement {
  if (hashes.length < 2) return artwork(hashes[0] ?? null, alt, onTap);
  const frame = document.createElement('div');
  frame.className = 'art ui-thumbmosaic';
  frame.addEventListener('click', onTap);
  for (const h of hashes.slice(0, 4)) frame.append(artwork(h, alt, () => undefined));
  return frame;
}
