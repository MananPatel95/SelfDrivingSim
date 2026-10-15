/**
 * City look: hemisphere + tight-frustum PCF sun, ACES, sky dome, fog,
 * world-mapped materials, and baked-ish vertex / instance AO.
 */

import * as THREE from 'three';
import { getCityTextures, type CityTextures } from './cityTextures';

export const SKY_DAY = 0x87b8d8;
export const SKY_NIGHT = 0x0a1020;
export const FOG_NEAR = 70;
export const FOG_FAR_DEFAULT = 240;
const SUN_OFFSET = new THREE.Vector3(48, 72, 36);
const SHADOW_EXTENT = 38;

export interface CityLook {
  hemi: THREE.HemisphereLight;
  fill: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  sunTarget: THREE.Object3D;
  sky: THREE.Mesh;
  textures: CityTextures;
  night: boolean;
}

function hash01(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export function createCityLook(scene: THREE.Scene, sun: THREE.DirectionalLight): CityLook {
  const textures = getCityTextures();

  const hemi = new THREE.HemisphereLight(0xd6e6f8, 0x3a3428, 0.95);
  scene.add(hemi);
  const fill = new THREE.AmbientLight(0xa8b8c8, 0.55);
  fill.layers.enableAll();
  hemi.layers.enableAll();
  scene.add(fill);

  sun.color.setHex(0xfff4dc);
  sun.intensity = 1.35;
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 3.2;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.updateProjectionMatrix();
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;

  const sky = makeSkyDome();
  scene.add(sky);

  scene.background = new THREE.Color(SKY_DAY);
  scene.fog = new THREE.Fog(SKY_DAY, FOG_NEAR, FOG_FAR_DEFAULT);

  return { hemi, fill, sun, sunTarget, sky, textures, night: false };
}

function makeSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color(0x6eb0de) },
      mid: { value: new THREE.Color(0xb7d4ea) },
      bot: { value: new THREE.Color(0xe8d8b8) },
    },
    vertexShader: `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 bot;
      varying float vY;
      void main() {
        float h = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bot, mid, smoothstep(0.0, 0.45, h));
        col = mix(col, top, smoothstep(0.4, 1.0, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

export function applyDayNight(look: CityLook, scene: THREE.Scene, night: boolean, fogFar: number) {
  look.night = night;
  const sky = night ? SKY_NIGHT : SKY_DAY;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, night ? 40 : FOG_NEAR, fogFar);
  look.hemi.intensity = night ? 0.28 : 0.95;
  look.hemi.color.setHex(night ? 0x1a2a44 : 0xd6e6f8);
  look.fill.intensity = night ? 0.18 : 0.55;
  look.sun.intensity = night ? 0.22 : 1.2;
  const uniforms = (look.sky.material as THREE.ShaderMaterial).uniforms;
  if (night) {
    uniforms['top']!.value.setHex(0x050814);
    uniforms['mid']!.value.setHex(0x0c1630);
    uniforms['bot']!.value.setHex(0x141018);
  } else {
    uniforms['top']!.value.setHex(0x6eb0de);
    uniforms['mid']!.value.setHex(0xb7d4ea);
    uniforms['bot']!.value.setHex(0xe8d8b8);
  }
}

export function updateSunRig(look: CityLook, x: number, y: number) {
  look.sunTarget.position.set(x, 0, -y);
  look.sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, -y + SUN_OFFSET.z);
  look.sunTarget.updateMatrixWorld();
  look.sun.updateMatrixWorld();
  look.sky.position.set(x, 0, -y);
}

export function configureRendererLook(renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function grassMaterial(tex: CityTextures): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: tex.grass,
    color: 0xffffff,
    vertexColors: true,
  });
}

export function asphaltMaterial(tex: CityTextures): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: tex.asphalt, color: 0xffffff });
}

export function sidewalkMaterial(tex: CityTextures): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: tex.sidewalk, color: 0xffffff });
}

export function curbMaterial(tex: CityTextures): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: tex.curb, color: 0xffffff });
}

export function facadeMaterial(tex: CityTextures, night: boolean): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: tex.facade,
    emissive: new THREE.Color(0xffe6b0),
    emissiveIntensity: night ? 1.15 : 0.55,
    emissiveMap: tex.windows,
    color: 0xffffff,
  });
}

export function impostorMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: 0x5a626c });
}

export function applyVertexAO(geo: THREE.BufferGeometry, strength = 0.28) {
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ground = Math.max(0, 1 - Math.abs(y) * 0.08);
    const shade = 1 - strength * (0.35 + 0.65 * hash01(x * 0.07, z * 0.07)) * (0.4 + 0.6 * ground);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade * 0.98;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function instanceAO(x: number, y: number, height: number): THREE.Color {
  const canyon = 0.78 + 0.22 * hash01(x * 0.03, y * 0.03);
  const heightLift = Math.min(1, height / 40) * 0.08;
  const s = Math.min(1, canyon + heightLift);
  return new THREE.Color(s, s, s * 0.98);
}

export function makeGrassGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1000, 1000, 8, 8);
  applyVertexAO(geo, 0.22);
  const colors = geo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < colors.count; i++) {
    const vary = 0.85 + 0.3 * hash01(i * 0.17, i * 0.31);
    colors.setXYZ(i, colors.getX(i) * vary, colors.getY(i) * (0.95 + 0.1 * vary), colors.getZ(i) * 0.85);
  }
  colors.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, grassMaterial(getCityTextures()));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  return mesh;
}
