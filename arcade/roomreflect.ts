import * as THREE from 'three';

const BLUR_LODS = 5.5;
const AT_LEAST = 0.06;
const STRENGTH = 0.5;
const BEND = 0.025;

const VERT_HEAD = `
uniform mat4 rMat;
varying vec4 vRefl;
void main() {`;
const FRAG_HEAD = `
uniform sampler2D rTex;
uniform float rOn;
varying vec4 vRefl;
void main() {`;
const FRAG_ADD = `
  if ( rOn > 0.5 ) {
    float rCos = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
    float rFresnel = ${AT_LEAST.toFixed(2)} + ( 1.0 - ${AT_LEAST.toFixed(2)} ) * pow( 1.0 - rCos, 5.0 );
    vec2 rUv = vRefl.xy / vRefl.w + normal.xy * ${BEND.toFixed(3)};
    outgoingLight = mix( outgoingLight, textureLod( rTex, rUv, roughnessFactor * ${BLUR_LODS.toFixed(1)} ).rgb, rFresnel * ${STRENGTH.toFixed(2)} );
  }
  #include <opaque_fragment>`;

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class FloorReflection {
  private readonly target = new THREE.WebGLRenderTarget(16, 16, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  private readonly virtual = new THREE.PerspectiveCamera();
  private readonly uniforms = {
    rTex: { value: this.target.texture as THREE.Texture },
    rMat: { value: new THREE.Matrix4() },
    rOn: { value: 1 },
  };
  private bound: THREE.MeshStandardMaterial | null = null;

  bind(mat: THREE.MeshStandardMaterial | null): void {
    if (mat === this.bound) return;
    if (this.bound) {
      delete (this.bound as { onBeforeCompile?: unknown }).onBeforeCompile;
      this.bound.needsUpdate = true;
    }
    this.bound = mat;
    if (!mat) return;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', VERT_HEAD)
        .replace('#include <project_vertex>', `#include <project_vertex>
  vRefl = rMat * modelMatrix * vec4( transformed, 1.0 );`);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', FRAG_HEAD)
        .replace('#include <opaque_fragment>', FRAG_ADD);
    };
    mat.needsUpdate = true;
  }

  set shown(on: boolean) { this.uniforms.rOn.value = on ? 1 : 0; }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(16, size.x >> 1), h = Math.max(16, size.y >> 1);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const v = this.virtual;
    const e = camera.matrixWorld.elements;
    v.position.set(e[12], -e[13], e[14]);
    v.up.set(e[4], -e[5], e[6]);
    v.lookAt(e[12] - e[8], -(e[13] - e[9]), e[14] - e[10]);
    v.near = camera.near;
    v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.uniforms.rMat.value.copy(BIAS).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    const was = renderer.getRenderTarget();
    const autoWas = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, v);
    renderer.setRenderTarget(was);
    renderer.autoClear = autoWas;
  }

  dispose(): void {
    this.bind(null);
    this.target.dispose();
  }
}
