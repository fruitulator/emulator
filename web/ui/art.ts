import { getThumb } from '../store';
import { imageMime } from '../cabjson';

export function artwork(hash: string | null, alt: string, onTap: () => void): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'art';
  frame.addEventListener('click', onTap);
  if (!hash) {
    const ph = document.createElement('div');
    ph.className = 'art-placeholder';
    ph.textContent = '\u{1F3B0}';
    frame.append(ph);
    return frame;
  }
  frame.dataset.hash = hash;
  frame.dataset.alt = alt;
  artObserver?.observe(frame);
  return frame;
}

const frameUrls = new WeakMap<HTMLElement, string>();
const inflight = new WeakMap<HTMLElement, Promise<void>>();

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
  const bytes = await getThumb(hash);
  if (!bytes || !frame.isConnected || frameUrls.has(frame)) return;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(bytes) }));
  frameUrls.set(frame, url);
  const back = document.createElement('img');
  back.className = 'art-blur';
  back.src = url;
  back.alt = '';
  back.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.className = 'art-img';
  img.src = url;
  img.alt = frame.dataset.alt ?? '';
  back.draggable = false;
  img.draggable = false;
  frame.prepend(back, img);
  await img.decode().catch(() => undefined);
  back.classList.add('in');
  img.classList.add('in');
}

export function clearArtwork(frame: HTMLElement): void {
  const url = frameUrls.get(frame);
  if (!url) return;
  frameUrls.delete(frame);
  for (const img of frame.querySelectorAll('.art-blur, .art-img')) img.remove();
  URL.revokeObjectURL(url);
}

const artObserver = typeof IntersectionObserver === 'undefined' ? null
  : new IntersectionObserver((entries) => {
    for (const e of entries) {
      const frame = e.target as HTMLElement;
      if (e.isIntersecting) void fillArtwork(frame);
      else clearArtwork(frame);
    }
  }, { rootMargin: '600px 400px' });

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
