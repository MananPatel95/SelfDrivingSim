import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { vec3 } from './math';
import {
  LANE_OFFSET,
  inRightLane,
  isValidLaneSpawn,
  snapTripStart,
} from './rightLane';
import {
  STOP_STUCK_RECOVER,
  isOffLane,
  isOffPath,
  recoveryFinished,
  reverseAnchor,
  reverseRejoinInput,
  shouldStartRecovery,
} from './recovery';
import { STOP_SIGN_DWELL, stopWayClear } from './intersectionRules';

describe('spawn validity', () => {
  it('places beginTrip on a valid right-hand lane, not the sidewalk or stop line', () => {
    const sim = new Simulation({ seed: 3 });
    const spawn = sim.getState().ego.transform.position;
    const yaw = sim.getState().ego.transform.rotation;
    expect(isValidLaneSpawn(spawn.x, spawn.y, yaw)).toBe(true);
    expect(spawn.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(Math.abs(spawn.y + 50)).toBeLessThan(2);

    sim.beginTrip(vec3(7.5, -8, 0), vec3(6, 80, 0), 'policy');
    const ego = sim.getState().ego.transform;
    expect(isValidLaneSpawn(ego.position.x, ego.position.y, ego.rotation)).toBe(true);
    expect(inRightLane(ego.position.x, ego.position.y, ego.rotation)).toBe(true);
    expect(Math.abs(ego.position.x)).toBeCloseTo(LANE_OFFSET, 5);
  });
});

describe('recovery decisions', () => {
  it('starts recovery when off-lane or stuck at a clear stop', () => {
    expect(shouldStartRecovery({
      arrived: false, human: false, offLane: true, offPath: false, speed: 0.2, stopStuckClear: false,
    })).toBe(true);
    expect(shouldStartRecovery({
      arrived: false, human: false, offLane: false, offPath: true, speed: 0.4, stopStuckClear: false,
    })).toBe(true);
    expect(shouldStartRecovery({
      arrived: false, human: false, offLane: false, offPath: false, speed: 0, stopStuckClear: true,
    })).toBe(true);
    expect(shouldStartRecovery({
      arrived: false, human: false, offLane: true, offPath: false, speed: 8, stopStuckClear: false,
    })).toBe(false);
    expect(shouldStartRecovery({
      arrived: true, human: false, offLane: true, offPath: true, speed: 0, stopStuckClear: true,
    })).toBe(false);
  });

  it('builds a reverse anchor behind the car and finishes after backing up', () => {
    const behind = reverseAnchor(3.5, -40, Math.PI / 2, 10);
    expect(behind.x).toBeCloseTo(3.5, 5);
    expect(behind.y).toBeCloseTo(-50, 5);
    const input = reverseRejoinInput(0);
    expect(input.gtaReverse).toBe(true);
    expect(input.brake).toBe(1);
    expect(recoveryFinished(3.5, -50, Math.PI / 2, vec3(3.5, -40, 0), [])).toBe(true);
    expect(isOffLane(7.4, -50, Math.PI / 2)).toBe(true);
    expect(isOffPath(20, -50, [vec3(3.5, -40, 0), vec3(3.5, -20, 0)])).toBe(true);
  });

  it('treats an empty box as a clear stop', () => {
    const self = { id: -1, x: 3.5, y: -8, yaw: Math.PI / 2, speed: 0 };
    const inter = {
      id: 1,
      center: vec3(0, 0, 0),
      control: 'stop' as const,
      signedHeadings: [0, Math.PI / 2, Math.PI, -Math.PI / 2],
      majorHeadings: [Math.PI / 2, -Math.PI / 2],
      stopLineDist: 8,
    };
    expect(stopWayClear(self, inter, [], [], { arrivals: new Map() })).toBe(true);
    expect(STOP_SIGN_DWELL).toBeGreaterThan(0.5);
    expect(STOP_STUCK_RECOVER).toBeGreaterThan(STOP_SIGN_DWELL);
  });
});

describe('reverse re-merge', () => {
  it('backs an off-lane car onto the planned path', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(3.5, -50, 0), vec3(6, 80, 0), 'policy');
    const yaw = Math.PI / 2;
    sim.getState().ego = {
      ...sim.getState().ego,
      transform: { position: { x: 7.35, y: -48, z: 0 }, rotation: yaw },
      velocity: { x: 0, y: 0, z: 0 },
      bodyVx: 0,
    };
    expect(inRightLane(7.35, -48, yaw)).toBe(false);
    sim.startRecovery();
    const dt = 1 / 30;
    let onLane = false;
    for (let i = 0; i < 30 * 8; i++) {
      sim.step(dt);
      const e = sim.getState().ego.transform;
      if (sim.getRecovery().phase === 'idle' && inRightLane(e.position.x, e.position.y, e.rotation)) {
        onLane = true;
        break;
      }
    }
    expect(onLane).toBe(true);
    expect(sim.getState().controlSource).toBe('policy');
    expect(sim.getState().route.length).toBeGreaterThan(2);
  });
});

describe('stuck-at-stop recovery', () => {
  it('does not sit forever at a clear stop sign', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(3.5, -50, 0), vec3(6, 80, 0), 'policy');
    sim.getState().trafficVehicles = [];
    sim.getState().pedestrians = [];
    sim.getState().ego = {
      ...sim.getState().ego,
      transform: { position: { x: 3.5, y: -16, z: 0 }, rotation: Math.PI / 2 },
      velocity: { x: 0, y: 2.2, z: 0 },
      bodyVx: 2.2,
    };
    const dt = 1 / 30;
    let leftStop = false;
    let sawStop = false;
    for (let i = 0; i < 30 * 12; i++) {
      sim.step(dt);
      const ego = sim.getState().ego;
      const y = ego.transform.position.y;
      const speed = Math.hypot(ego.velocity.x, ego.velocity.y);
      const reason = sim.getState().lastRule?.reason ?? '';
      if (reason.startsWith('Stopping') || reason.includes('stop sign')) sawStop = true;
      if (sawStop && y > 6 && speed > 1.0) {
        leftStop = true;
        break;
      }
    }
    expect(sawStop).toBe(true);
    expect(leftStop).toBe(true);
  });
});
