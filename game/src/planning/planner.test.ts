import { describe, it, expect } from 'vitest';
import { createPlannerState, planTrajectory } from './planner';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from '../sim/vehicle';
import { vec3 } from '../sim/math';

/** North on x=0, then along y=0. Asphalt is the 14 m roads around those lines. */
function cornerRoute(direction: 1 | -1) {
  const pts = [];
  for (let y = -80; y <= 0; y += 8) pts.push(vec3(0, y, 0));
  for (let x = 8; x <= 80; x += 8) pts.push(vec3(direction * x, 0, 0));
  return pts;
}

function onAsphalt(x: number, y: number): boolean {
  return Math.abs(x) < 8 || Math.abs(y) < 8;
}

describe('autopilot grid corners', () => {
  it.each([1, -1] as const)('turns %s on the asphalt instead of sweeping onto the grass', (direction) => {
    const route = cornerRoute(direction);
    let ego = createEgoState('car', vec3(0, -80, 0), Math.PI / 2);
    ego = { ...ego, bodyVx: 8, velocity: { x: 0, y: 8, z: 0 } };
    let planner = createPlannerState();
    let leftRoad = false;
    let passedCorner = false;
    let maxNorth = -Infinity;
    const dt = 1 / 30;

    for (let i = 0; i < 30 * 28; i++) {
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
      if (!onAsphalt(x, y)) leftRoad = true;
      if (y > maxNorth) maxNorth = y;
      if (direction * x > 25 && Math.abs(y) < 6) passedCorner = true;
      if (direction * x > 45) break;
    }

    expect(leftRoad).toBe(false);
    expect(maxNorth).toBeLessThan(9);
    expect(passedCorner).toBe(true);
    expect(direction * ego.transform.position.x).toBeGreaterThan(20);
  });
});
