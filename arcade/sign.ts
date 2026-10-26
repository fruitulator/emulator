import * as THREE from 'three';
import latinUrl from './fonts/tilt-neon-latin.woff2?url';
import latinExtUrl from './fonts/tilt-neon-latin-ext.woff2?url';

const SIGN_LETTER_M = 0.36;
const SIGN_MAX_W = 5.5;
const SIGN_COLOUR = '#ff2fb0';
const SIGN_FAMILY = 'Tilt Neon';
const SIGN_FONT = `'${SIGN_FAMILY}', 'Arial Rounded MT Bold', 'Helvetica Neue', Arial, system-ui, sans-serif`;
const FONT_WAIT_MS = 4000;
const PX = 220;
const TUBE = 0.075;
const CORE = 0.03;
const GLOW = 0.25;

export interface ArcadeSign {
  mesh: THREE.Mesh;
  width: number;
  height: number;
  nameUp: number;
}

let fontLoad: Promise<boolean> | null = null;

export function loadSignFont(text: string): Promise<boolean> {
  if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve(false);
  if (!fontLoad) {
    const faces = [
      new FontFace(SIGN_FAMILY, `url(${latinUrl}) format('woff2')`, {
        unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, '
          + 'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
      }),
      new FontFace(SIGN_FAMILY, `url(${latinExtUrl}) format('woff2')`, {
        unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, '
          + 'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
      }),
    ];
    for (const f of faces) document.fonts.add(f);
    fontLoad = Promise.resolve(true);
  }
  const wait = new Promise<boolean>((r) => { setTimeout(() => r(false), FONT_WAIT_MS); });
  const load = fontLoad
    .then(() => document.fonts.load(`${PX}px '${SIGN_FAMILY}'`, text))
    .then((got) => got.length > 0)
    .catch((e) => { console.warn('[arcade] the sign\'s typeface did not load', e); return false; });
  return Promise.race([load, wait]);
}

function signCore(colour: string): string {
  const n = parseInt(colour.slice(1), 16);
  const mix = (c: number): string => Math.round(c + (255 - c) * 0.86).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

function neonLine(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, scale: number, colour: string): void {
  g.font = `400 ${px}px ${SIGN_FONT}`;
  g.shadowColor = colour;
  g.strokeStyle = colour;
  for (const [blur, alpha] of [[GLOW, 0.22], [GLOW * 0.35, 0.3]] as const) {
    g.globalAlpha = alpha;
    g.shadowBlur = px * blur * scale;
    g.lineWidth = px * TUBE;
    g.strokeText(text, x, y);
  }
  g.globalAlpha = 1;
  g.shadowBlur = px * 0.06 * scale;
  g.lineWidth = px * TUBE;
  g.strokeText(text, x, y);
  g.shadowBlur = 0;
  g.strokeStyle = colour === SIGN_COLOUR ? '#ffe6f6' : signCore(colour);
  g.lineWidth = px * CORE;
  g.strokeText(text, x, y);
}

export function signCanvas(name: string, colour = SIGN_COLOUR): {
  canvas: HTMLCanvasElement; letterPx: number; nameUpPx: number;
} {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `400 ${PX}px ${SIGN_FONT}`;
  const textW = Math.ceil(probe.measureText(name).width);
  const textH = PX;
  const pad = Math.ceil(PX * 0.6);
  const c = document.createElement('canvas');
  const scale = Math.min(1, 4096 / (textW + pad * 2));
  c.width = Math.ceil((textW + pad * 2) * scale);
  c.height = Math.ceil((textH + pad * 2) * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const x = (textW + pad * 2) / 2;
  const nameY = pad + PX / 2 + PX * 0.04;
  neonLine(g, name, x, nameY, PX, scale, colour);
  return { canvas: c, letterPx: PX * scale, nameUpPx: ((textH + pad * 2) / 2 - nameY) * scale };
}

export async function arcadeSign(name: string, renderer: THREE.WebGLRenderer, colour?: string): Promise<ArcadeSign> {
  await loadSignFont(name);
  const { canvas: c, letterPx, nameUpPx } = signCanvas(name, colour);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let perM = letterPx / SIGN_LETTER_M;
  let width = c.width / perM;
  if (width > SIGN_MAX_W) {
    perM *= width / SIGN_MAX_W;
    width = SIGN_MAX_W;
  }
  const height = c.height / perM;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  mesh.renderOrder = 1;
  return { mesh, width, height, nameUp: nameUpPx / perM };
}
