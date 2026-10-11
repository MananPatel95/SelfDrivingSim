import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { vec3 } from './math';

describe('manual start without a map trip', () => {
  it('parks the car and gives the driver the wheel with no route', () => {
    const sim = new Simulation({ seed: 3 });
    const before = sim.getState().ego.transform.position;
    sim.beginParked();
    const state = sim.getState();
    expect(state.controlSource).toBe('human');
    expect(state.route).toEqual([]);
    expect(state.ego.transform.position.x).toBeCloseTo(before.x);
    expect(state.ego.transform.position.y).toBeCloseTo(before.y);
    expect(Math.hypot(state.ego.velocity.x, state.ego.velocity.y)).toBe(0);
  });

  it('can park at a chosen point instead', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginParked(vec3(40, -20, 0), 0);
    const ego = sim.getState().ego;
    expect(ego.transform.position.x).toBeCloseTo(40);
    expect(ego.transform.position.y).toBeCloseTo(-20);
    expect(ego.transform.rotation).toBeCloseTo(0);
    expect(sim.getState().controlSource).toBe('human');
  });
});
