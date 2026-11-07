import * as THREE from 'three';

const SOFT_M = 0.16;
const CORE = 0.8;
const ROUND_WITHIN_M = 0.12;
const LIFT_M = 0.003;

const VERT = `
attribute vec2 aHalf;
attribute float aRound;
varying vec2 vAt;
varying vec2 vHalf;
varying float vRound;
void main() {
  vAt = position.xz;
  vHalf = aHalf;
  vRound = aRound;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform float strength;
uniform float soft;
varying vec2 vAt;
varying vec2 vHalf;
varying float vRound;
void main() {
  // The distance outside a rounded rectangle of half-size vHalf and corner
  // radius vRound: negative inside.
  vec2 q = abs(vAt) - vHalf + vRound;
  float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - vRound;
  // Darkest a little inside the core's edge, gone SOFT_M outside it.
  float a = 1.0 - smoothstep(-soft * 0.6, soft, d);
  gl_FragColor = vec4(0.0, 0.0, 0.0, strength * a * a);
}`;

const materials = new Map<number, THREE.ShaderMaterial>();

function material(strength: number): THREE.ShaderMaterial {
  let m = materials.get(strength);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { strength: { value: strength }, soft: { value: SOFT_M } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    materials.set(strength, m);
  }
  return m;
}

export function shadowShape(w: number, d: number, core = CORE): { hx: number; hz: number; round: number } {
  const hx = (w / 2) * core, hz = (d / 2) * core;
  const round = Math.abs(w - d) <= ROUND_WITHIN_M ? Math.min(hx, hz) : Math.min(hx, hz) * 0.35;
  return { hx, hz, round };
}

export function contactShadow(w: number, d: number, strength: number, core = CORE): THREE.Mesh {
  const { hx, hz, round } = shadowShape(w, d, core);
  const g = new THREE.PlaneGeometry((hx + SOFT_M) * 2, (hz + SOFT_M) * 2).rotateX(-Math.PI / 2);
  const n = g.getAttribute('position').count;
  g.setAttribute('aHalf', new THREE.BufferAttribute(new Float32Array(n * 2).map((_, i) => (i % 2 ? hz : hx)), 2));
  g.setAttribute('aRound', new THREE.BufferAttribute(new Float32Array(n).fill(round), 1));
  const m = new THREE.Mesh(g, material(strength));
  m.position.y = LIFT_M;
  m.renderOrder = 1;
  m.userData.contactShadow = true;
  m.raycast = () => {};
  return m;
}
