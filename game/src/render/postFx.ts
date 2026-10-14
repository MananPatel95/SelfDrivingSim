/**
 * Half-resolution bloom (emissives / lamps) plus a 16³ colour-grade LUT.
 * Disabled on Low look so the scene render is a single pass.
 */

import * as THREE from 'three';

const BRIGHT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = `
uniform sampler2D tScene;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tScene, vUv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float m = max(0.0, lum - threshold);
  gl_FragColor = vec4(c.rgb * m * 1.6, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tInput;
uniform vec2 direction;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 off = direction * texel;
  vec4 sum = texture2D(tInput, vUv) * 0.294117;
  sum += texture2D(tInput, vUv + off) * 0.235294;
  sum += texture2D(tInput, vUv - off) * 0.235294;
  sum += texture2D(tInput, vUv + off * 2.0) * 0.117647;
  sum += texture2D(tInput, vUv - off * 2.0) * 0.117647;
  gl_FragColor = sum;
}`;

const COMP_FRAG = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tLut;
uniform float bloomStrength;
uniform float lutAmount;
varying vec2 vUv;

vec3 applyLut(vec3 c) {
  float size = 16.0;
  vec3 scaled = clamp(c, 0.0, 1.0) * (size - 1.0);
  float slice = floor(scaled.b);
  float f = scaled.b - slice;
  vec2 px = vec2(1.0 / (size * size), 1.0 / size);
  vec2 uv0 = vec2((slice * size + scaled.r + 0.5) * px.x, (scaled.g + 0.5) * px.y);
  vec2 uv1 = vec2(((slice + 1.0) * size + scaled.r + 0.5) * px.x, (scaled.g + 0.5) * px.y);
  vec3 a = texture2D(tLut, uv0).rgb;
  vec3 b = texture2D(tLut, uv1).rgb;
  return mix(a, b, f);
}

void main() {
  vec3 scene = texture2D(tScene, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 color = scene + bloom * bloomStrength;
  color = mix(color, applyLut(color), lutAmount);
  gl_FragColor = vec4(color, 1.0);
}`;

export class PostFx {
  enabled = false;
  private sceneRt: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private w = 1;
  private h = 1;

  constructor(lut: THREE.Texture) {
    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    };
    this.sceneRt = new THREE.WebGLRenderTarget(1, 1, opts);
    const bloomOpts = { ...opts, depthBuffer: false };
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, bloomOpts);
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, bloomOpts);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.sceneRt.texture }, threshold: { value: 0.88 } },
      vertexShader: BRIGHT_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: this.bloomA.texture },
        direction: { value: new THREE.Vector2(1, 0) },
        texel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: BRIGHT_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRt.texture },
        tBloom: { value: this.bloomB.texture },
        tLut: { value: lut },
        bloomStrength: { value: 0.28 },
        lutAmount: { value: 0.16 },
      },
      vertexShader: BRIGHT_VERT,
      fragmentShader: COMP_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightMat);
    this.fsScene.add(this.quad);
  }

  setSize(w: number, h: number) {
    this.w = Math.max(2, w);
    this.h = Math.max(2, h);
    this.sceneRt.setSize(this.w, this.h);
    const hw = Math.max(2, Math.floor(this.w / 2));
    const hh = Math.max(2, Math.floor(this.h / 2));
    this.bloomA.setSize(hw, hh);
    this.bloomB.setSize(hw, hh);
    this.blurMat.uniforms['texel']!.value.set(1 / hw, 1 / hh);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.sceneRt);
    renderer.render(scene, camera);

    this.quad.material = this.brightMat;
    this.brightMat.uniforms['tScene']!.value = this.sceneRt.texture;
    renderer.setRenderTarget(this.bloomA);
    renderer.render(this.fsScene, this.fsCam);

    this.quad.material = this.blurMat;
    this.blurMat.uniforms['tInput']!.value = this.bloomA.texture;
    this.blurMat.uniforms['direction']!.value.set(1, 0);
    renderer.setRenderTarget(this.bloomB);
    renderer.render(this.fsScene, this.fsCam);

    this.blurMat.uniforms['tInput']!.value = this.bloomB.texture;
    this.blurMat.uniforms['direction']!.value.set(0, 1);
    renderer.setRenderTarget(this.bloomA);
    renderer.render(this.fsScene, this.fsCam);

    this.quad.material = this.compMat;
    this.compMat.uniforms['tScene']!.value = this.sceneRt.texture;
    this.compMat.uniforms['tBloom']!.value = this.bloomA.texture;
    renderer.setRenderTarget(prev);
    renderer.render(this.fsScene, this.fsCam);
  }

  dispose() {
    this.sceneRt.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    (this.quad.geometry as THREE.BufferGeometry).dispose();
  }
}
