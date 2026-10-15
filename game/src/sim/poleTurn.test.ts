import { describe, it, expect } from 'vitest';
import { generateCityMap } from './world';
import { createEgoState } from './vehicle';
import { vec3 } from './math';
import { computeDecision } from '../render/perceptionViz';
import type { Track } from '../stacks/perception';
import { CITY, driveCorner } from './poleTurnDrive';

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
