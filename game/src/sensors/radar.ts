/**
 * Radar sensor simulation
 * Includes sea clutter for maritime applications
 */

import type { 
  RadarConfig, RadarDetection, Entity, Environment, EgoState 
} from '../sim/types';
import { vec3Sub, vec3Dot, vec3Length, rotateVec3, SeededRandom } from '../sim/math';

export interface RadarScanResult {
  timestamp: number;
  detections: RadarDetection[];
  sensorId: string;
}

export function simulateRadarScan(
  config: RadarConfig,
  egoState: EgoState,
  entities: Entity[],
  environment: Environment,
  timestamp: number,
  seed: number,
  isMaritime: boolean = false
): RadarScanResult {
  const rng = new SeededRandom(seed + timestamp);
  const detections: RadarDetection[] = [];
  
  // Sensor position and direction in world frame
  const sensorWorldPos = rotateVec3(config.position, egoState.transform.rotation);
  const sensorPos = {
    x: egoState.transform.position.x + sensorWorldPos.x,
    y: egoState.transform.position.y + sensorWorldPos.y,
    z: egoState.transform.position.z + sensorWorldPos.z,
  };
  const sensorYaw = egoState.transform.rotation + config.rotation.z;
  
  // Check each entity
  for (const entity of entities) {
    const relPos = vec3Sub(entity.boundingBox.center, sensorPos);
    const range = vec3Length(relPos);
    
    // Skip if out of range
    if (range > config.maxRange || range < 1) continue;
    
    // Calculate azimuth angle
    const azimuth = Math.atan2(relPos.y, relPos.x) - sensorYaw;
    
    // Check FOV
    const fovMin = (config.fov[0] * Math.PI) / 180;
    const fovMax = (config.fov[1] * Math.PI) / 180;
    if (azimuth < fovMin || azimuth > fovMax) continue;
    
    // Radar cross section (simplified - larger objects have larger RCS)
    const size = entity.boundingBox.size;
    const rcs = Math.log10(size.x * size.y + 1) * 10; // dBsm
    
    // Skip if RCS too small
    if (rcs < -10) continue;
    
    // Radial velocity
    const relVel = vec3Sub(entity.velocity, egoState.velocity);
    const direction = { x: relPos.x / range, y: relPos.y / range, z: relPos.z / range };
    const radialVelocity = vec3Dot(relVel, direction);
    
    // Add noise
    const rangeNoise = rng.nextGaussian(0, 0.5); // 0.5m range noise
    const azimuthNoise = rng.nextGaussian(0, 0.02); // ~1 degree
    const velocityNoise = rng.nextGaussian(0, 0.2); // 0.2 m/s
    
    // Weather effects
    let detectionProb = 1.0;
    if (environment.weather === 'rain') detectionProb *= 0.9;
    if (environment.weather === 'fog') detectionProb *= 0.95; // Radar handles fog well
    
    if (rng.next() < detectionProb) {
      detections.push({
        range: range + rangeNoise,
        azimuth: azimuth + azimuthNoise,
        radialVelocity: radialVelocity + velocityNoise,
        rcs,
        groundTruthId: entity.id,
      });
    }
  }
  
  // Add sea clutter for maritime
  if (isMaritime) {
    const numClutter = Math.floor(rng.next() * 20);
    for (let i = 0; i < numClutter; i++) {
      const clutterRange = rng.nextFloat(10, config.maxRange * 0.7);
      const clutterAzimuth = rng.nextFloat(
        (config.fov[0] * Math.PI) / 180,
        (config.fov[1] * Math.PI) / 180
      );
      
      detections.push({
        range: clutterRange,
        azimuth: clutterAzimuth,
        radialVelocity: rng.nextGaussian(0, 2), // Random movement (waves)
        rcs: rng.nextFloat(-20, -5), // Small RCS
        groundTruthId: undefined,
      });
    }
  }
  
  return {
    timestamp,
    detections,
    sensorId: config.id,
  };
}

// Default radar configurations
export const RADAR_CONFIGS: Record<string, RadarConfig> = {
  frontRadar: {
    id: 'front_radar',
    position: { x: 3.5, y: 0, z: 0.5 },
    rotation: { x: 0, y: 0, z: 0 },
    fov: [-45, 45],
    maxRange: 200,
  },
  rearRadar: {
    id: 'rear_radar',
    position: { x: -2, y: 0, z: 0.5 },
    rotation: { x: 0, y: 0, z: Math.PI },
    fov: [-45, 45],
    maxRange: 100,
  },
  sideRadarLeft: {
    id: 'side_radar_left',
    position: { x: 0, y: 1, z: 0.5 },
    rotation: { x: 0, y: 0, z: Math.PI / 2 },
    fov: [-60, 60],
    maxRange: 50,
  },
  sideRadarRight: {
    id: 'side_radar_right',
    position: { x: 0, y: -1, z: 0.5 },
    rotation: { x: 0, y: 0, z: -Math.PI / 2 },
    fov: [-60, 60],
    maxRange: 50,
  },
  marineRadar: {
    id: 'marine_radar',
    position: { x: 0, y: 0, z: 15 },
    rotation: { x: 0, y: 0, z: 0 },
    fov: [-180, 180],
    maxRange: 5000, // 5km for maritime
  },
};
