/**
 * Web Worker entry for lidar / occupancy / physics kernels.
 * Uses SharedArrayBuffer when available; otherwise copies typed arrays.
 */

import { loadWasmKernels, getWasmKernels } from '../sim/wasm';

export type HotPathRequest =
  | {
      kind: 'cast';
      ox: number; oy: number; oz: number;
      dirs: Float32Array;
      boxes: Float32Array;
      maxRange: number;
    }
  | {
      kind: 'occupancy';
      resolution: number;
      extent: number;
      centers: Float32Array;
      sizes: Float32Array;
      values: Float32Array;
    }
  | {
      kind: 'step';
      x: number; y: number; yaw: number; vx: number; vy: number;
      throttle: number; steering: number; brake: number; dt: number;
      wheelbase: number; maxSpeed: number; maxAccel: number; maxDecel: number;
    }
  | { kind: 'filter'; points: Float32Array; zThresh: number };

const ready = loadWasmKernels();

self.onmessage = async (ev: MessageEvent<HotPathRequest>) => {
  await ready;
  const k = getWasmKernels();
  const msg = ev.data;
  if (msg.kind === 'cast') {
    const hits = k.castRays(msg.ox, msg.oy, msg.oz, msg.dirs, msg.boxes, msg.maxRange);
    (self as unknown as Worker).postMessage({ kind: 'cast', hits, wasm: k.available }, [hits.buffer]);
  } else if (msg.kind === 'occupancy') {
    const grid = k.fillOccupancy(msg.resolution, msg.extent, msg.centers, msg.sizes, msg.values);
    (self as unknown as Worker).postMessage({ kind: 'occupancy', grid, wasm: k.available }, [grid.buffer]);
  } else if (msg.kind === 'step') {
    const state = k.stepVehicle(msg);
    (self as unknown as Worker).postMessage({ kind: 'step', state, wasm: k.available }, [state.buffer]);
  } else {
    const kept = k.filterGround(msg.points, msg.zThresh);
    (self as unknown as Worker).postMessage({ kind: 'filter', points: kept, wasm: k.available }, [kept.buffer]);
  }
};
