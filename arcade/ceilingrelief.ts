import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfaceMaterial } from './roomtextures';
import { BEAM_D, BEAM_W, beamLayout, cofferLayout, PLATE_M } from './ceilinggrid';
import { buildChandelier } from './chandelier';

export interface ReliefSpec {
  kind: 'beams' | 'coffered';
  colour: string;
  finish: 'cream' | 'wood';
  glow: number;
  chandelier: boolean;
  lamps: boolean;
}

export interface ReliefRoom { W: number; D: number; cx: number; cz: number; top: number }

const DOWN = 1.0;
const SIDE = 0.6;
const SIDE_TOP = 0.42;
const CORNICE_M = 0.1;
const BEAM_TINT = '#a06a42';
const BEAM_TINT_SPREAD = 0.13;
const WOOD_RELIEF = 4;
const WOOD_ROUGH = 0.7;
const PLASTER_GLOW = 0.24;
const WOOD_GLOW = 0.45;
const RECESS_M = 0.15;
const RIB_W = 0.16;
const STEP_H = 0.03;
const STEP_W = 0.03;
const RIB_CREAM = '#f1ead9';
const TRIM_GOLD = 0xc9a24a;
const TRIM_M = 0.012;
const AO_M = 0.22;
const AO_DARK = 0.45;
const COVE_M = 0.28;
const COVE_COLOUR = new THREE.Color(1, 0.72, 0.42);
const LAMP_DROP_M = 0.42;
const LAMP_COLOUR = new THREE.Color(1, 0.8, 0.55);

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

function shade(g: THREE.BufferGeometry, top: number, k = 1): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    const v = ny < -0.5 ? DOWN : ny > 0.5 ? SIDE_TOP : pos.getY(i) > top - 0.005 ? SIDE_TOP : SIDE;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function grain(g: THREE.BufferGeometry, alongX: boolean, off = 0): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    uv[i * 2] = (alongX ? x : z) + off;
    uv[i * 2 + 1] = (Math.abs(nor.getY(i)) > 0.5 ? (alongX ? z : x) : y) + off * 0.37;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: number, k = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
  grain(g, x1 - x0 >= z1 - z0);
  return shade(g, top, k);
}

function corniceShape(): THREE.Shape {
  const s = new THREE.Shape();
  const m = CORNICE_M;
  s.moveTo(0, 0);
  s.lineTo(0, -m);
  s.lineTo(0.015, -m);
  s.lineTo(0.015, -m + 0.018);
  s.quadraticCurveTo(0.03, -0.03, m - 0.018, -0.015);
  s.lineTo(m, -0.015);
  s.lineTo(m, 0);
  s.lineTo(0, 0);
  return s;
}

function cornice(r: ReliefRoom): THREE.BufferGeometry[] {
  const { W, D, cx, cz, top } = r;
  const shape = corniceShape();
  const out: THREE.BufferGeometry[] = [];
  const run = (len: number, x: number, z: number, rotY: number): void => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 6 }).toNonIndexed();
    g.translate(0, 0, -len / 2);
    g.rotateY(rotY);
    g.translate(x, top, z);
    g.computeVertexNormals();
    grain(g, Math.abs(Math.cos(rotY)) < 0.5);
    out.push(shade(g, top));
  };
  run(D, cx - W / 2, cz, 0);
  run(D, cx + W / 2, cz, Math.PI);
  run(W, cx, cz - D / 2, -Math.PI / 2);
  run(W, cx, cz + D / 2, Math.PI / 2);
  return out;
}

function strip(x0: number, x1: number, z0: number, z1: number, y: number, from: '-x' | '+x' | '-z' | '+z'): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2).toNonIndexed();
  const pos = g.getAttribute('position');
  const f = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    f[i] = from === '-x' ? (x - x0) / (x1 - x0) : from === '+x' ? (x1 - x) / (x1 - x0) : from === '-z' ? (z - z0) / (z1 - z0) : (z1 - z) / (z1 - z0);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.setAttribute('fade', new THREE.BufferAttribute(f, 1));
  return g;
}

function ring(x0: number, x1: number, z0: number, z1: number, y: number, w: number): THREE.BufferGeometry[] {
  return [
    strip(x0, Math.min(x1, x0 + w), z0, z1, y, '-x'),
    strip(Math.max(x0, x1 - w), x1, z0, z1, y, '+x'),
    strip(x0, x1, z0, Math.min(z1, z0 + w), y, '-z'),
    strip(x0, x1, Math.max(z0, z1 - w), z1, y, '+z'),
  ];
}

function shaded(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.vertexColors = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  m.customProgramCacheKey = () => 'ceiling-shaded';
  return m;
}

export const KEEP_ALPHA = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
} as const;

function aoMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...KEEP_ALPHA, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: 'attribute float fade; varying float vF; void main() { vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying float vF; void main() { float a = 1.0 - clamp(vF, 0.0, 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, ${AO_DARK.toFixed(2)} * a * a); }`,
  });
}

function coveMaterial(colour: THREE.Color, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...KEEP_ALPHA, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { colour: { value: colour }, strength: { value: strength } },
    vertexShader: 'attribute float fade; varying float vF; void main() { vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 colour; uniform float strength; varying float vF;
      vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() { float a = pow(1.0 - clamp(vF, 0.0, 1.0), 2.2); gl_FragColor = vec4(oetf(colour * a * strength), 1.0); }`,
  });
}

let discTex: THREE.Texture | null = null;
function disc(): THREE.Texture {
  if (!discTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    discTex = new THREE.CanvasTexture(c);
  }
  return discTex;
}

function glowDecal(colour: THREE.Color, k: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    ...KEEP_ALPHA, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    map: disc(), color: colour.clone().multiplyScalar(k), side: THREE.DoubleSide,
  });
}

export interface ReliefBuild { group: THREE.Group; dispose(): void }

export function buildRelief(spec: ReliefSpec, r: ReliefRoom, renderer: THREE.WebGLRenderer): ReliefBuild {
  const { W, D, cx, cz, top } = r;
  const minX = cx - W / 2, maxX = cx + W / 2, minZ = cz - D / 2, maxZ = cz + D / 2;
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const subs: { dispose(): void }[] = [];
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, order = 0): THREE.Mesh | null => {
    if (!parts.length) return null;
    const g = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!g) return null;
    geos.push(g);
    mats.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = order;
    m.raycast = () => {};
    group.add(m);
    return m;
  };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Matrix4[], order = 0): void => {
    if (!at.length) { geo.dispose(); return; }
    geos.push(geo);
    mats.push(mat);
    const m = new THREE.InstancedMesh(geo, mat, at.length);
    at.forEach((x, i) => m.setMatrixAt(i, x));
    m.renderOrder = order;
    m.raycast = () => {};
    group.add(m);
  };

  const plane = new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(cx, top, cz).toNonIndexed();
  {
    const pos = plane.getAttribute('position');
    const uv = plane.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
    shade(plane, top - 1);
  }
  const plaster = shaded(surfaceMaterial('plaster', 1, 1, renderer, spec.colour, 0, PLASTER_GLOW));
  add([plane, ...cornice(r)], plaster);

  const ao: THREE.BufferGeometry[] = [];
  const aoY = top - 0.002;
  ao.push(...ring(minX + CORNICE_M, maxX - CORNICE_M, minZ + CORNICE_M, maxZ - CORNICE_M, aoY, AO_M));

  const wood = (): THREE.MeshStandardMaterial => {
    const m = shaded(surfaceMaterial('veneer', 1, 1, renderer, BEAM_TINT, 0, WOOD_GLOW));
    m.normalScale.setScalar(WOOD_RELIEF);
    m.roughnessMap = null;
    m.roughness = WOOD_ROUGH;
    return m;
  };

  if (spec.kind === 'beams') {
    const { acrossX, at: beamAt } = beamLayout(r);
    const n = beamAt.length;
    const rnd = seeded(1871);
    const parts: THREE.BufferGeometry[] = [];
    const y0 = top - BEAM_D;
    for (const at of beamAt) {
      const k = 1 + (rnd() * 2 - 1) * BEAM_TINT_SPREAD;
      const g = acrossX
        ? box(minX + PLATE_M, maxX - PLATE_M, y0, top, at - BEAM_W / 2, at + BEAM_W / 2, top, k)
        : box(at - BEAM_W / 2, at + BEAM_W / 2, y0, top, minZ + PLATE_M, maxZ - PLATE_M, top, k);
      grain(g, acrossX, rnd() * 7);
      parts.push(g);
      if (acrossX) {
        ao.push(strip(minX, maxX, at + BEAM_W / 2, at + BEAM_W / 2 + AO_M, aoY, '-z'), strip(minX, maxX, at - BEAM_W / 2 - AO_M, at - BEAM_W / 2, aoY, '+z'));
      } else {
        ao.push(strip(at + BEAM_W / 2, at + BEAM_W / 2 + AO_M, minZ, maxZ, aoY, '-x'), strip(at - BEAM_W / 2 - AO_M, at - BEAM_W / 2, minZ, maxZ, aoY, '+x'));
      }
    }
    if (acrossX) {
      parts.push(box(minX, minX + PLATE_M, top - PLATE_M, top, minZ, maxZ, top), box(maxX - PLATE_M, maxX, top - PLATE_M, top, minZ, maxZ, top));
    } else {
      parts.push(box(minX, maxX, top - PLATE_M, top, minZ, minZ + PLATE_M, top), box(minX, maxX, top - PLATE_M, top, maxZ - PLATE_M, maxZ, top));
    }
    add(parts, wood());
    if (spec.lamps) {
      const span = acrossX ? W : D;
      const spots: THREE.Vector3[] = [];
      beamAt.forEach((at, i) => {
        if (i % 2 !== (n > 2 ? 1 : 0)) return;
        for (const f of [1 / 3, 2 / 3]) {
          const along = (acrossX ? minX : minZ) + span * f;
          spots.push(acrossX ? new THREE.Vector3(along, y0, at) : new THREE.Vector3(at, y0, along));
        }
      });
      const cordShade = mergeGeometries([
        new THREE.CylinderGeometry(0.005, 0.005, LAMP_DROP_M, 6).translate(0, -LAMP_DROP_M / 2, 0).toNonIndexed(),
        new THREE.CylinderGeometry(0.05, 0.17, 0.16, 20, 1, true).translate(0, -LAMP_DROP_M - 0.08, 0).toNonIndexed(),
      ])!;
      const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.6, roughness: 0.4, emissive: 0x3a2a10, emissiveIntensity: 0.6, side: THREE.DoubleSide });
      const m = (v: THREE.Vector3, dy = 0): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(v.x, v.y + dy, v.z);
      instanced(cordShade, brass, spots.map((v) => m(v)));
      instanced(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshBasicMaterial({ color: LAMP_COLOUR }), spots.map((v) => m(v, -LAMP_DROP_M - 0.13)));
      instanced(new THREE.PlaneGeometry(0.7, 0.7).rotateX(Math.PI / 2), glowDecal(LAMP_COLOUR, 0.55), spots.map((v) => m(v, -LAMP_DROP_M - 0.165)), 3);
    }
  } else {
    const { ix0, ix1, iz0, iz1, nx, nz, px, pz } = cofferLayout(r);
    const yS = top - RECESS_M;
    const yL = yS + STEP_H;
    const parts: THREE.BufferGeometry[] = [];
    const trim: THREE.BufferGeometry[] = [];
    const hw = RIB_W / 2, sw = hw + STEP_W;
    for (let i = 1; i < nx; i++) {
      const x = ix0 + i * px;
      parts.push(box(x - hw, x + hw, yS, yL, iz0, iz1, top), box(x - sw, x + sw, yL, top, iz0, iz1, top));
      trim.push(box(x - hw - TRIM_M / 2, x - hw + TRIM_M / 2, yL - TRIM_M / 2, yL + TRIM_M / 2, iz0, iz1, top), box(x + hw - TRIM_M / 2, x + hw + TRIM_M / 2, yL - TRIM_M / 2, yL + TRIM_M / 2, iz0, iz1, top));
    }
    for (let j = 1; j < nz; j++) {
      const z = iz0 + j * pz;
      parts.push(box(ix0, ix1, yS, yL, z - hw, z + hw, top), box(ix0, ix1, yL, top, z - sw, z + sw, top));
      trim.push(box(ix0, ix1, yL - TRIM_M / 2, yL + TRIM_M / 2, z - hw - TRIM_M / 2, z - hw + TRIM_M / 2, top), box(ix0, ix1, yL - TRIM_M / 2, yL + TRIM_M / 2, z + hw - TRIM_M / 2, z + hw + TRIM_M / 2, top));
    }
    parts.push(
      box(minX, ix0 + hw, yS, yL, minZ, maxZ, top), box(ix1 - hw, maxX, yS, yL, minZ, maxZ, top),
      box(minX, maxX, yS, yL, minZ, iz0 + hw, top), box(minX, maxX, yS, yL, iz1 - hw, maxZ, top),
      box(minX, ix0 + sw, yL, top, minZ, maxZ, top), box(ix1 - sw, maxX, yL, top, minZ, maxZ, top),
      box(minX, maxX, yL, top, minZ, iz0 + sw, top), box(minX, maxX, yL, top, iz1 - sw, maxZ, top),
    );
    trim.push(
      box(ix0 + hw - TRIM_M / 2, ix0 + hw + TRIM_M / 2, yL - TRIM_M / 2, yL + TRIM_M / 2, iz0 + hw, iz1 - hw, top),
      box(ix1 - hw - TRIM_M / 2, ix1 - hw + TRIM_M / 2, yL - TRIM_M / 2, yL + TRIM_M / 2, iz0 + hw, iz1 - hw, top),
      box(ix0 + hw, ix1 - hw, yL - TRIM_M / 2, yL + TRIM_M / 2, iz0 + hw - TRIM_M / 2, iz0 + hw + TRIM_M / 2, top),
      box(ix0 + hw, ix1 - hw, yL - TRIM_M / 2, yL + TRIM_M / 2, iz1 - hw - TRIM_M / 2, iz1 - hw + TRIM_M / 2, top),
    );
    const ribMat = spec.finish === 'wood'
      ? wood()
      : shaded(surfaceMaterial('plaster', 1, 1, renderer, RIB_CREAM, 0, PLASTER_GLOW));
    add(parts, ribMat);
    if (spec.finish === 'cream') {
      add(trim, new THREE.MeshStandardMaterial({ color: TRIM_GOLD, metalness: 0.85, roughness: 0.25, emissive: TRIM_GOLD, emissiveIntensity: 0.35 }));
    } else for (const t of trim) t.dispose();
    const cove: THREE.BufferGeometry[] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x0 = ix0 + i * px + sw, x1 = ix0 + (i + 1) * px - sw, z0 = iz0 + j * pz + sw, z1 = iz0 + (j + 1) * pz - sw;
        ao.push(...ring(x0, x1, z0, z1, aoY, AO_M * 0.8));
        if (spec.glow > 0) cove.push(...ring(x0, x1, z0, z1, top - 0.004, COVE_M));
      }
    }
    if (cove.length) add(cove, coveMaterial(COVE_COLOUR, spec.glow * 0.6), 3);
    if (spec.chandelier) {
      const ci = Math.min(nx - 1, Math.floor((cx - ix0) / px)), cj = Math.min(nz - 1, Math.floor((cz - iz0) / pz));
      const c = buildChandelier(ix0 + (ci + 0.5) * px, iz0 + (cj + 0.5) * pz, top);
      group.add(c.group);
      subs.push(c);
    }
  }
  add(ao, aoMaterial(), 1);
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const c of subs) c.dispose();
    },
  };
}
