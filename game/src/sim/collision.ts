/**
 * 2D oriented-box / capsule collision for the city sim.
 * Ego vs world uses SAT + circle tests, a spatial hash broadphase, and an
 * impulse solver (mass, restitution, off-centre spin). Lidar stays in WASM.
 */

import type { BoundingBox3D, EgoState, Entity, Vec3 } from './types';
import { normalizeAngle, vec3 } from './math';
import { applyCollisionMotion, syncBodyVelocity } from './vehicle';

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

/** Kenney sedan footprint (4.7 × 1.85 m) plus a 4 cm skin. */
export const EGO_HALF = { hx: 2.39, hy: 0.965 };
/** NPC sedan: BoxGeometry 4.2 × 1.6 plus wheels out to ~1.8 m. */
export const CAR_HALF = { hx: 2.20, hy: 0.90 };
export const TRUCK_HALF = { hx: 4.05, hy: 1.26 };
/** Upright capsule / circle, matched to the mesh (pole r=0.10, ped ~0.38 wide). */
export const POLE_RADIUS = 0.12;
export const TREE_RADIUS = 0.30;
export const PED_RADIUS = 0.28;
/** Stop / yield: thin board along facing, face ~1.0 m wide. */
export const SIGN_HALF = { hx: 0.12, hy: 0.52 };

export const CAR_MASS = 1400;
export const EGO_MASS = 1480;
export const TRUCK_MASS = 6500;
export const PED_MASS = 75;
export const CAR_INERTIA = 2680;
export const CAR_RESTITUTION = 0.22;
export const STATIC_RESTITUTION = 0.14;
export const PED_RESTITUTION = 0.05;
/** Closing speed (m/s) above which a pole or sign snaps and falls. ~22 km/h. */
export const SNAP_SPEED = 6;
export const MIN_REPORT_CLOSING = 0.55;
export const MIN_REPORT_DEPTH = 0.05;

export type Collider =
  | { kind: 'obb'; hx: number; hy: number }
  | { kind: 'circle'; radius: number };

export interface CollisionBody {
  id: number;
  classType: string;
  x: number;
  y: number;
  yaw: number;
  vx: number;
  vy: number;
  yawRate: number;
  invMass: number;
  invInertia: number;
  restitution: number;
  friction: number;
  collider: Collider;
}

export interface OverlapResult {
  hit: boolean;
  nx: number;
  ny: number;
  depth: number;
  cx: number;
  cy: number;
}

export interface ImpulseResult {
  avx: number;
  avy: number;
  aYawRate: number;
  bvx: number;
  bvy: number;
  bYawRate: number;
  j: number;
}

export interface FurnitureBreak {
  id: number;
  classType: 'pole' | 'stop_sign' | 'yield_sign';
  x: number;
  y: number;
  yaw: number;
  fallDirX: number;
  fallDirY: number;
  fallAngle: number;
  age: number;
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

export function isCollidableClass(classType: string): boolean {
  return classType === 'building' || classType === 'pole' || classType === 'tree'
    || classType === 'car' || classType === 'truck' || classType === 'bus'
    || classType === 'motorcycle' || classType === 'pedestrian' || classType === 'cyclist'
    || classType === 'stop_sign' || classType === 'yield_sign';
}

export function isBreakableClass(classType: string): boolean {
  return classType === 'pole' || classType === 'stop_sign' || classType === 'yield_sign';
}

export function isVehicleClass(classType: string): boolean {
  return classType === 'car' || classType === 'truck' || classType === 'bus' || classType === 'motorcycle';
}

export function colliderFor(classType: string, box?: BoundingBox3D): Collider {
  switch (classType) {
    case 'ego':
      return { kind: 'obb', hx: EGO_HALF.hx, hy: EGO_HALF.hy };
    case 'car':
    case 'motorcycle':
      return { kind: 'obb', hx: CAR_HALF.hx, hy: CAR_HALF.hy };
    case 'truck':
    case 'bus':
      return { kind: 'obb', hx: box ? box.size.x / 2 : TRUCK_HALF.hx, hy: box ? box.size.y / 2 : TRUCK_HALF.hy };
    case 'pedestrian':
    case 'cyclist':
      return { kind: 'circle', radius: PED_RADIUS };
    case 'pole':
      return { kind: 'circle', radius: POLE_RADIUS };
    case 'tree':
      return { kind: 'circle', radius: TREE_RADIUS };
    case 'stop_sign':
    case 'yield_sign':
      return { kind: 'obb', hx: SIGN_HALF.hx, hy: SIGN_HALF.hy };
    default:
      if (box) return { kind: 'obb', hx: box.size.x / 2, hy: box.size.y / 2 };
      return { kind: 'obb', hx: 1, hy: 1 };
  }
}

export function colliderRadius(c: Collider): number {
  return c.kind === 'circle' ? c.radius : Math.hypot(c.hx, c.hy);
}

export function massFor(classType: string, dynamic: boolean): number {
  if (!dynamic && classType !== 'car' && classType !== 'truck' && classType !== 'bus') return Infinity;
  switch (classType) {
    case 'truck':
    case 'bus':
      return TRUCK_MASS;
    case 'pedestrian':
    case 'cyclist':
      return PED_MASS;
    case 'car':
    case 'motorcycle':
      return CAR_MASS;
    default:
      return Infinity;
  }
}

export function inertiaFor(mass: number, collider: Collider): number {
  if (!Number.isFinite(mass) || mass <= 0) return Infinity;
  if (collider.kind === 'circle') return 0.5 * mass * collider.radius * collider.radius;
  const hx = collider.hx;
  const hy = collider.hy;
  return mass * (hx * hx + hy * hy) / 3;
}

export function restitutionFor(classType: string): number {
  if (classType === 'pedestrian' || classType === 'cyclist') return PED_RESTITUTION;
  if (isVehicleClass(classType)) return CAR_RESTITUTION;
  return STATIC_RESTITUTION;
}

export function bodyFromPose(
  id: number,
  classType: string,
  x: number,
  y: number,
  yaw: number,
  vx: number,
  vy: number,
  yawRate: number,
  dynamic: boolean,
  box?: BoundingBox3D,
): CollisionBody {
  const collider = classType === 'ego' ? colliderFor('ego') : colliderFor(classType, box);
  const mass = classType === 'ego' ? EGO_MASS : massFor(classType, dynamic);
  const inertia = classType === 'ego' ? CAR_INERTIA : inertiaFor(mass, collider);
  const invMass = Number.isFinite(mass) && mass > 0 ? 1 / mass : 0;
  const invInertia = Number.isFinite(inertia) && inertia > 0 ? 1 / inertia : 0;
  return {
    id,
    classType,
    x,
    y,
    yaw,
    vx,
    vy,
    yawRate,
    invMass,
    invInertia,
    restitution: restitutionFor(classType === 'ego' ? 'car' : classType),
    friction: classType === 'building' ? 0.18 : 0.45,
    collider,
  };
}

export function egoCollisionBody(ego: EgoState, id = -1): CollisionBody {
  return bodyFromPose(
    id,
    'ego',
    ego.transform.position.x,
    ego.transform.position.y,
    ego.transform.rotation,
    ego.velocity.x,
    ego.velocity.y,
    ego.yawRate ?? 0,
    true,
  );
}

export function entityCollisionBody(entity: Entity, extra?: { yawRate?: number; dynamic?: boolean }): CollisionBody {
  const dynamic = extra?.dynamic ?? (!entity.isStatic || isVehicleClass(entity.classType));
  return bodyFromPose(
    entity.id,
    entity.classType,
    entity.transform.position.x,
    entity.transform.position.y,
    entity.transform.rotation,
    entity.velocity.x,
    entity.velocity.y,
    extra?.yawRate ?? 0,
    dynamic,
    entity.boundingBox,
  );
}

function closestPointOnOBB(obb: OBB2, px: number, py: number): { x: number; y: number } {
  const c = Math.cos(obb.yaw);
  const s = Math.sin(obb.yaw);
  const dx = px - obb.cx;
  const dy = py - obb.cy;
  const lx = clamp(dx * c + dy * s, -obb.hx, obb.hx);
  const ly = clamp(-dx * s + dy * c, -obb.hy, obb.hy);
  return { x: obb.cx + c * lx - s * ly, y: obb.cy + s * lx + c * ly };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function noHit(): OverlapResult {
  return { hit: false, nx: 0, ny: 0, depth: 0, cx: 0, cy: 0 };
}

export function overlapCircleCircle(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): OverlapResult {
  const dx = ax - bx;
  const dy = ay - by;
  const dist = Math.hypot(dx, dy);
  const min = ar + br;
  if (dist >= min && dist > 1e-8) return noHit();
  const depth = min - (dist < 1e-8 ? 0 : dist);
  const inv = dist > 1e-8 ? 1 / dist : 0;
  const nx = dist > 1e-8 ? dx * inv : 1;
  const ny = dist > 1e-8 ? dy * inv : 0;
  return { hit: true, nx, ny, depth, cx: bx + nx * br, cy: by + ny * br };
}

export function overlapOBBCircle(obb: OBB2, cx: number, cy: number, radius: number): OverlapResult {
  const closest = closestPointOnOBB(obb, cx, cy);
  const vx = closest.x - cx;
  const vy = closest.y - cy;
  const dist = Math.hypot(vx, vy);
  const inside = Math.abs(closest.x - cx) < 1e-8 && Math.abs(closest.y - cy) < 1e-8;
  if (inside) {
    // Centre is inside the box: push out along the smallest OBB axis.
    const extX = { x: Math.cos(obb.yaw), y: Math.sin(obb.yaw) };
    const extY = { x: -Math.sin(obb.yaw), y: Math.cos(obb.yaw) };
    const fromC = { x: cx - obb.cx, y: cy - obb.cy };
    const px = fromC.x * extX.x + fromC.y * extX.y;
    const py = fromC.x * extY.x + fromC.y * extY.y;
    const dxToFace = obb.hx - Math.abs(px);
    const dyToFace = obb.hy - Math.abs(py);
    if (dxToFace < dyToFace) {
      const sign = px >= 0 ? 1 : -1;
      const nx = extX.x * sign;
      const ny = extX.y * sign;
      const depth = dxToFace + radius;
      return { hit: true, nx, ny, depth, cx: cx + nx * radius, cy: cy + ny * radius };
    }
    const sign = py >= 0 ? 1 : -1;
    const nx = extY.x * sign;
    const ny = extY.y * sign;
    const depth = dyToFace + radius;
    return { hit: true, nx, ny, depth, cx: cx + nx * radius, cy: cy + ny * radius };
  }
  if (dist >= radius) return noHit();
  const inv = 1 / dist;
  // Normal pushes the OBB (A) out of the circle (B): from circle toward box.
  const nx = (obb.cx - cx) * inv || vx * inv;
  const ny = (obb.cy - cy) * inv || vy * inv;
  const nlen = Math.hypot(nx, ny) || 1;
  const nnx = nx / nlen;
  const nny = ny / nlen;
  return {
    hit: true,
    nx: nnx,
    ny: nny,
    depth: radius - dist,
    cx: cx + nnx * radius,
    cy: cy + nny * radius,
  };
}

export function overlapColliders(
  a: CollisionBody,
  b: CollisionBody,
): OverlapResult {
  if (a.collider.kind === 'circle' && b.collider.kind === 'circle') {
    return overlapCircleCircle(a.x, a.y, a.collider.radius, b.x, b.y, b.collider.radius);
  }
  if (a.collider.kind === 'obb' && b.collider.kind === 'obb') {
    const aObb = { cx: a.x, cy: a.y, yaw: a.yaw, hx: a.collider.hx, hy: a.collider.hy };
    const bObb = { cx: b.x, cy: b.y, yaw: b.yaw, hx: b.collider.hx, hy: b.collider.hy };
    const hit = overlapOBB(aObb, bObb);
    if (!hit.hit) return noHit();
    const pa = closestPointOnOBB(aObb, b.x, b.y);
    const pb = closestPointOnOBB(bObb, a.x, a.y);
    return {
      hit: true,
      nx: hit.nx,
      ny: hit.ny,
      depth: hit.depth,
      cx: (pa.x + pb.x) * 0.5,
      cy: (pa.y + pb.y) * 0.5,
    };
  }
  if (a.collider.kind === 'obb' && b.collider.kind === 'circle') {
    const obb = { cx: a.x, cy: a.y, yaw: a.yaw, hx: a.collider.hx, hy: a.collider.hy };
    return overlapOBBCircle(obb, b.x, b.y, b.collider.radius);
  }
  const obb = { cx: b.x, cy: b.y, yaw: b.yaw, hx: (b.collider as { hx: number; hy: number }).hx, hy: (b.collider as { hx: number; hy: number }).hy };
  const raw = overlapOBBCircle(obb, a.x, a.y, (a.collider as { radius: number }).radius);
  if (!raw.hit) return raw;
  // overlapOBBCircle treats the OBB as A. We want A = circle, so flip the normal.
  return { ...raw, nx: -raw.nx, ny: -raw.ny };
}

export function applyImpulse(
  a: CollisionBody,
  b: CollisionBody,
  nx: number,
  ny: number,
  cx: number,
  cy: number,
  restitution: number,
): ImpulseResult {
  const rax = cx - a.x;
  const ray = cy - a.y;
  const rbx = cx - b.x;
  const rby = cy - b.y;
  const avx = a.vx - a.yawRate * ray;
  const avy = a.vy + a.yawRate * rax;
  const bvx = b.vx - b.yawRate * rby;
  const bvy = b.vy + b.yawRate * rbx;
  const rvx = avx - bvx;
  const rvy = avy - bvy;
  const vn = rvx * nx + rvy * ny;
  if (vn > 0) {
    return {
      avx: a.vx, avy: a.vy, aYawRate: a.yawRate,
      bvx: b.vx, bvy: b.vy, bYawRate: b.yawRate,
      j: 0,
    };
  }
  const raCrossN = rax * ny - ray * nx;
  const rbCrossN = rbx * ny - rby * nx;
  const invM = a.invMass + b.invMass
    + raCrossN * raCrossN * a.invInertia
    + rbCrossN * rbCrossN * b.invInertia;
  const j = invM > 1e-12 ? -(1 + restitution) * vn / invM : 0;
  const jx = j * nx;
  const jy = j * ny;
  let outAvx = a.vx + jx * a.invMass;
  let outAvy = a.vy + jy * a.invMass;
  let outBvx = b.vx - jx * b.invMass;
  let outBvy = b.vy - jy * b.invMass;
  let outAw = a.yawRate + raCrossN * j * a.invInertia;
  let outBw = b.yawRate - rbCrossN * j * b.invInertia;

  const tx = rvx - vn * nx;
  const ty = rvy - vn * ny;
  const tLen = Math.hypot(tx, ty);
  if (tLen > 1e-6) {
    const tnx = tx / tLen;
    const tny = ty / tLen;
    const raCrossT = rax * tny - ray * tnx;
    const rbCrossT = rbx * tny - rby * tnx;
    const invT = a.invMass + b.invMass
      + raCrossT * raCrossT * a.invInertia
      + rbCrossT * rbCrossT * b.invInertia;
    let jt = invT > 1e-12 ? -tLen / invT : 0;
    const mu = Math.min(a.friction, b.friction);
    const maxF = mu * Math.abs(j);
    if (Math.abs(jt) > maxF) jt = Math.sign(jt) * maxF;
    outAvx += jt * tnx * a.invMass;
    outAvy += jt * tny * a.invMass;
    outBvx -= jt * tnx * b.invMass;
    outBvy -= jt * tny * b.invMass;
    outAw += raCrossT * jt * a.invInertia;
    outBw -= rbCrossT * jt * b.invInertia;
  }

  return {
    avx: outAvx, avy: outAvy, aYawRate: outAw,
    bvx: outBvx, bvy: outBvy, bYawRate: outBw,
    j,
  };
}

export function separateBodies(
  a: CollisionBody,
  b: CollisionBody,
  nx: number,
  ny: number,
  depth: number,
): { ax: number; ay: number; bx: number; by: number } {
  const extra = b.invMass === 0 ? 0.05 : 0.04;
  const inv = a.invMass + b.invMass;
  if (inv <= 0) {
    return { ax: a.x + nx * (depth + extra), ay: a.y + ny * (depth + extra), bx: b.x, by: b.y };
  }
  const push = depth + extra;
  return {
    ax: a.x + nx * push * (a.invMass / inv),
    ay: a.y + ny * push * (a.invMass / inv),
    bx: b.x - nx * push * (b.invMass / inv),
    by: b.y - ny * push * (b.invMass / inv),
  };
}

/**
 * Uniform grid broadphase. Rebuild each step — cheap for a few hundred props.
 * Keys are packed so query does not allocate strings in the inner SAT loop
 * beyond the cell list.
 */
export class SpatialGrid {
  readonly cellSize: number;
  private cells = new Map<number, number[]>();

  constructor(cellSize = 8) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  private key(ix: number, iy: number): number {
    return ((ix + 4096) << 16) | ((iy + 4096) & 0xffff);
  }

  insert(index: number, x: number, y: number, radius: number): void {
    const x0 = Math.floor((x - radius) / this.cellSize);
    const x1 = Math.floor((x + radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize);
    const y1 = Math.floor((y + radius) / this.cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(index);
      }
    }
  }

  query(x: number, y: number, radius: number): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    const x0 = Math.floor((x - radius) / this.cellSize);
    const x1 = Math.floor((x + radius) / this.cellSize);
    const y0 = Math.floor((y - radius) / this.cellSize);
    const y1 = Math.floor((y + radius) / this.cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const bucket = this.cells.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const id of bucket) {
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }
    }
    return out;
  }
}

/** Segment vs circle. Returns TOI in [0, 1) or null. */
export function segmentCircleTOI(
  x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, radius: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-12) return null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t >= 1) return null;
  return t;
}

export function sweptBodyHit(
  prevX: number,
  prevY: number,
  nextX: number,
  nextY: number,
  sweepRadius: number,
  other: CollisionBody,
): { toi: number; nx: number; ny: number } | null {
  const r = sweepRadius + colliderRadius(other.collider);
  if (other.collider.kind === 'circle') {
    const t = segmentCircleTOI(prevX, prevY, nextX, nextY, other.x, other.y, r);
    if (t === null) return null;
    const x = prevX + (nextX - prevX) * t;
    const y = prevY + (nextY - prevY) * t;
    const dx = x - other.x;
    const dy = y - other.y;
    const len = Math.hypot(dx, dy) || 1;
    return { toi: t, nx: dx / len, ny: dy / len };
  }
  const obb = {
    cx: other.x,
    cy: other.y,
    yaw: other.yaw,
    hx: other.collider.hx + sweepRadius,
    hy: other.collider.hy + sweepRadius,
  };
  const samples = 6;
  let best: { toi: number; nx: number; ny: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const x = prevX + (nextX - prevX) * t;
    const y = prevY + (nextY - prevY) * t;
    const hit = overlapOBB({ cx: x, cy: y, yaw: 0, hx: 0.02, hy: 0.02 }, obb);
    if (hit.hit && (!best || t < best.toi)) best = { toi: Math.max(0, t - 0.08), nx: hit.nx, ny: hit.ny };
  }
  return best;
}

export function shouldSnap(classType: string, closing: number): boolean {
  return isBreakableClass(classType) && closing >= SNAP_SPEED;
}

export function shouldReportHit(closing: number, depth: number): boolean {
  return closing >= MIN_REPORT_CLOSING || depth >= MIN_REPORT_DEPTH;
}

export function applyEgoImpulse(ego: EgoState, vx: number, vy: number, yawRate: number, x: number, y: number): EgoState {
  const yaw = normalizeAngle(ego.transform.rotation + yawRate * (1 / 60));
  return applyCollisionMotion({
    ...ego,
    transform: { ...ego.transform, position: { ...ego.transform.position, x, y }, rotation: yaw },
  }, vx, vy, yawRate);
}

export function advanceFurniture(breakable: FurnitureBreak, dt: number): FurnitureBreak {
  const age = breakable.age + dt;
  const fallAngle = Math.min(Math.PI / 2, age * 3.6);
  return { ...breakable, age, fallAngle };
}

export function furnitureFallen(breakable: FurnitureBreak): boolean {
  return breakable.fallAngle > 1.05;
}

export function makeFurnitureBreak(
  id: number,
  classType: 'pole' | 'stop_sign' | 'yield_sign',
  x: number,
  y: number,
  yaw: number,
  nx: number,
  ny: number,
): FurnitureBreak {
  const len = Math.hypot(nx, ny) || 1;
  return {
    id,
    classType,
    x,
    y,
    yaw,
    fallDirX: -nx / len,
    fallDirY: -ny / len,
    fallAngle: 0,
    age: 0,
  };
}
