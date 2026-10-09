/**
 * Aurora-style Highway Trucking Stack
 * 
 * Features (based on publicly described Aurora approach):
 * - Long-range lidar optimized for highway speeds
 * - Trucking-specific considerations (blind spots, air brake delay)
 * - Highway-focused perception (lane markers, highway signs)
 * - Extended prediction horizons for highway merging
 */

import type {
  Detection, Vec3, EgoState, Entity
} from '../sim/types';
import { 
  vec3, vec3Add, vec3Sub, vec3Scale
} from '../sim/math';
import { Track, runPerception } from './perception';
import { simulateLidarScan, LIDAR_CONFIGS } from '../sensors/lidar';
import { simulateRadarScan, RADAR_CONFIGS } from '../sensors/radar';

// Highway lane representation
export interface HighwayLane {
  id: number;
  centerline: Vec3[];
  laneType: 'travel' | 'hov' | 'shoulder' | 'onramp' | 'offramp';
  speedLimit: number; // m/s
}

// Highway perception output
export interface HighwayDetection extends Detection {
  relativeVelocity: Vec3;
  predictedPosition5s: Vec3; // 5-second prediction for highway speeds
  isCutInRisk: boolean;
  laneIndex: number;
}

// Trucking-specific state
export interface TruckingState {
  tracks: Track[];
  currentLane: number;
  targetLane: number;
  laneChangeProgress: number;
  brakingDelay: number; // Air brake delay simulation
  blindSpotOccupied: { left: boolean; right: boolean };
}

// Simulate long-range lidar for highway
export function runHighwayPerception(
  egoState: EgoState,
  entities: Entity[],
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  existingState: TruckingState,
  timestamp: number,
  seed: number
): {
  detections: HighwayDetection[];
  newState: TruckingState;
} {
  // Use long-range lidar for highway (simulated higher range)
  const lidarConfig = {
    ...LIDAR_CONFIGS['roofLidar']!,
    maxRange: 200, // Extended range for highway
  };
  
  const lidarScan = simulateLidarScan(
    lidarConfig,
    egoState,
    entities,
    environment,
    timestamp,
    seed
  );
  
  // Add front radar for velocity
  const frontRadar = simulateRadarScan(
    RADAR_CONFIGS['frontRadar']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed + 1
  );
  
  // Run base perception
  const { detections: baseDetections, tracks } = runPerception(
    lidarScan.points,
    existingState.tracks,
    0.1
  );
  
  // Enhance detections for highway
  const highwayDetections: HighwayDetection[] = baseDetections.map(det => {
    const relVel = det.velocity 
      ? vec3Sub(det.velocity, egoState.velocity)
      : vec3(0, 0, 0);
    
    // 5-second prediction at highway speeds
    const pred5s = det.velocity
      ? vec3Add(det.boundingBox.center, vec3Scale(det.velocity, 5))
      : det.boundingBox.center;
    
    // Check for cut-in risk (vehicle in adjacent lane moving towards our lane)
    const lateralOffset = Math.abs(det.boundingBox.center.y - egoState.transform.position.y);
    const isCutIn = lateralOffset > 2 && lateralOffset < 6 && 
                    Math.abs(relVel.y) > 0.5 &&
                    det.boundingBox.center.x > egoState.transform.position.x;
    
    return {
      ...det,
      relativeVelocity: relVel,
      predictedPosition5s: pred5s,
      isCutInRisk: isCutIn,
      laneIndex: Math.round((det.boundingBox.center.y - egoState.transform.position.y) / 3.7),
    };
  });
  
  // Check blind spots using radar
  let leftBlind = false;
  let rightBlind = false;
  
  for (const radarDet of frontRadar.detections) {
    const isLeft = radarDet.azimuth > 0.5 && radarDet.azimuth < 2.5;
    const isRight = radarDet.azimuth < -0.5 && radarDet.azimuth > -2.5;
    const isClose = radarDet.range < 15;
    
    if (isLeft && isClose) leftBlind = true;
    if (isRight && isClose) rightBlind = true;
  }
  
  return {
    detections: highwayDetections,
    newState: {
      tracks,
      currentLane: existingState.currentLane,
      targetLane: existingState.targetLane,
      laneChangeProgress: existingState.laneChangeProgress,
      brakingDelay: 0.5, // Air brake delay in seconds
      blindSpotOccupied: { left: leftBlind, right: rightBlind },
    },
  };
}

// Calculate safe following distance for trucking
export function calculateTruckFollowDistance(
  speedMps: number,
  _weather: 'clear' | 'rain' | 'fog'
): number {
  // Trucking rule: 1 second per 10 feet of truck length at minimum
  // Plus stopping distance considerations
  const baseDistance = speedMps * 4; // 4-second following time
  const weatherMultiplier = _weather === 'clear' ? 1 : _weather === 'rain' ? 1.5 : 2;
  return baseDistance * weatherMultiplier;
}

// Info card content
export const AURORA_INFO_CARD = {
  name: 'Aurora-style: Highway Trucking',
  sensors: 'Publicly described: long-range lidar (FirstLight), cameras, radar optimized for highway speeds',
  internals: 'Extended detection range (200m+), 5-second prediction horizons, blind spot monitoring, cut-in detection, air brake delay modeling',
  strengths: 'Optimized for highway driving, handles long stopping distances of trucks, extended prediction for high-speed scenarios',
  weaknesses: 'Less optimized for dense urban environments, requires highway infrastructure',
  example: 'Aurora focuses on autonomous trucking with the Aurora Driver, emphasizing highway safety with longer prediction horizons.',
};
