import { describe, it, expect } from 'vitest';
import { snapToRoad, roadRoute } from './world';
import {
  generateCityMap,
  pointOnRoad,
  updatePedestrian,
  shouldYieldToPedestrian,
  approachingCrosswalk,
  type Pedestrian,
} from './world';
import { vec3, SeededRandom } from './math';

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };

function pedAt(x: number, y: number, rot: number, state: Pedestrian['state'] = 'walking'): Pedestrian {
  return {
    id: 1,
    classType: 'pedestrian',
    transform: { position: vec3(x, y, 0.9), rotation: rot },
    boundingBox: { center: vec3(x, y, 0.9), size: vec3(0.5, 0.5, 1.7), yaw: rot },
    velocity: vec3(0, 0, 0),
    isStatic: false,
    occlusionLevel: 0,
    targetPosition: vec3(x, y + 10, 0),
    state,
    waitTime: 0,
    crossCooldown: 0,
  };
}

describe('sidewalk trees and crosswalk pedestrians', () => {
  it('keeps every tree off the asphalt', () => {
    const map = generateCityMap(7, CITY);
    const trees = map.staticEntities.filter(e => e.classType === 'tree');
    expect(trees.length).toBeGreaterThan(10);
    for (const tree of trees) {
      expect(pointOnRoad(tree.transform.position.x, tree.transform.position.y, CITY, 0.4)).toBe(false);
      expect(tree.boundingBox.size.x).toBeLessThan(1.2);
    }
  });

  it('walks the sidewalk and crosses at a junction instead of wandering into the lane', () => {
    const rng = new SeededRandom(3);
    let ped = pedAt(8.8, -12, Math.PI / 2);
    let crossed = false;
    let steppedOnRoadWhileWalking = false;
    for (let i = 0; i < 400; i++) {
      ped = updatePedestrian(ped, [], 1 / 30, rng, []);
      if (ped.state === 'walking' && pointOnRoad(ped.transform.position.x, ped.transform.position.y, CITY, -0.2)) {
        steppedOnRoadWhileWalking = true;
      }
      if (ped.state === 'crossing') crossed = true;
    }
    expect(steppedOnRoadWhileWalking).toBe(false);
    expect(crossed).toBe(true);
  });

  it('waits when a car is closing on the crosswalk, then the car yields once they step out', () => {
    const rng = new SeededRandom(1);
    let ped = pedAt(8.8, -3, Math.PI / 2, 'walking');
    const car = { x: 0, y: -18, vx: 0, vy: 12 };
    for (let i = 0; i < 90; i++) {
      ped = updatePedestrian(ped, [], 1 / 30, rng, [car]);
    }
    expect(ped.state === 'waiting' || ped.state === 'walking').toBe(true);
    expect(approachingCrosswalk(0, 0, [car])).toBe(true);

    ped = { ...ped, state: 'crossing', transform: { ...ped.transform, position: vec3(2, 0, 0.9) } };
    expect(shouldYieldToPedestrian(0, -10, Math.PI / 2, [ped])).toBe(true);
    expect(shouldYieldToPedestrian(0, 12, Math.PI / 2, [ped])).toBe(false);
    const far = pedAt(1.2, 24, 0, 'crossing');
    expect(shouldYieldToPedestrian(0, 0, Math.PI / 2, [far], 20)).toBe(true);
  });

  it('snaps a map click onto a road and routes along the grid', () => {
    const start = snapToRoad(12, -80);
    const end = snapToRoad(210, 15);
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(-80);
    expect(end.x).toBeCloseTo(200);
    const route = roadRoute(start, end);
    expect(route.length).toBeGreaterThan(4);
    expect(route[0]!.x).toBeCloseTo(start.x);
    expect(route[route.length - 1]!.x).toBeCloseTo(end.x);
    expect(route[route.length - 1]!.y).toBeCloseTo(end.y);
    for (const p of route) {
      const onRoad = Math.abs(p.x - Math.round(p.x / 100) * 100) < 1.5
        || Math.abs(p.y - Math.round(p.y / 100) * 100) < 1.5;
      expect(onRoad).toBe(true);
    }
  });
});
