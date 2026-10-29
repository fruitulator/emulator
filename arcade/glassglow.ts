import * as THREE from 'three';
import type { Stand } from './floor';

export const WALL_NEAR_M = 0.6;
const NEIGHBOUR_MIN_W = 0.5;
const NEIGHBOUR_MAX_W = 1.6;

export interface GlowPlan {
  wall: boolean;
  left: number | null;
  right: number | null;
}

export function glowPlan(stands: readonly Stand[], i: number, box: { minX: number; maxX: number; minZ: number; maxZ: number }, w: number, d: number): GlowPlan {
  const s = stands[i];
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const ax = Math.cos(s.yaw), az = -Math.sin(s.yaw);
  const bx = s.x - fx * (d / 2), bz = s.z - fz * (d / 2);
  let wall = false;
  if (Math.abs(fz) > Math.abs(fx)) wall = fz > 0 ? bz - box.minZ < WALL_NEAR_M : box.maxZ - bz < WALL_NEAR_M;
  else wall = fx > 0 ? bx - box.minX < WALL_NEAR_M : box.maxX - bx < WALL_NEAR_M;
  let left: number | null = null, right: number | null = null;
  for (let j = 0; j < stands.length; j++) {
    if (j === i) continue;
    const o = stands[j];
    if (Math.abs(((o.yaw - s.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) > 0.01) continue;
    const dx = o.x - s.x, dz = o.z - s.z;
    const along = dx * fx + dz * fz;
    const across = dx * ax + dz * az;
    if (Math.abs(along) > 0.05) continue;
    const k = Math.abs(across) / w;
    if (k < NEIGHBOUR_MIN_W || k > NEIGHBOUR_MAX_W) continue;
    if (across < 0) left = j; else right = j;
  }
  return { wall, left, right };
}

const POOL_GAIN = 0.8;
const WALL_GAIN = 0.5;
const SPILL_GAIN = 0.45;
const MEAN_LOD = 16.0;

const VERT = `
attribute float aShape;
attribute float aGain;
varying vec2 vUv;
varying float vShape;
varying float vGain;
void main() {
  vUv = uv;
  vShape = aShape;
  vGain = aGain;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform sampler2D map;
uniform float dim;
varying vec2 vUv;
varying float vShape;
varying float vGain;
out vec4 outColor;
// sRGB encoding of the linear result, as three's colorspace_fragment does
// (GLSL3 has no gl_FragColor for that include to write).
vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 light = textureLod(map, vec2(0.5, 0.5), ${MEAN_LOD.toFixed(1)}).rgb;
  float a;
  if (vShape < 0.5) {            // the pool: radial, soft
    float r = length((vUv - 0.5) * 2.0);
    a = pow(max(0.0, 1.0 - r), 2.0);
  } else if (vShape < 1.5) {     // the wall: brightest at the cabinet's top, fading up
    a = pow(1.0 - vUv.y, 2.0);
  } else {                       // a spill: from the neighbour's side (u = 0), fading across
    a = pow(1.0 - vUv.x, 2.0) * (1.0 - vUv.y * 0.5);
  }
  // The viewer's brightness (arcade/room.ts \`setBrightness\`): three's
  // exposure, which this hand-written shader takes as the room's materials
  // do. 1 at neutral.
#ifdef TONE_MAPPING
  light *= toneMappingExposure;
#endif
  outColor = vec4(oetf(clamp(light * (a * vGain * dim), 0.0, 1.0)), 1.0);
}`;

function glowMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, dim: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    glslVersion: THREE.GLSL3,
  });
}

interface QuadSpec { w: number; h: number; at: THREE.Vector3; rot: THREE.Euler; shape: number; gain: number; flipU?: boolean }

function quads(specs: readonly QuadSpec[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const q of specs) {
    const g = new THREE.PlaneGeometry(q.w, q.h);
    if (q.flipU) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
    const n = g.attributes.position.count;
    g.setAttribute('aShape', new THREE.Float32BufferAttribute(new Array(n).fill(q.shape), 1));
    g.setAttribute('aGain', new THREE.Float32BufferAttribute(new Array(n).fill(q.gain), 1));
    g.applyMatrix4(new THREE.Matrix4().compose(q.at, new THREE.Quaternion().setFromEuler(q.rot), new THREE.Vector3(1, 1, 1)));
    parts.push(g);
  }
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv', 'aShape', 'aGain'];
  for (const name of names) {
    const arrays = parts.map((p) => p.attributes[name] as THREE.BufferAttribute);
    const size = arrays[0].itemSize;
    const data = new Float32Array(arrays.reduce((a, b) => a + b.count, 0) * size);
    let off = 0;
    for (const a of arrays) { data.set(a.array as Float32Array, off); off += a.count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  const index: number[] = [];
  let base = 0;
  for (const p of parts) {
    const idx = p.index!;
    for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + base);
    base += p.attributes.position.count;
  }
  out.setIndex(index);
  for (const p of parts) p.dispose();
  return out;
}

export interface GlassGlow {
  group: THREE.Group;
  setDim(own: number, left: number, right: number): void;
  dispose(): void;
}

export function makeGlow(size: { W: number; H: number; D: number; lowerFront?: number }, own: THREE.Texture, left: THREE.Texture | null, right: THREE.Texture | null, wall: boolean): GlassGlow {
  const group = new THREE.Group();
  const mats: THREE.ShaderMaterial[] = [];
  let leftMat: THREE.ShaderMaterial | null = null;
  let rightMat: THREE.ShaderMaterial | null = null;
  const front = size.D / 2;
  const ownQuads: QuadSpec[] = [{
    w: size.W * 1.4, h: 1.0, at: new THREE.Vector3(0, 0.005, front + 0.4), rot: new THREE.Euler(-Math.PI / 2, 0, 0), shape: 0, gain: POOL_GAIN,
  }];
  if (wall) {
    ownQuads.push({ w: size.W * 1.6, h: 1.1, at: new THREE.Vector3(0, size.H + 0.5, -front - WALL_NEAR_M + 0.03), rot: new THREE.Euler(0, 0, 0), shape: 1, gain: WALL_GAIN });
  }
  const ownMat = glowMaterial(own);
  mats.push(ownMat);
  group.add(new THREE.Mesh(quads(ownQuads), ownMat));
  const lowerH = size.H * 0.42;
  const spill = (tex: THREE.Texture, side: -1 | 1): void => {
    const m = glowMaterial(tex);
    mats.push(m);
    if (side < 0) leftMat = m; else rightMat = m;
    group.add(new THREE.Mesh(quads([{
      w: size.W, h: lowerH, at: new THREE.Vector3(0, lowerH / 2 + 0.05, (size.lowerFront ?? front - size.D * 0.12) + 0.035), rot: new THREE.Euler(0, 0, 0),
      shape: 2, gain: SPILL_GAIN, flipU: side > 0,
    }]), m));
  };
  if (left) spill(left, -1);
  if (right) spill(right, 1);
  for (const c of group.children) { c.frustumCulled = true; c.renderOrder = 2; }
  return {
    group,
    setDim(own, left, right) {
      ownMat.uniforms.dim.value = own;
      if (leftMat) leftMat.uniforms.dim.value = left;
      if (rightMat) rightMat.uniforms.dim.value = right;
    },
    dispose() { group.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); }); for (const m of mats) m.dispose(); },
  };
}
