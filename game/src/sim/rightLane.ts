/**
 * Right-hand traffic: lane center sits to the right of the yellow line.
 * Heading θ: right is (sin θ, −cos θ). Eastbound right is −Y; northbound right is +X.
 */

import type { Vec3 } from './types';
import { vec3, normalizeAngle } from './math';
import { nearestGridLine } from './world';

export const LANE_OFFSET = 3.5;
/** Keep the tyres off the yellow line and out of the oncoming lane. */
export const LANE_INNER = 1.6;
export const LANE_OUTER = 5.8;

export function headingRight(yaw: number): { x: number; y: number } {
  return { x: Math.sin(yaw), y: -Math.cos(yaw) };
}

export function offsetRight(x: number, y: number, yaw: number, offset = LANE_OFFSET): Vec3 {
  const r = headingRight(yaw);
  return vec3(x + r.x * offset, y + r.y * offset, 0);
}

/** Snap onto the right-hand lane of the road the heading is following. */
export function placeInRightLane(x: number, y: number, heading: number, offset = LANE_OFFSET): Vec3 {
  const r = headingRight(heading);
  const ns = Math.abs(Math.sin(heading)) >= Math.abs(Math.cos(heading));
  if (ns) return vec3(nearestGridLine(x) + r.x * offset, y, 0);
  return vec3(x, nearestGridLine(y) + r.y * offset, 0);
}

/** Signed metres to the right of the nearest road axis along `heading`. */
export function lateralFromCenter(x: number, y: number, heading: number): number {
  const r = headingRight(heading);
  const ns = Math.abs(Math.sin(heading)) >= Math.abs(Math.cos(heading));
  if (ns) {
    const axis = nearestGridLine(x);
    return (x - axis) * r.x + (y - y) * r.y;
  }
  const axis = nearestGridLine(y);
  return (x - x) * r.x + (y - axis) * r.y;
}

export function inRightLane(x: number, y: number, heading: number): boolean {
  const lat = lateralFromCenter(x, y, heading);
  return lat >= LANE_INNER && lat <= LANE_OUTER;
}

export function straddlesCenter(x: number, y: number, heading: number): boolean {
  return Math.abs(lateralFromCenter(x, y, heading)) < 1.05;
}

function onNS(p: Vec3): boolean {
  return Math.abs(p.x - nearestGridLine(p.x)) <= Math.abs(p.y - nearestGridLine(p.y));
}

/** Centerline corners of a Manhattan trip, then the right-hand lane through those corners. */
export function manhattanCorners(start: Vec3, end: Vec3): Vec3[] {
  const startNS = onNS(start);
  const endNS = onNS(end);
  const pts: Vec3[] = [start];
  if (startNS && endNS) {
    const crossY = nearestGridLine(end.y);
    pts.push(vec3(start.x, crossY, 0), vec3(end.x, crossY, 0));
  } else if (!startNS && !endNS) {
    const crossX = nearestGridLine(end.x);
    pts.push(vec3(crossX, start.y, 0), vec3(crossX, end.y, 0));
  } else if (startNS) {
    pts.push(vec3(start.x, end.y, 0));
  } else {
    pts.push(vec3(end.x, start.y, 0));
  }
  pts.push(end);
  return pts;
}

function sampleLine(a: Vec3, b: Vec3, spacing = 6): Vec3[] {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  const out: Vec3[] = [];
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    out.push(vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0));
  }
  return out;
}

/**
 * Route in the right-hand lane.
 * Right turns cut the near corner; left turns go wide into the far right lane.
 */
export function rightLaneRoute(start: Vec3, end: Vec3, offset = LANE_OFFSET): Vec3[] {
  const corners = manhattanCorners(start, end);
  const segs: { a: Vec3; b: Vec3; heading: number }[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]!;
    const b = corners[i + 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.4) continue;
    segs.push({ a, b, heading: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  if (segs.length === 0) return [placeInRightLane(start.x, start.y, 0, offset)];

  const out: Vec3[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const r = headingRight(s.heading);
    const from = i === 0
      ? vec3(s.a.x + r.x * offset, s.a.y + r.y * offset, 0)
      : out[out.length - 1]!;
    let to: Vec3;
    if (i < segs.length - 1) {
      const next = segs[i + 1]!;
      const nr = headingRight(next.heading);
      const C = s.b;
      // Incoming and outgoing offset lines meet at C + inRight + outRight.
      // Right turn: near (tight) corner. Left turn: far-side right lane (wide).
      to = vec3(C.x + r.x * offset + nr.x * offset, C.y + r.y * offset + nr.y * offset, 0);
    } else {
      to = vec3(s.b.x + r.x * offset, s.b.y + r.y * offset, 0);
    }
    out.push(...sampleLine(from, to));
    out.push(to);
  }
  return out;
}

export function turnKind(fromHeading: number, toHeading: number): 'left' | 'right' | 'straight' {
  const d = normalizeAngle(toHeading - fromHeading);
  if (d > 0.4) return 'left';
  if (d < -0.4) return 'right';
  return 'straight';
}
