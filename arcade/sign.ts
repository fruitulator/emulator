import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cabinetEnvironment } from './cabinetlight';
import { surfaceMaterial } from './roomtextures';
import { scrollerMessages, type RoomLook, type SignBoard, type SignLed } from './roomlook';
import { canvasFont, dotText, strokeText } from './signfont';
import { traceShapes } from './signtrace';

export const SIGN_LETTER_M = 0.26;

export interface SignWall {
  mesh: THREE.Mesh; w: number; along: number; vOff: number; y0: number; h: number;
  minX: number; z: number;
}

export interface Sign {
  group: THREE.Group;
  width: number;
  height: number;
  placed?(at: { x: number; y: number; s: number }): void;
  tick?(t: number): void;
  dispose(): void;
}

export interface SignContext {
  name: string | null;
  look: RoomLook;
  renderer: THREE.WebGLRenderer;
  wall: SignWall;
  motion: boolean;
}

export async function buildSign(c: SignContext): Promise<Sign | null> {
  const style = c.look.signStyle;
  if (style === 'matrix') return scrollerMessages(c.look, c.name).length ? matrixSign(c) : null;
  if (!c.name?.trim()) return null;
  switch (style) {
    case 'marquee': return marqueeSign(c);
    case 'ghost': return paintedSign(c, 'ghost');
    case 'vinyl': return paintedSign(c, 'vinyl');
    case 'gilded': return gildedSign(c);
    case 'brass': return brassSign(c);
    case 'lightbox': return lightboxSign(c);
    default: return neonSign(c);
  }
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) disposeMaterial(mat);
  });
}

function disposeMaterial(mat: THREE.Material): void {
  for (const [k, v] of Object.entries(mat)) {
    if (k !== 'envMap' && v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
  }
  const u = (mat as THREE.ShaderMaterial).uniforms;
  if (u) for (const x of Object.values(u)) if ((x.value as THREE.Texture)?.isTexture) (x.value as THREE.Texture).dispose();
  mat.dispose();
}

function canvasTex(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer, colour: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

function glowDecal(c: HTMLCanvasElement, w: number, h: number, colour: THREE.ColorRepresentation, level: number, renderer: THREE.WebGLRenderer): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: canvasTex(c, renderer, true), color: new THREE.Color(colour).multiplyScalar(level),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  m.position.z = 0.003;
  m.renderOrder = 1;
  return m;
}

function canvasFor(w: number, h: number, ppm: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D; ppm: number } {
  const k = Math.min(ppm, 4096 / w, 4096 / h);
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.ceil(w * k));
  c.height = Math.max(4, Math.ceil(h * k));
  return { c, g: c.getContext('2d')!, ppm: k };
}

async function textFit(name: string, font: RoomLook['signFont'], ppm: number): Promise<{ css: string; w: number; asc: number; desc: number }> {
  const probe = document.createElement('canvas').getContext('2d')!;
  const at = 100;
  probe.font = await canvasFont(font, at);
  const capAt = probe.measureText('H').actualBoundingBoxAscent || at * 0.7;
  const px = (SIGN_LETTER_M * ppm * at) / capAt;
  probe.font = await canvasFont(font, px);
  const m = probe.measureText(name);
  return {
    css: probe.font,
    w: Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / ppm,
    asc: m.actualBoundingBoxAscent / ppm,
    desc: m.actualBoundingBoxDescent / ppm,
  };
}

function drawName(g: CanvasRenderingContext2D, name: string, css: string, ppm: number, cw: number, ch: number, dy = 0): void {
  g.font = css;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText(name, cw / 2, ch / 2 + (SIGN_LETTER_M / 2 + dy) * ppm);
}

const metalEnv = (m: THREE.MeshStandardMaterial, r: THREE.WebGLRenderer, level: number): THREE.MeshStandardMaterial => {
  m.envMap = cabinetEnvironment(r);
  m.envMapIntensity = level;
  return m;
};

const TUBE_R = 0.0055;
const TUBE_Z = 0.045;
const BOARD_MARGIN = 0.07;
const BOARD_T = 0.006;
const BOARD_Z = 0.03;
const NEON_GLOW_M = 0.12;
const NEON_GLOW = 0.55;

function tubeMaterial(colour: string): THREE.ShaderMaterial {
  const c = new THREE.Color(colour);
  return new THREE.ShaderMaterial({
    uniforms: { uColour: { value: c }, uCore: { value: c.clone().lerp(new THREE.Color(1, 1, 1), 0.86) } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vN = normalize( normalMatrix * normal ); vV = - mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColour; uniform vec3 uCore; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = abs( dot( normalize( vN ), normalize( vV ) ) );
        gl_FragColor = vec4( mix( uColour * 1.4, uCore * 1.6, pow( f, 2.5 ) ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

async function neonSign(c: SignContext): Promise<Sign> {
  const H = SIGN_LETTER_M;
  const st = await strokeText(c.name!, H);
  const x0 = -st.width / 2;
  const y0 = -H / 2;
  const group = new THREE.Group();
  const tubes: THREE.BufferGeometry[] = [];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  const strokes: THREE.Vector3[][] = [];
  for (const line of st.lines) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < line.length; i += 2) {
      const p = new THREE.Vector3(line[i] + x0, line[i + 1] + y0, TUBE_Z);
      if (!pts.length || p.distanceTo(pts[pts.length - 1]) > 1e-4) pts.push(p);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (pts.length < 2) continue;
    strokes.push(pts);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    tubes.push(new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(curve.getLength() / 0.008)), TUBE_R, 8, false));
  }
  if (!tubes.length) { minX = -0.1; maxX = 0.1; minY = -0.1; maxY = 0.1; }
  const tubeMesh = new THREE.Mesh(tubes.length ? mergeGeometries(tubes) : new THREE.BufferGeometry(), tubeMaterial(c.look.sign));
  tubes.forEach((t) => t.dispose());
  tubeMesh.renderOrder = 2;
  group.add(tubeMesh);

  const bx0 = minX - BOARD_MARGIN; const bx1 = maxX + BOARD_MARGIN;
  const by0 = minY - BOARD_MARGIN; const by1 = maxY + BOARD_MARGIN;
  const bw = bx1 - bx0; const bh = by1 - by0;
  const bcx = (bx0 + bx1) / 2; const bcy = (by0 + by1) / 2;

  if (c.look.signBackboard) {
    const g = new THREE.BoxGeometry(bw, bh, BOARD_T).toNonIndexed();
    const n = g.getAttribute('normal');
    const col = new Float32Array(n.count * 4);
    for (let i = 0; i < n.count; i++) {
      const face = Math.abs(n.getZ(i)) > 0.5;
      col.set(face ? [0.75, 0.85, 0.9, 0.07] : [0.9, 0.95, 1, 0.55], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const board = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    board.position.set(bcx, bcy, BOARD_Z);
    board.renderOrder = 1;
    group.add(board);
  }

  const hwMat = metalEnv(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.35 }), c.renderer, 0.6);
  const hw = new THREE.Mesh(new THREE.BufferGeometry(), hwMat);
  group.add(hw);
  const coloured = (g: THREE.BufferGeometry, rgb: [number, number, number]): THREE.BufferGeometry => {
    const ng = g.index ? g.toNonIndexed() : g;
    const n = ng.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(rgb, i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ng.deleteAttribute('uv');
    return ng;
  };
  const post = (x: number, y: number, len: number, r: number): THREE.BufferGeometry =>
    coloured(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2).translate(x, y, len / 2), [0.78, 0.8, 0.82]);
  const posts: THREE.BufferGeometry[] = [];
  if (c.look.signBackboard) {
    const ix = Math.min(0.05, bw / 4); const iy = Math.min(0.05, bh / 4);
    for (const [x, y] of [[bx0 + ix, by0 + iy], [bx1 - ix, by0 + iy], [bx0 + ix, by1 - iy], [bx1 - ix, by1 - iy]]) {
      posts.push(post(x, y, BOARD_Z + BOARD_T / 2 + 0.004, 0.008));
    }
  } else {
    for (const s of strokes) {
      let run = 0.12;
      for (let i = 1; i < s.length; i++) {
        run += s[i].distanceTo(s[i - 1]);
        if (run >= 0.25) { posts.push(post(s[i].x, s[i].y, TUBE_Z - TUBE_R, 0.0035)); run = 0; }
      }
    }
  }
  const cableX = bx1 - 0.04;
  const cableY = c.look.signBackboard ? by1 : maxY;
  const hardware = (ceilingUp: number): void => {
    const parts = posts.map((p) => p.clone());
    if (ceilingUp > 0.01) {
      parts.push(coloured(new THREE.CylinderGeometry(0.0025, 0.0025, ceilingUp, 6).translate(cableX, cableY + ceilingUp / 2, 0.012), [0.04, 0.04, 0.045]));
    }
    hw.geometry.dispose();
    hw.geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
    parts.forEach((p) => p.dispose());
  };
  hardware(0);

  const pad = NEON_GLOW_M * 2;
  const gw = maxX - minX + pad * 2; const gh = maxY - minY + pad * 2;
  const { c: gc, g, ppm } = canvasFor(gw, gh, 160);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.filter = `blur(${(NEON_GLOW_M * ppm * 0.5).toFixed(1)}px)`;
  for (const [w, a] of [[NEON_GLOW_M * 1.2, 0.35], [NEON_GLOW_M * 0.35, 0.8]] as const) {
    g.lineWidth = w * ppm;
    g.globalAlpha = a;
    for (const s of strokes) {
      g.beginPath();
      s.forEach((p, i) => {
        const px = (p.x - minX + pad) * ppm; const py = (maxY + pad - p.y) * ppm;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      });
      g.stroke();
    }
  }
  const glow = glowDecal(gc, gw, gh, c.look.sign, NEON_GLOW, c.renderer);
  glow.position.set((minX + maxX) / 2, (minY + maxY) / 2, 0.003);
  group.add(glow);

  return {
    group, width: bw, height: bh,
    placed: ({ y, s }) => hardware(Math.max(0, (c.wall.y0 + c.wall.h - (y + cableY * s)) / s)),
    dispose: () => { posts.forEach((p) => p.dispose()); disposeGroup(group); },
  };
}

const BULBS_PER_CAP = 7.5;
const BULB_R = 0.3;
const CHASE_BPS = 8;
const CHASE_EVERY = 3;
const BULB_COLOUR = '#ffd27a';

async function marqueeSign(c: SignContext): Promise<Sign> {
  const H = SIGN_LETTER_M;
  const pitch = H / BULBS_PER_CAP;
  const at: [number, number][] = [];
  if (c.look.signFont === 'relief') {
    const st = await strokeText(c.name!, H);
    const x0 = -st.width / 2; const y0 = -H / 2;
    for (const l of st.lines) {
      let run = pitch;
      for (let i = 2; i < l.length; i += 2) {
        const ax = l[i - 2]; const ay = l[i - 1]; const bx = l[i]; const by = l[i + 1];
        const seg = Math.hypot(bx - ax, by - ay);
        let t = 0;
        while (run + (seg - t) >= pitch) {
          t += pitch - run;
          run = 0;
          const k = seg ? t / seg : 0;
          at.push([ax + (bx - ax) * k + x0, ay + (by - ay) * k + y0]);
        }
        run += seg - t;
      }
      if (l.length >= 2) at.push([l[0] + x0, l[1] + y0]);
    }
  } else {
    const fit = await textFit(c.name!, c.look.signFont, 1 / pitch * 4);
    const w = fit.w + pitch * 2; const h = H * 1.6;
    const { c: mc, g, ppm } = canvasFor(w, h, (1 / pitch) * 4);
    g.fillStyle = '#fff';
    drawName(g, c.name!, (await textFit(c.name!, c.look.signFont, ppm)).css, ppm, mc.width, mc.height);
    const a = g.getImageData(0, 0, mc.width, mc.height).data;
    const step = pitch * ppm;
    for (let y = step / 2; y < mc.height; y += step) {
      for (let x = step / 2; x < mc.width; x += step) {
        if (a[(Math.floor(y) * mc.width + Math.floor(x)) * 4 + 3] > 140) at.push([x / ppm - w / 2, h / 2 - y / ppm]);
      }
    }
  }
  at.sort((p, q) => p[0] - q[0]);
  const n = Math.max(1, at.length);
  const geo = new THREE.IcosahedronGeometry(pitch * BULB_R, 1);
  const order = new Float32Array(n);
  at.forEach((_, i) => { order[i] = i; });
  geo.setAttribute('aOrder', new THREE.InstancedBufferAttribute(order, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSpeed: { value: c.motion ? c.look.signChase : 0 }, uColour: { value: new THREE.Color(BULB_COLOUR) } },
    vertexShader: `attribute float aOrder; varying float vOrder; varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        vOrder = aOrder; vN = normalize( normalMatrix * mat3( instanceMatrix ) * normal ); vV = - mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uTime; uniform float uSpeed; uniform vec3 uColour;
      varying float vOrder; varying vec3 vN; varying vec3 vV;
      void main() {
        float lit = uSpeed <= 0.0 ? 1.0 : step( mod( vOrder - uTime * uSpeed * ${CHASE_BPS.toFixed(1)}, ${CHASE_EVERY.toFixed(1)} ), 1.0 );
        float f = abs( dot( normalize( vN ), normalize( vV ) ) );
        vec3 hot = mix( uColour, vec3( 1.0, 0.97, 0.9 ), pow( f, 3.0 ) );
        gl_FragColor = vec4( hot * mix( 0.18, 1.6, lit ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const bulbs = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4();
  at.forEach(([x, y], i) => bulbs.setMatrixAt(i, m4.makeTranslation(x, y, pitch * 0.5)));
  bulbs.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(bulbs);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of at) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (!at.length) { minX = minY = -0.1; maxX = maxY = 0.1; }
  const pad = pitch * 2;
  const gw = maxX - minX + pad * 2; const gh = maxY - minY + pad * 2;
  const { c: gc, g, ppm } = canvasFor(gw, gh, 120);
  g.fillStyle = '#fff';
  g.filter = `blur(${(pitch * ppm * 0.45).toFixed(1)}px)`;
  g.globalAlpha = 0.6;
  for (const [x, y] of at) {
    g.beginPath();
    g.arc((x - minX + pad) * ppm, (maxY + pad - y) * ppm, pitch * ppm * 0.55, 0, Math.PI * 2);
    g.fill();
  }
  const glow = glowDecal(gc, gw, gh, BULB_COLOUR, 0.45, c.renderer);
  glow.position.set((minX + maxX) / 2, (minY + maxY) / 2, 0.003);
  group.add(glow);
  return {
    group, width: maxX - minX + pitch, height: maxY - minY + pitch,
    tick: c.motion && c.look.signChase > 0 ? (t) => { mat.uniforms.uTime.value = t; } : undefined,
    dispose: () => disposeGroup(group),
  };
}

const PATCH_FADE_M = 0.05;
const WEAR_SPECKS = 9000;

async function paintedSign(c: SignContext, kind: 'ghost' | 'vinyl'): Promise<Sign> {
  const fit = await textFit(c.name!, c.look.signFont, 300);
  const margin = PATCH_FADE_M * 2;
  const w = fit.w + margin * 2;
  const h = Math.max(SIGN_LETTER_M, fit.asc + fit.desc) + margin * 2;
  const { c: mc, g, ppm } = canvasFor(w, h, 300);
  const css = (await textFit(c.name!, c.look.signFont, ppm)).css;
  const dy = (fit.desc - Math.max(0, fit.asc - SIGN_LETTER_M)) / 2;
  const cover = document.createElement('canvas');
  cover.width = mc.width; cover.height = mc.height;
  const cg = cover.getContext('2d')!;
  cg.fillStyle = '#fff';
  drawName(cg, c.name!, css, ppm, mc.width, mc.height, -dy);
  if (kind === 'ghost' && c.look.signWear > 0) {
    cg.globalCompositeOperation = 'destination-out';
    let seed = 1;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const n = Math.round(WEAR_SPECKS * w * h * c.look.signWear);
    for (let i = 0; i < n; i++) {
      cg.globalAlpha = 0.3 + rnd() * 0.7;
      const r = (0.6 + rnd() * rnd() * 5) * (ppm / 300);
      cg.beginPath();
      cg.ellipse(rnd() * mc.width, rnd() * mc.height, r * (1 + rnd() * 2), r, rnd() * Math.PI, 0, Math.PI * 2);
      cg.fill();
    }
    cg.globalAlpha = 1;
    cg.globalCompositeOperation = 'source-over';
  }
  const halo = document.createElement('canvas');
  halo.width = mc.width; halo.height = mc.height;
  const hg = halo.getContext('2d')!;
  hg.filter = `blur(${(PATCH_FADE_M * ppm * 0.5).toFixed(1)}px)`;
  hg.drawImage(cover, 0, 0);
  hg.drawImage(cover, 0, 0);
  hg.drawImage(cover, 0, 0);
  const cd = cg.getImageData(0, 0, mc.width, mc.height).data;
  const hd = hg.getImageData(0, 0, mc.width, mc.height).data;
  const img = g.createImageData(mc.width, mc.height);
  for (let i = 0; i < cd.length; i += 4) {
    img.data[i] = cd[i + 3];
    img.data[i + 1] = Math.min(255, hd[i + 3] * 4);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const paint = canvasTex(mc, c.renderer, false);
  const geo = new THREE.PlaneGeometry(w, h);
  const decal = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geo, new THREE.MeshBasicMaterial({ visible: false }));
  decal.position.z = 0.002;
  decal.renderOrder = 1;
  const group = new THREE.Group();
  group.add(decal);
  const colour = new THREE.Color(c.look.sign);
  const fade = kind === 'ghost' ? 1 - c.look.signWear * 0.4 : 1;
  const place = ({ x, y, s }: { x: number; y: number; s: number }): void => {
    const wall = c.wall;
    const wallMat = wall.mesh.material as THREE.MeshStandardMaterial;
    const dw = w * s; const dh = h * s;
    const xa = x - dw / 2 - wall.minX; const ya = y - dh / 2 - wall.y0;
    const m = surfaceMaterial(c.look.upper, dw, dh, c.renderer, c.look.upperColour, wall.along + xa, 0, wall.vOff + ya);
    if (wallMat.lightMap) {
      const L = wallMat.lightMap;
      const t = L.clone();
      const fu = xa / wall.w; const fv = ya / wall.h;
      t.repeat.set(L.repeat.x * (dw / wall.w), L.repeat.y * (dh / wall.h));
      t.offset.set(L.offset.x + L.repeat.x * fu, L.offset.y + L.repeat.y * fv);
      m.lightMap = t;
      m.lightMapIntensity = wallMat.lightMapIntensity;
    }
    m.transparent = true;
    m.depthWrite = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
    const before = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      before.call(m, sh, r);
      sh.uniforms.uPaint = { value: paint };
      sh.uniforms.uColour = { value: colour };
      sh.uniforms.uFade = { value: fade };
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'varying vec2 vDecal;\nvoid main() {')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vDecal = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D uPaint; uniform vec3 uColour; uniform float uFade; varying vec2 vDecal;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 paintTex = texture2D( uPaint, vDecal );
        ${kind === 'ghost' ? `
        // Paint in the brick's face, worn out of its joints (the AO map), the
        // brick's own light and dark showing through it.
        #ifdef USE_AOMAP
          float joint = smoothstep( 0.3, 0.65, texture2D( aoMap, vAoMapUv ).r );
        #else
          float joint = 1.0;
        #endif
        float wallLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        float paintK = paintTex.r * joint * uFade;
        diffuseColor.rgb = mix( diffuseColor.rgb, uColour * clamp( 0.85 + 1.5 * wallLuma, 0.85, 1.15 ), paintK );` : `
        float paintK = paintTex.r;
        diffuseColor.rgb = mix( diffuseColor.rgb, uColour, paintK );`}
        diffuseColor.a = paintTex.g;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, ${kind === 'ghost' ? '0.85' : '0.32'}, paintK );`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${kind === 'vinyl' ? 'normal = normalize( mix( normal, nonPerturbedNormal, paintK * 0.5 ) );' : ''}`);
    };
    m.customProgramCacheKey = () => `sign-${kind}-${before === THREE.Material.prototype.onBeforeCompile ? 0 : 1}`;
    disposeMaterial(decal.material as THREE.Material);
    decal.material = m;
    decal.receiveShadow = wall.mesh.receiveShadow;
  };
  return {
    group, width: w - margin * 2, height: h - margin * 2, placed: place,
    dispose: () => { paint.dispose(); disposeGroup(group); },
  };
}

const BOARD_COLOURS: Record<SignBoard, string> = { black: '#111214', green: '#0e3322', maroon: '#47101a' };
const GOLD = '#dcb45c';

async function gildedSign(c: SignContext): Promise<Sign> {
  const fit = await textFit(c.name!, c.look.signFont, 500);
  const h = SIGN_LETTER_M * 1.9;
  const w = fit.w + SIGN_LETTER_M * 1.2;
  const { c: ac, g, ppm } = canvasFor(w, h, 500);
  const css = (await textFit(c.name!, c.look.signFont, ppm)).css;
  const mr = document.createElement('canvas');
  mr.width = ac.width; mr.height = ac.height;
  const mg = mr.getContext('2d')!;
  const inset = 0.035 * ppm;
  const line = 0.008 * ppm;
  const paint = (x: CanvasRenderingContext2D, board: string, gold: string): void => {
    x.fillStyle = board;
    x.fillRect(0, 0, ac.width, ac.height);
    x.strokeStyle = gold;
    x.lineWidth = line;
    x.strokeRect(inset, inset, ac.width - inset * 2, ac.height - inset * 2);
    x.fillStyle = gold;
    drawName(x, c.name!, css, ppm, ac.width, ac.height);
  };
  paint(g, BOARD_COLOURS[c.look.signBoard], GOLD);
  g.lineWidth = 0.003 * ppm;
  g.strokeStyle = '#7a5a20';
  g.font = css;
  g.strokeText(c.name!, ac.width / 2, ac.height / 2 + (SIGN_LETTER_M / 2) * ppm);
  paint(mg, 'rgb(0,200,0)', 'rgb(0,60,255)');
  const map = canvasTex(ac, c.renderer, true);
  const mrTex = canvasTex(mr, c.renderer, false);
  const box = boardBox(w, h, 0.03, 0.004);
  const mat = metalEnv(new THREE.MeshStandardMaterial({ map, roughnessMap: mrTex, metalnessMap: mrTex, roughness: 1, metalness: 1 }), c.renderer, 0.7);
  const mesh = new THREE.Mesh(box, mat);
  mesh.position.z = 0.015;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, width: w, height: h, dispose: () => disposeGroup(group) };
}

function boardBox(w: number, h: number, d: number, u: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const front = g.groups[4];
  for (let i = 0; i < uv.count; i++) {
    const idx = g.index!;
    let onFront = false;
    for (let k = front.start; k < front.start + front.count; k++) if (idx.getX(k) === i) { onFront = true; break; }
    if (!onFront) uv.setXY(i, u, 0.5);
  }
  g.clearGroups();
  return g;
}

const BRASS = '#a8823a';
const HALO = '#ffb35c';
const BRASS_D = 0.02;
const BRASS_Z = 0.03;

async function brassSign(c: SignContext): Promise<Sign> {
  const fit = await textFit(c.name!, c.look.signFont, 400);
  const pad = 0.12;
  const w = fit.w + pad * 2; const h = SIGN_LETTER_M + fit.desc + pad * 2;
  const { c: mc, g, ppm } = canvasFor(w, h, 400);
  const css = (await textFit(c.name!, c.look.signFont, ppm)).css;
  g.fillStyle = '#fff';
  const dy = fit.desc / 2;
  drawName(g, c.name!, css, ppm, mc.width, mc.height, -dy);
  const a = g.getImageData(0, 0, mc.width, mc.height).data;
  const alpha = new Uint8Array(mc.width * mc.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = a[i * 4 + 3];
  const shapes = traceShapes(alpha, mc.width, mc.height, 1 / ppm, 0.8);
  const geo = shapes.length
    ? new THREE.ExtrudeGeometry(shapes, { depth: BRASS_D, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 1 })
    : new THREE.BufferGeometry();
  geo.translate(-w / 2, -h / 2, BRASS_Z);
  const letters = new THREE.Mesh(geo, metalEnv(new THREE.MeshStandardMaterial({ color: BRASS, metalness: 1, roughness: 0.38 }), c.renderer, 0.3));
  const group = new THREE.Group();
  group.add(letters);
  const { c: hc, g: hg } = canvasFor(w, h, ppm);
  hg.filter = `blur(${(0.035 * ppm).toFixed(1)}px)`;
  hg.drawImage(mc, 0, 0);
  hg.drawImage(mc, 0, 0);
  group.add(glowDecal(hc, w, h, HALO, 0.6, c.renderer));
  return { group, width: w - pad * 2, height: h - pad * 2, dispose: () => disposeGroup(group) };
}

const LIGHTBOX_D = 0.1;
const FRAME_M = 0.022;

async function lightboxSign(c: SignContext): Promise<Sign> {
  const fit = await textFit(c.name!, c.look.signFont, 400);
  const w = fit.w + SIGN_LETTER_M * 0.9;
  const h = SIGN_LETTER_M * 1.8;
  const { c: ac, g, ppm } = canvasFor(w, h, 400);
  const css = (await textFit(c.name!, c.look.signFont, ppm)).css;
  const face = new THREE.Color(c.look.signFace);
  const ink = face.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45 ? '#16161a' : '#ffffff';
  const em = document.createElement('canvas');
  em.width = ac.width; em.height = ac.height;
  const eg = em.getContext('2d')!;
  for (const [x, frame] of [[g, '#25272b'], [eg, '#000000']] as const) {
    x.fillStyle = frame;
    x.fillRect(0, 0, ac.width, ac.height);
    x.fillStyle = c.look.signFace;
    const f = FRAME_M * ppm;
    x.fillRect(f, f, ac.width - f * 2, ac.height - f * 2);
    x.fillStyle = ink;
    drawName(x, c.name!, css, ppm, ac.width, ac.height);
  }
  const mat = new THREE.MeshStandardMaterial({
    map: canvasTex(ac, c.renderer, true), emissiveMap: canvasTex(em, c.renderer, true), emissive: 0xffffff, emissiveIntensity: 1.1,
    roughness: 0.35, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(boardBox(w, h, LIGHTBOX_D, 0.002), mat);
  mesh.position.z = LIGHTBOX_D / 2;
  const group = new THREE.Group();
  group.add(mesh);
  const pad = 0.25;
  const { c: gc, g: gg, ppm: gp } = canvasFor(w + pad * 2, h + pad * 2, 60);
  gg.filter = `blur(${(pad * gp * 0.4).toFixed(1)}px)`;
  gg.fillStyle = '#fff';
  gg.fillRect(pad * gp, pad * gp, w * gp, h * gp);
  group.add(glowDecal(gc, w + pad * 2, h + pad * 2, c.look.signFace, 0.35, c.renderer));
  return { group, width: w, height: h, dispose: () => disposeGroup(group) };
}

const LED_COLOURS: Record<SignLed, string> = { red: '#ff2a1a', amber: '#ffa21a', green: '#3aff4a' };
const LED_COLS = 56;
const LED_ROWS = 9;
const LED_CPS = 14;
const LED_GAP = 8;

function matrixSign(c: SignContext): Sign {
  const msgs = scrollerMessages(c.look, c.name);
  const text = dotText(msgs.join(' '.repeat(3)));
  const W = LED_COLS + text.cols + LED_GAP;
  const data = new Uint8Array(W * 7);
  for (let r = 0; r < 7; r++) data.set(text.rows[r], r * W + LED_COLS);
  const tex = new THREE.DataTexture(data, W, 7, THREE.RedFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  const pitch = SIGN_LETTER_M / 7;
  const w = LED_COLS * pitch; const h = LED_ROWS * pitch;
  const still = LED_COLS;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uText: { value: tex }, uOffset: { value: c.motion ? 0 : still }, uColour: { value: new THREE.Color(LED_COLOURS[c.look.signLed]) },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform sampler2D uText; uniform float uOffset; uniform vec3 uColour; varying vec2 vUv;
      void main() {
        vec2 grid = vec2( ${LED_COLS.toFixed(1)}, ${LED_ROWS.toFixed(1)} );
        vec2 cell = floor( vUv * grid );
        vec2 local = fract( vUv * grid ) - 0.5;
        float led = smoothstep( 0.42, 0.3, length( local ) );
        int row = ${LED_ROWS - 2} - int( cell.y );
        float lit = 0.0;
        if ( row >= 0 && row < 7 ) {
          int col = int( mod( cell.x + uOffset, ${W.toFixed(1)} ) );
          lit = texelFetch( uText, ivec2( col, row ), 0 ).r;
        }
        vec3 c = mix( uColour * 0.06, uColour * 1.8 + 0.25, lit ) * led;
        gl_FragColor = vec4( c, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  screen.position.z = 0.0805;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.3 }));
  housing.position.z = 0.04;
  const group = new THREE.Group();
  group.add(housing, screen);
  return {
    group, width: w + 0.08, height: h + 0.08,
    tick: c.motion ? (t) => { mat.uniforms.uOffset.value = Math.floor(t * LED_CPS) % W; } : undefined,
    dispose: () => disposeGroup(group),
  };
}
