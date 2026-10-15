import { describe, it, expect } from 'vitest';
import { updatePedestrian, type Pedestrian } from './world';
import { vec3, SeededRandom } from './math';
import { angleDelta, headingFromVelocity, pedestrianMeshYaw } from './pedestrianVisual';

function pedAt(x: number, y: number, rot: number): Pedestrian {
  return {
    id: 1,
    classType: 'pedestrian',
    transform: { position: vec3(x, y, 0.9), rotation: rot },
    boundingBox: { center: vec3(x, y, 0.9), size: vec3(0.5, 0.5, 1.7), yaw: rot },
    velocity: vec3(Math.cos(rot) * 1.2, Math.sin(rot) * 1.2, 0),
    isStatic: false,
    occlusionLevel: 0,
    targetPosition: vec3(x, y + 10, 0),
    state: 'walking',
    waitTime: 0,
    crossCooldown: 4,
  };
}

describe('pedestrian heading', () => {
  it('keeps transform heading within 10° of atan2(velocity) while walking', () => {
    const rng = new SeededRandom(3);
    let ped = pedAt(8.8, -40, Math.PI / 2);
    for (let i = 0; i < 80; i++) {
      ped = updatePedestrian(ped, [], 1 / 30, rng, []);
      if (ped.state !== 'walking') continue;
      const want = headingFromVelocity(ped.velocity.x, ped.velocity.y, ped.transform.rotation);
      const err = Math.abs(angleDelta(ped.transform.rotation, want)) * (180 / Math.PI);
      expect(err).toBeLessThanOrEqual(10);
    }
  });

  it('maps local +Z to the sim heading in Three.js yaw', () => {
    const yaw = pedestrianMeshYaw(0);
    expect(Math.sin(yaw)).toBeCloseTo(1, 5);
    expect(Math.cos(yaw)).toBeCloseTo(0, 5);
  });
});
