import { describe, it, expect } from 'vitest';
import { generateCityMap } from '../sim/world';
import { vec3 } from '../sim/math';
import {
  snapHeadingToGrid,
  snapTripStart,
  resolveTripDestination,
  LANE_OFFSET,
  PULL_OVER_OFFSET,
} from '../sim/rightLane';
import { normalizeAngle } from '../sim/math';
import {
  closestHeadingLane,
  drivingLanes,
  laneGraphRoute,
  lanesMeet,
  minDistToLane,
} from './laneGraph';

function cardinalTurns(route: Array<{ x: number; y: number }>): Array<'left' | 'right' | 'uturn'> {
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

function cityLanes() {
  return generateCityMap(3, {
    gridSize: 6,
    blockSize: 100,
    laneWidth: 3.5,
    sidewalkWidth: 2,
  }).lanes;
}

describe('HD-map lane graph', () => {
  it('picks the heading-matched right-hand driving lane', () => {
    const lanes = cityLanes();
    const start = snapTripStart(50, 100, 0);
    const lane = closestHeadingLane(lanes, start, 0);
    expect(lane).toBeTruthy();
    expect(lane!.type).toBe('driving');
    expect(Math.abs(normalizeAngle(lane!.points[0]!.direction - 0))).toBeLessThan(0.2);
    expect(minDistToLane(lane!, start)).toBeLessThan(1.2);
  });

  it('meets eastbound and northbound lanes at the wide left corner', () => {
    const lanes = drivingLanes(cityLanes());
    const east = closestHeadingLane(lanes, vec3(50, 100 - LANE_OFFSET, 0), 0)!;
    const north = closestHeadingLane(lanes, vec3(100 + LANE_OFFSET, 110, 0), Math.PI / 2)!;
    const meet = lanesMeet(east, north);
    expect(meet.x).toBeCloseTo(100 + LANE_OFFSET, 1);
    expect(meet.y).toBeCloseTo(100 - LANE_OFFSET, 1);
  });

  it('routes a cross-street left on HD lanes without a U-turn', () => {
    const lanes = cityLanes();
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    expect(resolved.opposite).toBe(false);
    const route = laneGraphRoute(lanes, start, 0, resolved, resolved.pad);
    expect(cardinalTurns(route)).toEqual(['left']);
    expect(Math.min(...route.map(p => p.y))).toBeGreaterThan(90);
    expect(route[route.length - 1]!.x).toBeCloseTo(100 + PULL_OVER_OFFSET, 1);
    const body = route.slice(8, Math.max(10, route.length - 12));
    const driving = drivingLanes(lanes);
    const off = body.filter(p => driving.every(l => minDistToLane(l, p) > 2.8));
    expect(off.length).toBeLessThan(6);
  });

  it('keeps the #33 same-street opposite U-turn', () => {
    const lanes = cityLanes();
    const start = vec3(LANE_OFFSET, 22, 0);
    const resolved = resolveTripDestination(start, vec3(-4.5, 78, 0));
    expect(resolved.opposite).toBe(true);
    const route = laneGraphRoute(lanes, start, Math.PI / 2, resolved, resolved.pad);
    // Legal box U-turn is two lefts in cardinal samples (not a mid-block 180).
    expect(cardinalTurns(route).filter(t => t === 'left').length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...route.map(p => p.y))).toBeGreaterThan(95);
    expect(route[route.length - 1]!.x).toBeCloseTo(-PULL_OVER_OFFSET, 1);
  });
});
