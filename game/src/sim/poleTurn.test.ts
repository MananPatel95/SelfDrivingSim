import { describe, it, expect } from 'vitest';
import { generateCityMap } from './world';
import { rightLaneRoute } from './rightLane';
import { createEgoState, updateVehicle, vehicleInputFromAccel } from './vehicle';
import { createPlannerState, planTrajectory } from '../planning/planner';
import { obstacleAhead } from './collision';
import { vec3, vec3Length } from './math';
import { computeDecision } from '../render/perceptionViz';
import type { Track } from '../stacks/perception';

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };
const DT = 1 / 30;

function driveCorner(
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

describe('intersection turns with corner poles', () => {
  it('places poles at grid corners', () => {
    const map = generateCityMap(3, CITY);
    const poles = map.staticEntities.filter(e => e.classType === 'pole');
    expect(poles.length).toBeGreaterThan(8);
  });

  it('finishes a left turn at an intersection that has a corner pole', () => {
    const r = driveCorner(vec3(-90, 0, 0), (x, y) => x < -30 && Math.abs(y) < 12);
    expect(r.poles).toBeGreaterThan(8);
    expect(r.hazardHits).toBe(0);
    expect(r.finished).toBe(true);
    expect(r.maxStopInBox).toBeLessThan(30 * 2);
  });

  it('finishes a right turn at an intersection that has a corner pole', () => {
    const r = driveCorner(vec3(90, 0, 0), (x, y) => x > 30 && Math.abs(y) < 12);
    expect(r.hazardHits).toBe(0);
    expect(r.finished).toBe(true);
  });

  it('goes straight through an intersection that has a corner pole', () => {
    const r = driveCorner(vec3(0, 90, 0), (_x, y) => y > 30);
    expect(r.hazardHits).toBe(0);
    expect(r.finished).toBe(true);
  });

  it('does not banner-slow for a roadside pole', () => {
    const ego = createEgoState('car', vec3(0, 0, 0), Math.PI / 2);
    ego.velocity = vec3(0, 8, 0);
    const poleTrack: Track = {
      id: 23,
      classType: 'pole',
      box: { center: vec3(7, 2, 1), size: vec3(0.3, 0.3, 8), yaw: 0 },
      velocity: vec3(0, 0, 0),
      age: 4,
      missedFrames: 0,
      confidence: 0.82,
    };
    const decision = computeDecision({
      stack: 'waabi',
      ego,
      tracks: [poleTrack],
      lidarPoints: [],
      agents: [],
      groundTruth: [],
      showGroundTruth: false,
      plannerOutput: null,
      visionDetections: [],
      controlSource: 'policy',
    });
    expect(decision.text).not.toMatch(/pole/i);
  });
});
