import { describe, it, expect } from 'vitest';
import { generateCityMap } from '../sim/world';
import { vec3 } from '../sim/math';
import { createEgoState } from '../sim/vehicle';
import {
  snapTripStart,
  resolveTripDestination,
  mergeIntoLaneRoute,
  LANE_OFFSET,
} from '../sim/rightLane';
import { createPlannerState } from './planner';
import {
  buildStackRoute,
  planForStack,
  planWaabiAlongRoute,
  routeFollowCandidate,
  scoreOccupancyCandidates,
  teslaVisionPlannerDetections,
} from './stackPlan';
import { generateCandidateTrajectories, predictFutureOccupancyFromAgents } from '../stacks/waabi';
import type { Entity } from '../sim/types';

function cityLanes() {
  return generateCityMap(3, {
    gridSize: 6,
    blockSize: 100,
    laneWidth: 3.5,
    sidewalkWidth: 2,
  }).lanes;
}

function car(id: number, x: number, y: number): Entity {
  return {
    id,
    classType: 'car',
    transform: { position: vec3(x, y, 0.7), rotation: 0 },
    boundingBox: { center: vec3(x, y, 0.7), size: vec3(4.5, 1.8, 1.5), yaw: 0 },
    velocity: vec3(0, 0, 0),
    isStatic: false,
    occlusionLevel: 0,
  };
}

describe('stack-faithful planning', () => {
  it('Tesla follows the nav polyline (not the HD lane graph)', () => {
    const lanes = cityLanes();
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    const tesla = buildStackRoute({
      stack: 'tesla',
      from: start,
      heading: 0,
      goal: resolved.pad,
      resolved,
      lanes,
    });
    const nav = mergeIntoLaneRoute(start, 0, resolved.pad, LANE_OFFSET, resolved);
    expect(tesla.length).toBe(nav.length);
    expect(tesla[tesla.length - 1]!.x).toBeCloseTo(nav[nav.length - 1]!.x, 5);
    expect(tesla[tesla.length - 1]!.y).toBeCloseTo(nav[nav.length - 1]!.y, 5);
  });

  it('Tesla planner detections are camera-FOV only', () => {
    const ego = createEgoState('car', vec3(50, 96.5, 0), 0);
    const ahead = car(1, 62, 96.5);
    const farBehind = car(2, -40, 96.5);
    const dets = teslaVisionPlannerDetections(ego, [ahead, farBehind]);
    expect(dets.some(d => d.id === 1)).toBe(true);
    expect(dets.some(d => d.id === 2)).toBe(false);
  });

  it('Waymo builds a left from HD lanes; Tesla/Waabi use nav; dest rule is shared', () => {
    const lanes = cityLanes();
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    expect(resolved.opposite).toBe(false);
    for (const stack of ['tesla', 'waymo', 'waabi'] as const) {
      const route = buildStackRoute({
        stack,
        from: start,
        heading: 0,
        goal: resolved.pad,
        resolved,
        lanes,
      });
      expect(Math.min(...route.map(p => p.y))).toBeGreaterThan(90);
      expect(route[route.length - 1]!.y).toBeGreaterThan(100);
    }
  });

  it('Waabi occupancy scoring prefers the dest-route candidate over a U-turn fan', () => {
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    const route = mergeIntoLaneRoute(start, 0, resolved.pad, LANE_OFFSET, resolved);
    const ego = createEgoState('car', start, 0);
    ego.velocity = { x: 6, y: 0, z: 0 };
    const occupancy = predictFutureOccupancyFromAgents([], ego, 1.5, 24);
    const fan = generateCandidateTrajectories(ego, 8, 7);
    const along = routeFollowCandidate(ego, route, 8);
    const scored = scoreOccupancyCandidates([...fan, along], occupancy, ego, route);
    let best = scored[0]!;
    for (const t of scored) if (t.cost < best.cost) best = t;
    const look = best.points[Math.min(8, best.points.length - 1)]!;
    expect(look.position.y).toBeGreaterThan(start.y - 2);
    expect(best.costBreakdown.laneDeviation).toBeLessThanOrEqual(
      Math.min(...scored.map(s => s.costBreakdown.laneDeviation)) + 1e-6,
    );
  });

  it('planForStack Tesla uses vision detections while following the nav left', () => {
    const lanes = cityLanes();
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    const route = buildStackRoute({
      stack: 'tesla', from: start, heading: 0, goal: resolved.pad, resolved, lanes,
    });
    const ego = createEgoState('car', start, 0);
    ego.velocity = { x: 5, y: 0, z: 0 };
    const blocker = car(9, 70, 96.5);
    const { output } = planForStack(
      { egoState: ego, detections: [], route, trafficLightStates: new Map() },
      createPlannerState(),
      { stack: 'tesla', entities: [blocker] },
    );
    expect(output.steering).toBeGreaterThan(-0.2);
    expect(Number.isFinite(output.acceleration)).toBe(true);
  });

  it('planWaabiAlongRoute keeps a left dest and exposes scored candidates', () => {
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    const route = mergeIntoLaneRoute(start, 0, resolved.pad, LANE_OFFSET, resolved);
    const ego = createEgoState('car', start, 0);
    ego.velocity = { x: 6, y: 0, z: 0 };
    const planned = planWaabiAlongRoute(
      { egoState: ego, detections: [], route, trafficLightStates: new Map() },
      createPlannerState(),
      [],
    );
    expect(planned.candidates.length).toBeGreaterThan(3);
    expect(planned.output.selectedTrajectoryIndex).toBe(planned.selectedIndex);
    const look = planned.output.trajectory.points[Math.min(6, planned.output.trajectory.points.length - 1)]!;
    expect(look.position.y).toBeGreaterThan(90);
  });
});
