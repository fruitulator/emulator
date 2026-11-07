import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SCONCE_METALS, SCONCE_SHADES, WALL_LIGHT_STRENGTHS, type SconceMetal, type SconceShade, type WallLightStrength } from './roomlook';
import {
  BULB_DY_M, BULB_R_M, PLATE_DY_M, PLATE_R_M, SCONCE_OUT_M, SHADE_H_M, SHADE_R_BOT_M, SHADE_R_TOP_M, type WallLight, type WallRun,
} from './walllayout';

export interface SconceLook { shade: SconceShade; metal: SconceMetal; strength: WallLightStrength }

const ARM_R = 0.0085;
const PLATE_T = 0.012;
const BULB_V = 0.5 + BULB_DY_M / SHADE_H_M;
const HALO_R = 0.21;
const HALO_LEVEL = 0.22;
const SHADOW_W = 0.3;
const SHADOW_UP = 0.12;
const SHADOW_DOWN = 0.42;
const SHADOW_PX_M = 420;

const SHADE_VERT =  `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHADE_FRAG =  `
uniform vec3 uGlow;
uniform vec3 uInner;
uniform float uK;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float v = vUv.y;
  float d = v < ${BULB_V.toFixed(4)} ? (${BULB_V.toFixed(4)} - v) / ${BULB_V.toFixed(4)} : (v - ${BULB_V.toFixed(4)}) / ${(1 - BULB_V).toFixed(4)};
  float prof = 1.0 - 0.42 * d * d;
  // Linen: a fine plain weave (faded out where it is finer than a pixel,
  // so it never shimmers), slubs along the weft and a soft mottle.
  vec2 t = vec2(vUv.x * 190.0, v * 70.0);
  float aa = clamp(1.6 - 1.4 * max(fwidth(t.x), fwidth(t.y)), 0.0, 1.0);
  float weave = sin(t.x * 6.2832) * sin(t.y * 6.2832) * aa;
  float slub = noise(vec2(vUv.x * 60.0, v * 9.0));
  float mottle = noise(vec2(vUv.x * 14.0, v * 3.5));
  float fab = 0.9 + 0.07 * weave + 0.09 * (slub - 0.5) - 0.08 * mottle;
  vec3 col;
  if (gl_FrontFacing) {
    col = uGlow * prof * fab;
  } else {
    float rim = max(smoothstep(0.16, 0.0, v), smoothstep(0.84, 1.0, v));
    col = uInner * (0.9 * prof + 0.45 * rim) * (0.95 + 0.05 * fab);
  }
  gl_FragColor = vec4(col * uK, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function haloTexture(): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const a = r >= 1 ? 0 : Math.exp(-r * r * 4.5) * (1 - r * r) ** 2;
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture(): THREE.CanvasTexture {
  const w = Math.round(SHADOW_W * SHADOW_PX_M), h = Math.round((SHADOW_UP + SHADOW_DOWN) * SHADOW_PX_M);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < h; y++) {
    const my = SHADOW_UP - (y + 0.5) / SHADOW_PX_M;
    for (let x = 0; x < w; x++) {
      const mx = (x + 0.5) / SHADOW_PX_M - SHADOW_W / 2;
      const r = Math.hypot(mx, (my + 0.014) * 1.05);
      let s = 0.32 * smooth(PLATE_R_M + 0.022, PLATE_R_M - 0.004, r);
      if (my < 0) {
        const t = Math.min(1, -my / (SHADOW_DOWN - 0.02));
        const sig = 0.007 + 0.05 * t;
        s += 0.2 * (1 - t) ** 1.6 * Math.exp(-(mx * mx) / (2 * sig * sig)) * smooth(0, 0.03, -my);
      }
      const v = Math.round(255 * (1 - Math.min(0.42, s)));
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function metalMatcap(m: (typeof SCONCE_METALS)[number]): THREE.CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const shadow = new THREE.Color(m.shadow), body = new THREE.Color(m.lit), shine = new THREE.Color(m.shine);
  const key = new THREE.Vector3(-0.25, 0.8, 0.55).normalize();
  const nrm = new THREE.Vector3(), r = new THREE.Vector3(), col = new THREE.Color();
  const mirror = m.id === 'chrome' ? 0.35 : 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const nx = (x + 0.5) / (n / 2) - 1, ny = 1 - (y + 0.5) / (n / 2);
      const zz = 1 - nx * nx - ny * ny;
      nrm.set(nx, ny, Math.sqrt(Math.max(0, zz)));
      r.copy(nrm).multiplyScalar(2 * nrm.z).sub(new THREE.Vector3(0, 0, 1));
      const diff = Math.max(0, nrm.dot(key));
      col.copy(shadow).lerp(body, diff ** 0.8);
      col.lerp(body.clone().multiplyScalar(1.4), mirror * THREE.MathUtils.smoothstep(r.y, -0.15, 0.25));
      col.add(shine.clone().multiplyScalar(m.gloss * Math.max(0, r.dot(key)) ** m.sharp));
      const i = (y * n + x) * 4;
      img.data[i] = Math.min(255, Math.round(col.r * 255));
      img.data[i + 1] = Math.min(255, Math.round(col.g * 255));
      img.data[i + 2] = Math.min(255, Math.round(col.b * 255));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BULB_LIGHT = new THREE.Color(0xffc890);

export function buildSconces(lights: WallLight[], walls: WallRun[], look: SconceLook): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'sconces';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const shade = SCONCE_SHADES.find((s) => s.id === look.shade) ?? SCONCE_SHADES[0];
  const metal = SCONCE_METALS.find((m) => m.id === look.metal) ?? SCONCE_METALS[0];
  const k = (WALL_LIGHT_STRENGTHS.find((s) => s.id === look.strength) ?? WALL_LIGHT_STRENGTHS[1]).k;
  const glowK = 0.55 + 0.45 * k;

  const body: THREE.BufferGeometry[] = [];
  const shades: THREE.BufferGeometry[] = [];
  const bulbs: THREE.BufferGeometry[] = [];
  const decals: THREE.BufferGeometry[] = [];
  const frame = (i: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(walls[i].rotY).setPosition(walls[i].x, 0, walls[i].z);
  const put = (into: THREE.BufferGeometry[], g: THREE.BufferGeometry, m: THREE.Matrix4, keepUv = false): void => {
    g.applyMatrix4(m);
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    if (!keepUv) flat.deleteAttribute('uv');
    into.push(flat);
  };
  const haloTex = haloTexture();
  const shadowTex = shadowTexture();
  texs.push(haloTex, shadowTex);
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex, color: new THREE.Color(shade.glow).lerp(BULB_LIGHT, 0.4), transparent: true, opacity: HALO_LEVEL * glowK,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  mats.push(haloMat);

  for (const l of lights) {
    const f = frame(l.wall);
    const at = (x: number, y: number, z: number): THREE.Matrix4 => f.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    const plateY = l.y + PLATE_DY_M;
    const bulbY = l.y + BULB_DY_M;
    put(body, new THREE.CylinderGeometry(PLATE_R_M, PLATE_R_M * 0.96, PLATE_T, 40).rotateX(Math.PI / 2), at(l.u, plateY, PLATE_T / 2));
    put(body, new THREE.CylinderGeometry(0.016, 0.02, 0.018, 20).rotateX(Math.PI / 2), at(l.u, plateY, PLATE_T + 0.009));
    const socketY = bulbY - BULB_R_M - 0.012;
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, plateY, PLATE_T + 0.012),
      new THREE.Vector3(0, plateY, SCONCE_OUT_M * 0.85),
      new THREE.Vector3(0, plateY + 0.01, SCONCE_OUT_M),
      new THREE.Vector3(0, socketY - 0.02, SCONCE_OUT_M),
    );
    put(body, new THREE.TubeGeometry(curve, 20, ARM_R, 8, false), at(l.u, 0, 0));
    put(body, new THREE.CylinderGeometry(0.014, 0.011, 0.03, 16), at(l.u, socketY - 0.005, SCONCE_OUT_M));
    put(bulbs, new THREE.SphereGeometry(BULB_R_M, 12, 8), at(l.u, bulbY, SCONCE_OUT_M));
    put(shades, new THREE.CylinderGeometry(SHADE_R_TOP_M, SHADE_R_BOT_M, SHADE_H_M, 48, 1, true), at(l.u, l.y, SCONCE_OUT_M), true);
    put(body, new THREE.TorusGeometry(SHADE_R_TOP_M + 0.0012, 0.0022, 4, 40).rotateX(Math.PI / 2), at(l.u, l.y + SHADE_H_M / 2, SCONCE_OUT_M));
    put(body, new THREE.TorusGeometry(SHADE_R_BOT_M + 0.0012, 0.0022, 4, 40).rotateX(Math.PI / 2), at(l.u, l.y - SHADE_H_M / 2, SCONCE_OUT_M));
    put(decals, new THREE.PlaneGeometry(SHADOW_W, SHADOW_UP + SHADOW_DOWN).translate(0, (SHADOW_UP - SHADOW_DOWN) / 2, 0), at(l.u, plateY, 0.0015), true);
    const halo = new THREE.Sprite(haloMat);
    halo.position.set(l.u, l.y, SCONCE_OUT_M).applyMatrix4(f);
    halo.scale.setScalar(HALO_R * 2);
    halo.renderOrder = 2;
    halo.raycast = () => {};
    group.add(halo);
  }

  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, order = 0): void => {
    const g = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!g) return;
    geos.push(g);
    mats.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.raycast = () => {};
    m.renderOrder = order;
    group.add(m);
  };
  const matcap = metalMatcap(metal);
  texs.push(matcap);
  add(body, new THREE.MeshMatcapMaterial({ matcap, color: new THREE.Color().setScalar(0.75 + 0.25 * glowK) }));
  add(shades, new THREE.ShaderMaterial({
    uniforms: {
      uGlow: { value: new THREE.Color(shade.glow) },
      uInner: { value: BULB_LIGHT.clone().lerp(new THREE.Color(0xffffff), 0.2).lerp(new THREE.Color(shade.glow), 0.15) },
      uK: { value: glowK },
    },
    vertexShader: SHADE_VERT, fragmentShader: SHADE_FRAG, side: THREE.DoubleSide,
  }));
  add(bulbs, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  add(decals, new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), 1);
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
