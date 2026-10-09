/**
 * Math utilities for simulation - pure functions, renderer-independent
 */

import type { Vec2, Vec3, BoundingBox3D, Transform } from './types';

// Vector operations
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return vec3Scale(v, 1 / len);
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return vec3Length(vec3Sub(a, b));
}

export function vec2Length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

// Rotation
export function rotateVec3(v: Vec3, yaw: number): Vec3 {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
    z: v.z,
  };
}

export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

// Transform operations
export function applyTransform(point: Vec3, transform: Transform): Vec3 {
  const rotated = rotateVec3(point, transform.rotation);
  return vec3Add(rotated, transform.position);
}

export function inverseTransform(point: Vec3, transform: Transform): Vec3 {
  const translated = vec3Sub(point, transform.position);
  return rotateVec3(translated, -transform.rotation);
}

// Bounding box operations
export function pointInBox(point: Vec3, box: BoundingBox3D): boolean {
  const local = inverseTransform(point, { position: box.center, rotation: box.yaw });
  const halfSize = vec3Scale(box.size, 0.5);
  return (
    Math.abs(local.x) <= halfSize.x &&
    Math.abs(local.y) <= halfSize.y &&
    Math.abs(local.z) <= halfSize.z
  );
}

export function boxOverlap2D(a: BoundingBox3D, b: BoundingBox3D): boolean {
  const corners1 = getBoxCorners2D(a);
  const corners2 = getBoxCorners2D(b);
  return satOverlap(corners1, corners2);
}

function getBoxCorners2D(box: BoundingBox3D): Vec2[] {
  const halfW = box.size.x / 2;
  const halfH = box.size.y / 2;
  const cos = Math.cos(box.yaw);
  const sin = Math.sin(box.yaw);
  
  const corners: Vec2[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  
  return corners.map(c => ({
    x: box.center.x + c.x * cos - c.y * sin,
    y: box.center.y + c.x * sin + c.y * cos,
  }));
}

function satOverlap(poly1: Vec2[], poly2: Vec2[]): boolean {
  const axes = getAxes(poly1).concat(getAxes(poly2));
  for (const axis of axes) {
    const [min1, max1] = projectPolygon(poly1, axis);
    const [min2, max2] = projectPolygon(poly2, axis);
    if (max1 < min2 || max2 < min1) return false;
  }
  return true;
}

function getAxes(poly: Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % poly.length]!;
    const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
    axes.push(vec2Normalize({ x: -edge.y, y: edge.x }));
  }
  return axes;
}

function projectPolygon(poly: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const proj = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, proj);
    max = Math.max(max, proj);
  }
  return [min, max];
}

// IoU calculation
export function calculateIoU3D(a: BoundingBox3D, b: BoundingBox3D): number {
  const overlapZ = Math.max(0,
    Math.min(a.center.z + a.size.z / 2, b.center.z + b.size.z / 2) -
    Math.max(a.center.z - a.size.z / 2, b.center.z - b.size.z / 2)
  );
  
  if (overlapZ === 0) return 0;
  
  const corners1 = getBoxCorners2D(a);
  const corners2 = getBoxCorners2D(b);
  
  const intersectionArea = computePolygonIntersectionArea(corners1, corners2);
  const area1 = a.size.x * a.size.y;
  const area2 = b.size.x * b.size.y;
  
  const intersectionVolume = intersectionArea * overlapZ;
  const volume1 = area1 * a.size.z;
  const volume2 = area2 * b.size.z;
  
  const union = volume1 + volume2 - intersectionVolume;
  return union > 0 ? intersectionVolume / union : 0;
}

function computePolygonIntersectionArea(poly1: Vec2[], poly2: Vec2[]): number {
  let clipped = [...poly1];
  
  for (let i = 0; i < poly2.length; i++) {
    if (clipped.length === 0) return 0;
    
    const p1 = poly2[i]!;
    const p2 = poly2[(i + 1) % poly2.length]!;
    clipped = clipPolygonByEdge(clipped, p1, p2);
  }
  
  return computePolygonArea(clipped);
}

function clipPolygonByEdge(polygon: Vec2[], edgeP1: Vec2, edgeP2: Vec2): Vec2[] {
  const result: Vec2[] = [];
  
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    
    const currentInside = isLeftOfLine(current, edgeP1, edgeP2);
    const nextInside = isLeftOfLine(next, edgeP1, edgeP2);
    
    if (currentInside) {
      result.push(current);
      if (!nextInside) {
        const intersection = lineIntersection(current, next, edgeP1, edgeP2);
        if (intersection) result.push(intersection);
      }
    } else if (nextInside) {
      const intersection = lineIntersection(current, next, edgeP1, edgeP2);
      if (intersection) result.push(intersection);
    }
  }
  
  return result;
}

function isLeftOfLine(p: Vec2, lineP1: Vec2, lineP2: Vec2): boolean {
  return (lineP2.x - lineP1.x) * (p.y - lineP1.y) - (lineP2.y - lineP1.y) * (p.x - lineP1.x) >= 0;
}

function lineIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  
  return {
    x: p1.x + t * d1x,
    y: p1.y + t * d1y,
  };
}

function computePolygonArea(polygon: Vec2[]): number {
  if (polygon.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i]!;
    const p2 = polygon[(i + 1) % polygon.length]!;
    area += p1.x * p2.y - p2.x * p1.y;
  }
  
  return Math.abs(area) / 2;
}

// Time to collision
export function calculateTTC(
  egoPos: Vec3,
  egoVel: Vec3,
  targetPos: Vec3,
  targetVel: Vec3,
  targetRadius: number
): number | null {
  const relPos = vec3Sub(targetPos, egoPos);
  const relVel = vec3Sub(targetVel, egoVel);
  
  const a = vec3Dot(relVel, relVel);
  const b = 2 * vec3Dot(relPos, relVel);
  const c = vec3Dot(relPos, relPos) - targetRadius * targetRadius;
  
  if (Math.abs(a) < 1e-10) {
    if (c <= 0) return 0;
    return null;
  }
  
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  
  const t1 = (-b - Math.sqrt(discriminant)) / (2 * a);
  const t2 = (-b + Math.sqrt(discriminant)) / (2 * a);
  
  if (t1 > 0) return t1;
  if (t2 > 0) return t2;
  return null;
}

// Closest point of approach (for maritime)
export function calculateCPA(
  pos1: Vec3,
  vel1: Vec3,
  pos2: Vec3,
  vel2: Vec3
): { cpa: number; tcpa: number } {
  const relPos = vec3Sub(pos2, pos1);
  const relVel = vec3Sub(vel2, vel1);
  
  const relVelMag = vec3Dot(relVel, relVel);
  
  if (relVelMag < 1e-10) {
    return { cpa: vec3Length(relPos), tcpa: 0 };
  }
  
  const tcpa = -vec3Dot(relPos, relVel) / relVelMag;
  
  if (tcpa < 0) {
    return { cpa: vec3Length(relPos), tcpa: 0 };
  }
  
  const cpaPos = vec3Add(relPos, vec3Scale(relVel, tcpa));
  const cpa = vec3Length(cpaPos);
  
  return { cpa, tcpa };
}

// Braking distance calculation
export function calculateBrakingDistance(
  speed: number, // m/s
  mass: number, // kg
  brakeForce: number, // N
  grade: number = 0, // slope in radians
  friction: number = 0.7
): number {
  const g = 9.81;
  const decel = (brakeForce / mass) + g * Math.sin(grade) - friction * g * Math.cos(grade);
  if (decel <= 0) return Infinity;
  return (speed * speed) / (2 * decel);
}

// Seeded random number generator
export class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  
  nextGaussian(mean: number = 0, stddev: number = 1): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }
  
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
}

// Lerp and clamp
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
