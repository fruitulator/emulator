export interface PrismStep {
  level: 1 | 2;
  third: boolean;
  face: 1 | 2;
  near: boolean;
  mask: boolean;
}

export function prismBothLitPlan(style: number): PrismStep[] {
  const s1 = style !== 0;
  return [
    { level: 1, third: false, face: 1, near: s1, mask: true },
    { level: 2, third: false, face: 2, near: !s1, mask: true },
    { level: 1, third: true, face: s1 ? 2 : 1, near: true, mask: false },
    { level: 2, third: true, face: s1 ? 1 : 2, near: false, mask: false },
  ];
}
