import { describe, it, expect } from 'vitest';
import { vec3 } from './math';
import { driveCorner } from './poleTurnDrive';

/**
 * Autopilot turn regression reused from poleTurn.test.ts.
 * Perception/visual scheduling must not change planner or obstacleAhead —
 * left, right, and straight turns still complete at a corner with poles.
 */
describe('autopilot turns still complete after view-perf scheduling', () => {
  it('finishes a left turn at an intersection that has a corner pole', () => {
    const r = driveCorner(vec3(-90, 0, 0), (x, y) => x < -30 && Math.abs(y) < 12);
    expect(r.poles).toBeGreaterThan(8);
    expect(r.hazardHits).toBe(0);
    expect(r.finished).toBe(true);
    expect(r.maxStopInBox).toBeLessThan(30 * 2);
  });

  it('finishes a right turn at an intersection that has a corner pole', () => {
    const r = driveCorner(vec3(90, 0, 0), (x, y) => x > 30 && Math.abs(y) < 12);
    expect(r.hazardHits).toBe(0);
    expect(r.finished).toBe(true);
  });

  it('goes straight through an intersection that has a corner pole', () => {
    const r = driveCorner(vec3(0, 90, 0), (_x, y) => y > 30);
    expect(r.hazardHits).toBe(0);
    expect(r.finished).toBe(true);
  });
});
