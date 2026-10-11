/**
 * 2D oriented-box collision for the city sim.
 * Used for ego vs world and NPC vs NPC / ego.
 */

import type { BoundingBox3D, EgoState, Entity, Vec3 } from './types';
import { vec3 } from './math';
import { syncBodyVelocity } from './vehicle';

export interface OBB2 {
  cx: number;
  cy: number;
  yaw: number;
  hx: number;
  hy: number;
}

export interface CollisionHit {
  otherId: number;
  classType: string;
  nx: number;
  ny: number;
  depth: number;
}

export function boxToOBB(box: BoundingBox3D, inflate = 0): OBB2 {
  return {
    cx: box.center.x,
    cy: box.center.y,
    yaw: box.yaw,
    hx: box.size.x / 2 + inflate,
    hy: box.size.y / 2 + inflate,
  };
}

function project(obb: OBB2, ax: number, ay: number): { min: number; max: number } {
  const c = Math.cos(obb.yaw);
  const s = Math.sin(obb.yaw);
  const wx = Math.abs(ax * c + ay * s) * obb.hx;
  const wy = Math.abs(ax * -s + ay * c) * obb.hy;
  const mid = obb.cx * ax + obb.cy * ay;
  return { min: mid - wx - wy, max: mid + wx + wy };
}

/** SAT test. Returns outward normal on A (push A out of B) and penetration depth. */
export function overlapOBB(a: OBB2, b: OBB2): { hit: boolean; nx: number; ny: number; depth: number } {
  const axes = [
    { x: Math.cos(a.yaw), y: Math.sin(a.yaw) },
    { x: -Math.sin(a.yaw), y: Math.cos(a.yaw) },
    { x: Math.cos(b.yaw), y: Math.sin(b.yaw) },
    { x: -Math.sin(b.yaw), y: Math.cos(b.yaw) },
  ];

  let depth = Infinity;
  let nx = 1;
  let ny = 0;

  for (const axis of axes) {
    const pa = project(a, axis.x, axis.y);
    const pb = project(b, axis.x, axis.y);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return { hit: false, nx: 0, ny: 0, depth: 0 };
    if (overlap < depth) {
      depth = overlap;
      const fromBtoA = (a.cx - b.cx) * axis.x + (a.cy - b.cy) * axis.y;
      const sign = fromBtoA >= 0 ? 1 : -1;
      nx = axis.x * sign;
      ny = axis.y * sign;
    }
  }
  return { hit: true, nx, ny, depth };
}

export function firstHit(self: OBB2, others: Array<{ id: number; classType: string; box: BoundingBox3D }>, inflate = 0.05): CollisionHit | null {
  let best: CollisionHit | null = null;
  for (const other of others) {
    const o = overlapOBB(self, boxToOBB(other.box, inflate));
    if (!o.hit) continue;
    if (!best || o.depth > best.depth) {
      best = { otherId: other.id, classType: other.classType, nx: o.nx, ny: o.ny, depth: o.depth };
    }
  }
  return best;
}

export function resolveEgoCollision(
  ego: EgoState,
  hit: CollisionHit
): EgoState {
  const push = hit.depth + 0.05;
  const pos: Vec3 = {
    x: ego.transform.position.x + hit.nx * push,
    y: ego.transform.position.y + hit.ny * push,
    z: ego.transform.position.z,
  };
  const nx = hit.nx;
  const ny = hit.ny;
  const vn = ego.velocity.x * nx + ego.velocity.y * ny;
  const tx = ego.velocity.x - vn * nx;
  const ty = ego.velocity.y - vn * ny;
  const restitution = 0.14;
  const friction = 0.22;
  const vnOut = vn < 0 ? -vn * restitution : vn;
  const tSpeed = Math.hypot(tx, ty);
  const jn = Math.abs(vnOut - vn);
  const tLoss = Math.min(tSpeed, friction * jn + friction * 1.6);
  const tScale = tSpeed > 1e-4 ? (tSpeed - tLoss) / tSpeed : 0;
  const vx = tx * tScale + nx * vnOut;
  const vy = ty * tScale + ny * vnOut;
  return syncBodyVelocity({
    ...ego,
    transform: { ...ego.transform, position: pos },
    velocity: vec3(vx, vy, 0),
  }, vx, vy, 0.7);
}

export function separateEntities(
  aPos: Vec3,
  aBox: BoundingBox3D,
  bBox: BoundingBox3D
): Vec3 | null {
  const o = overlapOBB(boxToOBB(aBox), boxToOBB(bBox));
  if (!o.hit) return null;
  return {
    x: aPos.x + o.nx * (o.depth * 0.5 + 0.04),
    y: aPos.y + o.ny * (o.depth * 0.5 + 0.04),
    z: aPos.z,
  };
}

export function obstacleAhead(
  ego: EgoState,
  entities: Entity[],
  maxDist: number,
  laneHalf = 2.2
): { entity: Entity; dist: number } | null {
  const fx = Math.cos(ego.transform.rotation);
  const fy = Math.sin(ego.transform.rotation);
  let best: { entity: Entity; dist: number } | null = null;
  for (const e of entities) {
    const dx = e.boundingBox.center.x - ego.transform.position.x;
    const dy = e.boundingBox.center.y - ego.transform.position.y;
    const ahead = dx * fx + dy * fy;
    if (ahead < 1 || ahead > maxDist) continue;
    const lat = Math.abs(-dx * fy + dy * fx);
    const half = Math.max(e.boundingBox.size.y, e.boundingBox.size.x) * 0.35;
    if (lat > laneHalf + half) continue;
    if (!best || ahead < best.dist) best = { entity: e, dist: ahead };
  }
  return best;
}
