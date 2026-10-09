/**
 * Tests for perception pipeline
 */

import { describe, it, expect } from 'vitest';
import {
  removeGround, clusterPoints, fitBoundingBox, classifyBySize, updateTracks
} from './perception';
import { vec3 } from '../sim/math';
import type { LidarPoint } from '../sim/types';

function makePoint(x: number, y: number, z: number): LidarPoint {
  return { x, y, z, intensity: 0.5, ring: 0 };
}

describe('removeGround', () => {
  it('separates ground from obstacles', () => {
    const points: LidarPoint[] = [
      // Ground points
      ...Array(20).fill(0).map((_, i) => makePoint(i, 0, 0)),
      ...Array(20).fill(0).map((_, i) => makePoint(i, 5, 0.02)),
      // Obstacle points
      ...Array(10).fill(0).map((_, i) => makePoint(10, 3, 0.5 + i * 0.1)),
    ];
    
    const { ground, nonGround } = removeGround(points);
    
    expect(ground.length).toBeGreaterThan(30);
    expect(nonGround.length).toBeGreaterThan(5);
    expect(nonGround.every(p => p.z > 0.1)).toBe(true);
  });
});

describe('clusterPoints', () => {
  it('groups nearby points into clusters', () => {
    const points: LidarPoint[] = [
      // Cluster 1
      makePoint(0, 0, 1),
      makePoint(0.1, 0, 1),
      makePoint(0, 0.1, 1),
      makePoint(0.1, 0.1, 1),
      makePoint(0, 0, 1.1),
      // Cluster 2 (far away)
      makePoint(10, 10, 1),
      makePoint(10.1, 10, 1),
      makePoint(10, 10.1, 1),
      makePoint(10.1, 10.1, 1),
      makePoint(10, 10, 1.1),
    ];
    
    const clusters = clusterPoints(points, 0.5, 3);
    expect(clusters.length).toBe(2);
  });

  it('ignores sparse points', () => {
    const points: LidarPoint[] = [
      makePoint(0, 0, 1),
      makePoint(5, 5, 1),
      makePoint(10, 10, 1),
    ];
    
    const clusters = clusterPoints(points, 0.5, 5);
    expect(clusters.length).toBe(0);
  });
});

describe('fitBoundingBox', () => {
  it('fits box to rectangular cluster', () => {
    const points: LidarPoint[] = [];
    // Create a 4x2x1.5 rectangular cluster (car-like)
    for (let x = 0; x < 4; x += 0.2) {
      for (let y = 0; y < 2; y += 0.2) {
        for (let z = 0; z < 1.5; z += 0.2) {
          points.push(makePoint(x, y, z));
        }
      }
    }
    
    const cluster = {
      points,
      centroid: vec3(2, 1, 0.75),
      minBound: vec3(0, 0, 0),
      maxBound: vec3(4, 2, 1.5),
    };
    
    const box = fitBoundingBox(cluster);
    
    expect(box.size.x).toBeCloseTo(4, 0);
    expect(box.size.y).toBeCloseTo(2, 0);
    expect(box.size.z).toBeCloseTo(1.5, 0);
  });
});

describe('classifyBySize', () => {
  it('classifies car-sized box', () => {
    const box = {
      center: vec3(0, 0, 0),
      size: vec3(4.5, 1.8, 1.5),
      yaw: 0,
    };
    
    const { classType, confidence } = classifyBySize(box);
    expect(classType).toBe('car');
    expect(confidence).toBeGreaterThan(0.5);
  });

  it('classifies pedestrian-sized box', () => {
    const box = {
      center: vec3(0, 0, 0),
      size: vec3(0.5, 0.5, 1.7),
      yaw: 0,
    };
    
    const { classType, confidence } = classifyBySize(box);
    expect(classType).toBe('pedestrian');
    expect(confidence).toBeGreaterThan(0.5);
  });

  it('classifies truck-sized box', () => {
    const box = {
      center: vec3(0, 0, 0),
      size: vec3(10, 2.5, 3.5),
      yaw: 0,
    };
    
    const { classType, confidence } = classifyBySize(box);
    expect(classType).toBe('truck');
    expect(confidence).toBeGreaterThan(0.3);
  });
});

describe('updateTracks', () => {
  it('creates new track for detection', () => {
    const detections = [{
      box: { center: vec3(10, 0, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      classType: 'car' as const,
      confidence: 0.8,
      pointsInBox: 100,
    }];
    
    const tracks = updateTracks([], detections, 0.1);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.classType).toBe('car');
  });

  it('updates existing track with new detection', () => {
    const initialTracks = [{
      id: 1,
      classType: 'car' as const,
      box: { center: vec3(10, 0, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      velocity: vec3(5, 0, 0),
      age: 5,
      missedFrames: 0,
      confidence: 0.8,
    }];
    
    const detections = [{
      box: { center: vec3(10.5, 0, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      classType: 'car' as const,
      confidence: 0.9,
      pointsInBox: 100,
    }];
    
    const tracks = updateTracks(initialTracks, detections, 0.1);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.id).toBe(1); // Same track
    expect(tracks[0]!.age).toBe(6); // Age incremented
    expect(tracks[0]!.missedFrames).toBe(0);
  });

  it('coasts track when detection is missed', () => {
    const initialTracks = [{
      id: 1,
      classType: 'car' as const,
      box: { center: vec3(10, 0, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      velocity: vec3(5, 0, 0),
      age: 5,
      missedFrames: 0,
      confidence: 0.8,
    }];
    
    const tracks = updateTracks(initialTracks, [], 0.1);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.missedFrames).toBe(1);
  });

  it('removes track after too many missed frames', () => {
    const initialTracks = [{
      id: 1,
      classType: 'car' as const,
      box: { center: vec3(10, 0, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      velocity: vec3(5, 0, 0),
      age: 5,
      missedFrames: 9,
      confidence: 0.8,
    }];
    
    const tracks = updateTracks(initialTracks, [], 0.1);
    expect(tracks.length).toBe(0); // Track removed (missedFrames would be 10)
  });
});
