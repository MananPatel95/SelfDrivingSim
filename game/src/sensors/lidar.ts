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
import { vec3Add, rotateVec3, vec3Dot, vec3Sub, SeededRandom } from '../sim/math';

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
  
  // Build spatial grid
  const grid = new SpatialGrid(10);
  for (const entity of entities) {
    grid.insert(entity);
  }
  
  // Sensor position in world frame
  const sensorWorldPos = vec3Add(
    egoState.transform.position,
    rotateVec3(config.position, egoState.transform.rotation)
  );
  const sensorWorldYaw = egoState.transform.rotation + config.rotation.z;
  
  // Generate rays
  const rays = generateLidarRays(
    sensorWorldPos,
    sensorWorldYaw,
    config.beams,
    config.verticalFov,
    config.horizontalFov,
    config.horizontalResolution
  );
  
  // Cast rays and collect points
  for (const { ray, ring } of rays) {
    const hit = castRay(ray, entities, config.maxRange, grid);
    
    if (hit) {
      // Apply noise
      const noisyHit = applyLidarNoise(
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
  fmcwLongRange: {
    id: 'fmcw_long_range',
    position: { x: 3, y: 0, z: 1.5 },
    rotation: { x: 0, y: 0, z: 0 },
    verticalFov: [-10, 10],
    horizontalFov: [-30, 30],
    beams: 64,
    horizontalResolution: 0.2,
    maxRange: 300,
    isFMCW: true,
  },
};
