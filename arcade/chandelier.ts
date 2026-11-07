import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const DROP_M = 0.66;
const R_LOW = 0.36;
const R_HIGH = 0.21;
const ARMS_LOW = 8;
const ARMS_HIGH = 6;
const UPPER_RISE = 0.17;
const LOD_M = 8;
const BRASS = new THREE.Color(1.0, 0.76, 0.38);
const SLEEVE = new THREE.Color(1.75, 1.7, 1.6);
const WIRE = new THREE.Color(0.8, 0.8, 0.82);
const FLAME = new THREE.Color(1.0, 0.86, 0.62);
const GLOW = new THREE.Color(1.0, 0.72, 0.42);
const CEILING_GLOW = 0.5;
const FLOOR_GLOW = 0.11;
const HALO_M = 0.15;
const CRYSTAL_SCALE = 0.75;
const SPARK_SHARE = 0.12;
const STAR_M = 0.035;
const FLASH_S = 0.15;
const FLASH_EVERY_S: [number, number] = [1.5, 5];

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let metalCap: THREE.Texture | null = null;
let crystalCap: THREE.Texture | null = null;

function metalMatcap(): THREE.Texture {
  if (!metalCap) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const base = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    base.addColorStop(0, '#9a9a9a');
    base.addColorStop(0.75, '#505050');
    base.addColorStop(1, '#141414');
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    const band = g.createLinearGradient(0, 56, 0, 80);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = band;
    g.fillRect(0, 56, 128, 24);
    const hot = g.createRadialGradient(44, 38, 0, 44, 38, 26);
    hot.addColorStop(0, 'rgba(255,255,255,1)');
    hot.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hot;
    g.fillRect(0, 0, 128, 128);
    metalCap = new THREE.CanvasTexture(c);
    metalCap.colorSpace = THREE.SRGBColorSpace;
  }
  return metalCap;
}

function crystalMatcap(): THREE.Texture {
  if (!crystalCap) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const base = g.createRadialGradient(128, 118, 0, 128, 128, 128);
    base.addColorStop(0, '#d4dae4');
    base.addColorStop(0.5, '#6a7488');
    base.addColorStop(1, '#161a24');
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    const rnd = seeded(4242);
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 112;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      const s = 6 + rnd() * 22;
      const light = rnd();
      g.fillStyle = light > 0.55 ? `rgba(255,255,255,${0.85 + rnd() * 0.15})` : light > 0.35 ? `rgba(190,220,255,${0.3 + rnd() * 0.3})` : `rgba(4,6,12,${0.6 + rnd() * 0.35})`;
      g.beginPath();
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const b = (k / n) * Math.PI * 2 + rnd();
        g.lineTo(x + Math.cos(b) * s * (0.5 + rnd()), y + Math.sin(b) * s * (0.5 + rnd()));
      }
      g.closePath();
      g.fill();
    }
    crystalCap = new THREE.CanvasTexture(c);
    crystalCap.colorSpace = THREE.SRGBColorSpace;
  }
  return crystalCap;
}

function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (k !== 'position') f.deleteAttribute(k);
  f.computeVertexNormals();
  return f;
}

function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal') f.deleteAttribute(k);
  return f;
}

function paint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function seedOf(g: THREE.BufferGeometry, s: number): THREE.BufferGeometry {
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(s), 1));
  return g;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 5): THREE.BufferGeometry {
  const d = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), sides, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return smooth(g);
}

function teardrop(h0: number): THREE.BufferGeometry {
  const h = h0 * CRYSTAL_SCALE;
  const r = h * 0.32;
  return facet(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(r, -h * 0.3), new THREE.Vector2(0, -h)], 5));
}
function prism(h0: number): THREE.BufferGeometry {
  const h = h0 * CRYSTAL_SCALE;
  const r = h * 0.16;
  return facet(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(r, -h * 0.15), new THREE.Vector2(r, -h * 0.85), new THREE.Vector2(0, -h)], 6));
}
function bead(r0: number): THREE.BufferGeometry {
  const r = r0 * CRYSTAL_SCALE;
  return facet(new THREE.IcosahedronGeometry(r, 0)).translate(0, -r, 0);
}

export interface ChandelierBuild { group: THREE.Group; dispose(): void }

export function buildChandelier(x: number, z: number, top: number): ChandelierBuild {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const keep = <T extends THREE.BufferGeometry | THREE.Material>(o: T): T => {
    if ((o as THREE.Material).isMaterial) mats.push(o as THREE.Material); else geos.push(o as THREE.BufferGeometry);
    return o;
  };
  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    const g = mergeGeometries(parts)!;
    for (const p of parts) p.dispose();
    return keep(g);
  };
  const rnd = seeded(1923);
  const v = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c);
  const ringY = 0;
  const roseY = DROP_M;

  const frame: THREE.BufferGeometry[] = [];
  const flames: THREE.Vector3[] = [];
  const arm = (a: number, r: number, y0: number, y1: number): THREE.Vector3 => {
    const c = Math.cos(a), s = Math.sin(a);
    const at = (t: number, y: number): THREE.Vector3 => v(c * r * t, y, s * r * t);
    const curve = new THREE.CatmullRomCurve3([at(0.05, y0), at(0.3, y0 - 0.07), at(0.62, y0 - 0.05), at(0.88, y1 - 0.06), at(1, y1 - 0.015)]);
    frame.push(paint(smooth(new THREE.TubeGeometry(curve, 18, 0.0075, 6)), BRASS));
    const cup = at(1, y1);
    frame.push(paint(smooth(new THREE.CylinderGeometry(0.032, 0.02, 0.014, 12).translate(cup.x, cup.y - 0.007, cup.z)), BRASS));
    frame.push(paint(smooth(new THREE.CylinderGeometry(0.011, 0.011, 0.075, 10).translate(cup.x, cup.y + 0.0375, cup.z)), SLEEVE));
    flames.push(v(cup.x, cup.y + 0.075, cup.z));
    return cup;
  };
  frame.push(paint(smooth(new THREE.CylinderGeometry(0.07, 0.09, 0.03, 16).translate(0, roseY - 0.015, 0)), BRASS));
  frame.push(paint(rod(v(0, roseY - 0.03, 0), v(0, -0.1, 0), 0.011, 8), BRASS));
  frame.push(paint(smooth(new THREE.SphereGeometry(0.05, 14, 10).scale(1, 0.75, 1).translate(0, -0.06, 0)), BRASS));
  frame.push(paint(smooth(new THREE.SphereGeometry(0.03, 12, 8).translate(0, UPPER_RISE + 0.02, 0)), BRASS));
  frame.push(paint(smooth(new THREE.ConeGeometry(0.02, 0.07, 10).rotateX(Math.PI).translate(0, -0.14, 0)), BRASS));
  const lowCups: THREE.Vector3[] = [];
  for (let i = 0; i < ARMS_LOW; i++) lowCups.push(arm((i / ARMS_LOW) * Math.PI * 2, R_LOW, -0.04, ringY));
  const highCups: THREE.Vector3[] = [];
  for (let i = 0; i < ARMS_HIGH; i++) highCups.push(arm(((i + 0.5) / ARMS_HIGH) * Math.PI * 2, R_HIGH, UPPER_RISE, UPPER_RISE + 0.09));
  const ringR = R_LOW * 0.82, ringH = ringY - 0.06;
  frame.push(paint(smooth(new THREE.TorusGeometry(ringR, 0.005, 6, 48).rotateX(Math.PI / 2).translate(0, ringH, 0)), BRASS));
  for (const c of lowCups) frame.push(paint(rod(v(c.x, c.y - 0.014, c.z), v(c.x * 0.82, ringH, c.z * 0.82), 0.0035), BRASS));

  const full: THREE.BufferGeometry[] = [];
  const simple: THREE.BufferGeometry[] = [];
  const sparkAt: THREE.Vector3[] = [];
  let seed = 0;
  const drop = (p: THREE.Vector3, wire: number, g: THREE.BufferGeometry, alsoSimple: boolean): void => {
    frame.push(paint(rod(p, v(p.x, p.y - wire, p.z), 0.0012, 4), WIRE));
    const s = (seed++ * 0.6180339) % 1;
    const at = g.translate(p.x, p.y - wire, p.z);
    if (alsoSimple) simple.push(seedOf(at.clone(), s));
    full.push(seedOf(at, s));
    if (rnd() < SPARK_SHARE) sparkAt.push(v(p.x, p.y - wire - 0.02, p.z));
  };
  for (const c of lowCups) drop(v(c.x, c.y - 0.014, c.z), 0.03 + rnd() * 0.04, teardrop(0.075), true);
  const RING_DROPS = 24;
  for (let i = 0; i < RING_DROPS; i++) {
    const a = ((i + 0.5) / RING_DROPS) * Math.PI * 2;
    const p = v(Math.cos(a) * ringR, ringH, Math.sin(a) * ringR);
    drop(p, 0.02 + rnd() * 0.07, i % 2 ? prism(0.05 + rnd() * 0.02) : teardrop(0.045 + rnd() * 0.02), i % 3 === 0);
  }
  for (let i = 0; i < ARMS_HIGH; i++) {
    const c = highCups[i];
    drop(v(c.x, c.y - 0.014, c.z), 0.02 + rnd() * 0.03, teardrop(0.045), false);
    const a = ((i + 1) / ARMS_HIGH) * Math.PI * 2;
    drop(v(Math.cos(a) * R_HIGH * 0.7, UPPER_RISE - 0.02, Math.sin(a) * R_HIGH * 0.7), 0.04 + rnd() * 0.05, prism(0.04), false);
  }
  drop(v(0, -0.175, 0), 0.02, teardrop(0.11), true);
  for (const k of [-1, 1]) drop(v(k * 0.03, -0.12, 0), 0.05 + rnd() * 0.03, teardrop(0.06), false);
  const BEADS = 11;
  for (let i = 0; i < ARMS_LOW; i++) {
    const a = lowCups[i], b = lowCups[(i + 1) % ARMS_LOW];
    for (let k = 1; k < BEADS; k++) {
      const t = k / BEADS;
      const p = a.clone().lerp(b, t);
      p.y -= 0.014 + Math.sin(t * Math.PI) * 0.085;
      full.push(seedOf(bead(0.0065).translate(p.x, p.y, p.z), (seed++ * 0.6180339) % 1));
    }
  }

  const time = { value: 0 };
  const brass = keep(new THREE.MeshMatcapMaterial({ matcap: metalMatcap(), vertexColors: true }));
  const crystal = keep(new THREE.MeshMatcapMaterial({ matcap: crystalMatcap(), color: 0xf2f6ff }));
  crystal.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying float vSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed = aSeed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vSeed;')
      .replace('#include <opaque_fragment>', [
        'float hf = fract(sin(vSeed * 91.7 + floor(uTime * 5.0 + vSeed * 13.0) * 12.9898) * 43758.5453);',
        'float lit = smoothstep(0.55, 0.9, max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b)));',
        'outgoingLight *= 1.0 + 0.6 * lit * smoothstep(0.75, 1.0, hf);',
        'outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.0, 0.88, 0.7), lit * 0.45);',
        '#include <opaque_fragment>',
      ].join('\n'));
  };
  crystal.customProgramCacheKey = () => 'chandelier-crystal';
  const flameMat = keep(new THREE.MeshBasicMaterial({ color: FLAME }));

  const flameGeo = smooth(new THREE.LatheGeometry([0, 0.006, 0.011, 0.012, 0.009, 0.004, 0].map((r, i, a) => new THREE.Vector2(r, (i / (a.length - 1)) * 0.042)), 10));
  const bulbs = merge(flames.map((p) => flameGeo.clone().translate(p.x, p.y, p.z)));
  flameGeo.dispose();

  const pts = (withStars: boolean): THREE.BufferGeometry => {
    const at: number[] = [], size: number[] = [], kind: number[] = [], sd: number[] = [];
    for (const p of flames) { at.push(p.x, p.y + 0.02, p.z); size.push(HALO_M); kind.push(0); sd.push(0); }
    if (withStars) sparkAt.forEach((p, i) => { at.push(p.x, p.y, p.z); size.push(STAR_M); kind.push(1); sd.push((i * 0.7548776) % 1); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
    return keep(g);
  };
  const scale = { value: 600 };
  const sparkMat = keep(new THREE.ShaderMaterial({
    uniforms: { uTime: time, uScale: scale, uHalo: { value: GLOW }, uFlame: { value: FLAME } },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: `
      attribute float aSize; attribute float aKind; attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vKind; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
        vKind = aKind;
        // A star flashes for FLASH_S now and then: each its own wait between
        // ${FLASH_EVERY_S[0]} and ${FLASH_EVERY_S[1]} s, and only on about half its turns, so
        // the flashes come at no rhythm the eye can find.
        float every = mix(${FLASH_EVERY_S[0].toFixed(2)}, ${FLASH_EVERY_S[1].toFixed(2)}, fract(aSeed * 7.31));
        float turn = uTime / every + aSeed * 13.0;
        float on = step(0.5, fract(sin(floor(turn) * 78.233 + aSeed * 12.9898) * 43758.5453));
        float t = fract(turn) * every;
        vA = aKind < 0.5 ? 1.0 : on * step(t, ${FLASH_S.toFixed(3)}) * sin(3.14159 * t / ${FLASH_S.toFixed(3)});
      }`,
    fragmentShader: `
      uniform vec3 uHalo; uniform vec3 uFlame;
      varying float vKind; varying float vA;
      vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        vec3 c;
        if (vKind < 0.5) {
          // A tight bright core and a steep (cubic) falloff: each candle a
          // point of light, not part of a cloud.
          c = uHalo * (pow(max(0.0, 1.0 - r), 3.0) * 0.7 + pow(max(0.0, 1.0 - r * 3.5), 2.0) * 1.6);
        } else {
          // A thin cross, faint: a glint, not a cartoon star.
          float rays = max(0.0, 1.0 - abs(p.x) * 18.0) * pow(max(0.0, 1.0 - abs(p.y)), 2.0) + max(0.0, 1.0 - abs(p.y) * 18.0) * pow(max(0.0, 1.0 - abs(p.x)), 2.0);
          c = vec3(1.0, 0.95, 0.86) * (rays * 0.55 + pow(max(0.0, 1.0 - r * 4.0), 2.0) * 0.4) * vA;
        }
        gl_FragColor = vec4(oetf(clamp(c, 0.0, 1.0)), 1.0);
      }`,
  }));

  const disc = (): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    r.addColorStop(0.65, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  };
  const glowTex = disc();
  const glowParts = [
    paint(new THREE.PlaneGeometry(3, 3).rotateX(Math.PI / 2).translate(0, roseY - 0.006, 0), GLOW.clone().multiplyScalar(CEILING_GLOW)),
    paint(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2).translate(0, -(top - DROP_M) + 0.008, 0), GLOW.clone().multiplyScalar(FLOOR_GLOW)),
  ];
  const glowMat = keep(new THREE.MeshBasicMaterial({
    map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));

  const frameGeo = merge(frame);
  const crystalsFull = merge(full);
  const crystalsSimple = merge(simple);
  const level = (crystals: THREE.BufferGeometry, stars: boolean): THREE.Group => {
    const g = new THREE.Group();
    const c = new THREE.Mesh(crystals, crystal);
    c.onBeforeRender = () => { time.value = performance.now() / 1000; };
    const p = new THREE.Points(pts(stars), sparkMat);
    p.onBeforeRender = (renderer, _s, camera) => {
      const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
      scale.value = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] * h * 0.5;
      time.value = performance.now() / 1000;
    };
    p.renderOrder = 4;
    g.add(new THREE.Mesh(frameGeo, brass), c, new THREE.Mesh(bulbs, flameMat), p);
    return g;
  };
  const lod = new THREE.LOD();
  lod.addLevel(level(crystalsFull, true), 0);
  lod.addLevel(level(crystalsSimple, false), LOD_M);
  const glow = new THREE.Mesh(merge(glowParts), glowMat);
  glow.renderOrder = 3;
  const group = new THREE.Group();
  group.position.set(x, top - DROP_M, z);
  group.add(lod, glow);
  group.traverse((o) => { o.raycast = () => {}; });
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      glowTex.dispose();
    },
  };
}
