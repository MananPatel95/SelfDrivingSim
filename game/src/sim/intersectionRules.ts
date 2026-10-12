/**
 * Intersection controls and right-of-way for every vehicle, ego included.
 * Seeded mix: stop / yield / uncontrolled, about a third each.
 */

import type { Vec3 } from './types';
import { normalizeAngle } from './math';

export type ControlKind = 'stop' | 'yield' | 'none';

export const STOP_LINE_DIST = 8;
export const INTERSECTION_BOX = 7;
export const APPROACH_RANGE = 42;

export interface ControlledIntersection {
  id: number;
  center: Vec3;
  control: ControlKind;
  /** Incoming travel headings that have a sign. Stop: all four. Yield: minor only. */
  signedHeadings: number[];
  majorHeadings: number[];
  stopLineDist: number;
}

export interface RoadUser {
  id: number;
  x: number;
  y: number;
  yaw: number;
  speed: number;
}

export interface StopBook {
  arrivals: Map<number, { intersectionId: number; arrivedAt: number }>;
}

export interface RuleDecision {
  maxSpeed: number;
  mustStop: boolean;
  reason: string;
  severity: 'go' | 'slow' | 'brake';
}

const HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export function pickControl(i: number, j: number, seed: number): ControlKind {
  const n = Math.abs(i * 17 + j * 31 + seed * 13) % 3;
  return n === 0 ? 'stop' : n === 1 ? 'yield' : 'none';
}

export function buildControlledIntersection(
  id: number,
  i: number,
  j: number,
  center: Vec3,
  seed: number,
): ControlledIntersection {
  const control = pickControl(i, j, seed);
  const nsMajor = (i + j + seed) % 2 === 0;
  const majorHeadings = nsMajor ? [Math.PI / 2, -Math.PI / 2] : [0, Math.PI];
  const minorHeadings = nsMajor ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
  const signedHeadings = control === 'stop'
    ? [...HEADINGS]
    : control === 'yield'
      ? minorHeadings
      : [];
  return {
    id,
    center,
    control,
    signedHeadings,
    majorHeadings,
    stopLineDist: STOP_LINE_DIST,
  };
}

export function headingMatches(a: number, b: number, slop = 0.45): boolean {
  return Math.abs(normalizeAngle(a - b)) < slop;
}

export function isOnRight(selfYaw: number, otherYaw: number): boolean {
  return Math.abs(normalizeAngle(otherYaw - selfYaw) - Math.PI / 2) < 0.7;
}

export function distToCenter(user: { x: number; y: number }, inter: ControlledIntersection): number {
  return Math.hypot(user.x - inter.center.x, user.y - inter.center.y);
}

/** Metres before the stop line (positive = still approaching). */
export function distToStopLine(user: RoadUser, inter: ControlledIntersection): number {
  const fx = Math.cos(user.yaw);
  const fy = Math.sin(user.yaw);
  const along = (inter.center.x - user.x) * fx + (inter.center.y - user.y) * fy;
  return along - inter.stopLineDist;
}

export function approachingIntersection(
  user: RoadUser,
  intersections: readonly ControlledIntersection[],
): { inter: ControlledIntersection; distToLine: number } | null {
  let best: { inter: ControlledIntersection; distToLine: number } | null = null;
  for (const inter of intersections) {
    const fx = Math.cos(user.yaw);
    const fy = Math.sin(user.yaw);
    const along = (inter.center.x - user.x) * fx + (inter.center.y - user.y) * fy;
    const lat = Math.abs(-(inter.center.x - user.x) * fy + (inter.center.y - user.y) * fx);
    if (along < -4 || along > APPROACH_RANGE || lat > 9) continue;
    const distToLine = along - inter.stopLineDist;
    if (!best || distToLine < best.distToLine) best = { inter, distToLine };
  }
  return best;
}

function headingIs(list: number[], yaw: number): boolean {
  return list.some(h => headingMatches(yaw, h));
}

function someoneInBox(inter: ControlledIntersection, users: RoadUser[], selfId: number): boolean {
  return users.some(u => u.id !== selfId && distToCenter(u, inter) < INTERSECTION_BOX && u.speed > 0.4);
}

function pedInCrosswalk(
  inter: ControlledIntersection,
  peds: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  return peds.some(p => Math.hypot(p.x - inter.center.x, p.y - inter.center.y) < 12);
}

function majorTrafficClose(
  inter: ControlledIntersection,
  self: RoadUser,
  others: RoadUser[],
): boolean {
  return others.some(o => {
    if (o.id === self.id) return false;
    if (!headingIs(inter.majorHeadings, o.yaw)) return false;
    const d = distToCenter(o, inter);
    if (d > 28 || o.speed < 0.4) return false;
    const fx = Math.cos(o.yaw);
    const fy = Math.sin(o.yaw);
    const along = (inter.center.x - o.x) * fx + (inter.center.y - o.y) * fy;
    return along > -6 && along < 30;
  });
}

function rightTrafficClose(
  inter: ControlledIntersection,
  self: RoadUser,
  others: RoadUser[],
): RoadUser | null {
  for (const o of others) {
    if (o.id === self.id) continue;
    if (!isOnRight(self.yaw, o.yaw)) continue;
    const d = distToCenter(o, inter);
    if (d > 24) continue;
    const fx = Math.cos(o.yaw);
    const fy = Math.sin(o.yaw);
    const along = (inter.center.x - o.x) * fx + (inter.center.y - o.y) * fy;
    if (along > -6 && along < 26 && o.speed > 0.3) return o;
  }
  return null;
}

function canLeaveStop(
  self: RoadUser,
  inter: ControlledIntersection,
  others: RoadUser[],
  book: StopBook,
): { ok: boolean; reason: string } {
  if (someoneInBox(inter, others, self.id)) {
    return { ok: false, reason: 'Stopping: intersection occupied' };
  }
  const mine = book.arrivals.get(self.id);
  if (!mine || mine.intersectionId !== inter.id) {
    return { ok: false, reason: 'Stopping: stop sign' };
  }
  const waiting = others
    .map(o => ({ o, rec: book.arrivals.get(o.id) }))
    .filter((x): x is { o: RoadUser; rec: { intersectionId: number; arrivedAt: number } } =>
      !!x.rec && x.rec.intersectionId === inter.id && x.o.id !== self.id
      && distToCenter(x.o, inter) < INTERSECTION_BOX + 12);

  for (const { o, rec } of waiting) {
    if (rec.arrivedAt < mine.arrivedAt - 0.12) {
      return { ok: false, reason: 'Stopping: first come, first served' };
    }
    if (Math.abs(rec.arrivedAt - mine.arrivedAt) <= 0.12 && isOnRight(self.yaw, o.yaw)) {
      return { ok: false, reason: 'Yielding to car on right' };
    }
  }
  return { ok: true, reason: 'Clearing: stop sign' };
}

export function markArrival(book: StopBook, user: RoadUser, inter: ControlledIntersection, now: number): void {
  const rec = book.arrivals.get(user.id);
  if (rec?.intersectionId === inter.id) return;
  book.arrivals.set(user.id, { intersectionId: inter.id, arrivedAt: now });
}

export function clearArrival(book: StopBook, userId: number, inter: ControlledIntersection, user: RoadUser): void {
  if (distToCenter(user, inter) > INTERSECTION_BOX + 4) book.arrivals.delete(userId);
}

export function decideIntersection(
  self: RoadUser,
  others: RoadUser[],
  peds: ReadonlyArray<{ x: number; y: number }>,
  intersections: readonly ControlledIntersection[],
  book: StopBook,
  now: number,
): RuleDecision {
  const hit = approachingIntersection(self, intersections);
  if (!hit) {
    return { maxSpeed: 99, mustStop: false, reason: 'Cruising: lane clear', severity: 'go' };
  }
  const { inter, distToLine } = hit;
  if (distToCenter(self, inter) > INTERSECTION_BOX + 6) {
    clearArrival(book, self.id, inter, self);
  }
  for (const [id, rec] of book.arrivals) {
    if (rec.intersectionId !== inter.id) continue;
    const who = [self, ...others].find(u => u.id === id);
    if (!who || distToCenter(who, inter) > INTERSECTION_BOX + 12) book.arrivals.delete(id);
  }

  if (pedInCrosswalk(inter, peds) && distToLine > -2 && distToLine < 18) {
    return { maxSpeed: 0, mustStop: true, reason: 'Yielding to pedestrian', severity: 'brake' };
  }

  const signed = headingIs(inter.signedHeadings, self.yaw);

  if (inter.control === 'stop' && signed && distToLine > -2.5 && distToLine < 28) {
    const atLine = distToLine < 2.4;
    const stopped = self.speed < 0.25 && atLine;
    if (stopped) markArrival(book, self, inter, now);
    const rec = book.arrivals.get(self.id);
    const completed = rec?.intersectionId === inter.id;
    if (!completed) {
      const creep = distToLine < 8 ? 1.15 : Math.max(1.2, distToLine * 0.35);
      return {
        maxSpeed: atLine ? 0 : creep,
        mustStop: atLine,
        reason: 'Stopping: stop sign',
        severity: 'brake',
      };
    }
    const leave = canLeaveStop(self, inter, others, book);
    if (!leave.ok) {
      return { maxSpeed: 0, mustStop: true, reason: leave.reason, severity: 'brake' };
    }
    return { maxSpeed: 4.5, mustStop: false, reason: leave.reason, severity: 'go' };
  }

  if (inter.control === 'yield' && signed && distToLine > -2 && distToLine < 24) {
    if (majorTrafficClose(inter, self, others)) {
      return { maxSpeed: distToLine < 4 ? 0 : 3.2, mustStop: distToLine < 3, reason: 'Yielding to cross traffic', severity: 'slow' };
    }
    return { maxSpeed: 6.2, mustStop: false, reason: 'Yielding: clear to go', severity: 'go' };
  }

  if (inter.control === 'none' && distToLine > -2 && distToLine < 22) {
    const right = rightTrafficClose(inter, self, others);
    if (right) {
      return { maxSpeed: distToLine < 4 ? 1.2 : 3.5, mustStop: false, reason: 'Yielding to car on right', severity: 'slow' };
    }
    return { maxSpeed: 5.5, mustStop: false, reason: 'Uncontrolled: slowing', severity: 'slow' };
  }

  return { maxSpeed: 99, mustStop: false, reason: 'Cruising: lane clear', severity: 'go' };
}

export function signPose(
  inter: ControlledIntersection,
  heading: number,
  side = 8.4,
  back = 10,
): { x: number; y: number; yaw: number } {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const rx = Math.sin(heading);
  const ry = -Math.cos(heading);
  return {
    x: inter.center.x - fx * back + rx * side,
    y: inter.center.y - fy * back + ry * side,
    yaw: heading + Math.PI,
  };
}

export function stopLinePose(inter: ControlledIntersection, heading: number): { x: number; y: number; yaw: number } {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  return {
    x: inter.center.x - fx * inter.stopLineDist,
    y: inter.center.y - fy * inter.stopLineDist,
    yaw: heading,
  };
}
