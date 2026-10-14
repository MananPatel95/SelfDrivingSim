/**
 * Procedural city textures (asphalt wear, sidewalk, curb, grass, facade + windows).
 * Generated once in the browser; Node tests get solid-color fallbacks.
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
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function paintAsphalt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#3a3b3e';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const x = hash2(i, 1) * w;
    const y = hash2(i, 2) * h;
    const a = 0.04 + hash2(i, 3) * 0.1;
    ctx.fillStyle = `rgba(${30 + hash2(i, 4) * 40},${30 + hash2(i, 5) * 35},${28 + hash2(i, 6) * 30},${a})`;
    ctx.fillRect(x, y, 1 + hash2(i, 7) * 3, 1 + hash2(i, 8) * 2);
  }
  // Lane wear / oil streaks
  for (let s = 0; s < 6; s++) {
    const cx = (0.2 + s * 0.12) * w;
    ctx.strokeStyle = `rgba(12,12,10,${0.18 + s * 0.03})`;
    ctx.lineWidth = 6 + s;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    for (let y = 0; y < h; y += 8) {
      ctx.lineTo(cx + Math.sin(y * 0.04 + s) * 4, y);
    }
    ctx.stroke();
  }
  // Faint patch repairs
  ctx.fillStyle = 'rgba(50,48,44,0.25)';
  ctx.fillRect(20, 40, 80, 36);
  ctx.fillRect(140, 160, 60, 28);
}

function paintSidewalk(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#c8c4b8';
  ctx.fillRect(0, 0, w, h);
  const tiles = 8;
  const tw = w / tiles;
  const th = h / tiles;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const shade = 190 + hash2(tx, ty) * 28;
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
      ctx.fillRect(tx * tw + 1, ty * th + 1, tw - 2, th - 2);
    }
  }
  ctx.strokeStyle = 'rgba(90,88,80,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * tw, 0);
    ctx.lineTo(i * tw, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * th);
    ctx.lineTo(w, i * th);
    ctx.stroke();
  }
}

function paintCurb(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8a8680');
  g.addColorStop(0.45, '#6a6660');
  g.addColorStop(1, '#3e3c38');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 0, w, 6);
}

function paintGrass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#3a6a32';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) {
    const x = hash2(i, 11) * w;
    const y = hash2(i, 12) * h;
    const g = 70 + hash2(i, 13) * 70;
    ctx.fillStyle = `rgba(${30 + hash2(i, 14) * 25},${g},${28 + hash2(i, 15) * 20},${0.35 + hash2(i, 16) * 0.4})`;
    ctx.fillRect(x, y, 1, 2 + hash2(i, 17) * 3);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(50,90,30,${0.15 + hash2(i, 18) * 0.2})`;
    ctx.beginPath();
    ctx.arc(hash2(i, 19) * w, hash2(i, 20) * h, 8 + hash2(i, 21) * 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintFacade(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#8a9098';
  ctx.fillRect(0, 0, w, h);
  // Concrete noise
  for (let i = 0; i < 800; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + hash2(i, 30) * 0.05})`;
    ctx.fillRect(hash2(i, 31) * w, hash2(i, 32) * h, 2, 2);
  }
  const cols = 6;
  const rows = 8;
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.22;
      const y = r * ch + ch * 0.28;
      const ww = cw * 0.56;
      const wh = ch * 0.42;
      ctx.fillStyle = '#2a3038';
      ctx.fillRect(x - 1, y - 1, ww + 2, wh + 2);
      ctx.fillStyle = '#1a222c';
      ctx.fillRect(x, y, ww, wh);
    }
  }
  // Ledge bands
  ctx.fillStyle = 'rgba(20,20,22,0.25)';
  for (let r = 1; r < rows; r++) ctx.fillRect(0, r * ch - 2, w, 4);
}

function paintWindows(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  const cols = 6;
  const rows = 8;
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = hash2(r + 3, c + 7) > 0.42;
      if (!lit) continue;
      const x = c * cw + cw * 0.22;
      const y = r * ch + ch * 0.28;
      const ww = cw * 0.56;
      const wh = ch * 0.42;
      const warm = hash2(r, c) > 0.55;
      ctx.fillStyle = warm ? '#ffd89a' : '#c8e4ff';
      ctx.fillRect(x, y, ww, wh);
    }
  }
}

function makeLut(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        // Mild teal shadows / warm highlights
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
    grass: canvasTexture(256, 256, paintGrass),
    facade: canvasTexture(256, 256, paintFacade),
    windows: canvasTexture(256, 256, paintWindows),
    lut: makeLut(),
  };
  cached.asphalt.repeat.set(8, 40);
  cached.sidewalk.repeat.set(4, 40);
  cached.grass.repeat.set(40, 40);
  cached.facade.repeat.set(2, 3);
  cached.windows.repeat.set(2, 3);
  return cached;
}

export function disposeCityTextures() {
  if (!cached) return;
  for (const t of Object.values(cached)) t.dispose();
  cached = null;
}
