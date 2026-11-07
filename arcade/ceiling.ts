import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ceiling, CeilingFinish, RoomLook } from './roomlook';
import { buildRelief, KEEP_ALPHA } from './ceilingrelief';
import { DARK_PANEL_M, TILE_M, tileGrid } from './ceilinggrid';

const PANEL_EVERY_X = 4;
const PANEL_EVERY_Z = 3;
const PANEL_COLOUR = 0xf2f6ff;
const PANEL_HALO_M = 0.55;
const PANEL_HALO = 0.32;
const CEILING_GLOW = 0.14;

export interface CeilingBuild {
  group: THREE.Group;
  dispose(): void;
}

export interface CeilingSpec {
  kind: Ceiling;
  colour: string;
  finish: CeilingFinish;
  glow: number;
  chandelier: boolean;
  lamps: boolean;
}

export function ceilingOf(l: RoomLook): CeilingSpec {
  return { kind: l.ceiling, colour: l.ceilingColour, finish: l.ceilingFinish, glow: l.ceilingGlow, chandelier: l.chandelier, lamps: l.ceilingLamps };
}
export function ceilingKey(l: RoomLook): string {
  return JSON.stringify(ceilingOf(l));
}

const tex = new Map<string, THREE.Texture>();

function canvasTexture(key: string, px: number, draw: (g: CanvasRenderingContext2D, n: number) => void): THREE.Texture {
  let t = tex.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    draw(c.getContext('2d')!, px);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    tex.set(key, t);
  }
  return t;
}

function tileTexture(): THREE.Texture {
  return canvasTexture('tile', 128, (g, n) => {
    g.fillStyle = '#e8e6e0';
    g.fillRect(0, 0, n, n);
    let s = 1975;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(90,86,80,${0.08 + rnd() * 0.2})`;
      g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 1.5, 1 + rnd());
    }
    g.fillStyle = '#9a9a98';
    g.fillRect(0, 0, n, 3);
    g.fillRect(0, n - 3, n, 3);
    g.fillRect(0, 0, 3, n);
    g.fillRect(n - 3, 0, 3, n);
  });
}

let haloTex: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (!haloTex) {
    const n = 64;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const hw = TILE_M / 2 + PANEL_HALO_M, hd = TILE_M + PANEL_HALO_M;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = Math.abs(((i + 0.5) / n) * 2 - 1) * hw, z = Math.abs(((j + 0.5) / n) * 2 - 1) * hd;
        const d = Math.hypot(Math.max(0, x - TILE_M / 2), Math.max(0, z - TILE_M)) / PANEL_HALO_M;
        const a = d >= 1 ? 0 : (1 - d) ** 2;
        img.data.set([255, 255, 255, Math.round(a * 255)], (j * n + i) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    haloTex = new THREE.CanvasTexture(c);
  }
  return haloTex;
}

function darkPanelTexture(): THREE.Texture {
  return canvasTexture('dark', 128, (g, n) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, n, n);
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, n, 2);
    g.fillRect(0, 0, 2, n);
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 2, n, 1);
    g.fillRect(2, 0, 1, n);
  });
}

export function buildCeiling(
  spec: CeilingSpec, W: number, D: number, cx: number, cz: number, top: number, renderer: THREE.WebGLRenderer,
): CeilingBuild {
  const { kind, colour } = spec;
  if (kind === 'beams' || kind === 'coffered') return buildRelief({ ...spec, kind }, { W, D, cx, cz, top }, renderer);
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const plane = (mat: THREE.Material): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), mat);
    m.position.set(cx, top, cz);
    geos.push(m.geometry);
    group.add(m);
  };
  const merged = (parts: THREE.BufferGeometry[], mat: THREE.Material): void => {
    if (!parts.length) return;
    const g = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!g) return;
    geos.push(g);
    group.add(new THREE.Mesh(g, mat));
  };

  const map = (kind === 'tiles' ? tileTexture() : darkPanelTexture()).clone();
  const side = kind === 'tiles' ? TILE_M : DARK_PANEL_M;
  map.repeat.set(W / side, D / side);
  map.offset.set(-(W / 2) / side, -(D / 2) / side);
  map.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color: colour, map, emissive: colour, emissiveMap: map, emissiveIntensity: CEILING_GLOW, roughness: 0.95, metalness: 0 });
  mats.push(m);
  plane(m);
  if (kind === 'tiles') {
    const { nx, nz, x0, z0 } = tileGrid({ W, D, cx, cz });
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 1; i + 1 < nx; i += PANEL_EVERY_X) {
      for (let j = 1; j + 2 < nz; j += PANEL_EVERY_Z) {
        const p = new THREE.PlaneGeometry(TILE_M - 0.04, TILE_M * 2 - 0.04).rotateX(Math.PI / 2)
          .translate(x0 + (i + 0.5) * TILE_M, top - 0.004, z0 + (j + 1) * TILE_M);
        parts.push(p);
      }
    }
    const halos = parts.map((p) => {
      p.computeBoundingBox();
      const c = p.boundingBox!.getCenter(new THREE.Vector3());
      return new THREE.PlaneGeometry(TILE_M + PANEL_HALO_M * 2, TILE_M * 2 + PANEL_HALO_M * 2).rotateX(Math.PI / 2).translate(c.x, top - 0.002, c.z);
    });
    const halo = new THREE.MeshBasicMaterial({
      ...KEEP_ALPHA, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      map: haloTexture(), color: new THREE.Color(PANEL_COLOUR).multiplyScalar(PANEL_HALO),
    });
    mats.push(halo);
    merged(halos, halo);
    const lit = new THREE.MeshBasicMaterial({ color: PANEL_COLOUR });
    mats.push(lit);
    merged(parts, lit);
  }
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
