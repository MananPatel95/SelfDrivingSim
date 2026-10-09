/**
 * Analytic ray caster for lidar simulation
 * Uses geometric primitives, NOT Three.js Raycaster
 * Works in browser and Node.js (Web Workers)
 */

import type { Vec3, BoundingBox3D, Entity } from '../sim/types';
import { vec3, vec3Add, vec3Scale, vec3Sub, vec3Dot, vec3Normalize, rotateVec3 } from '../sim/math';

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  entityId: number;
  entityClass: string;
  intensity: number;
}

// Material reflectivity for intensity simulation
const MATERIAL_INTENSITY: Record<string, number> = {
  car: 0.6,
  truck: 0.7,
  bus: 0.7,
  motorcycle: 0.5,
  bicycle: 0.4,
  pedestrian: 0.3,
  building: 0.8,
  tree: 0.2,
  pole: 0.9,
  traffic_light: 0.8,
  traffic_sign: 0.95,
  barrier: 0.7,
  cone: 0.9,
  ground: 0.4,
  default: 0.5,
};

// Spatial grid for acceleration
export class SpatialGrid {
  private cells: Map<string, Entity[]>;
  private cellSize: number;
  
  constructor(cellSize: number = 10) {
    this.cells = new Map();
    this.cellSize = cellSize;
  }
  
  clear(): void {
    this.cells.clear();
  }
  
  insert(entity: Entity): void {
    const box = entity.boundingBox;
    const minX = Math.floor((box.center.x - box.size.x / 2) / this.cellSize);
    const maxX = Math.floor((box.center.x + box.size.x / 2) / this.cellSize);
    const minY = Math.floor((box.center.y - box.size.y / 2) / this.cellSize);
    const maxY = Math.floor((box.center.y + box.size.y / 2) / this.cellSize);
    
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        const list = this.cells.get(key);
        if (list) {
          list.push(entity);
        } else {
          this.cells.set(key, [entity]);
        }
      }
    }
  }
  
  query(ray: Ray, maxDist: number): Entity[] {
    const result: Entity[] = [];
    const seen = new Set<number>();
    
    // March along ray and collect entities from cells
    const steps = Math.ceil(maxDist / this.cellSize);
    for (let i = 0; i <= steps; i++) {
      const t = (i * this.cellSize) / maxDist;
      const p = vec3Add(ray.origin, vec3Scale(ray.direction, t * maxDist));
      const cx = Math.floor(p.x / this.cellSize);
      const cy = Math.floor(p.y / this.cellSize);
      
      // Check this cell and neighbors
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${cx + dx},${cy + dy}`;
          const entities = this.cells.get(key);
          if (entities) {
            for (const e of entities) {
              if (!seen.has(e.id)) {
                seen.add(e.id);
                result.push(e);
              }
            }
          }
        }
      }
    }
    
    return result;
  }
}

// Ray-box intersection (oriented bounding box)
export function rayBoxIntersection(ray: Ray, box: BoundingBox3D): number | null {
  // Transform ray to box local space
  const localOrigin = vec3Sub(ray.origin, box.center);
  const rotatedOrigin = rotateVec3(localOrigin, -box.yaw);
  const rotatedDir = rotateVec3(ray.direction, -box.yaw);
  
  const halfSize = vec3Scale(box.size, 0.5);
  
  let tMin = -Infinity;
  let tMax = Infinity;
  
  // X axis
  if (Math.abs(rotatedDir.x) < 1e-8) {
    if (rotatedOrigin.x < -halfSize.x || rotatedOrigin.x > halfSize.x) return null;
  } else {
    const t1 = (-halfSize.x - rotatedOrigin.x) / rotatedDir.x;
    const t2 = (halfSize.x - rotatedOrigin.x) / rotatedDir.x;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  
  // Y axis
  if (Math.abs(rotatedDir.y) < 1e-8) {
    if (rotatedOrigin.y < -halfSize.y || rotatedOrigin.y > halfSize.y) return null;
  } else {
    const t1 = (-halfSize.y - rotatedOrigin.y) / rotatedDir.y;
    const t2 = (halfSize.y - rotatedOrigin.y) / rotatedDir.y;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  
  // Z axis
  if (Math.abs(rotatedDir.z) < 1e-8) {
    if (rotatedOrigin.z < -halfSize.z || rotatedOrigin.z > halfSize.z) return null;
  } else {
    const t1 = (-halfSize.z - rotatedOrigin.z) / rotatedDir.z;
    const t2 = (halfSize.z - rotatedOrigin.z) / rotatedDir.z;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  
  if (tMin > tMax || tMax < 0) return null;
  
  return tMin > 0 ? tMin : tMax;
}

// Ray-plane intersection (for ground)
export function rayPlaneIntersection(
  ray: Ray,
  planeNormal: Vec3,
  planeD: number
): number | null {
  const denom = vec3Dot(ray.direction, planeNormal);
  if (Math.abs(denom) < 1e-8) return null;
  
  const t = -(vec3Dot(ray.origin, planeNormal) + planeD) / denom;
  return t > 0 ? t : null;
}

// Ray-cylinder intersection (for poles)
export function rayCylinderIntersection(
  ray: Ray,
  center: Vec3,
  radius: number,
  height: number
): number | null {
  // Infinite cylinder first
  const dx = ray.origin.x - center.x;
  const dy = ray.origin.y - center.y;
  
  const a = ray.direction.x ** 2 + ray.direction.y ** 2;
  const b = 2 * (dx * ray.direction.x + dy * ray.direction.y);
  const c = dx ** 2 + dy ** 2 - radius ** 2;
  
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  
  const sqrtD = Math.sqrt(discriminant);
  let t = (-b - sqrtD) / (2 * a);
  if (t < 0) t = (-b + sqrtD) / (2 * a);
  if (t < 0) return null;
  
  // Check height bounds
  const hitZ = ray.origin.z + t * ray.direction.z;
  const minZ = center.z - height / 2;
  const maxZ = center.z + height / 2;
  
  if (hitZ < minZ || hitZ > maxZ) {
    // Check caps
    const tBottom = (minZ - ray.origin.z) / ray.direction.z;
    const tTop = (maxZ - ray.origin.z) / ray.direction.z;
    
    for (const tCap of [tBottom, tTop]) {
      if (tCap > 0) {
        const px = ray.origin.x + tCap * ray.direction.x - center.x;
        const py = ray.origin.y + tCap * ray.direction.y - center.y;
        if (px ** 2 + py ** 2 <= radius ** 2) {
          return tCap;
        }
      }
    }
    return null;
  }
  
  return t;
}

// Cast a single ray against all entities
export function castRay(
  ray: Ray,
  _entities: Entity[],
  maxRange: number,
  grid: SpatialGrid
): RayHit | null {
  let closest: RayHit | null = null;
  let closestDist = maxRange;
  
  // Ground plane check
  const groundT = rayPlaneIntersection(ray, vec3(0, 0, 1), 0);
  if (groundT !== null && groundT < closestDist) {
    closest = {
      distance: groundT,
      point: vec3Add(ray.origin, vec3Scale(ray.direction, groundT)),
      normal: vec3(0, 0, 1),
      entityId: -1,
      entityClass: 'ground',
      intensity: MATERIAL_INTENSITY['ground'] ?? 0.5,
    };
    closestDist = groundT;
  }
  
  // Query spatial grid for nearby entities
  const candidates = grid.query(ray, maxRange);
  
  for (const entity of candidates) {
    let t: number | null = null;
    
    if (entity.classType === 'pole') {
      t = rayCylinderIntersection(
        ray,
        entity.boundingBox.center,
        entity.boundingBox.size.x / 2,
        entity.boundingBox.size.z
      );
    } else {
      t = rayBoxIntersection(ray, entity.boundingBox);
    }
    
    if (t !== null && t < closestDist && t > 0.1) {
      const point = vec3Add(ray.origin, vec3Scale(ray.direction, t));
      const intensity = MATERIAL_INTENSITY[entity.classType] ?? MATERIAL_INTENSITY['default']!;
      
      closest = {
        distance: t,
        point,
        normal: vec3(0, 0, 1), // Simplified
        entityId: entity.id,
        entityClass: entity.classType,
        intensity,
      };
      closestDist = t;
    }
  }
  
  return closest;
}

// Generate lidar rays for a spinning lidar
export function generateLidarRays(
  origin: Vec3,
  sensorYaw: number,
  beams: number,
  verticalFov: [number, number], // min, max in degrees
  horizontalFov: [number, number],
  horizontalRes: number // degrees
): Array<{ ray: Ray; ring: number; azimuth: number }> {
  const rays: Array<{ ray: Ray; ring: number; azimuth: number }> = [];
  
  const vertMin = (verticalFov[0] * Math.PI) / 180;
  const vertMax = (verticalFov[1] * Math.PI) / 180;
  const horzMin = (horizontalFov[0] * Math.PI) / 180;
  const horzMax = (horizontalFov[1] * Math.PI) / 180;
  const horzStep = (horizontalRes * Math.PI) / 180;
  
  const vertStep = beams > 1 ? (vertMax - vertMin) / (beams - 1) : 0;
  
  for (let ring = 0; ring < beams; ring++) {
    const elevation = vertMin + ring * vertStep;
    
    for (let azimuth = horzMin; azimuth <= horzMax; azimuth += horzStep) {
      const totalAzimuth = sensorYaw + azimuth;
      
      const direction: Vec3 = {
        x: Math.cos(elevation) * Math.cos(totalAzimuth),
        y: Math.cos(elevation) * Math.sin(totalAzimuth),
        z: Math.sin(elevation),
      };
      
      rays.push({
        ray: { origin, direction: vec3Normalize(direction) },
        ring,
        azimuth: (totalAzimuth * 180) / Math.PI,
      });
    }
  }
  
  return rays;
}

// Apply noise to lidar returns
export function applyLidarNoise(
  hit: RayHit,
  rangeNoise: number,
  dropoutProb: number,
  weather: 'clear' | 'rain' | 'fog',
  timeOfDay: 'day' | 'night',
  rng: () => number
): RayHit | null {
  // Increased dropout with weather
  let effectiveDropout = dropoutProb;
  if (weather === 'rain') effectiveDropout += 0.1;
  if (weather === 'fog') effectiveDropout += 0.3;
  
  // Range-dependent dropout
  effectiveDropout += (hit.distance / 100) * 0.1;
  
  if (rng() < effectiveDropout) return null;
  
  // Range noise
  let effectiveNoise = rangeNoise;
  if (weather !== 'clear') effectiveNoise *= 2;
  
  const noisyDistance = hit.distance + (rng() - 0.5) * effectiveNoise * 2;
  if (noisyDistance <= 0) return null;
  
  // Reduced intensity at night and with weather
  let intensityMod = 1;
  if (timeOfDay === 'night') intensityMod *= 0.8;
  if (weather === 'rain') intensityMod *= 0.7;
  if (weather === 'fog') intensityMod *= 0.5;
  
  return {
    ...hit,
    distance: noisyDistance,
    intensity: hit.intensity * intensityMod,
  };
}
