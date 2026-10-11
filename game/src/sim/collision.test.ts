import { describe, it, expect } from 'vitest';
import { overlapOBB, firstHit, obstacleAhead, resolveEgoCollision } from './collision';
import { vec3 } from './math';
import type { EgoState, Entity } from './types';
import { createEgoState } from './vehicle';

describe('OBB collision', () => {
  it('detects overlapping axis-aligned boxes', () => {
    const a = { cx: 0, cy: 0, yaw: 0, hx: 2.25, hy: 0.9 };
    const b = { cx: 2.0, cy: 0, yaw: 0, hx: 2.25, hy: 0.9 };
    const hit = overlapOBB(a, b);
    expect(hit.hit).toBe(true);
    expect(hit.depth).toBeGreaterThan(1);
  });

  it('does not report separated boxes', () => {
    const a = { cx: 0, cy: 0, yaw: 0, hx: 2, hy: 1 };
    const b = { cx: 8, cy: 0, yaw: 0, hx: 2, hy: 1 };
    expect(overlapOBB(a, b).hit).toBe(false);
  });

  it('handles rotated boxes', () => {
    const a = { cx: 0, cy: 0, yaw: Math.PI / 4, hx: 2, hy: 0.8 };
    const b = { cx: 1.2, cy: 1.2, yaw: 0, hx: 1, hy: 1 };
    expect(overlapOBB(a, b).hit).toBe(true);
  });

  it('finds the deepest hit among candidates', () => {
    const self = { cx: 0, cy: 0, yaw: 0, hx: 2, hy: 1 };
    const hit = firstHit(self, [
      { id: 1, classType: 'car', box: { center: vec3(10, 0, 0.8), size: vec3(4, 2, 1.5), yaw: 0 } },
      { id: 2, classType: 'car', box: { center: vec3(2.5, 0, 0.8), size: vec3(4, 2, 1.5), yaw: 0 } },
    ]);
    expect(hit?.otherId).toBe(2);
  });
});

describe('obstacleAhead', () => {
  it('returns the nearest in-lane entity ahead', () => {
    const ego = {
      vehicleType: 'car',
      transform: { position: vec3(0, 0, 0), rotation: Math.PI / 2 },
      velocity: vec3(0, 8, 0),
      acceleration: vec3(0, 0, 0),
      steering: 0, throttle: 0, brake: 0, mass: 1500, stoppingDistance: 10,
    } as EgoState;
    const near: Entity = {
      id: 1, classType: 'car',
      transform: { position: vec3(0, 12, 0.8), rotation: Math.PI / 2 },
      boundingBox: { center: vec3(0, 12, 0.8), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2 },
      velocity: vec3(0, 0, 0), isStatic: false, occlusionLevel: 0,
    };
    const side: Entity = {
      id: 2, classType: 'car',
      transform: { position: vec3(8, 6, 0.8), rotation: 0 },
      boundingBox: { center: vec3(8, 6, 0.8), size: vec3(4.5, 1.8, 1.5), yaw: 0 },
      velocity: vec3(0, 0, 0), isStatic: false, occlusionLevel: 0,
    };
    const hit = obstacleAhead(ego, [side, near], 40);
    expect(hit?.entity.id).toBe(1);
    expect(hit?.dist).toBeCloseTo(12, 0);
  });
});

describe('resolveEgoCollision', () => {
  it('separates the car and keeps wall-slide speed', () => {
    const ego = createEgoState('car', vec3(0, 0, 0), 0);
    ego.velocity = vec3(8, 12, 0);
    ego.bodyVx = 8;
    ego.bodyVy = 12;
    const next = resolveEgoCollision(ego, {
      otherId: 9, classType: 'building', nx: 0, ny: 1, depth: 0.2,
    });
    expect(next.transform.position.y).toBeGreaterThan(0.2);
    expect(next.velocity.y).toBeGreaterThanOrEqual(-0.5);
    expect(next.velocity.x).toBeGreaterThan(5);
  });
});
