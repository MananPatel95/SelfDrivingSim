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
/** Fitted sedan half-width (1.85 m body). */
export const SEDAN_HALF_WIDTH = 0.925;
/** Parked tyre-to-curb gap. */
export const CURB_CLEARANCE = 0.3;
/** Asphalt half-width of the 14 m roads. Curb face sits here. */
export const ROAD_HALF = 7;
/**
 * Parked offset: right-hand bay, ~0.3 m off the curb.
 * 7 − 0.3 − 0.925 = 5.775 m. Right edge at 6.7 m, pad outer flush at 7 m.
 */
export const PULL_OVER_OFFSET = ROAD_HALF - CURB_CLEARANCE - SEDAN_HALF_WIDTH;
/** Pink bay, long axis along the road. */
export const PAD_ALONG = 8.4;
/** Pink bay width: centered on the parked pose, outer edge at the curb. */
export const PAD_WIDTH = 2 * (ROAD_HALF - PULL_OVER_OFFSET);
/** Ease laterally onto the pad over this many metres. */
export const PULL_OVER_LENGTH = 16;
/** Straight, road-parallel tail so the nose matches the curb at the stop. */
export const PULL_OVER_STRAIGHT = 10;
/** Keep the pad out of the intersection box. */
export const DEST_INTERSECTION_CLEAR = 16;
/** Mid-block spawn: stay this far from a grid crossing so the car is not on a stop line. */
export const SPAWN_INTERSECTION_CLEAR = 24;
/** City grid step (matches `world.ts` MAP_BLOCK). */
export const GRID_STEP = 100;
/** Click this far left of the naive approach counts as an opposite-side dest. */
export const OPPOSITE_SIDE_LAT = -1.2;

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

export function isNearIntersection(x: number, y: number, clear = SPAWN_INTERSECTION_CLEAR): boolean {
  return nearGridCrossing(x, y, clear);
}

/** Default travel heading on the road this point sits on (north on N–S, east on E–W). */
export function headingAlongRoadPoint(x: number, y: number): number {
  const ns = Math.abs(x - nearestGridLine(x)) <= Math.abs(y - nearestGridLine(y));
  return ns ? Math.PI / 2 : 0;
}

/**
 * Snap a map start click onto the right-hand driving lane, aligned to the grid,
 * and slide it off any junction so the sedan is not on a sidewalk or stop line.
 */
export function snapTripStart(x: number, y: number, heading?: number): Vec3 {
  const yaw = snapHeadingToGrid(heading ?? headingAlongRoadPoint(x, y));
  const ns = Math.abs(Math.sin(yaw)) >= Math.abs(Math.cos(yaw));
  const snapped = ns
    ? vec3(nearestGridLine(x), y, 0)
    : vec3(x, nearestGridLine(y), 0);
  let placed = placeInRightLane(snapped.x, snapped.y, yaw, LANE_OFFSET);
  if (nearGridCrossing(placed.x, placed.y, SPAWN_INTERSECTION_CLEAR)) {
    const ix = nearestGridLine(placed.x);
    const iy = nearestGridLine(placed.y);
    const fx = Math.cos(yaw);
    const fy = Math.sin(yaw);
    const along = (placed.x - ix) * fx + (placed.y - iy) * fy;
    const away = along >= 0 ? SPAWN_INTERSECTION_CLEAR : -SPAWN_INTERSECTION_CLEAR;
    placed = placeInRightLane(ix + fx * away, iy + fy * away, yaw, LANE_OFFSET);
  }
  return placed;
}

export function isValidLaneSpawn(x: number, y: number, heading: number): boolean {
  const yaw = snapHeadingToGrid(heading);
  return inRightLane(x, y, yaw)
    && !nearGridCrossing(x, y, SPAWN_INTERSECTION_CLEAR - 2)
    && Math.abs(normalizeAngle(heading - yaw)) < 0.2;
}

/** Place the ego at a legal lane start, then aim it along the first trip segment. */
export function placeTripStart(start: Vec3, end: Vec3): { pos: Vec3; yaw: number } {
  const hint = snapTripStart(start.x, start.y);
  let yaw = headingAlongRoadPoint(hint.x, hint.y);
  if (sameGridRoad(hint, end)) {
    yaw = snapHeadingToGrid(Math.atan2(end.y - hint.y, end.x - hint.x));
  } else {
    const probe = rightLaneRoute(hint, end);
    const next = probe[Math.min(1, probe.length - 1)] ?? end;
    yaw = snapHeadingToGrid(Math.atan2(next.y - hint.y, next.x - hint.x));
  }
  return { pos: placeInRightLane(hint.x, hint.y, yaw, LANE_OFFSET), yaw };
}

/**
 * Slide a roadside pad out of a junction.
 * Same-street: park *before* the box (backward along the approach).
 * Cross-street (`keepClickSide`): stay on the click's arm so a left-turn dest
 * just past the corner is not dragged back onto the approach street.
 */
export function slideOffIntersection(point: Vec3, heading: number, keepClickSide = false): Vec3 {
  const yaw = snapHeadingToGrid(heading);
  if (!nearGridCrossing(point.x, point.y)) {
    return placeInRightLane(point.x, point.y, yaw, PULL_OVER_OFFSET);
  }
  const ix = nearestGridLine(point.x);
  const iy = nearestGridLine(point.y);
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const along = (point.x - ix) * fx + (point.y - iy) * fy;
  const targetAlong = keepClickSide
    ? (along >= 0 ? 1 : -1) * DEST_INTERSECTION_CLEAR
    : (along >= 0 ? -DEST_INTERSECTION_CLEAR : Math.min(along, -DEST_INTERSECTION_CLEAR));
  return placeInRightLane(ix + fx * targetAlong, iy + fy * targetAlong, yaw, PULL_OVER_OFFSET);
}

/** Right-curb pad for a map click: last-segment heading, then pull-over offset. */
export function roadsideDestination(end: Vec3, approachHeading: number, keepClickSide = false): Vec3 {
  const yaw = snapHeadingToGrid(approachHeading);
  const pad = placeInRightLane(end.x, end.y, yaw, PULL_OVER_OFFSET);
  return slideOffIntersection(pad, yaw, keepClickSide);
}

/** Arrival heading implied by a pad that already sits at `PULL_OVER_OFFSET`. */
export function arrivalHeadingFromPad(pad: Vec3): number {
  if (onNS(pad)) {
    return pad.x >= nearestGridLine(pad.x) ? Math.PI / 2 : -Math.PI / 2;
  }
  return pad.y <= nearestGridLine(pad.y) ? 0 : Math.PI;
}

/** Next grid crossing ahead of `point` along `heading` (not the one we already sit in). */
export function nextIntersectionAhead(point: Vec3, heading: number): Vec3 {
  const yaw = snapHeadingToGrid(heading);
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  if (Math.abs(fx) >= Math.abs(fy)) {
    const roadY = nearestGridLine(point.y);
    let gx = nearestGridLine(point.x);
    if ((gx - point.x) * fx <= DEST_INTERSECTION_CLEAR) gx += Math.sign(fx || 1) * GRID_STEP;
    return vec3(gx, roadY, 0);
  }
  const roadX = nearestGridLine(point.x);
  let gy = nearestGridLine(point.y);
  if ((gy - point.y) * fy <= DEST_INTERSECTION_CLEAR) gy += Math.sign(fy || 1) * GRID_STEP;
  return vec3(roadX, gy, 0);
}

/**
 * Legal left U-turn through an intersection box. Never crosses a mid-block median.
 * Incoming right lane → far-side apex → outgoing right lane heading the opposite way.
 */
export function intersectionUTurn(center: Vec3, inHeading: number): Vec3[] {
  const yaw = snapHeadingToGrid(inHeading);
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  const r = headingRight(yaw);
  const lane = LANE_OFFSET;
  const pts = [
    vec3(center.x - ux * 18 + r.x * lane, center.y - uy * 18 + r.y * lane, 0),
    vec3(center.x - ux * 6 + r.x * lane, center.y - uy * 6 + r.y * lane, 0),
    vec3(center.x + ux * 5 + r.x * 1.6, center.y + uy * 5 + r.y * 1.6, 0),
    vec3(center.x + ux * 12 - r.x * 1.2, center.y + uy * 12 - r.y * 1.2, 0),
    vec3(center.x + ux * 14 - r.x * lane, center.y + uy * 14 - r.y * lane, 0),
    vec3(center.x + ux * 6 - r.x * lane, center.y + uy * 6 - r.y * lane, 0),
    vec3(center.x - ux * 2 - r.x * lane, center.y - uy * 2 - r.y * lane, 0),
    vec3(center.x - ux * 16 - r.x * lane, center.y - uy * 16 - r.y * lane, 0),
  ];
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(...sampleLine(pts[i]!, pts[i + 1]!, 2.5));
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export interface ResolvedDestination {
  pad: Vec3;
  arrivalHeading: number;
  naiveHeading: number;
  opposite: boolean;
}

/**
 * Pad on the right-hand curb of the heading we will arrive with.
 * Opposite-side U-turn only when start and end share a grid road *and* the
 * click is left of that road's naive approach — never for a cross-street
 * dest that only needs a left / right / straight. A legal left at a corner
 * must stay cheaper than going past, U-turning, and coming back for a right.
 */
export function resolveTripDestination(start: Vec3, end: Vec3): ResolvedDestination {
  const lane = rightLaneRoute(start, end);
  const naiveHeading = snapHeadingToGrid(
    lastHeading(lane, Math.atan2(end.y - start.y, end.x - start.x)),
  );
  const lat = lateralFromCenter(end.x, end.y, naiveHeading);
  const sameStreet = sameGridRoad(start, end);
  const opposite = sameStreet && lat < OPPOSITE_SIDE_LAT;
  const arrivalHeading = normalizeAngle(
    snapHeadingToGrid(opposite ? naiveHeading + Math.PI : naiveHeading),
  );
  return {
    pad: roadsideDestination(end, arrivalHeading, !sameStreet),
    arrivalHeading,
    naiveHeading,
    opposite,
  };
}

function joinRoutes(parts: Vec3[][]): Vec3[] {
  const out: Vec3[] = [];
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.35) continue;
      out.push(p);
    }
  }
  return out;
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
  const hw = SEDAN_HALF_WIDTH;
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

/**
 * On the asphalt of the road `heading` is following — not the cross street.
 * A southbound corner uses |x − axis| < 7; an eastbound corner uses |y − axis| < 7.
 */
export function onArrivalAsphalt(x: number, y: number, heading: number, half = ROAD_HALF): boolean {
  const yaw = snapHeadingToGrid(heading);
  const ns = Math.abs(Math.sin(yaw)) >= Math.abs(Math.cos(yaw));
  if (ns) return Math.abs(x - nearestGridLine(x)) < half;
  return Math.abs(y - nearestGridLine(y)) < half;
}

/** Metres from a point to the right-hand curb of `heading`'s road. Negative = over the sidewalk. */
export function distanceToRightCurb(x: number, y: number, heading: number): number {
  return ROAD_HALF - lateralFromCenter(x, y, heading);
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

function routeToPad(start: Vec3, resolved: ResolvedDestination, offset: number): Vec3[] {
  const axisEnd = axisPoint(resolved.pad.x, resolved.pad.y, resolved.arrivalHeading);
  if (!resolved.opposite) {
    const lane = rightLaneRoute(start, axisEnd, offset);
    return appendPullOver(lane, resolved.pad);
  }
  const turnAt = nextIntersectionAhead(resolved.pad, resolved.naiveHeading);
  const toTurn = rightLaneRoute(start, turnAt, offset);
  const uTurn = intersectionUTurn(turnAt, lastHeading(toTurn, resolved.naiveHeading));
  const after = rightLaneRoute(uTurn[uTurn.length - 1]!, axisEnd, offset);
  return appendPullOver(joinRoutes([toTurn, uTurn, after]), resolved.pad);
}

/** Right-hand-lane Manhattan trip that ends pulled over at a roadside pad. */
export function tripRoute(start: Vec3, end: Vec3, offset = LANE_OFFSET): Vec3[] {
  return routeToPad(start, resolveTripDestination(start, end), offset);
}

/**
 * Replan from the car's pose: ease into the right-hand lane, then follow a
 * Manhattan right-lane path to `goal` (or cruise ahead if goal is omitted).
 * A trip goal finishes with a roadside pull-over; cruise does not.
 * Same-street opposite-side pads loop via a legal intersection U-turn.
 */
export function mergeIntoLaneRoute(
  from: Vec3,
  heading: number,
  goal?: Vec3 | null,
  offset = LANE_OFFSET,
): Vec3[] {
  const yaw = snapHeadingToGrid(heading);
  const axisFrom = axisPoint(from.x, from.y, yaw);
  if (!goal) {
    const dest = cruiseDestination(from.x, from.y, yaw);
    const rest = rightLaneRoute(axisFrom, dest, offset);
    const merge = rest[0] ?? placeInRightLane(from.x, from.y, yaw, offset);
    const lead: Vec3[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      lead.push(vec3(from.x * (1 - t) + merge.x * t, from.y * (1 - t) + merge.y * t, 0));
    }
    return [...lead, ...rest.slice(1)];
  }
  const resolved = resolveTripDestination(from, goal);
  const rest = routeToPad(axisFrom, resolved, offset);
  const merge = rest[0] ?? placeInRightLane(from.x, from.y, yaw, offset);
  const lead: Vec3[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    lead.push(vec3(from.x * (1 - t) + merge.x * t, from.y * (1 - t) + merge.y * t, 0));
  }
  return joinRoutes([lead, rest]);
}
