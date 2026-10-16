
export function captionFamily(face: string): string {
  return `"${face}", Tahoma, system-ui, sans-serif`;
}

export const SHIPPED_CAPTION_FACES: readonly string[] = ['mfme'];

interface LegendCarrier {
  legend?: { face: string; off?: string; on?: string };
}

export function shippedFacesIn(lamps: readonly LegendCarrier[]): { face: string; text: string }[] {
  const by = new Map<string, Set<string>>();
  for (const lp of lamps) {
    const lg = lp.legend;
    if (!lg || !SHIPPED_CAPTION_FACES.includes(lg.face.toLowerCase())) continue;
    let set = by.get(lg.face);
    if (!set) by.set(lg.face, (set = new Set()));
    for (const ch of `${lg.off ?? ''}${lg.on ?? ''}`) set.add(ch);
  }
  return [...by].map(([face, chars]) => ({ face, text: [...chars].join('') }));
}

export function loadShippedFaces(lamps: readonly LegendCarrier[]): Promise<void> | null {
  const faces = shippedFacesIn(lamps);
  if (!faces.length || typeof document === 'undefined' || !document.fonts) return null;
  return Promise.all(faces.map(({ face, text }) =>
    document.fonts.load(`16px "${face}"`, text || 'A').catch(() => []))).then(() => undefined);
}
