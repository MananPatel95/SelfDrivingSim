/**
 * North-American stop / yield blades. Shared canvas textures + geometries
 * so every sign is one InstancedMesh per part (pole, stop, yield).
 * Original work, CC0 — see docs/licenses/graphics.md.
 */

import * as THREE from 'three';

export const SIGN_BLADE_Y = 2.52;
const STOP_SIZE = 0.92;
const YIELD_W = 0.98;
const YIELD_H = 0.88;

export interface SignAssets {
  poleGeo: THREE.BufferGeometry;
  stopGeo: THREE.BufferGeometry;
  yieldGeo: THREE.BufferGeometry;
  poleMat: THREE.MeshLambertMaterial;
  stopMat: THREE.MeshBasicMaterial;
  yieldMat: THREE.MeshBasicMaterial;
  stopTex: THREE.Texture;
  yieldTex: THREE.Texture;
}

let cached: SignAssets | null = null;

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.Texture {
  const canvas = makeCanvas(w, h);
  if (!canvas) {
    const data = new Uint8Array([200, 30, 30, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  }
  const ctx = canvas.getContext('2d')!;
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Flat-top regular octagon, MUTCD-style. */
export function octagonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + Math.PI / 8 + i * (Math.PI / 4);
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintStop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.48;
  octagonPath(ctx, cx, cy, r);
  ctx.fillStyle = '#f5f5f5';
  ctx.fill();
  octagonPath(ctx, cx, cy, r * 0.86);
  ctx.fillStyle = '#d32f2f';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(w * 0.24)}px Arial, Helvetica, sans-serif`;
  ctx.fillText('STOP', cx, cy + w * 0.012);
}

function paintYield(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const top = h * 0.06;
  const bot = h * 0.94;
  const half = w * 0.46;
  const tri = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, bot - inset);
    ctx.lineTo(cx - half + inset * 1.15, top + inset);
    ctx.lineTo(cx + half - inset * 1.15, top + inset);
    ctx.closePath();
  };
  tri(0);
  ctx.fillStyle = '#d32f2f';
  ctx.fill();
  tri(w * 0.14);
  ctx.fillStyle = '#f7f7f7';
  ctx.fill();
  ctx.fillStyle = '#d32f2f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(w * 0.16)}px Arial, Helvetica, sans-serif`;
  ctx.fillText('YIELD', cx, h * 0.38);
}

function facingPlusX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.rotateY(Math.PI / 2);
  // Sit a few centimetres in front of the pole so the post does not
  // cut through STOP / YIELD when the blade faces the camera.
  geo.translate(0.07, SIGN_BLADE_Y, 0);
  return geo;
}

export function getSignAssets(): SignAssets {
  if (cached) return cached;
  const stopTex = canvasTexture(256, 256, paintStop);
  const yieldTex = canvasTexture(256, 256, paintYield);
  cached = {
    poleGeo: new THREE.CylinderGeometry(0.04, 0.05, 2.08, 6),
    stopGeo: facingPlusX(new THREE.PlaneGeometry(STOP_SIZE, STOP_SIZE)),
    yieldGeo: facingPlusX(new THREE.PlaneGeometry(YIELD_W, YIELD_H)),
    poleMat: new THREE.MeshLambertMaterial({ color: 0x4a4a4a }),
    stopMat: new THREE.MeshBasicMaterial({
      map: stopTex,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      depthWrite: true,
    }),
    yieldMat: new THREE.MeshBasicMaterial({
      map: yieldTex,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      depthWrite: true,
    }),
    stopTex,
    yieldTex,
  };
  cached.poleGeo.translate(0, 1.04, 0);
  return cached;
}

/** One sign group (snap / hit-demo). Shares geos and materials with instances. */
export function createSignGroup(kind: 'stop_sign' | 'yield_sign'): THREE.Group {
  const a = getSignAssets();
  const group = new THREE.Group();
  const pole = new THREE.Mesh(a.poleGeo, a.poleMat);
  pole.castShadow = true;
  pole.userData.sharedSignAssets = true;
  group.add(pole);
  const blade = new THREE.Mesh(kind === 'stop_sign' ? a.stopGeo : a.yieldGeo, kind === 'stop_sign' ? a.stopMat : a.yieldMat);
  blade.userData.sharedSignAssets = true;
  group.add(blade);
  group.userData.signKind = kind;
  group.userData.sharedSignAssets = true;
  return group;
}

export function disposeSignAssets() {
  if (!cached) return;
  cached.poleGeo.dispose();
  cached.stopGeo.dispose();
  cached.yieldGeo.dispose();
  cached.poleMat.dispose();
  cached.stopMat.dispose();
  cached.yieldMat.dispose();
  cached.stopTex.dispose();
  cached.yieldTex.dispose();
  cached = null;
}
