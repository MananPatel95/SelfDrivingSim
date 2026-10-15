import { describe, it, expect } from 'vitest';
import { generateCityMap, nearestGridLine } from './world';
import { normalizeAngle, vec3 } from './math';
import { createPlannerState, planTrajectory } from '../planning/planner';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import {
  CURB_CLEARANCE,
  DEST_PAD_ALONG_CLEAR,
  LANE_OFFSET,
  PAD_ALONG,
  PAD_JUNCTION_GAP,
  PAD_WIDTH,
  PULL_OVER_OFFSET,
  ROAD_HALF,
  SPAWN_INTERSECTION_CLEAR,
  isValidLaneSpawn,
  snapHeadingToGrid,
  snapTripStart,
  SEDAN_HALF_WIDTH,
  distanceToRightCurb,
  inRightLane,
  lateralFromCenter,
  mergeIntoLaneRoute,
  onArrivalAsphalt,
  placeInRightLane,
  roadsideDestination,
  resolveTripDestination,
  rightLaneRoute,
  sedanCorners,
  straddlesCenter,
  tripRoute,
  turnKind,
} from './rightLane';
import type { Vec3 } from './types';

function routeLength(route: Vec3[]): number {
  let d = 0;
  for (let i = 1; i < route.length; i++) {
    d += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  }
  return d;
}

/** Cardinal heading changes along a route. A 180° flip is a U-turn. */
function cardinalTurns(route: Vec3[]): Array<'left' | 'right' | 'uturn'> {
  const cards: number[] = [];
  for (let i = 1; i < route.length; i++) {
    const dx = route[i]!.x - route[i - 1]!.x;
    const dy = route[i]!.y - route[i - 1]!.y;
    if (dx * dx + dy * dy < 1.4) continue;
    const h = snapHeadingToGrid(Math.atan2(dy, dx));
    const prev = cards[cards.length - 1];
    if (prev == null || Math.abs(normalizeAngle(h - prev)) > 0.5) cards.push(h);
  }
  const turns: Array<'left' | 'right' | 'uturn'> = [];
  for (let i = 1; i < cards.length; i++) {
    const d = normalizeAngle(cards[i]! - cards[i - 1]!);
    if (Math.abs(d) > 2.4) turns.push('uturn');
    else if (d > 0.5) turns.push('left');
    else if (d < -0.5) turns.push('right');
  }
  return turns;
}

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };

describe('right-hand traffic lanes', () => {
  it('places northbound traffic to +X and eastbound to −Y of the yellow line', () => {
    expect(placeInRightLane(2, -40, Math.PI / 2).x).toBeCloseTo(LANE_OFFSET);
    expect(placeInRightLane(12, 3, 0).y).toBeCloseTo(-LANE_OFFSET);
    expect(lateralFromCenter(3.5, -40, Math.PI / 2)).toBeCloseTo(LANE_OFFSET);
    expect(inRightLane(3.5, -40, Math.PI / 2)).toBe(true);
    expect(straddlesCenter(0.2, -40, Math.PI / 2)).toBe(true);
    expect(turnKind(Math.PI / 2, 0)).toBe('right');
    expect(turnKind(Math.PI / 2, Math.PI)).toBe('left');
  });

  it('keeps generated driving lanes in the right-hand offset', () => {
    const map = generateCityMap(3, CITY);
    const driving = map.lanes.filter(l => l.type === 'driving');
    expect(driving.length).toBeGreaterThan(8);
    for (const lane of driving) {
      const mid = lane.points[Math.floor(lane.points.length / 2)]!;
      expect(inRightLane(mid.position.x, mid.position.y, mid.direction)).toBe(true);
      expect(straddlesCenter(mid.position.x, mid.position.y, mid.direction)).toBe(false);
    }
  });

  it('routes a Manhattan trip in the right-hand lane, tight right and wide left', () => {
    const start = vec3(0, -80, 0);
    const end = vec3(80, 0, 0);
    const route = rightLaneRoute(start, end);
    expect(route.length).toBeGreaterThan(6);
    for (const p of route) {
      const nearCorner = Math.abs(p.x) < 12 && Math.abs(p.y) < 12;
      if (nearCorner) continue;
      const heading = Math.abs(p.x) > Math.abs(p.y) ? 0 : Math.PI / 2;
      expect(straddlesCenter(p.x, p.y, heading)).toBe(false);
      expect(inRightLane(p.x, p.y, heading)).toBe(true);
    }
    const corner = route.find(p => Math.abs(p.x) < 10 && Math.abs(p.y) < 10);
    expect(corner).toBeDefined();
    // Right turn from north onto east meets at +X −Y of the intersection.
    expect(corner!.x).toBeGreaterThan(2);
    expect(corner!.y).toBeLessThan(-2);
  });

  it('keeps the ego in the right-hand lane on a straight and through a right turn', () => {
    const route = rightLaneRoute(vec3(0, -80, 0), vec3(90, 0, 0));
    let ego = createEgoState('car', route[0]!, Math.PI / 2);
    ego = { ...ego, bodyVx: 6, velocity: { x: 0, y: 6, z: 0 } };
    let planner = createPlannerState();
    let leftLane = false;
    let turned = false;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 22; i++) {
      const { output, newState } = planTrajectory({
        egoState: ego,
        detections: [],
        route,
        trafficLightStates: new Map(),
      }, planner);
      planner = newState;
      const accel = output.acceleration;
      ego = updateVehicle(ego, vehicleInputFromAccel(accel, output.steering), dt);
      const x = ego.transform.position.x;
      const y = ego.transform.position.y;
      const yaw = ego.transform.rotation;
      const onStraight = y < -30 || x > 45;
      if (onStraight && !inRightLane(x, y, yaw)) leftLane = true;
      if (x > 25 && Math.abs(y) < 8) turned = true;
      if (x > 70) break;
    }
    expect(leftLane).toBe(false);
    expect(turned).toBe(true);
    expect(lateralFromCenter(ego.transform.position.x, ego.transform.position.y, ego.transform.rotation)).toBeGreaterThan(1.2);
  });

  it('merges from an off-lane pose into a right-hand trip', () => {
    const from = vec3(0.2, -70, 0);
    const route = mergeIntoLaneRoute(from, Math.PI / 2, vec3(90, 0, 0));
    expect(route.length).toBeGreaterThan(10);
    expect(Math.hypot(route[0]!.x - from.x, route[0]!.y - from.y)).toBeLessThan(1);
    const tail = route[route.length - 1]!;
    expect(tail.x).toBeGreaterThan(70);
    const dest = route[route.length - 1]!;
    const settled = route.slice(9).filter((p) => {
      const nearCorner = Math.abs(p.x - nearestGridLine(p.x)) < 12 && Math.abs(p.y - nearestGridLine(p.y)) < 12;
      const nearDest = Math.hypot(p.x - dest.x, p.y - dest.y) < 24;
      return !nearCorner && !nearDest;
    });
    expect(settled.length).toBeGreaterThan(3);
    for (const p of settled) {
      const heading = Math.abs(p.x - nearestGridLine(p.x)) <= Math.abs(p.y - nearestGridLine(p.y))
        ? Math.PI / 2
        : 0;
      expect(inRightLane(p.x, p.y, heading)).toBe(true);
    }
  });

  it('places the trip destination on the right-hand curb, not in the driving lane', () => {
    const north = roadsideDestination(vec3(0, 80, 0), Math.PI / 2);
    expect(north.x).toBeCloseTo(PULL_OVER_OFFSET);
    expect(north.y).toBeCloseTo(80);
    const east = roadsideDestination(vec3(50, 0, 0), 0);
    expect(east.y).toBeCloseTo(-PULL_OVER_OFFSET);
    expect(east.x).toBeCloseTo(50);
  });

  it('slides a destination out of an intersection before parking', () => {
    const pad = roadsideDestination(vec3(0, 4, 0), Math.PI / 2);
    expect(Math.abs(pad.x - nearestGridLine(pad.x))).toBeGreaterThan(4);
    expect(pad.y).toBeLessThan(-10);
    expect(pad.x).toBeCloseTo(PULL_OVER_OFFSET, 0);
  });

  it('ends a trip route pulled over at the roadside pad', () => {
    const route = tripRoute(vec3(0, 20, 0), vec3(0, 80, 0));
    const tail = route[route.length - 1]!;
    expect(tail.x).toBeCloseTo(PULL_OVER_OFFSET, 1);
    expect(tail.y).toBeCloseTo(80, 0);
    const mid = route[Math.floor(route.length / 2)]!;
    expect(mid.x).toBeLessThan(tail.x);
    expect(inRightLane(mid.x, mid.y, Math.PI / 2)).toBe(true);
  });

  it('keeps the parked sedan ~0.3 m off the curb on every heading', () => {
    expect(PULL_OVER_OFFSET).toBeCloseTo(ROAD_HALF - CURB_CLEARANCE - SEDAN_HALF_WIDTH);
    expect(PAD_WIDTH).toBeCloseTo(2 * (ROAD_HALF - PULL_OVER_OFFSET));
    const poses: Array<{ x: number; y: number; yaw: number }> = [
      { x: PULL_OVER_OFFSET, y: 40, yaw: Math.PI / 2 },
      { x: -PULL_OVER_OFFSET, y: 78, yaw: -Math.PI / 2 },
      { x: 50, y: -PULL_OVER_OFFSET, yaw: 0 },
      { x: -50, y: PULL_OVER_OFFSET, yaw: Math.PI },
    ];
    for (const pose of poses) {
      const corners = sedanCorners(pose.x, pose.y, pose.yaw);
      for (const c of corners) {
        expect(onArrivalAsphalt(c.x, c.y, pose.yaw)).toBe(true);
        expect(distanceToRightCurb(c.x, c.y, pose.yaw)).toBeGreaterThan(0.12);
      }
      const rightGap = Math.min(...corners.map((c) => distanceToRightCurb(c.x, c.y, pose.yaw)));
      expect(rightGap).toBeCloseTo(CURB_CLEARANCE, 2);
      const padOuter = lateralFromCenter(pose.x, pose.y, pose.yaw) + PAD_WIDTH / 2;
      expect(padOuter).toBeCloseTo(ROAD_HALF, 5);
    }
  });

  it('eastbound asphalt follows the Y curb — |x|<7 is the wrong oracle', () => {
    const dest = roadsideDestination(vec3(50, 0, 0), 0);
    expect(dest.y).toBeCloseTo(-PULL_OVER_OFFSET);
    const corners = sedanCorners(dest.x, dest.y, 0);
    for (const c of corners) {
      expect(Math.abs(c.x)).toBeGreaterThan(7);
      expect(onArrivalAsphalt(c.x, c.y, 0)).toBe(true);
      expect(distanceToRightCurb(c.x, c.y, 0)).toBeGreaterThan(0.12);
    }
    const overCurb = sedanCorners(50, -(ROAD_HALF + 0.4), 0);
    const rightmost = overCurb.reduce((a, b) => (
      distanceToRightCurb(a.x, a.y, 0) < distanceToRightCurb(b.x, b.y, 0) ? a : b
    ));
    expect(onArrivalAsphalt(rightmost.x, rightmost.y, 0)).toBe(false);
    expect(distanceToRightCurb(rightmost.x, rightmost.y, 0)).toBeLessThan(0);
  });

  it('snaps an opposite-side click onto the left curb and arrives heading south', () => {
    const resolved = resolveTripDestination(vec3(0, 22, 0), vec3(-4.5, 78, 0));
    expect(resolved.opposite).toBe(true);
    expect(resolved.pad.x).toBeCloseTo(-PULL_OVER_OFFSET, 1);
    expect(resolved.arrivalHeading).toBeCloseTo(-Math.PI / 2, 5);
    const route = tripRoute(vec3(0, 22, 0), vec3(-4.5, 78, 0));
    const tail = route[route.length - 1]!;
    expect(tail.x).toBeCloseTo(-PULL_OVER_OFFSET, 1);
    expect(tail.y).toBeCloseTo(78, 0);
    const prev = route[route.length - 2]!;
    expect(tail.y).toBeLessThan(prev.y);
    expect(Math.max(...route.map(p => p.y))).toBeGreaterThan(95);
  });

  it('takes exactly one left and no U-turn when the dest is one left away', () => {
    const start = snapTripStart(50, 100, 0);
    const end = vec3(103.5, 140, 0);
    const resolved = resolveTripDestination(start, end);
    expect(resolved.opposite).toBe(false);
    expect(resolved.arrivalHeading).toBeCloseTo(Math.PI / 2, 5);
    expect(resolved.pad.x).toBeCloseTo(100 + PULL_OVER_OFFSET, 1);
    expect(resolved.pad.y).toBeCloseTo(140, 0);

    const route = tripRoute(start, end);
    const turns = cardinalTurns(route);
    expect(turns.filter(t => t === 'left')).toHaveLength(1);
    expect(turns.filter(t => t === 'right')).toHaveLength(0);
    expect(turns.filter(t => t === 'uturn')).toHaveLength(0);
    expect(Math.max(...route.map(p => p.y))).toBeLessThan(resolved.pad.y + 8);
    expect(Math.min(...route.map(p => p.y))).toBeGreaterThan(90);

    const manhattan = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    // Left at the corner stays near Manhattan. A U-turn + right adds a full extra block.
    expect(routeLength(route)).toBeLessThan(manhattan + 55);
    expect(routeLength(route)).toBeLessThan(manhattan + 100);
  });

  it('keeps a just-around-the-corner left dest on the far arm, not a loop', () => {
    const start = snapTripStart(50, 100, 0);
    const end = vec3(104, 110, 0);
    const resolved = resolveTripDestination(start, end);
    expect(resolved.opposite).toBe(false);
    expect(resolved.pad.y).toBeGreaterThan(100);
    expect(resolved.pad.x).toBeCloseTo(100 + PULL_OVER_OFFSET, 1);
    const route = tripRoute(start, end);
    const turns = cardinalTurns(route);
    expect(turns).toEqual(['left']);
    expect(Math.min(...route.map(p => p.y))).toBeGreaterThan(90);
    expect(Math.max(...route.map(p => p.y))).toBeLessThan(resolved.pad.y + 8);
  });

  it('parks a corner left dest in the curb lane, 12 m past poles, signs, and crosswalks', () => {
    const start = snapTripStart(50, 100, 0);
    const end = vec3(104, 110, 0);
    const resolved = resolveTripDestination(start, end);
    const ix = 100;
    const iy = 100;
    expect(resolved.opposite).toBe(false);
    expect(resolved.arrivalHeading).toBeCloseTo(Math.PI / 2, 5);
    expect(resolved.pad.x).toBeCloseTo(ix + PULL_OVER_OFFSET, 5);
    expect(resolved.pad.y).toBeCloseTo(iy + DEST_PAD_ALONG_CLEAR, 5);

    const nearEdge = resolved.pad.y - PAD_ALONG / 2;
    expect(nearEdge).toBeGreaterThanOrEqual(iy + ROAD_HALF + PAD_JUNCTION_GAP - 0.01);
    expect(lateralFromCenter(resolved.pad.x, resolved.pad.y, resolved.arrivalHeading))
      .toBeCloseTo(PULL_OVER_OFFSET, 5);

    const halfAlong = PAD_ALONG / 2;
    const halfLat = PAD_WIDTH / 2;
    const padHits = (x: number, y: number, r = 0.2) => (
      x >= resolved.pad.x - halfLat - r
      && x <= resolved.pad.x + halfLat + r
      && y >= resolved.pad.y - halfAlong - r
      && y <= resolved.pad.y + halfAlong + r
    );

    const map = generateCityMap(3, CITY);
    const furniture = map.staticEntities.filter(e => (
      e.classType === 'pole' || e.classType === 'stop_sign' || e.classType === 'yield_sign'
    ));
    expect(furniture.some(e => (
      Math.abs(e.transform.position.x - ix) < 14 && Math.abs(e.transform.position.y - iy) < 14
    ))).toBe(true);
    for (const e of furniture) {
      expect(padHits(e.transform.position.x, e.transform.position.y)).toBe(false);
    }

    // Visual lamps / painted bars sit ~9–10 m off the crossing (main.ts city roads).
    const lamp = ROAD_HALF + 2;
    const walk = ROAD_HALF + 2.2;
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      expect(padHits(ix + dx * lamp, iy + dy * lamp)).toBe(false);
    }
    for (const s of [-3, 0, 3]) {
      expect(padHits(ix + s * 0.9, iy + walk)).toBe(false);
      expect(padHits(ix + walk, iy + s * 0.9)).toBe(false);
    }

    const opposite = resolveTripDestination(vec3(0, 22, 0), vec3(-4.5, 78, 0));
    expect(opposite.opposite).toBe(true);
    expect(opposite.pad.y).toBeCloseTo(78, 0);
  });

  it('does not loop for a cross-street dest that used to look opposite', () => {
    const start = snapTripStart(50, 100, 0);
    const end = vec3(103.5, 80, 0);
    const resolved = resolveTripDestination(start, end);
    expect(resolved.opposite).toBe(false);
    const route = tripRoute(start, end);
    expect(cardinalTurns(route)).toEqual(['right']);
    expect(Math.min(...route.map(p => p.y))).toBeGreaterThan(70);
  });

  it('routes left, right, and straight without a U-turn', () => {
    const leftStart = snapTripStart(50, 100, 0);
    const left = tripRoute(leftStart, vec3(103.5, 140, 0));
    expect(cardinalTurns(left)).toEqual(['left']);

    const rightStart = snapTripStart(50, 100, 0);
    const right = tripRoute(rightStart, vec3(96.5, 60, 0));
    expect(resolveTripDestination(rightStart, vec3(96.5, 60, 0)).opposite).toBe(false);
    expect(cardinalTurns(right)).toEqual(['right']);
    expect(Math.min(...right.map(p => p.y))).toBeGreaterThan(50);

    const straightStart = vec3(LANE_OFFSET, -50, 0);
    const straight = tripRoute(straightStart, vec3(3.5, 40, 0));
    expect(resolveTripDestination(straightStart, vec3(3.5, 40, 0)).opposite).toBe(false);
    expect(cardinalTurns(straight)).toEqual([]);
    expect(straight[straight.length - 1]!.x).toBeCloseTo(PULL_OVER_OFFSET, 1);
  });

  it('snaps a start click into a mid-block right-hand lane, off the stop line', () => {
    const nearSign = snapTripStart(8.2, -10, Math.PI / 2);
    expect(isValidLaneSpawn(nearSign.x, nearSign.y, Math.PI / 2)).toBe(true);
    expect(nearSign.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(Math.abs(nearSign.y)).toBeGreaterThanOrEqual(SPAWN_INTERSECTION_CLEAR - 0.01);
    const mid = snapTripStart(4, -50, Math.PI / 2);
    expect(mid.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(mid.y).toBeCloseTo(-50, 5);
    expect(isValidLaneSpawn(mid.x, mid.y, Math.PI / 2)).toBe(true);
  });
});
