import type { CabinetModel } from './cabinets';

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function json(url: string): Promise<unknown[]> {
  const v = await fetchJson(url);
  return Array.isArray(v) ? v : [];
}

export async function cabinetManifest(): Promise<(CabinetModel & { url: string })[]> {
  const list = (await json('/arcade/cabinets/cabinets.json')) as CabinetModel[];
  return list.map((m) => ({ ...m, url: `/arcade/cabinets/${m.file}` }));
}
