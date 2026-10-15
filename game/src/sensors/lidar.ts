/**
 * Lidar sensor simulation
 * Configurable for different lidar types (spinning, FMCW, etc.)
 */

import type { 
  LidarConfig, LidarPoint, Entity, Environment, EgoState 
} from '../sim/types';
import { 
  SpatialGrid, generateLidarRays, castRay, applyLidarNoise 
} from './raycaster';
import { vec3Add, rotateVec3, vec3Dot, vec3Sub, vec3, vec3Scale, SeededRandom } from '../sim/math';
import { getWasmKernels } from '../sim/wasm';

const localDirCache = new Map<string, { dirs: Float32Array; rings: number[]; count: number }>();
let pooledDirs = new Float32Array(0);
let pooledBoxes = new Float32Array(0);

function configKey(config: LidarConfig): string {
  return `${config.beams}:${config.verticalFov[0]},${config.verticalFov[1]}:${config.horizontalFov[0]},${config.horizontalFov[1]}:${config.horizontalResolution}`;
}

function localDirsFor(config: LidarConfig): { dirs: Float32Array; rings: number[]; count: number } {
  const key = configKey(config);
  const hit = localDirCache.get(key);
  if (hit) return hit;
  const rays = generateLidarRays(
    vec3(0, 0, 0),
    0,
    config.beams,
    config.verticalFov,
    config.horizontalFov,
    config.horizontalResolution
  );
  const dirs = new Float32Array(rays.length * 3);
  const rings = new Array<number>(rays.length);
  for (let i = 0; i < rays.length; i++) {
    const r = rays[i]!;
    dirs[i * 3] = r.ray.direction.x;
    dirs[i * 3 + 1] = r.ray.direction.y;
    dirs[i * 3 + 2] = r.ray.direction.z;
    rings[i] = r.ring;
  }
  const cached = { dirs, rings, count: rays.length };
  localDirCache.set(key, cached);
  return cached;
}

function ensureCapacity(buf: Float32Array, n: number): Float32Array {
  return buf.length >= n ? buf : new Float32Array(n);
}

export interface LidarScanResult {
  timestamp: number;
  points: LidarPoint[];
  sensorId: string;
}

export function simulateLidarScan(
  config: LidarConfig,
  egoState: EgoState,
  entities: Entity[],
  environment: Environment,
  timestamp: number,
  seed: number
): LidarScanResult {
  const rng = new SeededRandom(seed + timestamp);
  const points: LidarPoint[] = [];
  
  // Sensor position in world frame
  const sensorWorldPos = vec3Add(
    egoState.transform.position,
    rotateVec3(config.position, egoState.transform.rotation)
  );
  const sensorWorldYaw = egoState.transform.rotation + config.rotation.z;
  
  const kernels = getWasmKernels();
  const useBatch = typeof window !== 'undefined';
  const local = useBatch ? localDirsFor(config) : null;
  const rayCount = local?.count ?? 0;

  // Generate rays only for the TS fallback (WASM uses cached local dirs).
  const rays = useBatch ? null : generateLidarRays(
    sensorWorldPos,
    sensorWorldYaw,
    config.beams,
    config.verticalFov,
    config.horizontalFov,
    config.horizontalResolution
  );
  
  let batchHits: Float32Array | null = null;
  if (useBatch && local && entities.length > 0) {
    const cos = Math.cos(sensorWorldYaw);
    const sin = Math.sin(sensorWorldYaw);
    pooledDirs = ensureCapacity(pooledDirs, rayCount * 3);
    for (let i = 0; i < rayCount; i++) {
      const lx = local.dirs[i * 3]!;
      const ly = local.dirs[i * 3 + 1]!;
      const lz = local.dirs[i * 3 + 2]!;
      pooledDirs[i * 3] = lx * cos - ly * sin;
      pooledDirs[i * 3 + 1] = lx * sin + ly * cos;
      pooledDirs[i * 3 + 2] = lz;
    }
    pooledBoxes = ensureCapacity(pooledBoxes, entities.length * 7);
    for (let j = 0; j < entities.length; j++) {
      const e = entities[j]!;
      pooledBoxes[j * 7] = e.boundingBox.center.x;
      pooledBoxes[j * 7 + 1] = e.boundingBox.center.y;
      pooledBoxes[j * 7 + 2] = e.boundingBox.center.z;
      pooledBoxes[j * 7 + 3] = e.boundingBox.size.x;
      pooledBoxes[j * 7 + 4] = e.boundingBox.size.y;
      pooledBoxes[j * 7 + 5] = e.boundingBox.size.z;
      pooledBoxes[j * 7 + 6] = e.boundingBox.yaw;
    }
    batchHits = kernels.castRays(
      sensorWorldPos.x, sensorWorldPos.y, sensorWorldPos.z,
      pooledDirs.subarray(0, rayCount * 3),
      pooledBoxes.subarray(0, entities.length * 7),
      config.maxRange
    );
  }

  const grid = (!batchHits && rays) ? new SpatialGrid(10) : null;
  if (grid) {
    for (const entity of entities) grid.insert(entity);
  }

  const nRays = rays ? rays.length : rayCount;
  // Cast rays and collect points
  for (let ri = 0; ri < nRays; ri++) {
    const ray = rays
      ? rays[ri]!.ray
      : {
          origin: sensorWorldPos,
          direction: {
            x: pooledDirs[ri * 3]!,
            y: pooledDirs[ri * 3 + 1]!,
            z: pooledDirs[ri * 3 + 2]!,
          },
        };
    const ring = rays ? rays[ri]!.ring : local!.rings[ri]!;
    let hit = null as ReturnType<typeof castRay>;
    if (batchHits) {
      const t = batchHits[ri * 2] ?? -1;
      const idx = batchHits[ri * 2 + 1] ?? -1;
      const groundT = (() => {
        const denom = ray.direction.z;
        if (Math.abs(denom) < 1e-8) return null;
        const gt = -ray.origin.z / denom;
        return gt > 0 ? gt : null;
      })();
      if (t > 0 && (groundT === null || t < groundT)) {
        const entity = entities[idx]!;
        const point = vec3Add(ray.origin, vec3Scale(ray.direction, t));
        hit = {
          distance: t,
          point,
          normal: vec3(0, 0, 1),
          entityId: entity?.id ?? -1,
          entityClass: entity?.classType ?? 'unknown',
          intensity: 0.5,
        };
      } else if (groundT !== null && groundT < config.maxRange) {
        hit = {
          distance: groundT,
          point: vec3Add(ray.origin, vec3Scale(ray.direction, groundT)),
          normal: vec3(0, 0, 1),
          entityId: -1,
          entityClass: 'ground',
          intensity: 0.4,
        };
      }
    } else if (grid) {
      hit = castRay(ray, entities, config.maxRange, grid);
    }
    
    if (hit) {
      // Browser viz: fixed beam (no per-frame jitter). Headless keeps seeded noise.
      const noisyHit = useBatch
        ? { ...hit, intensity: hit.intensity * 0.72 }
        : applyLidarNoise(
            hit,
            0.02, // 2cm range noise
            0.01, // 1% base dropout
            environment.weather,
            environment.timeOfDay,
            () => rng.next()
          );
      
      if (noisyHit) {
        // Transform hit point to ego frame
        const localPoint = rotateVec3(
          vec3Sub(noisyHit.point, egoState.transform.position),
          -egoState.transform.rotation
        );
        
        const lidarPoint: LidarPoint = {
          x: localPoint.x,
          y: localPoint.y,
          z: localPoint.z,
          intensity: noisyHit.intensity,
          ring,
          groundTruthId: hit.entityId >= 0 ? hit.entityId : undefined,
          groundTruthClass: hit.entityId >= 0 ? hit.entityClass as LidarPoint['groundTruthClass'] : undefined,
        };
        
        // Add FMCW radial velocity if applicable
        if (config.isFMCW && hit.entityId >= 0) {
          const entity = entities.find(e => e.id === hit.entityId);
          if (entity && !entity.isStatic) {
            // Radial velocity: dot product of relative velocity and ray direction
            const relVel = vec3Sub(entity.velocity, egoState.velocity);
            const radialVel = vec3Dot(relVel, ray.direction);
            lidarPoint.radialVelocity = radialVel + rng.nextGaussian(0, 0.1); // 0.1 m/s noise
          } else {
            // Static object - radial velocity from ego motion only
            const egoWorldVel = rotateVec3(egoState.velocity, egoState.transform.rotation);
            const radialVel = -vec3Dot(egoWorldVel, ray.direction);
            lidarPoint.radialVelocity = radialVel + rng.nextGaussian(0, 0.1);
          }
        }
        
        points.push(lidarPoint);
      }
    }
  }
  
  return {
    timestamp,
    points,
    sensorId: config.id,
  };
}

// Merge multiple lidar scans (for multi-lidar setups)
export function mergeLidarScans(scans: LidarScanResult[]): LidarPoint[] {
  const allPoints: LidarPoint[] = [];
  for (const scan of scans) {
    allPoints.push(...scan.points);
  }
  return allPoints;
}

// Default lidar configurations
export const LIDAR_CONFIGS: Record<string, LidarConfig> = {
  roofLidar: {
    id: 'roof_lidar',
    position: { x: 0, y: 0, z: 2.0 },
    rotation: { x: 0, y: 0, z: 0 },
    verticalFov: [-25, 15],
    horizontalFov: [-180, 180],
    beams: 32,
    horizontalResolution: 0.5,
    maxRange: 100,
    isFMCW: false,
  },
  // Browser-interactive scan: ~8x fewer rays than the full 32-beam / 0.5° cloud
  browserLite: {
    id: 'browser_lite',
    position: { x: 0, y: 0, z: 2.0 },
    rotation: { x: 0, y: 0, z: 0 },
    verticalFov: [-20, 10],
    horizontalFov: [-180, 180],
    beams: 16,
    horizontalResolution: 2,
    maxRange: 80,
    isFMCW: false,
  },
  qualityLow: {
    id: 'quality_low',
    position: { x: 0, y: 0, z: 2.0 },
    rotation: { x: 0, y: 0, z: 0 },
    verticalFov: [-18, 8],
    horizontalFov: [-180, 180],
    beams: 8,
    horizontalResolution: 3,
    maxRange: 55,
    isFMCW: false,
  },
  qualityMed: {
    id: 'quality_med',
    position: { x: 0, y: 0, z: 2.0 },
    rotation: { x: 0, y: 0, z: 0 },
    verticalFov: [-20, 10],
    horizontalFov: [-180, 180],
    beams: 16,
    horizontalResolution: 2,
    maxRange: 80,
    isFMCW: false,
  },
  qualityHigh: {
    id: 'quality_high',
    position: { x: 0, y: 0, z: 2.0 },
    rotation: { x: 0, y: 0, z: 0 },
    verticalFov: [-22, 12],
    horizontalFov: [-180, 180],
    beams: 32,
    horizontalResolution: 1,
    maxRange: 100,
    isFMCW: false,
  },
  frontLidarLeft: {
    id: 'front_lidar_left',
    position: { x: 2, y: 0.5, z: 0.5 },
    rotation: { x: 0, y: 0, z: 0.2 },
    verticalFov: [-15, 5],
    horizontalFov: [-60, 60],
    beams: 16,
    horizontalResolution: 0.5,
    maxRange: 50,
    isFMCW: false,
  },
  frontLidarRight: {
    id: 'front_lidar_right',
    position: { x: 2, y: -0.5, z: 0.5 },
    rotation: { x: 0, y: 0, z: -0.2 },
    verticalFov: [-15, 5],
    horizontalFov: [-60, 60],
    beams: 16,
    horizontalResolution: 0.5,
    maxRange: 50,
    isFMCW: false,
  },
};
