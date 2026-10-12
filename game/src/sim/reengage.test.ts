import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { vec3, vec3Length } from './math';
import { inRightLane, lateralFromCenter } from './rightLane';
import { updateVehicle } from './vehicle';
import { createPlannerState, planTrajectory } from '../planning/planner';

describe('autopilot re-engage', () => {
  it('takeover then re-engage replans from the current pose to the trip destination', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(0, -80, 0), vec3(90, 0, 0), 'policy');
    const dest = sim.getTripDestination();
    expect(dest).not.toBeNull();

    for (let i = 0; i < 18; i++) sim.step(1 / 30);
    expect(sim.getState().controlSource).toBe('policy');

    sim.takeover('other');
    expect(sim.getState().controlSource).toBe('human');
    for (let i = 0; i < 8; i++) {
      sim.step(1 / 30, { throttle: 0.4, steering: -0.15, brake: 0, gtaReverse: true });
    }
    const afterManual = sim.getState().ego.transform.position;

    const result = sim.reengageAutopilot();
    expect(result.mode).toBe('trip');
    expect(sim.getState().controlSource).toBe('policy');
    const start = result.route[0]!;
    expect(Math.hypot(start.x - afterManual.x, start.y - afterManual.y)).toBeLessThan(4);
    const end = result.route[result.route.length - 1]!;
    expect(Math.hypot(end.x - dest!.x, end.y - dest!.y)).toBeLessThan(12);

    for (let i = 0; i < 30; i++) sim.step(1 / 30);
    expect(sim.getState().controlSource).toBe('policy');
    const ego = sim.getState().ego;
    expect(lateralFromCenter(ego.transform.position.x, ego.transform.position.y, ego.transform.rotation))
      .toBeGreaterThan(1.0);
  });

  it('cruises ahead in the right-hand lane when there is no trip', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginParked(vec3(3.5, -80, 0), Math.PI / 2);
    expect(sim.getTripDestination()).toBeNull();
    sim.step(1 / 30, { throttle: 0, steering: 0, brake: 0 });
    expect(sim.getState().controlSource).toBe('human');

    const result = sim.reengageAutopilot();
    expect(result.mode).toBe('cruise');
    expect(result.route.length).toBeGreaterThan(8);
    expect(sim.getState().controlSource).toBe('policy');

    for (let i = 0; i < 40; i++) sim.step(1 / 30);
    const ego = sim.getState().ego;
    expect(inRightLane(ego.transform.position.x, ego.transform.position.y, ego.transform.rotation)).toBe(true);
    expect(vec3Length(ego.velocity)).toBeGreaterThan(1);
  });

  it('still respects stop / yield after re-engage', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(0, -40, 0), vec3(0, 80, 0), 'human');
    sim.takeover('other');
    sim.reengageAutopilot();
    for (let i = 0; i < 8; i++) sim.step(1 / 30);
    const rule = sim.getState().lastRule;
    expect(rule).not.toBeNull();
    expect(typeof rule!.mustStop).toBe('boolean');
    expect(typeof rule!.maxSpeed).toBe('number');
  });
});

describe('merge-into-lane planner follow', () => {
  it('steers back into the right-hand lane from a left-of-lane pose', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginParked(vec3(0.4, -70, 0), Math.PI / 2);
    const result = sim.reengageAutopilot();
    let ego = sim.getState().ego;
    ego = { ...ego, bodyVx: 6, velocity: { x: 0, y: 6, z: 0 } };
    let planner = createPlannerState();
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 12; i++) {
      const { output, newState } = planTrajectory({
        egoState: ego,
        detections: [],
        route: result.route,
        trafficLightStates: new Map(),
      }, planner);
      planner = newState;
      const accel = output.acceleration;
      ego = updateVehicle(ego, {
        throttle: accel > 0 ? accel / 3 : 0,
        steering: output.steering,
        brake: accel < 0 ? -accel / 8 : 0,
      }, dt);
    }
    expect(lateralFromCenter(ego.transform.position.x, ego.transform.position.y, ego.transform.rotation))
      .toBeGreaterThan(1.2);
  });
});
