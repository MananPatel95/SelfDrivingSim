import { describe, it, expect } from 'vitest';
import { generateCityMap } from './world';
import {
  type ControlledIntersection,
  type RoadUser,
  type StopBook,
  buildControlledIntersection,
  decideIntersection,
  pickControl,
  signPose,
} from './intersectionRules';
import { vec3 } from './math';
import { detectVisibleAgents, hudDetectionCount } from '../stacks/tesla';
import { computeDecision } from '../render/perceptionViz';
import { createEgoState } from './vehicle';

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };

function user(id: number, x: number, y: number, yaw: number, speed: number): RoadUser {
  return { id, x, y, yaw, speed };
}

function book(): StopBook {
  return { arrivals: new Map() };
}

function stopAtOrigin(): ControlledIntersection {
  return buildControlledIntersection(1, 0, 0, vec3(0, 0, 0), 0);
}

describe('seeded intersection mix', () => {
  it('splits the grid about one-third each of stop, yield, and uncontrolled', () => {
    const map = generateCityMap(3, CITY);
    const counts = { stop: 0, yield: 0, none: 0 };
    for (const inter of map.controlledIntersections) counts[inter.control] += 1;
    const total = map.controlledIntersections.length;
    expect(total).toBe(49);
    expect(counts.stop).toBeGreaterThan(10);
    expect(counts.yield).toBeGreaterThan(10);
    expect(counts.none).toBeGreaterThan(10);
    expect(Math.abs(counts.stop - counts.yield)).toBeLessThan(8);
    expect(map.staticEntities.filter(e => e.classType === 'stop_sign').length).toBeGreaterThan(20);
    expect(map.staticEntities.filter(e => e.classType === 'yield_sign').length).toBeGreaterThan(10);
    expect(pickControl(0, 0, 0)).toBe('stop');
    expect(pickControl(0, 0, 1)).toBe('yield');
    expect(pickControl(0, 0, 2)).toBe('none');
  });

  it('puts stop signs on every approach and yield signs on the minor road only', () => {
    const stop = buildControlledIntersection(1, 0, 0, vec3(0, 0, 0), 0);
    expect(stop.control).toBe('stop');
    expect(stop.signedHeadings).toHaveLength(4);
    const yieldI = buildControlledIntersection(2, 0, 0, vec3(0, 0, 0), 1);
    expect(yieldI.control).toBe('yield');
    expect(yieldI.signedHeadings).toHaveLength(2);
    const pose = signPose(stop, Math.PI / 2);
    expect(pose.x).toBeGreaterThan(4);
    expect(pose.y).toBeLessThan(-4);
  });
});

describe('intersection right-of-way', () => {
  it('requires a full stop at a stop sign before leaving', () => {
    const inter = stopAtOrigin();
    const approaching = user(1, 0, -16, Math.PI / 2, 6);
    const slowing = decideIntersection(approaching, [], [], [inter], book(), 1);
    expect(slowing.reason).toMatch(/stop sign/i);
    expect(slowing.maxSpeed).toBeLessThan(4);
    const self = user(1, 0, -9.2, Math.PI / 2, 1);
    const moving = decideIntersection(self, [], [], [inter], book(), 1);
    expect(moving.mustStop).toBe(true);
    expect(moving.maxSpeed).toBe(0);
    expect(moving.reason).toMatch(/stop sign/i);

    const halted = user(1, 0, -8.2, Math.PI / 2, 0.05);
    const arrivals = book();
    const first = decideIntersection(halted, [], [], [inter], arrivals, 2);
    expect(first.mustStop).toBe(false);
    expect(first.reason).toMatch(/clearing/i);
    expect(arrivals.arrivals.get(1)?.intersectionId).toBe(1);
  });

  it('yields at a yield sign when major-road traffic is close, and goes if clear', () => {
    const yieldI = buildControlledIntersection(2, 0, 0, vec3(0, 0, 0), 1);
    const minor = user(1, yieldI.signedHeadings[0] === 0 ? -16 : 0, yieldI.signedHeadings[0] === 0 ? 0 : -16, yieldI.signedHeadings[0]!, 5);
    const majorYaw = yieldI.majorHeadings[0]!;
    const major = user(9, Math.cos(majorYaw) * -20, Math.sin(majorYaw) * -20, majorYaw, 8);
    const blocked = decideIntersection(minor, [major], [], [yieldI], book(), 1);
    expect(blocked.reason).toMatch(/cross traffic/i);
    const clear = decideIntersection(minor, [], [], [yieldI], book(), 1);
    expect(clear.mustStop).toBe(false);
    expect(clear.reason).toMatch(/clear to go/i);
  });

  it('yields to the car on the right and to pedestrians at uncontrolled junctions', () => {
    const open = buildControlledIntersection(3, 0, 0, vec3(0, 0, 0), 2);
    expect(open.control).toBe('none');
    const self = user(1, 0, -16, Math.PI / 2, 6);
    const right = user(2, 16, 0, Math.PI, 7);
    const yieldRight = decideIntersection(self, [right], [], [open], book(), 1);
    expect(yieldRight.reason).toMatch(/car on right/i);
    const ped = decideIntersection(self, [], [{ x: 1, y: 1 }], [open], book(), 1);
    expect(ped.mustStop).toBe(true);
    expect(ped.reason).toMatch(/pedestrian/i);
  });
});

describe('HUD detections and parked banner', () => {
  it('counts Tesla vision boxes, not empty lidar tracks', () => {
    const ego = createEgoState('car', vec3(0, 0, 0), Math.PI / 2);
    const ped = {
      id: 12,
      classType: 'pedestrian' as const,
      transform: { position: vec3(2, 18, 0.9), rotation: 0 },
      boundingBox: { center: vec3(2, 18, 0.9), size: vec3(0.5, 0.5, 1.7), yaw: 0 },
      velocity: vec3(0, 0, 0),
      isStatic: false,
      occlusionLevel: 0 as const,
    };
    const sign = {
      id: 40,
      classType: 'stop_sign' as const,
      transform: { position: vec3(6, 12, 1.6), rotation: 0 },
      boundingBox: { center: vec3(6, 12, 1.6), size: vec3(0.9, 0.18, 3.2), yaw: 0 },
      velocity: vec3(0, 0, 0),
      isStatic: true,
      occlusionLevel: 0 as const,
    };
    const dets = detectVisibleAgents(ego, [ped, sign]);
    expect(dets.some(d => d.classType === 'pedestrian')).toBe(true);
    expect(dets.some(d => d.classType === 'stop_sign')).toBe(true);
    expect(hudDetectionCount('tesla', dets, [])).toBe(dets.length);
    expect(hudDetectionCount('tesla', dets, [])).toBeGreaterThan(0);
  });

  it('shows Manual instead of Cruising while parked in manual', () => {
    const ego = createEgoState('car', vec3(3.5, -22, 0), Math.PI / 2);
    const decision = computeDecision({
      stack: 'tesla',
      ego,
      tracks: [],
      lidarPoints: [],
      agents: [],
      groundTruth: [],
      showGroundTruth: false,
      plannerOutput: null,
      visionDetections: [],
      controlSource: 'human',
    });
    expect(decision.text).toBe('Manual');
    expect(decision.text).not.toMatch(/Cruising/);
  });
});
