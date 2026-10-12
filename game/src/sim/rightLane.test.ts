import { describe, it, expect } from 'vitest';
import { generateCityMap } from './world';
import { vec3 } from './math';
import { createPlannerState, planTrajectory } from '../planning/planner';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import {
  LANE_OFFSET,
  inRightLane,
  lateralFromCenter,
  placeInRightLane,
  rightLaneRoute,
  straddlesCenter,
  turnKind,
} from './rightLane';

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };

describe('right-hand traffic lanes', () => {
  it('places northbound traffic to +X and eastbound to −Y of the yellow line', () => {
    expect(placeInRightLane(2, -40, Math.PI / 2).x).toBeCloseTo(LANE_OFFSET);
    expect(placeInRightLane(12, 3, 0).y).toBeCloseTo(-LANE_OFFSET);
    expect(lateralFromCenter(3.5, -40, Math.PI / 2)).toBeCloseTo(LANE_OFFSET);
    expect(inRightLane(3.5, -40, Math.PI / 2)).toBe(true);
    expect(straddlesCenter(0.2, -40, Math.PI / 2)).toBe(true);
    expect(turnKind(Math.PI / 2, 0)).toBe('right');
    expect(turnKind(Math.PI / 2, Math.PI)).toBe('left');
  });

  it('keeps generated driving lanes in the right-hand offset', () => {
    const map = generateCityMap(3, CITY);
    const driving = map.lanes.filter(l => l.type === 'driving');
    expect(driving.length).toBeGreaterThan(8);
    for (const lane of driving) {
      const mid = lane.points[Math.floor(lane.points.length / 2)]!;
      expect(inRightLane(mid.position.x, mid.position.y, mid.direction)).toBe(true);
      expect(straddlesCenter(mid.position.x, mid.position.y, mid.direction)).toBe(false);
    }
  });

  it('routes a Manhattan trip in the right-hand lane, tight right and wide left', () => {
    const start = vec3(0, -80, 0);
    const end = vec3(80, 0, 0);
    const route = rightLaneRoute(start, end);
    expect(route.length).toBeGreaterThan(6);
    for (const p of route) {
      const nearCorner = Math.abs(p.x) < 12 && Math.abs(p.y) < 12;
      if (nearCorner) continue;
      const heading = Math.abs(p.x) > Math.abs(p.y) ? 0 : Math.PI / 2;
      expect(straddlesCenter(p.x, p.y, heading)).toBe(false);
      expect(inRightLane(p.x, p.y, heading)).toBe(true);
    }
    const corner = route.find(p => Math.abs(p.x) < 10 && Math.abs(p.y) < 10);
    expect(corner).toBeDefined();
    // Right turn from north onto east meets at +X −Y of the intersection.
    expect(corner!.x).toBeGreaterThan(2);
    expect(corner!.y).toBeLessThan(-2);
  });

  it('keeps the ego in the right-hand lane on a straight and through a right turn', () => {
    const route = rightLaneRoute(vec3(0, -80, 0), vec3(90, 0, 0));
    let ego = createEgoState('car', route[0]!, Math.PI / 2);
    ego = { ...ego, bodyVx: 6, velocity: { x: 0, y: 6, z: 0 } };
    let planner = createPlannerState();
    let leftLane = false;
    let turned = false;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 22; i++) {
      const { output, newState } = planTrajectory({
        egoState: ego,
        detections: [],
        route,
        trafficLightStates: new Map(),
      }, planner);
      planner = newState;
      const accel = output.acceleration;
      ego = updateVehicle(ego, vehicleInputFromAccel(accel, output.steering), dt);
      const x = ego.transform.position.x;
      const y = ego.transform.position.y;
      const yaw = ego.transform.rotation;
      const onStraight = y < -30 || x > 45;
      if (onStraight && !inRightLane(x, y, yaw)) leftLane = true;
      if (x > 25 && Math.abs(y) < 8) turned = true;
      if (x > 70) break;
    }
    expect(leftLane).toBe(false);
    expect(turned).toBe(true);
    expect(lateralFromCenter(ego.transform.position.x, ego.transform.position.y, ego.transform.rotation)).toBeGreaterThan(1.2);
  });
});
