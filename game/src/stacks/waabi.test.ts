import { describe, it, expect } from 'vitest';
import {
  createBEVOccupancyFromAgents,
  predictFutureOccupancyFromAgents,
} from './waabi';
import { vec3 } from '../sim/math';
import type { EgoState } from '../sim/types';

function egoAtOrigin(): EgoState {
  return {
    vehicleType: 'car',
    transform: { position: vec3(0, 0, 0), rotation: Math.PI / 2 },
    velocity: vec3(0, 8, 0),
    acceleration: vec3(0, 0, 0),
    steering: 0,
    throttle: 0,
    brake: 0,
    mass: 1500,
    stoppingDistance: 10,
  };
}

describe('dense BEV occupancy from agents', () => {
  it('fills a blob of cells for each nearby car and pedestrian', () => {
    const occ = createBEVOccupancyFromAgents(
      [
        { position: vec3(4, 18, 0.7), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2, velocity: vec3(0, 8, 0), confidence: 0.9 },
        { position: vec3(-6, 12, 0.9), size: vec3(0.5, 0.5, 1.7), yaw: 0, velocity: vec3(1, 0, 0), confidence: 0.85 },
        { position: vec3(8, 8, 0.7), size: vec3(4.5, 1.8, 1.5), yaw: 0, velocity: vec3(6, 0, 0), confidence: 0.88 },
      ],
      egoAtOrigin(),
      0.8,
      32,
      0
    );

    let occupied = 0;
    for (const v of occ.grid) if (v > 0.08) occupied++;
    expect(occupied).toBeGreaterThan(40);
    expect(occ.grid.length).toBeGreaterThan(2000);
  });

  it('advances occupancy with predicted motion', () => {
    const agents = [
      { position: vec3(0, 20, 0.7), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2, velocity: vec3(0, 10, 0), confidence: 1 },
    ];
    const future = predictFutureOccupancyFromAgents(agents, egoAtOrigin(), 0.8, 32);

    const peak = (grid: Float32Array) => {
      let best = 0;
      let idx = 0;
      grid.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
      return idx;
    };
    expect(peak(future.t3s.grid)).not.toBe(peak(future.current.grid));
  });
});
