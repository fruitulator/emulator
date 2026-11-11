
export interface DotAlphaMetrics {
  x: number;
  y: number;
  spacing: number;
  digitGap: number;
}

export const DOT_ALPHA_INTENSITY: readonly number[] = [
  0, 39, 70, 95, 110, 125, 135, 145, 169, 175, 181, 187, 193, 198, 203, 208,
  213, 218, 222, 226, 230, 234, 237, 240, 243, 246, 248, 250, 252, 253, 254, 255,
];

export function dotAlphaCanvas(g: DotAlphaMetrics): { width: number; height: number } {
  return {
    width: ((g.x + g.spacing) * 6 + g.digitGap) * 16 + 3,
    height: (g.y + g.spacing) * 7 + 6,
  };
}

export function dotAlphaDot(g: DotAlphaMetrics, cell: number, col: number, row: number): { x: number; y: number } {
  const px = g.x + g.spacing;
  const py = g.y + g.spacing;
  return {
    x: 3 + (cell * 6 + col) * px + cell * g.digitGap,
    y: col === 5 ? py * 6 + 4 : 3 + row * py,
  };
}

export interface MatrixAlphaMetrics {
  x: number;
  y: number;
  spacing: number;
}

export function matrixAlphaCanvas(g: MatrixAlphaMetrics): { width: number; height: number } {
  return {
    width: g.spacing * 95 + 6 + g.x * 96,
    height: (g.y + g.spacing) * 8 - g.spacing + 6,
  };
}

export function matrixAlphaDot(g: MatrixAlphaMetrics, cell: number, col: number, row: number): { x: number; y: number } {
  return {
    x: 3 + (cell * 6 + col) * (g.x + g.spacing),
    y: 3 + row * (g.y + g.spacing),
  };
}
