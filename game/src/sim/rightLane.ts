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
/** Parked offset: right of the driving lane. Sedan half-width 0.925 → right edge ~6.3 m, curb at 7 m. */
export const PULL_OVER_OFFSET = 5.4;
/** Ease laterally onto the pad over this many metres. */
export const PULL_OVER_LENGTH = 16;
/** Straight, road-parallel tail so the nose matches the curb at the stop. */
export const PULL_OVER_STRAIGHT = 10;
/** Keep the pad out of the intersection box. */
export const DEST_INTERSECTION_CLEAR = 16;
/** Asphalt half-width of the 14 m roads. */
export const ROAD_HALF = 7;

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

function sameGridRoad(a: Vec3, b: Vec3): boolean {
  if (onNS(a) && onNS(b)) return Math.abs(nearestGridLine(a.x) - nearestGridLine(b.x)) < 1;
  if (!onNS(a) && !onNS(b)) return Math.abs(nearestGridLine(a.y) - nearestGridLine(b.y)) < 1;
  return false;
}

/** Centerline corners of a Manhattan trip, then the right-hand lane through those corners. */
export function manhattanCorners(start: Vec3, end: Vec3): Vec3[] {
  const startNS = onNS(start);
  const endNS = onNS(end);
  const pts: Vec3[] = [start];
  if (sameGridRoad(start, end)) {
    pts.push(end);
    return pts;
  }
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

/** Snap heading onto the nearest cardinal so cruise stays on the grid. */
export function snapHeadingToGrid(heading: number): number {
  const n = Math.round(heading / (Math.PI / 2));
  return n * (Math.PI / 2);
}

function axisPoint(x: number, y: number, heading: number): Vec3 {
  const ns = Math.abs(Math.sin(heading)) >= Math.abs(Math.cos(heading));
  if (ns) return vec3(nearestGridLine(x), y, 0);
  return vec3(x, nearestGridLine(y), 0);
}

/** Destination a few hundred metres ahead on the current road axis. */
export function cruiseDestination(x: number, y: number, heading: number, dist = 260): Vec3 {
  const yaw = snapHeadingToGrid(heading);
  return axisPoint(x + Math.cos(yaw) * dist, y + Math.sin(yaw) * dist, yaw);
}

function lastHeading(route: Vec3[], fallback = 0): number {
  if (route.length < 2) return fallback;
  const a = route[route.length - 2]!;
  const b = route[route.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-6) return fallback;
  return Math.atan2(dy, dx);
}

function nearGridCrossing(x: number, y: number, clear = DEST_INTERSECTION_CLEAR): boolean {
  return Math.abs(x - nearestGridLine(x)) < clear && Math.abs(y - nearestGridLine(y)) < clear;
}

/** Slide a roadside pad backward along the approach so it is not in a junction. */
export function slideOffIntersection(point: Vec3, heading: number): Vec3 {
  const yaw = snapHeadingToGrid(heading);
  if (!nearGridCrossing(point.x, point.y)) {
    return placeInRightLane(point.x, point.y, yaw, PULL_OVER_OFFSET);
  }
  const ix = nearestGridLine(point.x);
  const iy = nearestGridLine(point.y);
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const along = (point.x - ix) * fx + (point.y - iy) * fy;
  const targetAlong = along >= 0 ? -DEST_INTERSECTION_CLEAR : Math.min(along, -DEST_INTERSECTION_CLEAR);
  return placeInRightLane(ix + fx * targetAlong, iy + fy * targetAlong, yaw, PULL_OVER_OFFSET);
}

/** Right-curb pad for a map click: last-segment heading, then pull-over offset. */
export function roadsideDestination(end: Vec3, approachHeading: number): Vec3 {
  const yaw = snapHeadingToGrid(approachHeading);
  const pad = placeInRightLane(end.x, end.y, yaw, PULL_OVER_OFFSET);
  return slideOffIntersection(pad, yaw);
}

function alongLat(p: Vec3, ux: number, uy: number, rx: number, ry: number): { along: number; lat: number } {
  return { along: p.x * ux + p.y * uy, lat: p.x * rx + p.y * ry };
}

function fromAlongLat(along: number, lat: number, ux: number, uy: number, rx: number, ry: number): Vec3 {
  return vec3(along * ux + lat * rx, along * uy + lat * ry, 0);
}

/** Pin at the front-right of the pad, ahead of the bumper and outside the body. */
export function destinationPinWorld(dest: Vec3, heading: number): Vec3 {
  const yaw = snapHeadingToGrid(heading);
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  const r = headingRight(yaw);
  return vec3(dest.x + ux * 3.15 + r.x * 1.1, dest.y + uy * 3.15 + r.y * 1.1, 0);
}

/** Body-plan corners of the fitted sedan (4.7 × 1.85 m). */
export function sedanCorners(x: number, y: number, yaw: number): Array<{ x: number; y: number }> {
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  const r = headingRight(yaw);
  const hl = 2.35;
  const hw = 0.925;
  const out: Array<{ x: number; y: number }> = [];
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      out.push({ x: x + ux * s * hl + r.x * t * hw, y: y + uy * s * hl + r.y * t * hw });
    }
  }
  return out;
}

export function pointOnAsphalt(x: number, y: number, half = ROAD_HALF): boolean {
  return Math.abs(x - nearestGridLine(x)) <= half || Math.abs(y - nearestGridLine(y)) <= half;
}

/** Replace the last metres of a lane route with an ease, then a road-parallel tail onto `dest`. */
export function appendPullOver(route: Vec3[], dest: Vec3): Vec3[] {
  if (route.length === 0) return [dest];
  const heading = snapHeadingToGrid(
    lastHeading(route, Math.atan2(dest.y - route[0]!.y, dest.x - route[0]!.x)),
  );
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  const r = headingRight(heading);
  const destAL = alongLat(dest, ux, uy, r.x, r.y);
  const easeEndAlong = destAL.along - PULL_OVER_STRAIGHT;
  const easeStartAlong = easeEndAlong - PULL_OVER_LENGTH;

  const kept: Vec3[] = [];
  for (const p of route) {
    if (alongLat(p, ux, uy, r.x, r.y).along <= easeStartAlong + 0.35) kept.push(p);
  }
  const from = kept[kept.length - 1] ?? route[0]!;
  const fromAL = alongLat(from, ux, uy, r.x, r.y);
  const out = kept.length > 0 ? kept.slice() : [from];

  const easeSteps = 8;
  for (let s = 1; s <= easeSteps; s++) {
    const t = s / easeSteps;
    const e = t * t * (3 - 2 * t);
    out.push(fromAlongLat(
      fromAL.along + (easeEndAlong - fromAL.along) * t,
      fromAL.lat + (destAL.lat - fromAL.lat) * e,
      ux, uy, r.x, r.y,
    ));
  }
  const straightSteps = 6;
  for (let s = 1; s <= straightSteps; s++) {
    const t = s / straightSteps;
    out.push(fromAlongLat(
      easeEndAlong + (destAL.along - easeEndAlong) * t,
      destAL.lat,
      ux, uy, r.x, r.y,
    ));
  }
  out[out.length - 1] = dest;
  return out;
}

/** Right-hand-lane Manhattan trip that ends pulled over at a roadside pad. */
export function tripRoute(start: Vec3, end: Vec3, offset = LANE_OFFSET): Vec3[] {
  const lane = rightLaneRoute(start, end, offset);
  const heading = lastHeading(lane, 0);
  const dest = roadsideDestination(end, heading);
  return appendPullOver(lane, dest);
}

/**
 * Replan from the car's pose: ease into the right-hand lane, then follow a
 * Manhattan right-lane path to `goal` (or cruise ahead if goal is omitted).
 * A trip goal finishes with a roadside pull-over; cruise does not.
 */
export function mergeIntoLaneRoute(
  from: Vec3,
  heading: number,
  goal?: Vec3 | null,
  offset = LANE_OFFSET,
): Vec3[] {
  const yaw = snapHeadingToGrid(heading);
  const axisFrom = axisPoint(from.x, from.y, yaw);
  const dest = goal
    ? axisPoint(goal.x, goal.y, Math.abs(goal.x - nearestGridLine(goal.x)) <= Math.abs(goal.y - nearestGridLine(goal.y)) ? Math.PI / 2 : 0)
    : cruiseDestination(from.x, from.y, yaw);
  const rest = rightLaneRoute(axisFrom, dest, offset);
  const merge = rest[0] ?? placeInRightLane(from.x, from.y, yaw, offset);
  const lead: Vec3[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    lead.push(vec3(from.x * (1 - t) + merge.x * t, from.y * (1 - t) + merge.y * t, 0));
  }
  const merged = [...lead, ...rest.slice(1)];
  if (!goal) return merged;
  return appendPullOver(merged, roadsideDestination(goal, lastHeading(merged, yaw)));
}
