import { describe, it, expect } from 'vitest';
import { detectVisibleAgents } from './tesla';
import { vec3 } from '../sim/math';
import type { EgoState, Entity } from '../sim/types';

function ego(): EgoState {
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

function agent(id: number, classType: Entity['classType'], x: number, y: number, occ: 0 | 1 | 2 = 0): Entity {
  return {
    id,
    classType,
    transform: { position: vec3(x, y, 0.9), rotation: 0 },
    boundingBox: { center: vec3(x, y, 0.9), size: vec3(classType === 'pedestrian' ? 0.5 : 4.5, 0.5, 1.7), yaw: 0 },
    velocity: vec3(0, 0, 0),
    isStatic: false,
    occlusionLevel: occ,
  };
}

describe('Tesla vision detector', () => {
  it('detects a visible pedestrian and car ahead inside camera range', () => {
    const dets = detectVisibleAgents(ego(), [
      agent(12, 'pedestrian', 2, 18),
      agent(3, 'car', -3, 25),
    ]);
    expect(dets.some(d => d.classType === 'pedestrian' && d.entityId === 12)).toBe(true);
    expect(dets.some(d => d.classType === 'car' && d.entityId === 3)).toBe(true);
  });

  it('detects a heavily occluded pedestrian with weaker confidence', () => {
    const dets = detectVisibleAgents(ego(), [agent(9, 'pedestrian', 1, 12, 2)]);
    const hit = dets.find(d => d.entityId === 9);
    expect(hit).toBeDefined();
    expect(hit!.confidence).toBeLessThan(0.6);
  });

  it('does not detect an agent behind the car outside rear-camera range mix', () => {
    const dets = detectVisibleAgents(ego(), [agent(4, 'car', 0, -80)]);
    expect(dets.find(d => d.entityId === 4)).toBeUndefined();
  });
});
