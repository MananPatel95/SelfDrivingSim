/**
 * Waymo-style HD-map lane-graph routing.
 *
 * Public Waymo Driver descriptions use a prior HD map of lane centerlines
 * as the routing graph (plus stop lines, crosswalks, lights). This city's
 * driving lanes are full-map one-way polylines with empty `connections[]`,
 * so a hop is: stay on the heading-matched start lane to the crossing
 * with the dest lane, then follow the dest lane to the pad. Opposite-side
 * dests still U-turn at the next junction. This is not a trained planner.
 */

import type { Lane, Vec3 } from '../sim/types';
import { normalizeAngle, vec3 } from '../sim/math';
import {
  appendPullOver,
  cruiseDestination,
  intersectionUTurn,
  nextIntersectionAhead,
  placeInRightLane,
  snapHeadingToGrid,
  type ResolvedDestination,
  LANE_OFFSET,
} from '../sim/rightLane';

export function drivingLanes(lanes: readonly Lane[]): Lane[] {
  return lanes.filter(l => l.type === 'driving' && l.points.length >= 2);
}

export function closestHeadingLane(
  lanes: readonly Lane[],
  pos: Vec3,
  heading: number,
): Lane | null {
  const yaw = snapHeadingToGrid(heading);
  const pool = drivingLanes(lanes);
  let best: Lane | null = null;
  let bestDist = Infinity;
  for (const lane of pool) {
    const dir = lane.points[0]!.direction;
    if (Math.abs(normalizeAngle(dir - yaw)) > 0.7) continue;
    const d = minDistToLane(lane, pos);
    if (d < bestDist) {
      bestDist = d;
      best = lane;
    }
  }
  if (best) return best;
  for (const lane of pool) {
    const d = minDistToLane(lane, pos);
    if (d < bestDist) {
      bestDist = d;
      best = lane;
    }
  }
  return best;
}

export function minDistToLane(lane: Lane, pos: Vec3): number {
  let best = Infinity;
  for (const p of lane.points) {
    const dx = p.position.x - pos.x;
    const dy = p.position.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function closestLaneIndex(lane: Lane, pos: Vec3): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < lane.points.length; i++) {
    const p = lane.points[i]!.position;
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
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

/** Walk a one-way HD lane from `from` toward `to` (increasing index only). */
export function walkLane(lane: Lane, from: Vec3, to: Vec3): Vec3[] {
  const i0 = closestLaneIndex(lane, from);
  const i1 = closestLaneIndex(lane, to);
  const end = Math.max(i0, i1);
  const pts: Vec3[] = [];
  for (let i = i0; i <= end; i++) pts.push(lane.points[i]!.position);
  if (pts.length === 0) return [from];
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(...sampleLine(pts[i]!, pts[i + 1]!));
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

function laneIsNS(lane: Lane): boolean {
  const dir = lane.points[0]!.direction;
  return Math.abs(Math.sin(dir)) >= Math.abs(Math.cos(dir));
}

/** Crossing of two offset driving lanes (they already sit in the right-hand bay). */
export function lanesMeet(a: Lane, b: Lane): Vec3 {
  const pa = a.points[0]!.position;
  const pb = b.points[0]!.position;
  const aNS = laneIsNS(a);
  const bNS = laneIsNS(b);
  if (aNS && !bNS) return vec3(pa.x, pb.y, 0);
  if (!aNS && bNS) return vec3(pb.x, pa.y, 0);
  return vec3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 0);
}

function lastHeading(route: Vec3[], fallback: number): number {
  if (route.length < 2) return fallback;
  const a = route[route.length - 2]!;
  const b = route[route.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy < 1e-6) return fallback;
  return Math.atan2(dy, dx);
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

function mergeLead(from: Vec3, rest: Vec3[]): Vec3[] {
  const merge = rest[0] ?? from;
  const lead: Vec3[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    lead.push(vec3(from.x * (1 - t) + merge.x * t, from.y * (1 - t) + merge.y * t, 0));
  }
  return joinRoutes([lead, rest]);
}

function axisOnLane(lane: Lane, p: Vec3): Vec3 {
  if (laneIsNS(lane)) return vec3(lane.points[0]!.position.x, p.y, 0);
  return vec3(p.x, lane.points[0]!.position.y, 0);
}

/**
 * Route on HD driving lanes from the current pose to a resolved pad
 * (or cruise ahead). Same dest rule as `resolveTripDestination`:
 * opposite-side U-turn only when the caller marked `resolved.opposite`.
 */
export function laneGraphRoute(
  lanes: readonly Lane[],
  from: Vec3,
  heading: number,
  resolved?: ResolvedDestination | null,
  goal?: Vec3 | null,
): Vec3[] {
  const yaw = snapHeadingToGrid(heading);
  const startLane = closestHeadingLane(lanes, from, yaw);
  if (!startLane) {
    return [placeInRightLane(from.x, from.y, yaw, LANE_OFFSET)];
  }

  if (!goal && !resolved) {
    const dest = cruiseDestination(from.x, from.y, yaw);
    return mergeLead(from, walkLane(startLane, from, dest));
  }

  const dest = resolved!;
  const pad = dest.pad;
  const destLane = closestHeadingLane(lanes, pad, dest.arrivalHeading) ?? startLane;

  if (dest.opposite) {
    const turnAt = nextIntersectionAhead(pad, dest.naiveHeading);
    const toTurn = walkLane(startLane, from, turnAt);
    const uTurn = intersectionUTurn(turnAt, lastHeading(toTurn, dest.naiveHeading));
    const afterFrom = uTurn[uTurn.length - 1] ?? turnAt;
    const after = walkLane(destLane, afterFrom, axisOnLane(destLane, pad));
    return appendPullOver(mergeLead(from, joinRoutes([toTurn, uTurn, after])), pad);
  }

  if (startLane.id === destLane.id) {
    const along = walkLane(startLane, from, axisOnLane(startLane, pad));
    return appendPullOver(mergeLead(from, along), pad);
  }

  const meet = lanesMeet(startLane, destLane);
  const incoming = walkLane(startLane, from, meet);
  const outgoing = walkLane(destLane, meet, axisOnLane(destLane, pad));
  return appendPullOver(mergeLead(from, joinRoutes([incoming, [meet], outgoing])), pad);
}
