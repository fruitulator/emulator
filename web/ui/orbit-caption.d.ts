export interface OrbitCaptionGame {
  title: string;
  chipsHtml: string;
  ctaLabel: string;
}
export interface OrbitCaption {
  update(game: OrbitCaptionGame): void;
  moving(on: boolean): void;
  settle(game: OrbitCaptionGame): void;
  replay(game: OrbitCaptionGame): void;
}
export function createOrbitCaption(root: HTMLElement): OrbitCaption;
