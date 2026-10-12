/**
 * AI traffic random-walk over the city grid.
 * Cars travel right-hand-lane edges, pick a legal exit at each node, and never reverse.
 */

import type { Vec3 } from './types';
import { vec3, SeededRandom, normalizeAngle } from './math';
import { rightLaneRoute, placeInRightLane, LANE_OFFSET } from './rightLane';
import { INTERSECTION_BOX } from './intersectionRules';

export interface CityGrid {
  gridSize: number;
  blockSize: number;
  laneWidth: number;
}

export const DEFAULT_CITY: CityGrid = { gridSize: 6, blockSize: 100, laneWidth: 3.5 };

export interface GridNode {
  i: number;
  j: number;
}

export type TurnName = 'left' | 'right' | 'straight' | 'uturn';

export const STRAIGHT_WEIGHT = 0.5;
export const RIGHT_WEIGHT = 0.3;
export const LEFT_WEIGHT = 0.2;

export function nodePosition(node: GridNode, city: CityGrid = DEFAULT_CITY): Vec3 {
  const half = (city.gridSize * city.blockSize) / 2;
  return vec3(-half + node.i * city.blockSize, -half + node.j * city.blockSize, 0);
}

export function nearestNode(x: number, y: number, city: CityGrid = DEFAULT_CITY): GridNode {
  const half = (city.gridSize * city.blockSize) / 2;
  const i = Math.max(0, Math.min(city.gridSize, Math.round((x + half) / city.blockSize)));
  const j = Math.max(0, Math.min(city.gridSize, Math.round((y + half) / city.blockSize)));
  return { i, j };
}

export function neighborNodes(node: GridNode, gridSize: number): GridNode[] {
  const out: GridNode[] = [];
  if (node.i > 0) out.push({ i: node.i - 1, j: node.j });
  if (node.i < gridSize) out.push({ i: node.i + 1, j: node.j });
  if (node.j > 0) out.push({ i: node.i, j: node.j - 1 });
  if (node.j < gridSize) out.push({ i: node.i, j: node.j + 1 });
  return out;
}

export function edgeHeading(from: GridNode, to: GridNode): number {
  return Math.atan2(to.j - from.j, to.i - from.i);
}

export function turnName(from: GridNode, via: GridNode, to: GridNode): TurnName {
  const inDx = via.i - from.i;
  const inDy = via.j - from.j;
  const outDx = to.i - via.i;
  const outDy = to.j - via.j;
  const cross = inDx * outDy - inDy * outDx;
  const dot = inDx * outDx + inDy * outDy;
  if (dot < 0) return 'uturn';
  if (cross > 0.1) return 'left';
  if (cross < -0.1) return 'right';
  return 'straight';
}

function weightFor(kind: TurnName, allowUturn: boolean): number {
  if (kind === 'straight') return STRAIGHT_WEIGHT;
  if (kind === 'right') return RIGHT_WEIGHT;
  if (kind === 'left') return LEFT_WEIGHT;
  return allowUturn ? 1 : 0;
}

/** Random legal exit: left / straight / right weighted. U-turn only at a true dead end. */
export function pickRandomExit(
  from: GridNode,
  via: GridNode,
  gridSize: number,
  rng: SeededRandom,
): GridNode {
  const opts = neighborNodes(via, gridSize);
  const classified = opts.map(to => ({ to, kind: turnName(from, via, to) }));
  const legal = classified.filter(o => o.kind !== 'uturn');
  const pool = legal.length > 0 ? legal : classified;
  const allowUturn = legal.length === 0;
  const weights = pool.map(o => weightFor(o.kind, allowUturn));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * Math.max(1e-6, sum);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!.to;
  }
  return pool[pool.length - 1]!.to;
}

export function sameNode(a: GridNode, b: GridNode): boolean {
  return a.i === b.i && a.j === b.j;
}

/** Centerline point `dist` metres from `from` toward `to` (clamped to the edge). */
export function alongEdge(from: GridNode, to: GridNode, dist: number, city: CityGrid = DEFAULT_CITY): Vec3 {
  const a = nodePosition(from, city);
  const b = nodePosition(to, city);
  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const t = Math.max(0, Math.min(1, dist / len));
  return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0);
}

/** Right-hand lane path from the current centerline through `to` onto `to`→`next`. */
export function edgePath(
  from: GridNode,
  to: GridNode,
  next: GridNode,
  start: Vec3,
  city: CityGrid = DEFAULT_CITY,
): Vec3[] {
  const toPos = nodePosition(to, city);
  const nextPos = nodePosition(next, city);
  const hx = nextPos.x - toPos.x;
  const hy = nextPos.y - toPos.y;
  const len = Math.max(1, Math.hypot(hx, hy));
  const ahead = Math.min(48, len * 0.55);
  const end = vec3(toPos.x + (hx / len) * ahead, toPos.y + (hy / len) * ahead, 0);
  const path = rightLaneRoute(start, end, city.laneWidth || LANE_OFFSET);
  return path.length >= 2 ? path : [placeInRightLane(start.x, start.y, edgeHeading(from, to), city.laneWidth), placeInRightLane(end.x, end.y, edgeHeading(to, next), city.laneWidth)];
}

export function pathLength(path: readonly Vec3[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    s += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }
  return s;
}

export function nearestPathS(path: readonly Vec3[], x: number, y: number): number {
  let bestS = 0;
  let bestD = Infinity;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const len2 = sx * sx + sy * sy;
    const t = len2 < 1e-8 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * sx + (y - a.y) * sy) / len2));
    const px = a.x + sx * t;
    const py = a.y + sy * t;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      bestS = acc + Math.sqrt(len2) * t;
    }
    acc += Math.sqrt(len2);
  }
  return bestS;
}

export function samplePath(
  path: readonly Vec3[],
  s: number,
): { x: number; y: number; yaw: number; s: number; total: number } {
  if (path.length === 0) return { x: 0, y: 0, yaw: 0, s: 0, total: 0 };
  if (path.length === 1) {
    return { x: path[0]!.x, y: path[0]!.y, yaw: 0, s: 0, total: 0 };
  }
  let remaining = Math.max(0, s);
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }
  remaining = Math.min(remaining, Math.max(0, total - 0.05));
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const yaw = Math.atan2(b.y - a.y, b.x - a.x);
    if (remaining <= seg || i === path.length - 2) {
      const t = seg < 1e-4 ? 0 : remaining / seg;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        yaw,
        s: Math.min(s, total),
        total,
      };
    }
    remaining -= seg;
  }
  const last = path[path.length - 1]!;
  const prev = path[path.length - 2]!;
  return {
    x: last.x,
    y: last.y,
    yaw: Math.atan2(last.y - prev.y, last.x - prev.x),
    s: total,
    total,
  };
}

/** Metres past `to` along the outgoing `to`→`next` edge. Negative = still approaching `to`. */
export function alongOutgoing(
  x: number,
  y: number,
  to: GridNode,
  next: GridNode,
  city: CityGrid = DEFAULT_CITY,
): number {
  const T = nodePosition(to, city);
  const N = nodePosition(next, city);
  const fx = N.x - T.x;
  const fy = N.y - T.y;
  const len = Math.max(1, Math.hypot(fx, fy));
  return ((x - T.x) * fx + (y - T.y) * fy) / len;
}

export function insideIntersectionBox(
  x: number,
  y: number,
  intersections: ReadonlyArray<{ center: { x: number; y: number } }>,
  radius = INTERSECTION_BOX,
): boolean {
  return intersections.some(i => Math.hypot(x - i.center.x, y - i.center.y) < radius);
}

export function upcomingTurnSlow(
  path: readonly Vec3[],
  s: number,
  lookAhead = 16,
): boolean {
  const here = samplePath(path, s);
  const ahead = samplePath(path, s + lookAhead);
  return Math.abs(normalizeAngle(ahead.yaw - here.yaw)) > 0.55;
}

export interface GraphCar {
  fromNode: GridNode;
  toNode: GridNode;
  nextNode: GridNode;
  path: Vec3[];
  pathS: number;
  stuckTime: number;
  intersectionsCleared: number;
}

export function pickRandomEdge(
  rng: SeededRandom,
  city: CityGrid = DEFAULT_CITY,
): { from: GridNode; to: GridNode } {
  for (let n = 0; n < 24; n++) {
    const from = { i: rng.nextInt(0, city.gridSize), j: rng.nextInt(0, city.gridSize) };
    const opts = neighborNodes(from, city.gridSize);
    if (opts.length === 0) continue;
    const to = opts[rng.nextInt(0, opts.length - 1)]!;
    return { from, to };
  }
  return { from: { i: 3, j: 2 }, to: { i: 3, j: 3 } };
}

export function makeGraphTrip(
  rng: SeededRandom,
  city: CityGrid = DEFAULT_CITY,
  avoid?: { x: number; y: number; radius: number },
): GraphCar {
  let from: GridNode = { i: 3, j: 2 };
  let to: GridNode = { i: 3, j: 3 };
  for (let n = 0; n < 20; n++) {
    const edge = pickRandomEdge(rng, city);
    const mid = alongEdge(edge.from, edge.to, city.blockSize * 0.45, city);
    if (avoid && Math.hypot(mid.x - avoid.x, mid.y - avoid.y) < avoid.radius) continue;
    from = edge.from;
    to = edge.to;
    break;
  }
  const next = pickRandomExit(from, to, city.gridSize, rng);
  const dist = rng.nextFloat(18, Math.max(22, city.blockSize - 22));
  const start = alongEdge(from, to, dist, city);
  const path = edgePath(from, to, next, start, city);
  return {
    fromNode: from,
    toNode: to,
    nextNode: next,
    path,
    pathS: 0,
    stuckTime: 0,
    intersectionsCleared: 0,
  };
}

export function promoteIfCleared(
  car: GraphCar,
  x: number,
  y: number,
  rng: SeededRandom,
  city: CityGrid = DEFAULT_CITY,
): GraphCar {
  const past = alongOutgoing(x, y, car.toNode, car.nextNode, city);
  if (past < 10) return car;
  const from = car.toNode;
  const to = car.nextNode;
  const next = pickRandomExit(from, to, city.gridSize, rng);
  const start = alongEdge(from, to, Math.max(10, past), city);
  const path = edgePath(from, to, next, start, city);
  return {
    fromNode: from,
    toNode: to,
    nextNode: next,
    path,
    pathS: 0,
    stuckTime: car.stuckTime,
    intersectionsCleared: car.intersectionsCleared + 1,
  };
}

export function replanFrom(
  car: GraphCar,
  x: number,
  y: number,
  rng: SeededRandom,
  city: CityGrid = DEFAULT_CITY,
): GraphCar {
  const heading = samplePath(car.path, car.pathS).yaw;
  const ns = Math.abs(Math.sin(heading)) >= Math.abs(Math.cos(heading));
  const here = nearestNode(x, y, city);
  let from = car.fromNode;
  let to = car.toNode;
  if (ns) {
    const ahead = Math.sin(heading) >= 0 ? 1 : -1;
    to = { i: here.i, j: Math.max(0, Math.min(city.gridSize, here.j + ahead)) };
    from = { i: here.i, j: Math.max(0, Math.min(city.gridSize, here.j - ahead)) };
  } else {
    const ahead = Math.cos(heading) >= 0 ? 1 : -1;
    to = { i: Math.max(0, Math.min(city.gridSize, here.i + ahead)), j: here.j };
    from = { i: Math.max(0, Math.min(city.gridSize, here.i - ahead)), j: here.j };
  }
  if (sameNode(from, to)) {
    const opts = neighborNodes(here, city.gridSize);
    to = opts[0] ?? to;
    from = here;
  }
  const next = pickRandomExit(from, to, city.gridSize, rng);
  const start = vec3(x, y, 0);
  // Snap start to the road axis so rightLaneRoute does not double-offset.
  const axis = alongEdge(from, to, city.blockSize * 0.4, city);
  const snapped = ns ? vec3(axis.x, y, 0) : vec3(x, axis.y, 0);
  const path = edgePath(from, to, next, snapped.x === 0 && snapped.y === 0 ? start : snapped, city);
  return {
    fromNode: from,
    toNode: to,
    nextNode: next,
    path,
    pathS: 0,
    stuckTime: 0,
    intersectionsCleared: car.intersectionsCleared,
  };
}

export function sameDirection(a: number, b: number, slop = 0.7): boolean {
  return Math.abs(normalizeAngle(a - b)) < slop;
}
