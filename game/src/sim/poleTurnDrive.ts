import { generateCityMap } from './world';
import { rightLaneRoute } from './rightLane';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import { createPlannerState, planTrajectory } from '../planning/planner';
import { obstacleAhead } from './collision';
import { vec3, vec3Length } from './math';

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };
const DT = 1 / 30;

/** Shared helper from poleTurn.test.ts — planner + obstacleAhead, no perception scheduling. */
export function driveCorner(
  dest: ReturnType<typeof vec3>,
  done: (x: number, y: number) => boolean,
) {
  const map = generateCityMap(3, CITY);
  const roadside = map.staticEntities.filter(e =>
    e.classType === 'pole' || e.classType === 'tree' || e.classType === 'building'
  );
  const route = rightLaneRoute(vec3(0, -80, 0), dest);
  let ego = createEgoState('car', route[0]!, Math.PI / 2);
  ego = { ...ego, bodyVx: 8, velocity: { x: 0, y: 8, z: 0 } };
  let planner = createPlannerState();
  let finished = false;
  let hazardHits = 0;
  let maxStopInBox = 0;
  let stopRun = 0;

  for (let i = 0; i < 30 * 28; i++) {
    const hazard = obstacleAhead(ego, roadside, 45, 2.4);
    if (hazard) hazardHits++;
    const { output, newState } = planTrajectory({
      egoState: ego,
      detections: [],
      route,
      trafficLightStates: new Map(),
    }, planner);
    planner = newState;
    let input = vehicleInputFromAccel(output.acceleration, output.steering);
    if (hazard && (hazard.dist < 8 || (hazard.dist < 18 && vec3Length(ego.velocity) > 4))) {
      input = { ...input, throttle: 0, brake: 1 };
    }
    ego = updateVehicle(ego, input, DT);
    const x = ego.transform.position.x;
    const y = ego.transform.position.y;
    const inBox = Math.abs(x) < 14 && Math.abs(y) < 14;
    if (inBox && vec3Length(ego.velocity) < 0.45) {
      stopRun++;
      maxStopInBox = Math.max(maxStopInBox, stopRun);
    } else {
      stopRun = 0;
    }
    if (done(x, y)) {
      finished = true;
      break;
    }
  }
  return { finished, hazardHits, maxStopInBox, poles: roadside.filter(e => e.classType === 'pole').length };
}

export { CITY };
