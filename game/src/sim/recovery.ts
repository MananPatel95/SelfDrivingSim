/**
 * Autopilot recovery: back up off a sidewalk / stop-line stall and re-merge
 * onto the planned right-hand-lane path. Does not replace the planner.
 */

import type { Vec3 } from './types';
import type { VehicleInput } from './vehicle';
import { vec3 } from './math';
import { inRightLane, LANE_OFFSET } from './rightLane';

/** Full-stop dwell before a stop sign may release (seconds). */
export const STOP_SIGN_DWELL = 1.2;
/** After this at a clear stop, recover instead of sitting forever. */
export const STOP_STUCK_RECOVER = 2.4;
/** Metres to reverse when re-merging. */
export const REVERSE_DISTANCE = 10;
/** How far off the route polyline counts as off-path (samples are ~6 m). */
export const OFF_PATH_DIST = 5.5;

export type RecoveryPhase = 'idle' | 'braking' | 'reversing';

export interface RecoveryState {
  phase: RecoveryPhase;
  ticks: number;
  target: Vec3 | null;
}

export function createRecoveryState(): RecoveryState {
  return { phase: 'idle', ticks: 0, target: null };
}

export function distanceToRoute(
  x: number,
  y: number,
  route: ReadonlyArray<{ x: number; y: number }>,
): number {
  if (route.length === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i < route.length; i++) {
    const p = route[i]!;
    const d0 = Math.hypot(p.x - x, p.y - y);
    if (d0 < best) best = d0;
    const q = route[i + 1];
    if (!q) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
    const d = Math.hypot(x - (p.x + dx * t), y - (p.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

export function isOffLane(x: number, y: number, heading: number): boolean {
  return !inRightLane(x, y, heading);
}

export function isOffPath(
  x: number,
  y: number,
  route: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  if (route.length < 2) return false;
  return distanceToRoute(x, y, route) > OFF_PATH_DIST;
}

export function reverseAnchor(x: number, y: number, heading: number, dist = REVERSE_DISTANCE): Vec3 {
  return vec3(x - Math.cos(heading) * dist, y - Math.sin(heading) * dist, 0);
}

export function shouldStartRecovery(opts: {
  arrived: boolean;
  human: boolean;
  offLane: boolean;
  offPath: boolean;
  speed: number;
  stopStuckClear: boolean;
}): boolean {
  if (opts.arrived || opts.human) return false;
  if (opts.stopStuckClear) return true;
  if ((opts.offLane || opts.offPath) && opts.speed < 1.25) return true;
  return false;
}

export function recoveryFinished(
  x: number,
  y: number,
  heading: number,
  start: Vec3,
  route: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  const backed = Math.hypot(x - start.x, y - start.y);
  if (backed >= REVERSE_DISTANCE - 0.8) return true;
  const onLane = inRightLane(x, y, heading);
  const onPath = route.length < 2 || distanceToRoute(x, y, route) < LANE_OFFSET;
  return backed > 3.2 && onLane && onPath;
}

/** GTA reverse: hold S at rest so the sedan backs along its nose. */
export function reverseRejoinInput(steering = 0): VehicleInput {
  return { throttle: 0, steering, brake: 1, gtaReverse: true };
}

export function brakeToStopInput(steering = 0): VehicleInput {
  return { throttle: 0, steering, brake: 1 };
}
