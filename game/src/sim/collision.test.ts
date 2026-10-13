import { describe, it, expect } from 'vitest';
import {
  overlapOBB, firstHit, obstacleAhead, resolveEgoCollision,
  SpatialGrid, applyImpulse, bodyFromPose, overlapColliders, overlapCircleCircle,
  overlapOBBCircle, separateBodies, shouldSnap, SNAP_SPEED, CAR_MASS, EGO_MASS,
  colliderFor, POLE_RADIUS, PED_RADIUS, EGO_HALF, CAR_HALF, SIGN_HALF,
  sweptBodyHit, shouldReportHit,
} from './collision';
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

  it('does not treat a corner pole 7 m ahead as an in-lane hazard', () => {
    const ego = {
      vehicleType: 'car',
      transform: { position: vec3(0, 0, 0), rotation: Math.PI / 2 },
      velocity: vec3(0, 8, 0),
      acceleration: vec3(0, 0, 0),
      steering: 0, throttle: 0, brake: 0, mass: 1500, stoppingDistance: 10,
    } as EgoState;
    const pole: Entity = {
      id: 23, classType: 'pole',
      transform: { position: vec3(2, 7, 4), rotation: 0 },
      boundingBox: { center: vec3(2, 7, 4), size: vec3(0.3, 0.3, 8), yaw: 0 },
      velocity: vec3(0, 0, 0), isStatic: true, occlusionLevel: 0,
    };
    const car: Entity = {
      id: 8, classType: 'car',
      transform: { position: vec3(0, 9, 0.8), rotation: Math.PI / 2 },
      boundingBox: { center: vec3(0, 9, 0.8), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2 },
      velocity: vec3(0, 0, 0), isStatic: false, occlusionLevel: 0,
    };
    expect(obstacleAhead(ego, [pole], 45, 2.4)).toBeNull();
    expect(obstacleAhead(ego, [pole, car], 45, 2.4)?.entity.id).toBe(8);
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

describe('mesh-matched colliders', () => {
  it('uses a sedan OBB and upright capsules for poles and pedestrians', () => {
    expect(colliderFor('ego').kind).toBe('obb');
    expect(colliderFor('car').kind).toBe('obb');
    expect(colliderFor('pole')).toEqual({ kind: 'circle', radius: POLE_RADIUS });
    expect(colliderFor('pedestrian')).toEqual({ kind: 'circle', radius: PED_RADIUS });
    expect(colliderFor('stop_sign').kind).toBe('obb');
    expect(EGO_HALF.hx).toBeCloseTo(2.39, 2);
    expect(CAR_HALF.hy).toBeCloseTo(0.9, 2);
    expect(SIGN_HALF.hx).toBeLessThan(SIGN_HALF.hy);
    expect(POLE_RADIUS).toBeCloseTo(0.12, 2);
  });
});

describe('spatial grid broadphase', () => {
  it('returns nearby ids and skips distant ones', () => {
    const grid = new SpatialGrid(8);
    grid.insert(1, 0, 0, 1);
    grid.insert(2, 3, 1, 1);
    grid.insert(3, 80, 80, 1);
    const near = grid.query(0, 0, 6);
    expect(near).toContain(1);
    expect(near).toContain(2);
    expect(near).not.toContain(3);
  });
});

describe('capsule / circle overlap', () => {
  it('detects two overlapping upright capsules', () => {
    const hit = overlapCircleCircle(0, 0, 0.28, 0.4, 0, 0.28);
    expect(hit.hit).toBe(true);
    expect(hit.depth).toBeGreaterThan(0.1);
  });

  it('detects a sedan OBB overlapping a pole capsule', () => {
    const car = { cx: 0, cy: 0, yaw: 0, hx: 2.35, hy: 0.92 };
    const hit = overlapOBBCircle(car, 2.4, 0, POLE_RADIUS);
    expect(hit.hit).toBe(true);
    expect(hit.depth).toBeGreaterThan(0);
  });
});

describe('impulse response', () => {
  it('conserves linear momentum on a centred car-to-car hit', () => {
    const a = bodyFromPose(-1, 'car', 0, 0, 0, 10, 0, 0, true);
    const b = bodyFromPose(2, 'car', 4.2, 0, 0, 0, 0, 0, true);
    const hit = overlapColliders(a, b);
    expect(hit.hit).toBe(true);
    const imp = applyImpulse(a, b, hit.nx, hit.ny, hit.cx, hit.cy, 0.22);
    const p0 = CAR_MASS * 10;
    const p1 = CAR_MASS * imp.avx + CAR_MASS * imp.bvx;
    expect(p1).toBeCloseTo(p0, 4);
    expect(imp.bvx).toBeGreaterThan(3);
    expect(imp.avx).toBeLessThan(10);
  });

  it('spins both cars from an off-centre hit', () => {
    const a = bodyFromPose(-1, 'car', 0, 0, 0, 12, 0, 0, true);
    const b = bodyFromPose(2, 'car', 4.1, 0.7, 0, 0, 0, 0, true);
    const hit = overlapColliders(a, b);
    expect(hit.hit).toBe(true);
    const imp = applyImpulse(a, b, hit.nx, hit.ny, hit.cx, hit.cy, 0.22);
    expect(Math.abs(imp.aYawRate)).toBeGreaterThan(0.15);
    expect(Math.abs(imp.bYawRate)).toBeGreaterThan(0.15);
    expect(imp.bvx).toBeGreaterThan(1);
  });

  it('shoves the traffic car and separates both bodies', () => {
    const a = bodyFromPose(-1, 'ego', 0, 0, 0, 11, 0, 0, true);
    const b = bodyFromPose(2, 'car', 4.3, 0, 0, 0, 0, 0, true);
    const hit = overlapColliders(a, b);
    expect(hit.hit).toBe(true);
    const imp = applyImpulse(a, b, hit.nx, hit.ny, hit.cx, hit.cy, 0.22);
    const sep = separateBodies(a, b, hit.nx, hit.ny, hit.depth);
    expect(sep.bx).toBeGreaterThan(b.x);
    expect(sep.ax).toBeLessThan(a.x + 0.01);
    expect(imp.bvx).toBeGreaterThan(2);
    const afterA = { ...a, x: sep.ax, y: sep.ay };
    const afterB = { ...b, x: sep.bx, y: sep.by };
    expect(overlapColliders(afterA, afterB).hit).toBe(false);
  });

  it('keeps a slow pole solid and unmoved', () => {
    const a = bodyFromPose(-1, 'ego', 0, 0, 0, 4, 0, 0, true);
    const b = bodyFromPose(9, 'pole', 2.5, 0, 0, 0, 0, 0, false);
    const hit = overlapColliders(a, b);
    expect(hit.hit).toBe(true);
    const closing = -(a.vx * hit.nx + a.vy * hit.ny);
    expect(shouldSnap('pole', closing)).toBe(false);
    const imp = applyImpulse(a, b, hit.nx, hit.ny, hit.cx, hit.cy, 0.14);
    expect(imp.bvx).toBeCloseTo(0, 5);
    expect(imp.bvy).toBeCloseTo(0, 5);
    expect(imp.avx).toBeLessThan(4);
  });

  it('snaps a pole above SNAP_SPEED and slows the ego hard', () => {
    const a = bodyFromPose(-1, 'ego', 0, 0, 0, 14, 0, 0, true);
    const b = bodyFromPose(9, 'pole', 2.5, 0, 0, 0, 0, 0, false);
    const hit = overlapColliders(a, b);
    expect(hit.hit).toBe(true);
    const closing = Math.max(0, -(a.vx * hit.nx + a.vy * hit.ny));
    expect(closing).toBeGreaterThan(SNAP_SPEED);
    expect(shouldSnap('pole', closing)).toBe(true);
    const imp = applyImpulse(a, b, hit.nx, hit.ny, hit.cx, hit.cy, 0.06);
    const slowed = { vx: imp.avx * 0.55, vy: imp.avy * 0.55 };
    expect(Math.hypot(slowed.vx, slowed.vy)).toBeLessThan(8);
    expect(Math.hypot(slowed.vx, slowed.vy)).toBeLessThan(Math.hypot(a.vx, a.vy) * 0.6);
  });

  it('does not tunnel through a thin pole at high speed', () => {
    const pole = bodyFromPose(9, 'pole', 1.0, 0, 0, 0, 0, 0, false);
    const swept = sweptBodyHit(0, 0, 2.2, 0, 0.96, pole);
    expect(swept).not.toBeNull();
    expect(swept!.toi).toBeGreaterThanOrEqual(0);
    expect(swept!.toi).toBeLessThan(1);
  });

  it('reports a real hit but ignores hairline numerical overlap', () => {
    expect(shouldReportHit(3, 0.02)).toBe(true);
    expect(shouldReportHit(0.1, 0.02)).toBe(false);
    expect(shouldReportHit(0.1, 0.08)).toBe(true);
  });

  it('uses ego mass 1480 kg in the two-body response', () => {
    expect(EGO_MASS).toBe(1480);
    const a = bodyFromPose(-1, 'ego', 0, 0, 0, 8, 0, 0, true);
    expect(a.invMass).toBeCloseTo(1 / 1480, 6);
  });
});
