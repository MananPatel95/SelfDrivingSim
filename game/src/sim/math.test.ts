/**
 * Tests for math utilities
 */

import { describe, it, expect } from 'vitest';
import {
  vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Length, vec3Normalize,
  vec3Distance, rotateVec3, normalizeAngle, calculateIoU3D, calculateTTC,
  calculateCPA, calculateBrakingDistance, SeededRandom, pointInBox, boxOverlap2D
} from './math';
import type { BoundingBox3D } from './types';

describe('Vector operations', () => {
  it('vec3Add adds vectors correctly', () => {
    const result = vec3Add(vec3(1, 2, 3), vec3(4, 5, 6));
    expect(result).toEqual({ x: 5, y: 7, z: 9 });
  });

  it('vec3Sub subtracts vectors correctly', () => {
    const result = vec3Sub(vec3(4, 5, 6), vec3(1, 2, 3));
    expect(result).toEqual({ x: 3, y: 3, z: 3 });
  });

  it('vec3Scale scales correctly', () => {
    const result = vec3Scale(vec3(1, 2, 3), 2);
    expect(result).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('vec3Dot computes dot product', () => {
    const result = vec3Dot(vec3(1, 0, 0), vec3(0, 1, 0));
    expect(result).toBe(0);
    
    const result2 = vec3Dot(vec3(1, 2, 3), vec3(4, 5, 6));
    expect(result2).toBe(32); // 1*4 + 2*5 + 3*6
  });

  it('vec3Length computes length', () => {
    expect(vec3Length(vec3(3, 4, 0))).toBe(5);
    expect(vec3Length(vec3(0, 0, 0))).toBe(0);
  });

  it('vec3Normalize normalizes correctly', () => {
    const result = vec3Normalize(vec3(3, 4, 0));
    expect(result.x).toBeCloseTo(0.6);
    expect(result.y).toBeCloseTo(0.8);
    expect(result.z).toBe(0);
  });

  it('vec3Distance computes distance', () => {
    expect(vec3Distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(5);
  });
});

describe('Rotation', () => {
  it('rotateVec3 rotates by 90 degrees', () => {
    const result = rotateVec3(vec3(1, 0, 0), Math.PI / 2);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(1);
    expect(result.z).toBe(0);
  });

  it('normalizeAngle keeps angles in [-pi, pi]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI);
  });
});

describe('Bounding box operations', () => {
  const box1: BoundingBox3D = {
    center: vec3(0, 0, 0),
    size: vec3(2, 2, 2),
    yaw: 0,
  };

  it('pointInBox detects point inside', () => {
    expect(pointInBox(vec3(0, 0, 0), box1)).toBe(true);
    expect(pointInBox(vec3(0.5, 0.5, 0.5), box1)).toBe(true);
  });

  it('pointInBox detects point outside', () => {
    expect(pointInBox(vec3(2, 0, 0), box1)).toBe(false);
    expect(pointInBox(vec3(0, 2, 0), box1)).toBe(false);
  });

  it('boxOverlap2D detects overlapping boxes', () => {
    const box2: BoundingBox3D = {
      center: vec3(1, 0, 0),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    expect(boxOverlap2D(box1, box2)).toBe(true);
  });

  it('boxOverlap2D detects non-overlapping boxes', () => {
    const box3: BoundingBox3D = {
      center: vec3(5, 0, 0),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    expect(boxOverlap2D(box1, box3)).toBe(false);
  });
});

describe('IoU calculation', () => {
  it('calculateIoU3D returns 1 for identical boxes', () => {
    const box: BoundingBox3D = {
      center: vec3(0, 0, 0),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    expect(calculateIoU3D(box, box)).toBeCloseTo(1);
  });

  it('calculateIoU3D returns 0 for non-overlapping boxes', () => {
    const box1: BoundingBox3D = {
      center: vec3(0, 0, 0),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    const box2: BoundingBox3D = {
      center: vec3(10, 10, 10),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    expect(calculateIoU3D(box1, box2)).toBe(0);
  });

  it('calculateIoU3D returns correct value for partial overlap', () => {
    const box1: BoundingBox3D = {
      center: vec3(0, 0, 0),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    const box2: BoundingBox3D = {
      center: vec3(1, 0, 0),
      size: vec3(2, 2, 2),
      yaw: 0,
    };
    const iou = calculateIoU3D(box1, box2);
    expect(iou).toBeGreaterThan(0);
    expect(iou).toBeLessThan(1);
  });
});

describe('TTC calculation', () => {
  it('calculateTTC returns null for diverging objects', () => {
    const ttc = calculateTTC(
      vec3(0, 0, 0),
      vec3(-1, 0, 0), // moving away
      vec3(10, 0, 0),
      vec3(1, 0, 0),  // also moving away
      1
    );
    expect(ttc).toBeNull();
  });

  it('calculateTTC returns positive time for approaching objects', () => {
    const ttc = calculateTTC(
      vec3(0, 0, 0),
      vec3(5, 0, 0), // moving toward target
      vec3(20, 0, 0),
      vec3(0, 0, 0), // stationary target
      1
    );
    expect(ttc).toBeGreaterThan(0);
    expect(ttc).toBeLessThan(5); // Should collide within 4 seconds
  });
});

describe('CPA calculation', () => {
  it('calculateCPA for head-on approach', () => {
    const result = calculateCPA(
      vec3(0, 0, 0),
      vec3(1, 0, 0), // moving right
      vec3(10, 0, 0),
      vec3(-1, 0, 0) // moving left (toward each other)
    );
    expect(result.cpa).toBe(0); // Will pass through same point
    expect(result.tcpa).toBeGreaterThan(0);
  });

  it('calculateCPA for parallel paths', () => {
    const result = calculateCPA(
      vec3(0, 0, 0),
      vec3(1, 0, 0),
      vec3(0, 10, 0), // 10m parallel
      vec3(1, 0, 0)   // same velocity
    );
    expect(result.cpa).toBeCloseTo(10);
  });
});

describe('Braking distance', () => {
  it('calculateBrakingDistance increases with speed', () => {
    const d1 = calculateBrakingDistance(10, 1500, 15000);
    const d2 = calculateBrakingDistance(20, 1500, 15000);
    expect(d2).toBeGreaterThan(d1);
    expect(d2).toBeCloseTo(d1 * 4, 0); // Should be ~4x at 2x speed
  });

  it('calculateBrakingDistance increases with mass', () => {
    const d1 = calculateBrakingDistance(20, 1500, 15000);
    const d2 = calculateBrakingDistance(20, 3000, 15000);
    expect(d2).toBeGreaterThan(d1);
  });
});

describe('SeededRandom', () => {
  it('produces same sequence with same seed', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);
    
    for (let i = 0; i < 10; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });

  it('produces different sequences with different seeds', () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(123);
    
    const values1 = Array(10).fill(0).map(() => rng1.next());
    const values2 = Array(10).fill(0).map(() => rng2.next());
    
    expect(values1).not.toEqual(values2);
  });

  it('nextInt produces values in range', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('nextFloat produces values in range', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextFloat(-1, 1);
      expect(val).toBeGreaterThanOrEqual(-1);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});
