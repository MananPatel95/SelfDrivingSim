/**
 * Tests for ray casting
 */

import { describe, it, expect } from 'vitest';
import {
  rayBoxIntersection, rayPlaneIntersection, rayCylinderIntersection,
  SpatialGrid, generateLidarRays
} from './raycaster';
import { vec3 } from '../sim/math';
import type { BoundingBox3D, Entity } from '../sim/types';

describe('rayBoxIntersection', () => {
  const box: BoundingBox3D = {
    center: vec3(5, 0, 1),
    size: vec3(2, 2, 2),
    yaw: 0,
  };

  it('detects intersection with direct ray', () => {
    const ray = {
      origin: vec3(0, 0, 1),
      direction: vec3(1, 0, 0),
    };
    const t = rayBoxIntersection(ray, box);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(4); // Hit at x=4 (center at 5, half-width 1)
  });

  it('returns null for ray missing box', () => {
    const ray = {
      origin: vec3(0, 0, 10),
      direction: vec3(1, 0, 0),
    };
    const t = rayBoxIntersection(ray, box);
    expect(t).toBeNull();
  });

  it('handles rotated box', () => {
    const rotatedBox: BoundingBox3D = {
      center: vec3(5, 0, 1),
      size: vec3(2, 2, 2),
      yaw: Math.PI / 4, // 45 degrees
    };
    const ray = {
      origin: vec3(0, 0, 1),
      direction: vec3(1, 0, 0),
    };
    const t = rayBoxIntersection(ray, rotatedBox);
    expect(t).not.toBeNull();
  });
});

describe('rayPlaneIntersection', () => {
  it('intersects horizontal ground plane', () => {
    const ray = {
      origin: vec3(0, 0, 10),
      direction: vec3(0, 0, -1),
    };
    const t = rayPlaneIntersection(ray, vec3(0, 0, 1), 0);
    expect(t).toBeCloseTo(10);
  });

  it('returns null for parallel ray', () => {
    const ray = {
      origin: vec3(0, 0, 10),
      direction: vec3(1, 0, 0), // Parallel to ground
    };
    const t = rayPlaneIntersection(ray, vec3(0, 0, 1), 0);
    expect(t).toBeNull();
  });

  it('returns null for ray pointing away', () => {
    const ray = {
      origin: vec3(0, 0, 10),
      direction: vec3(0, 0, 1), // Pointing up
    };
    const t = rayPlaneIntersection(ray, vec3(0, 0, 1), 0);
    expect(t).toBeNull();
  });
});

describe('rayCylinderIntersection', () => {
  it('intersects cylinder from side', () => {
    const ray = {
      origin: vec3(-10, 0, 2),
      direction: vec3(1, 0, 0),
    };
    const t = rayCylinderIntersection(ray, vec3(0, 0, 4), 1, 8);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(9); // Hit at x=-1 (radius 1)
  });

  it('misses cylinder above', () => {
    const ray = {
      origin: vec3(-10, 0, 20),
      direction: vec3(1, 0, 0),
    };
    const t = rayCylinderIntersection(ray, vec3(0, 0, 4), 1, 8);
    expect(t).toBeNull();
  });
});

describe('SpatialGrid', () => {
  it('inserts and queries entities', () => {
    const grid = new SpatialGrid(10);
    const entity: Entity = {
      id: 1,
      classType: 'car',
      transform: { position: vec3(5, 5, 0), rotation: 0 },
      boundingBox: { center: vec3(5, 5, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      velocity: vec3(0, 0, 0),
      isStatic: false,
      occlusionLevel: 0,
    };
    
    grid.insert(entity);
    
    const ray = {
      origin: vec3(0, 5, 1),
      direction: vec3(1, 0, 0),
    };
    const result = grid.query(ray, 100);
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe(1);
  });

  it('returns empty for distant query', () => {
    const grid = new SpatialGrid(10);
    const entity: Entity = {
      id: 1,
      classType: 'car',
      transform: { position: vec3(5, 5, 0), rotation: 0 },
      boundingBox: { center: vec3(5, 5, 1), size: vec3(4, 2, 1.5), yaw: 0 },
      velocity: vec3(0, 0, 0),
      isStatic: false,
      occlusionLevel: 0,
    };
    
    grid.insert(entity);
    
    const ray = {
      origin: vec3(100, 100, 1),
      direction: vec3(1, 0, 0),
    };
    const result = grid.query(ray, 10);
    expect(result.length).toBe(0);
  });
});

describe('generateLidarRays', () => {
  it('generates correct number of rays', () => {
    const rays = generateLidarRays(
      vec3(0, 0, 0),
      0,
      4, // beams
      [-10, 10], // vertical FOV
      [0, 10], // horizontal FOV (10 degrees)
      5 // 5 degree resolution -> 3 rays per beam
    );
    
    // 4 beams × 3 azimuth positions = 12 rays
    expect(rays.length).toBe(12);
  });

  it('assigns correct ring indices', () => {
    const rays = generateLidarRays(
      vec3(0, 0, 0),
      0,
      4,
      [-10, 10],
      [0, 10],
      5
    );
    
    const rings = new Set(rays.map(r => r.ring));
    expect(rings.size).toBe(4);
    expect(rings.has(0)).toBe(true);
    expect(rings.has(3)).toBe(true);
  });

  it('ray directions are normalized', () => {
    const rays = generateLidarRays(
      vec3(0, 0, 0),
      0,
      4,
      [-10, 10],
      [-180, 180],
      1
    );
    
    for (const { ray } of rays) {
      const length = Math.sqrt(
        ray.direction.x ** 2 + ray.direction.y ** 2 + ray.direction.z ** 2
      );
      expect(length).toBeCloseTo(1);
    }
  });
});
