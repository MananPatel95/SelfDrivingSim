import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { normalizeAngle, vec3, vec3Length } from './math';
import { createPlannerState, planTrajectory, remainingRouteDistance } from '../planning/planner';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import {
  PULL_OVER_OFFSET,
  lateralFromCenter,
  pointOnAsphalt,
  sedanCorners,
  snapHeadingToGrid,
  tripRoute,
} from './rightLane';
import { ROUTE_DEST } from '../ui/minimapRoute';
import { computeDecision } from '../render/perceptionViz';

describe('roadside destination arrival', () => {
  it('uses a hot-pink destination colour', () => {
    expect(ROUTE_DEST.toLowerCase()).toBe('#ff2d8a');
  });

  it('stores the pull-over pad as the trip destination', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(0, 22, 0), vec3(0, 78, 0), 'policy');
    const dest = sim.getTripDestination();
    expect(dest).not.toBeNull();
    expect(dest!.x).toBeCloseTo(PULL_OVER_OFFSET, 1);
    expect(dest!.y).toBeCloseTo(78, 0);
    const tail = sim.getState().route[sim.getState().route.length - 1]!;
    expect(tail.x).toBeCloseTo(dest!.x, 5);
    expect(tail.y).toBeCloseTo(dest!.y, 5);
  });

  it('pulls over onto the pad and stops (planner + vehicle, no traffic)', () => {
    const route = tripRoute(vec3(0, 22, 0), vec3(0, 78, 0));
    const dest = route[route.length - 1]!;
    let ego = createEgoState('car', route[0]!, Math.PI / 2);
    let planner = createPlannerState();
    const dt = 1 / 30;
    let leftAsphalt = false;
    for (let i = 0; i < 30 * 22; i++) {
      const { output, newState } = planTrajectory({
        egoState: ego,
        detections: [],
        route,
        trafficLightStates: new Map(),
      }, planner);
      planner = newState;
      ego = updateVehicle(ego, vehicleInputFromAccel(output.acceleration, output.steering), dt);
      const { x, y } = ego.transform.position;
      if (Math.abs(x) > 7.2) leftAsphalt = true;
      if (vec3Length(ego.velocity) < 0.25 && Math.hypot(x - dest.x, y - dest.y) < 4) break;
    }
    const speed = vec3Length(ego.velocity);
    const dist = Math.hypot(ego.transform.position.x - dest.x, ego.transform.position.y - dest.y);
    expect(leftAsphalt).toBe(false);
    expect(speed).toBeLessThan(0.45);
    expect(dist).toBeLessThan(3.5);
    expect(lateralFromCenter(
      ego.transform.position.x,
      ego.transform.position.y,
      ego.transform.rotation,
    )).toBeGreaterThan(5.0);
    expect(remainingRouteDistance(ego, route)).toBeLessThan(6);
  });

  it('parks parallel to the curb with no body over the sidewalk', () => {
    const route = tripRoute(vec3(0, 22, 0), vec3(0, 78, 0));
    const dest = route[route.length - 1]!;
    const roadHeading = snapHeadingToGrid(Math.PI / 2);
    let ego = createEgoState('car', route[0]!, Math.PI / 2);
    let planner = createPlannerState();
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 24; i++) {
      const { output, newState } = planTrajectory({
        egoState: ego,
        detections: [],
        route,
        trafficLightStates: new Map(),
      }, planner);
      planner = newState;
      ego = updateVehicle(ego, vehicleInputFromAccel(output.acceleration, output.steering), dt);
      if (vec3Length(ego.velocity) < 0.2
        && Math.hypot(ego.transform.position.x - dest.x, ego.transform.position.y - dest.y) < 3.2) {
        break;
      }
    }
    const yawErr = Math.abs(normalizeAngle(ego.transform.rotation - roadHeading));
    expect(yawErr).toBeLessThan(5 * Math.PI / 180);
    const corners = sedanCorners(
      ego.transform.position.x,
      ego.transform.position.y,
      ego.transform.rotation,
    );
    for (const c of corners) {
      expect(pointOnAsphalt(c.x, c.y)).toBe(true);
      expect(Math.abs(c.x)).toBeLessThan(7);
    }
    expect(lateralFromCenter(
      ego.transform.position.x,
      ego.transform.position.y,
      ego.transform.rotation,
    )).toBeGreaterThan(4.4);
    expect(lateralFromCenter(
      ego.transform.position.x,
      ego.transform.position.y,
      ego.transform.rotation,
    )).toBeLessThan(6.2);
  });

  it('holds with an Arrived banner after the live sim reaches the pad', () => {
    const sim = new Simulation({ seed: 3, lidarEveryN: 40 });
    sim.getState().trafficVehicles = [];
    sim.getState().pedestrians = [];
    sim.beginTrip(vec3(0, 58, 0), vec3(0, 78, 0), 'policy');
    for (let i = 0; i < 30 * 10; i++) {
      sim.step(1 / 30);
      if (sim.hasArrived() && vec3Length(sim.getState().ego.velocity) < 0.25) break;
    }
    expect(sim.hasArrived()).toBe(true);
    expect(sim.getState().lastRule?.reason).toBe('Arrived');
    expect(vec3Length(sim.getState().ego.velocity)).toBeLessThan(0.35);
    const yawErr = Math.abs(normalizeAngle(
      sim.getState().ego.transform.rotation - snapHeadingToGrid(sim.getTripHeading()),
    ));
    expect(yawErr).toBeLessThan(5 * Math.PI / 180);
    for (const c of sedanCorners(
      sim.getState().ego.transform.position.x,
      sim.getState().ego.transform.position.y,
      sim.getState().ego.transform.rotation,
    )) {
      expect(pointOnAsphalt(c.x, c.y)).toBe(true);
      expect(Math.abs(c.x)).toBeLessThan(7);
    }
    const banner = computeDecision({
      stack: 'tesla',
      ego: sim.getState().ego,
      tracks: [],
      lidarPoints: [],
      agents: [],
      groundTruth: [],
      showGroundTruth: false,
      plannerOutput: sim.getState().lastPlannerOutput,
      visionDetections: [],
      controlSource: 'policy',
      rule: sim.getState().lastRule,
    });
    expect(banner.text).toBe('Arrived');
    const x = sim.getState().ego.transform.position.x;
    const y = sim.getState().ego.transform.position.y;
    for (let i = 0; i < 20; i++) sim.step(1 / 30);
    expect(sim.hasArrived()).toBe(true);
    expect(vec3Length(sim.getState().ego.velocity)).toBeLessThan(0.2);
    expect(Math.hypot(
      sim.getState().ego.transform.position.x - x,
      sim.getState().ego.transform.position.y - y,
    )).toBeLessThan(0.4);
  });

  it('hands the roadside pad to the live planner on beginTrip', () => {
    const sim = new Simulation({ seed: 3, lidarEveryN: 40 });
    sim.getState().trafficVehicles = [];
    sim.getState().pedestrians = [];
    sim.beginTrip(vec3(0, 48, 0), vec3(0, 78, 0), 'policy');
    const dest = sim.getTripDestination()!;
    const before = sim.getState().ego.transform.position;
    for (let i = 0; i < 45; i++) sim.step(1 / 30);
    const ego = sim.getState().ego;
    expect(sim.getState().controlSource).toBe('policy');
    expect(ego.transform.position.y).toBeGreaterThan(before.y + 2);
    expect(vec3Length(ego.velocity)).toBeGreaterThan(1);
    expect(Math.hypot(
      sim.getState().route[sim.getState().route.length - 1]!.x - dest.x,
      sim.getState().route[sim.getState().route.length - 1]!.y - dest.y,
    )).toBeLessThan(1);
  });
});
