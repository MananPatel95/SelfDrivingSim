import { describe, it, expect } from 'vitest';
import { getWasmKernels } from './wasm';

describe('WASM / TS fallback kernels', () => {
  const k = getWasmKernels();

  it('exposes a fallback when the crate is not loaded', () => {
    expect(k.available).toBe(false);
  });

  it('castRays hits a box in front of the origin', () => {
    const dirs = new Float32Array([1, 0, 0]);
    const boxes = new Float32Array([5, 0, 0, 2, 2, 2, 0]);
    const hits = k.castRays(0, 0, 0, dirs, boxes, 20);
    expect(hits[0]).toBeGreaterThan(3);
    expect(hits[0]).toBeLessThan(6);
    expect(hits[1]).toBe(0);
  });

  it('filterGround drops low points', () => {
    const pts = new Float32Array([0, 0, 0.05, 1, 1, 1.2]);
    const kept = k.filterGround(pts, 0.2);
    expect(kept.length).toBe(3);
    expect(kept[2]).toBeCloseTo(1.2);
  });

  it('stepVehicle moves forward under throttle', () => {
    const next = k.stepVehicle({
      x: 0, y: 0, yaw: 0, vx: 0, vy: 0,
      throttle: 1, steering: 0, brake: 0, dt: 0.1,
      wheelbase: 2.7, maxSpeed: 30, maxAccel: 3, maxDecel: 8,
    });
    expect(next[0]).toBeGreaterThan(0);
  });
});
