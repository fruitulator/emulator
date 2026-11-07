import * as THREE from 'three';
import smudgeUrl from './textures/SurfaceImperfections003/SurfaceImperfections003_Opacity_256.jpg?url';

export const ENV_SIZE = 128;
export const GLASS_R0 = 0.1;
export const GLASS_R90 = 0.4;
export const GLASS_GAIN = 2.2;
export const GLASS_FLOOR = 0.02;
export const GLASS_LOD_CLEAN = 0.6;
export const GLASS_LOD_SMEAR = 3.2;
export const GLASS_SMEAR_M = 0.7;
export const GLASS_AO = 0.18;
export const GLASS_AO_M = 0.025;
export const EDGE_AO = 0.22;
export const EDGE_AO_M = 0.04;
export const SPILL = 0.5;
export const SPILL_SLOPE = 3;

export function glassMaterial(o: { w: number; h: number; frame: number; bar: number; transomY: number }): THREE.ShaderMaterial & { uniforms: GlassUniforms } {
  const smear = new THREE.TextureLoader().load(smudgeUrl);
  smear.wrapS = smear.wrapT = THREE.RepeatWrapping;
  const uniforms: GlassUniforms = {
    envMap: { value: null },
    envOn: { value: 0 },
    level: { value: 1 },
    smear: { value: smear },
    smearRep: { value: new THREE.Vector2(o.w / GLASS_SMEAR_M, o.h / GLASS_SMEAR_M) },
    halfSize: { value: new THREE.Vector2(o.w / 2, o.h / 2) },
    frame: { value: o.frame },
    bar: { value: o.bar },
    transomY: { value: o.transomY },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vUv = uv;
        vLocal = position.xy;
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vWorld = w.xyz;
        vNormalW = normalize( mat3( modelMatrix ) * normal );
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform samplerCube envMap;
      uniform float envOn;
      uniform float level;
      uniform sampler2D smear;
      uniform vec2 smearRep;
      uniform vec2 halfSize;
      uniform float frame;
      uniform float bar;
      uniform float transomY;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec3 V = normalize( vWorld - cameraPosition );
        vec3 N = normalize( vNormalW );
        if ( dot( N, V ) > 0.0 ) N = -N;
        float c = clamp( -dot( V, N ), 0.0, 1.0 );
        float F = ${GLASS_R0.toFixed(3)} + ${(GLASS_R90 - GLASS_R0).toFixed(3)} * pow( 1.0 - c, 5.0 );
        float sm = texture( smear, vUv * smearRep ).r;
        vec3 refl = vec3( 0.0 );
        if ( envOn > 0.5 ) {
          float lod = mix( ${GLASS_LOD_CLEAN.toFixed(2)}, ${GLASS_LOD_SMEAR.toFixed(2)}, sm );
          refl = textureLod( envMap, reflect( V, N ), lod ).rgb * level * ${GLASS_GAIN.toFixed(2)};
          refl = max( refl - ${GLASS_FLOOR.toFixed(3)}, 0.0 );
        }
        // Against the frame's inside edge, the mullion and the transom.
        vec2 a = abs( vLocal );
        float d = min( min( halfSize.x - frame - a.x, halfSize.y - frame - a.y ), min( a.x - bar * 0.5, abs( vLocal.y - transomY ) - bar * 0.5 ) );
        float ao = 1.0 - ${GLASS_AO.toFixed(3)} * exp( -max( d, 0.0 ) / ${GLASS_AO_M.toFixed(3)} );
        gl_FragColor = vec4( refl, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // Over the street: out = reflection * F + street * (1 - F) * ao.
        float alpha = 1.0 - ( 1.0 - F ) * ao;
        gl_FragColor = vec4( gl_FragColor.rgb * F / max( alpha, 1e-4 ), alpha );
      }`,
  });
  return m as THREE.ShaderMaterial & { uniforms: GlassUniforms };
}

export interface GlassUniforms {
  [k: string]: THREE.IUniform;
  envMap: THREE.IUniform<THREE.Texture | null>;
  envOn: THREE.IUniform<number>;
  level: THREE.IUniform<number>;
  smear: THREE.IUniform<THREE.Texture>;
  smearRep: THREE.IUniform<THREE.Vector2>;
  halfSize: THREE.IUniform<THREE.Vector2>;
  frame: THREE.IUniform<number>;
  bar: THREE.IUniform<number>;
  transomY: THREE.IUniform<number>;
}

export class WindowEnv {
  readonly target = new THREE.WebGLCubeRenderTarget(ENV_SIZE, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  private readonly cam = new THREE.CubeCamera(0.05, 100, this.target);

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, at: THREE.Vector3, hide: THREE.Object3D[]): void {
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    this.cam.position.copy(at);
    this.cam.updateMatrixWorld();
    this.cam.update(renderer, scene);
    hide.forEach((o, i) => { o.visible = was[i]; });
  }

  dispose(): void { this.target.dispose(); }
}

export function edgeShade(o: { depth: number; len: number; frame: [number, number] | null; ends: boolean; spill: boolean; from?: 'top' }, nx = 16, ny = 32): Uint8Array {
  const data = new Uint8Array(nx * ny * 4);
  const reach = (d: number): number => Math.exp(-Math.max(d, 0) / EDGE_AO_M);
  for (let j = 0; j < ny; j++) {
    const t = ((j + 0.5) / ny) * o.len;
    for (let i = 0; i < nx; i++) {
      const s = ((i + 0.5) / nx) * o.depth;
      let dark = 0;
      if (o.ends) dark = Math.max(dark, reach(t), reach(o.len - t));
      if (o.frame) dark = Math.max(dark, s < o.frame[0] ? reach(o.frame[0] - s) : s > o.frame[1] ? reach(s - o.frame[1]) : 1);
      if (o.from === 'top') dark = Math.max(dark, reach(s));
      let spill = 0;
      if (o.spill) {
        const glass = o.frame ? o.frame[0] : o.depth;
        spill = s >= glass ? 1 : Math.pow(s / glass, 1.5);
      }
      const k = (j * nx + i) * 4;
      data[k] = Math.round((1 - EDGE_AO * dark) * 255);
      data[k + 1] = Math.round(spill * 255);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  return data;
}

export function edgeMaterial(data: Uint8Array, nx = 16, ny = 32): THREE.ShaderMaterial & { uniforms: { shade: THREE.IUniform<THREE.Texture>; spill: THREE.IUniform<THREE.Color> } } {
  const tex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const m = new THREE.ShaderMaterial({
    uniforms: { shade: { value: tex }, spill: { value: new THREE.Color(0, 0, 0) } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `
      uniform sampler2D shade;
      uniform vec3 spill;
      varying vec2 vUv;
      void main() {
        vec4 s = texture( shade, vUv );
        gl_FragColor = vec4( spill * s.g * ${SPILL_SLOPE.toFixed(1)}, s.r );
      }`,
  });
  return m as ReturnType<typeof edgeMaterial>;
}

export function viewColour(img: CanvasImageSource): THREE.Color {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return new THREE.Color(0.6, 0.7, 1);
  g.drawImage(img, 0, 0, 8, 8);
  return averageLight(g.getImageData(0, 0, 8, 8).data);
}

export function averageLight(px: Uint8ClampedArray | Uint8Array): THREE.Color {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4, n++) { r += lin(px[i]); g += lin(px[i + 1]); b += lin(px[i + 2]); }
  n = Math.max(n, 1);
  return new THREE.Color(r / n, g / n, b / n);
}
