import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { normalizeAngle, vec3, vec3Length } from './math';
import { createPlannerState, planTrajectory } from '../planning/planner';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import {
  snapHeadingToGrid,
  snapTripStart,
  resolveTripDestination,
} from './rightLane';
import { computeDecision } from '../render/perceptionViz';
import type { StackProfile } from '../ui/viewCopy';

const STACKS: Array<{ stack: StackProfile; label: string }> = [
  { stack: 'tesla', label: 'F1 Tesla' },
  { stack: 'waymo', label: 'F2 Waymo' },
  { stack: 'waabi', label: 'F3 Waabi' },
];

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

function startLeftTrip(): Simulation {
  const sim = new Simulation({ seed: 3, lidarEveryN: 80 });
  sim.getState().trafficVehicles = [];
  sim.getState().pedestrians = [];
  const start = snapTripStart(50, 100, 0);
  sim.beginTrip(start, vec3(104, 110, 0), 'policy');
  return sim;
}

describe('live left turn — each stack keeps the dest left', () => {
  it('beginTrip hands the planner a one-left route, not a U-turn+right', () => {
    const sim = startLeftTrip();
    const start = snapTripStart(50, 100, 0);
    const resolved = resolveTripDestination(start, vec3(104, 110, 0));
    expect(resolved.opposite).toBe(false);
    expect(cardinalTurns(sim.getState().route)).toEqual(['left']);
    expect(Math.min(...sim.getState().route.map(p => p.y))).toBeGreaterThan(90);
    expect(sim.getTripDestination()!.y).toBeGreaterThan(100);
  });

  it.each(STACKS)('$label beginTrip is still one left after setPlannerStack', ({ stack }) => {
    const sim = new Simulation({ seed: 3, lidarEveryN: 80 });
    sim.getState().trafficVehicles = [];
    sim.getState().pedestrians = [];
    sim.setPlannerStack(stack);
    const start = snapTripStart(50, 100, 0);
    sim.beginTrip(start, vec3(104, 110, 0), 'policy');
    expect(sim.getPlannerStack()).toBe(stack);
    expect(cardinalTurns(sim.getState().route)).toEqual(['left']);
    expect(Math.min(...sim.getState().route.map(p => p.y))).toBeGreaterThan(90);
    expect(sim.getTripDestination()!.y).toBeGreaterThan(100);
  });

  it('re-engage keeps the original left and does not rebuild a U-turn from the pad', () => {
    const sim = startLeftTrip();
    const again = sim.reengageAutopilot();
    expect(again.mode).toBe('trip');
    expect(cardinalTurns(again.route)).toEqual(['left']);
    expect(Math.min(...sim.getState().route.map(p => p.y))).toBeGreaterThan(90);
  });

  it('the live planner + vehicle take the single left (the path every stack follows)', () => {
    const sim = startLeftTrip();
    const route = sim.getState().route;
    expect(cardinalTurns(route)).toEqual(['left']);
    let ego = createEgoState('car', route[0]!, 0);
    ego = { ...ego, bodyVx: 6, velocity: { x: 6, y: 0, z: 0 } };
    let planner = createPlannerState();
    const dt = 1 / 30;
    let tookLeft = false;
    let wentSouth = false;
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
      const yaw = ego.transform.rotation;
      if (y < 88) wentSouth = true;
      if (y > 102 && yaw > 0.85 && x > 90) {
        tookLeft = true;
        break;
      }
    }
    expect(wentSouth).toBe(false);
    expect(tookLeft).toBe(true);
    expect(vec3Length(ego.velocity)).toBeGreaterThan(0.4);
  });

  it.each(STACKS)('$label uses that same one-left driving route', ({ stack }) => {
    const sim = startLeftTrip();
    const route = sim.getState().route;
    expect(cardinalTurns(route)).toEqual(['left']);
    expect(sim.getState().controlSource).toBe('policy');

    const mid = route.find(p => p.y > 100 && p.x > 98) ?? route[Math.floor(route.length / 2)]!;
    const ego = createEgoState('car', mid, Math.PI / 2 * 0.7);
    ego.velocity = { x: 2.2, y: 4.5, z: 0 };
    const decision = computeDecision({
      stack,
      ego,
      tracks: [],
      lidarPoints: [],
      agents: [],
      groundTruth: [],
      showGroundTruth: false,
      plannerOutput: {
        trajectory: { points: [], timestamps: [], velocities: [] },
        acceleration: 0.4,
        steering: 0.35,
      },
      visionDetections: [],
      controlSource: 'policy',
    });
    expect(decision.text).not.toMatch(/arrived/i);
    expect(Math.min(...route.map(p => p.y))).toBeGreaterThan(90);
    expect(sim.getTripDestination()!.x).toBeGreaterThan(100);
  });
});
