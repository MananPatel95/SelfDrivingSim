/**
 * F3 Waabi BEV overlay: occupancy heatmaps, trajectory fan, Sim World table.
 * Prediction runs at 10 Hz into pooled grids; the canvas is one putImageData.
 */

import type { EgoState, Entity } from '../sim/types';
import {
  type AdversarialVariant,
  type BEVOccupancy,
  type CandidateTrajectory,
  type FutureOccupancy,
  type WaabiStackState,
  WAABI_BEV_EXTENT,
  WAABI_BEV_RESOLUTION,
  WAABI_PREDICT_PERIOD_MS,
  emptyWaabiState,
  f3WorkStats,
  lerpOccupancyGrid,
  makeFutureOccupancy,
  tickWaabiView,
} from '../stacks/waabi';
import { writeOccupancyRgba } from './occupancyPaint';

export interface BevOverlayInput {
  ego: EgoState;
  traffic: Iterable<Entity>;
  pedestrians: Iterable<Entity>;
  timestamp: number;
  nowMs: number;
  canvas?: HTMLCanvasElement | null;
  variantsBody?: HTMLElement | null;
  variantsStats?: HTMLElement | null;
  /** Force a predict even if 10 Hz has not elapsed (tests). */
  force?: boolean;
}

let waabiState: WaabiStackState = emptyWaabiState();
let prevOcc = makeFutureOccupancy(WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
let currOcc = makeFutureOccupancy(WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
let displayOcc = makeFutureOccupancy(WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
let lastPredictMs = -1e9;
let hasPrev = false;
let imageBuf: ImageData | null = null;
let lastVariantKey = '';
let cachedDisplayVariants: AdversarialVariant[] = [];

export function getWaabiState(): WaabiStackState {
  return waabiState;
}

export function resetWaabiOverlay() {
  waabiState = emptyWaabiState();
  prevOcc = makeFutureOccupancy(WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
  currOcc = makeFutureOccupancy(WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
  displayOcc = makeFutureOccupancy(WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
  lastPredictMs = -1e9;
  hasPrev = false;
  lastVariantKey = '';
  cachedDisplayVariants = [];
}

function copyOccupancy(dst: BEVOccupancy, src: BEVOccupancy) {
  dst.resolution = src.resolution;
  dst.extent = src.extent;
  if (dst.grid.length !== src.grid.length) {
    dst.grid = new Float32Array(src.grid.length);
    f3WorkStats.occupancyAllocs++;
  }
  dst.grid.set(src.grid);
}

function copyFuture(dst: FutureOccupancy, src: FutureOccupancy) {
  copyOccupancy(dst.current, src.current);
  copyOccupancy(dst.t1s, src.t1s);
  copyOccupancy(dst.t2s, src.t2s);
  copyOccupancy(dst.t3s, src.t3s);
}

function lerpFuture(out: FutureOccupancy, a: FutureOccupancy, b: FutureOccupancy, t: number) {
  lerpOccupancyGrid(out.current.grid, a.current.grid, b.current.grid, t);
  lerpOccupancyGrid(out.t1s.grid, a.t1s.grid, b.t1s.grid, t);
  lerpOccupancyGrid(out.t2s.grid, a.t2s.grid, b.t2s.grid, t);
  lerpOccupancyGrid(out.t3s.grid, a.t3s.grid, b.t3s.grid, t);
  out.current.resolution = b.current.resolution;
  out.current.extent = b.current.extent;
  out.t1s.resolution = b.t1s.resolution;
  out.t1s.extent = b.t1s.extent;
  out.t2s.resolution = b.t2s.resolution;
  out.t2s.extent = b.t2s.extent;
  out.t3s.resolution = b.t3s.resolution;
  out.t3s.extent = b.t3s.extent;
}

/** Interpolated current occupancy for 3D voxels / AI View between 10 Hz ticks. */
export function getDisplayedOccupancy(nowMs: number = (typeof performance !== 'undefined' ? performance.now() : 0)): BEVOccupancy {
  if (!hasPrev) return currOcc.current;
  const t = Math.max(0, Math.min(1, (nowMs - lastPredictMs) / WAABI_PREDICT_PERIOD_MS));
  lerpOccupancyGrid(displayOcc.current.grid, prevOcc.current.grid, currOcc.current.grid, t);
  displayOcc.current.resolution = currOcc.current.resolution;
  displayOcc.current.extent = currOcc.current.extent;
  return displayOcc.current;
}

export function getDisplayedFuture(nowMs: number = (typeof performance !== 'undefined' ? performance.now() : 0)): FutureOccupancy {
  if (!hasPrev) return currOcc;
  const t = Math.max(0, Math.min(1, (nowMs - lastPredictMs) / WAABI_PREDICT_PERIOD_MS));
  lerpFuture(displayOcc, prevOcc, currOcc, t);
  return displayOcc;
}

function variantsKey(variants: AdversarialVariant[]): string {
  if (variants.length === 0) return '';
  let fails = 0;
  for (const v of variants) if (v.result === 'fail') fails++;
  return `${variants.length}:${variants[0]!.id}:${fails}:${variants[variants.length - 1]!.result}`;
}

function generateDisplayVariants(existing: AdversarialVariant[]): AdversarialVariant[] {
  const result = existing.slice();
  const types: Array<'timing' | 'speed' | 'path'> = ['timing', 'speed', 'path'];
  while (result.length < 20) {
    const i = result.length;
    const pertType = types[i % 3]!;
    const isPassing = (i * 17) % 20 > 2;
    result.push({
      id: `variant_${i.toString().padStart(2, '0')}`,
      description: `${pertType} perturbation`,
      perturbations: [{ actorId: 1000 + i, type: pertType, delta: ((i % 7) - 3) * 0.08 }],
      result: isPassing ? 'pass' : 'fail',
      metrics: {
        minTTC: isPassing ? 1.5 + (i % 5) * 0.4 : 0.5 + (i % 3) * 0.2,
        maxDecel: isPassing ? 2 + (i % 4) : 6 + (i % 3),
        hadCollision: !isPassing && i % 2 === 0,
      },
    });
  }
  return result;
}

function updateSimWorldTable(
  variants: AdversarialVariant[],
  tbody: HTMLElement | null,
  statsEl: HTMLElement | null,
) {
  if (!tbody || !statsEl) return;
  const display = variants.length >= 20 ? variants : (cachedDisplayVariants.length >= 20 ? cachedDisplayVariants : generateDisplayVariants(variants));
  if (display !== variants) cachedDisplayVariants = display;
  const key = variantsKey(display);
  if (key === lastVariantKey) return;
  lastVariantKey = key;
  f3WorkStats.simWorldDomRewrites++;

  const rows: string[] = [];
  let passCount = 0;
  let failCount = 0;
  for (const v of display) {
    if (v.result === 'pass') passCount++;
    else if (v.result === 'fail') failCount++;
    const ttc = v.metrics ? `${v.metrics.minTTC.toFixed(1)}s` : '-';
    const ttcColor = v.metrics && v.metrics.minTTC < 2 ? '#ffaa00' : '#888';
    const mark = v.result === 'pass' ? '✓' : v.result === 'fail' ? '✗' : '?';
    const markColor = v.result === 'pass' ? '#00ff88' : v.result === 'fail' ? '#ff4444' : '#888';
    rows.push(
      `<tr><td style="padding:2px 4px;color:#aaa;">${v.id.slice(0, 10)}</td>` +
      `<td style="padding:2px 4px;text-align:center;color:#888;">${v.perturbations[0]?.type || 'mixed'}</td>` +
      `<td style="padding:2px 4px;text-align:center;"><span style="color:${markColor};">${mark}</span></td>` +
      `<td style="padding:2px 4px;text-align:right;color:${ttcColor};">${ttc}</td></tr>`
    );
  }
  tbody.innerHTML = rows.join('');
  statsEl.textContent = `${display.length} variants: ${passCount} pass, ${failCount} fail`;
}

function ensureImage(ctx: CanvasRenderingContext2D, w: number, h: number): ImageData {
  if (!imageBuf || imageBuf.width !== w || imageBuf.height !== h) {
    imageBuf = ctx.createImageData(w, h);
  }
  return imageBuf;
}

function paintHeatmaps(
  ctx: CanvasRenderingContext2D,
  occ: FutureOccupancy,
  ego: EgoState,
  trajectories: CandidateTrajectory[],
  selectedIndex: number,
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const img = ensureImage(ctx, w, h);
  img.data.fill(0);
  // Dark background
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 0x1a;
    img.data[i + 1] = 0x1a;
    img.data[i + 2] = 0x2e;
    img.data[i + 3] = 255;
  }

  const cellWidth = w / 4;
  const cellHeight = h / 2;
  const grids: Array<{ occ: BEVOccupancy; x: number }> = [
    { occ: occ.current, x: 0 },
    { occ: occ.t1s, x: cellWidth },
    { occ: occ.t2s, x: cellWidth * 2 },
    { occ: occ.t3s, x: cellWidth * 3 },
  ];
  for (const g of grids) {
    writeOccupancyRgba(
      img.data,
      w,
      g.occ,
      g.x + 2,
      2,
      cellWidth - 6,
      cellHeight - 24,
    );
  }
  ctx.putImageData(img, 0, 0);

  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  const labels = ['Current', '+1s', '+2s', '+3s'];
  grids.forEach((g, i) => {
    ctx.strokeRect(g.x + 1, 1, cellWidth - 4, cellHeight - 22);
    ctx.fillStyle = i === 0 ? '#00ffff' : '#888';
    ctx.fillText(labels[i]!, g.x + cellWidth / 2, cellHeight - 5);
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(g.x + 2 + (cellWidth - 6) / 2, 2 + (cellHeight - 24) / 2, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.translate(w / 2, h - 20);
  ctx.scale(3, -3);
  const egoX = ego.transform.position.x;
  const egoY = ego.transform.position.y;
  for (let i = 0; i < trajectories.length; i++) {
    const traj = trajectories[i]!;
    const isSelected = i === selectedIndex;
    ctx.strokeStyle = isSelected ? '#00ff00' : '#ff6600';
    ctx.lineWidth = isSelected ? 0.5 : 0.2;
    ctx.globalAlpha = isSelected ? 1 : 0.5;
    ctx.beginPath();
    for (let j = 0; j < traj.points.length; j++) {
      const pt = traj.points[j]!;
      const dx = pt.position.x - egoX;
      const dy = pt.position.y - egoY;
      if (j === 0) ctx.moveTo(dx, dy);
      else ctx.lineTo(dx, dy);
    }
    ctx.stroke();
    if (isSelected && traj.points.length > 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#00ff00';
      ctx.font = '3px Arial';
      const lastPt = traj.points[traj.points.length - 1]!;
      ctx.fillText(`Cost: ${traj.cost.toFixed(1)}`, lastPt.position.x - egoX + 1, lastPt.position.y - egoY);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function tickWaabiBevOverlay(input: BevOverlayInput): FutureOccupancy {
  const due = input.force || input.nowMs - lastPredictMs >= WAABI_PREDICT_PERIOD_MS || lastPredictMs < 0;
  if (due) {
    if (hasPrev) copyFuture(prevOcc, currOcc);
    const result = tickWaabiView(
      input.ego,
      [input.traffic, input.pedestrians],
      waabiState,
      input.timestamp,
      42,
      currOcc,
      10,
    );
    waabiState = result.newState;
    lastPredictMs = input.nowMs;
    if (!hasPrev) {
      copyFuture(prevOcc, currOcc);
      hasPrev = true;
    }

    if (input.canvas) {
      const ctx = input.canvas.getContext('2d');
      if (ctx) paintHeatmaps(ctx, currOcc, input.ego, result.trajectories, waabiState.selectedTrajectoryIndex);
    }
    updateSimWorldTable(waabiState.simWorld.variants, input.variantsBody ?? null, input.variantsStats ?? null);
  } else if (hasPrev) {
    const t = Math.max(0, Math.min(1, (input.nowMs - lastPredictMs) / WAABI_PREDICT_PERIOD_MS));
    lerpFuture(displayOcc, prevOcc, currOcc, t);
  }
  return hasPrev ? getDisplayedFuture(input.nowMs) : currOcc;
}

/** Headless paint used by the bench / tests (no DOM canvas required). */
export function paintOccupancyPanelsToRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  occ: FutureOccupancy,
): void {
  const cellWidth = width / 4;
  const cellHeight = height / 2;
  const grids = [occ.current, occ.t1s, occ.t2s, occ.t3s];
  grids.forEach((g, i) => {
    writeOccupancyRgba(pixels, width, g, i * cellWidth + 2, 2, cellWidth - 6, cellHeight - 24);
  });
}
