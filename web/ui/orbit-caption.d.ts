export interface OrbitCaptionGame {
  title: string;
  chipsHtml: string;
  ctaLabel: string;
}
export interface OrbitCaption {
  update(game: OrbitCaptionGame): void;
  moving(on: boolean): void;
}
export function createOrbitCaption(root: HTMLElement): OrbitCaption;
