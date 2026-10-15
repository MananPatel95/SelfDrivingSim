/**
 * Procedural city textures. Asphalt / sidewalk are low-contrast isotropic noise
 * (no grout, no oil streaks) so mipmaps + anisotropy do not moiré at distance.
 * Original work, CC0 / public domain — see docs/licenses/graphics.md.
 */

import * as THREE from 'three';

export interface CityTextures {
  asphalt: THREE.Texture;
  sidewalk: THREE.Texture;
  curb: THREE.Texture;
  grass: THREE.Texture;
  facade: THREE.Texture;
  windows: THREE.Texture;
  lut: THREE.DataTexture;
}

export const GROUND_TILE_M = 8;

let cached: CityTextures | null = null;

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

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
  wrap = true,
): THREE.Texture {
  const canvas = makeCanvas(w, h);
  if (!canvas) {
    const data = new Uint8Array([80, 80, 80, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  }
  const ctx = canvas.getContext('2d')!;
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Seamless, directionless speckle. No lines. */
function paintNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: [number, number, number],
  amp: number,
) {
  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (hash2(x, y) + hash2(x + 17, y + 9) + hash2(w - 1 - x, h - 1 - y)) / 3;
      const d = (n - 0.5) * amp;
      const i = (y * w + x) * 4;
      data[i] = Math.max(0, Math.min(255, base[0] + d));
      data[i + 1] = Math.max(0, Math.min(255, base[1] + d * 0.95));
      data[i + 2] = Math.max(0, Math.min(255, base[2] + d * 0.9));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function paintAsphalt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintNoise(ctx, w, h, [58, 59, 62], 22);
}

function paintSidewalk(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintNoise(ctx, w, h, [188, 184, 176], 18);
}

function paintCurb(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintNoise(ctx, w, h, [110, 108, 102], 10);
}

function paintGrass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintNoise(ctx, w, h, [58, 102, 50], 16);
}

function paintFacade(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintNoise(ctx, w, h, [96, 100, 108], 10);
}

function paintWindows(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
}

function makeLut(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rf = r / (size - 1);
        const gf = g / (size - 1);
        const bf = b / (size - 1);
        data[i++] = Math.min(255, Math.floor((rf * 1.02 + 0.02) * 255));
        data[i++] = Math.min(255, Math.floor((gf * 0.98 + 0.01) * 255));
        data[i++] = Math.min(255, Math.floor((bf * 1.04) * 255));
        data[i++] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, size * size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function getCityTextures(): CityTextures {
  if (cached) return cached;
  cached = {
    asphalt: canvasTexture(256, 256, paintAsphalt),
    sidewalk: canvasTexture(256, 256, paintSidewalk),
    curb: canvasTexture(64, 64, paintCurb),
    grass: canvasTexture(128, 128, paintGrass),
    facade: canvasTexture(64, 64, paintFacade),
    windows: canvasTexture(8, 8, paintWindows),
    lut: makeLut(),
  };
  for (const t of [cached.asphalt, cached.sidewalk, cached.curb, cached.grass]) {
    t.repeat.set(1, 1);
  }
  return cached;
}

export function applyTextureAnisotropy(renderer: THREE.WebGLRenderer) {
  const tex = getCityTextures();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of [tex.asphalt, tex.sidewalk, tex.curb, tex.grass]) {
    t.anisotropy = aniso;
    t.needsUpdate = true;
  }
}

/** Clone a ground material and set UV repeat so one tile ≈ `tileM` metres. */
export function tiledGroundMaterial(
  base: THREE.MeshLambertMaterial,
  worldU: number,
  worldV: number,
  tileM = GROUND_TILE_M,
): THREE.MeshLambertMaterial {
  const mat = base.clone();
  if (base.map) {
    const map = base.map.clone();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(Math.max(0.25, worldU / tileM), Math.max(0.25, worldV / tileM));
    map.needsUpdate = true;
    mat.map = map;
  }
  return mat;
}

export function disposeCityTextures() {
  if (!cached) return;
  for (const t of Object.values(cached)) t.dispose();
  cached = null;
}
