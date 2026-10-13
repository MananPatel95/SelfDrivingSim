import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { vec3, vec3Length } from './math';
import { createPlannerState, planTrajectory, remainingRouteDistance } from '../planning/planner';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import { PULL_OVER_OFFSET, lateralFromCenter, tripRoute } from './rightLane';
import { ROUTE_DEST } from '../ui/minimapRoute';

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
