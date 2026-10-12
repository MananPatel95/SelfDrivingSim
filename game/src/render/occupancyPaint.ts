/**
 * Occupancy heatmap → RGBA without per-cell fillRect / fillStyle strings.
 * Used by the F3 BEV overlay and the AI View occupancy inset.
 */

import type { BEVOccupancy } from '../stacks/waabi';
import { f3WorkStats } from '../stacks/waabi';

const BG_R = 0x12;
const BG_G = 0x18;
const BG_B = 0x2a;

/**
 * Write a square occupancy grid into an RGBA buffer (row-major, y down).
 * `dstW`/`dstH` is the destination patch size; `dstX`/`dstY` is the offset.
 */
export function writeOccupancyRgba(
  pixels: Uint8ClampedArray,
  strideW: number,
  occ: BEVOccupancy,
  dstX: number,
  dstY: number,
  dstW: number,
  dstH: number,
): void {
  if (occ.grid.length === 0 || dstW <= 0 || dstH <= 0) return;
  const gridSize = Math.sqrt(occ.grid.length);
  if (!Number.isFinite(gridSize) || gridSize < 1) return;
  const grid = occ.grid;
  const maxX = dstX + dstW;
  const maxY = dstY + dstH;
  for (let py = dstY; py < maxY; py++) {
    const gy = Math.min(gridSize - 1, Math.max(0, Math.floor((1 - (py - dstY + 0.5) / dstH) * gridSize)));
    const row = gy * gridSize;
    for (let px = dstX; px < maxX; px++) {
      const gx = Math.min(gridSize - 1, Math.max(0, Math.floor(((px - dstX + 0.5) / dstW) * gridSize)));
      const v = grid[row + gx] || 0;
      const i = (py * strideW + px) * 4;
      if (v <= 0.01) {
        pixels[i] = BG_R;
        pixels[i + 1] = BG_G;
        pixels[i + 2] = BG_B;
        pixels[i + 3] = 255;
      } else {
        pixels[i] = Math.min(255, Math.floor(v * 255 * 2));
        pixels[i + 1] = Math.max(0, Math.min(255, Math.floor((1 - v) * 255)));
        pixels[i + 2] = Math.max(0, 150 - Math.floor(v * 150));
        pixels[i + 3] = 255;
      }
    }
  }
  f3WorkStats.canvasPuts++;
}

/** AI-view palette (cyan ego, warmer occupied cells). */
export function writeOccupancyRgbaAiView(
  pixels: Uint8ClampedArray,
  strideW: number,
  occ: BEVOccupancy,
  dstX: number,
  dstY: number,
  dstW: number,
  dstH: number,
): void {
  if (occ.grid.length === 0 || dstW <= 0 || dstH <= 0) return;
  const gridSize = Math.sqrt(occ.grid.length);
  if (!Number.isFinite(gridSize) || gridSize < 1) return;
  const grid = occ.grid;
  const maxX = dstX + dstW;
  const maxY = dstY + dstH;
  for (let py = dstY; py < maxY; py++) {
    const gy = Math.min(gridSize - 1, Math.max(0, Math.floor((1 - (py - dstY + 0.5) / dstH) * gridSize)));
    const row = gy * gridSize;
    for (let px = dstX; px < maxX; px++) {
      const gx = Math.min(gridSize - 1, Math.max(0, Math.floor(((px - dstX + 0.5) / dstW) * gridSize)));
      const v = grid[row + gx] || 0;
      const i = (py * strideW + px) * 4;
      if (v < 0.05) {
        pixels[i] = 11;
        pixels[i + 1] = 15;
        pixels[i + 2] = 24;
        pixels[i + 3] = 255;
      } else {
        pixels[i] = Math.min(255, Math.floor(v * 255 * 1.6));
        pixels[i + 1] = Math.max(0, Math.floor((1 - v) * 180));
        pixels[i + 2] = 40;
        pixels[i + 3] = 255;
      }
    }
  }
  f3WorkStats.canvasPuts++;
}
