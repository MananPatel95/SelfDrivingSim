/**
 * Rail Autonomy Stack
 * 
 * Features:
 * - Fixed-path motion planning (following track)
 * - Signal-based control system
 * - Track occupancy detection
 * - Long stopping distances (kilometers for freight)
 * - Grade crossing detection
 */

import type {
  Detection, Vec3, EgoState, Entity
} from '../sim/types';
import { 
  vec3Sub, vec3Length
} from '../sim/math';
import { Track, runPerception } from './perception';
import { simulateLidarScan, LIDAR_CONFIGS } from '../sensors/lidar';

// Track segment representation
export interface TrackSegment {
  id: number;
  points: Vec3[];
  maxSpeed: number; // m/s
  gradient: number; // Percent grade
  isElectrified: boolean;
}

// Signal state
export interface RailSignal {
  id: number;
  position: Vec3;
  state: 'clear' | 'approach' | 'stop' | 'restricted';
  distanceToStop: number;
}

// Grade crossing
export interface GradeCrossing {
  id: number;
  position: Vec3;
  state: 'active' | 'inactive'; // Gates down or up
  hasObstruction: boolean;
}

// Rail perception output
export interface RailDetection extends Detection {
  isOnTrack: boolean;
  trackRelativePosition: number; // Lateral offset from track center
  isGradeCrossingObstacle: boolean;
}

// Rail autonomy state
export interface RailState {
  tracks: Track[];
  currentSignal: RailSignal | null;
  nextSignals: RailSignal[];
  currentSpeed: number;
  targetSpeed: number;
  brakingDistance: number;
  emergencyBraking: boolean;
  gradeCrossings: GradeCrossing[];
}

// Calculate braking distance for rail (much longer than road vehicles)
export function calculateRailBrakingDistance(
  speedMps: number,
  trainMassKg: number,
  gradient: number // Positive = uphill, negative = downhill
): number {
  // Simplified braking physics
  // Typical freight train: 1-2 km stopping distance at 60 mph
  const kineticEnergy = 0.5 * trainMassKg * speedMps * speedMps;
  const brakingForce = trainMassKg * 0.05; // ~0.05g deceleration typical
  const gradientForce = trainMassKg * 9.8 * (gradient / 100);
  const effectiveBrakingForce = brakingForce + gradientForce;
  
  if (effectiveBrakingForce <= 0) {
    return Infinity; // Can't stop going downhill with weak brakes
  }
  
  return kineticEnergy / effectiveBrakingForce;
}

// Run rail perception
export function runRailPerception(
  egoState: EgoState,
  entities: Entity[],
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  existingState: RailState,
  trackCenterline: Vec3[],
  timestamp: number,
  seed: number
): {
  detections: RailDetection[];
  newState: RailState;
} {
  // Forward-looking lidar for obstacle detection
  const forwardLidar = {
    ...LIDAR_CONFIGS['roofLidar']!,
    horizontalFovDeg: 60, // Narrower FOV for rail
    maxRange: 300, // Very long range for rail
  };
  
  const lidarScan = simulateLidarScan(
    forwardLidar,
    egoState,
    entities,
    environment,
    timestamp,
    seed
  );
  
  // Run base perception
  const { detections: baseDetections, tracks } = runPerception(
    lidarScan.points,
    existingState.tracks,
    0.1
  );
  
  // Classify detections relative to track
  const railDetections: RailDetection[] = baseDetections.map(det => {
    // Check if detection is on or near track
    let minTrackDist = Infinity;
    for (const trackPoint of trackCenterline) {
      const dist = Math.abs(det.boundingBox.center.y - trackPoint.y);
      if (dist < minTrackDist) minTrackDist = dist;
    }
    
    const isOnTrack = minTrackDist < 3; // Within 3m of track center
    const isGradeCrossing = existingState.gradeCrossings.some(gc => {
      const dist = vec3Length(vec3Sub(det.boundingBox.center, gc.position));
      return dist < 20;
    });
    
    return {
      ...det,
      isOnTrack,
      trackRelativePosition: minTrackDist,
      isGradeCrossingObstacle: isOnTrack && isGradeCrossing,
    };
  });
  
  // Check for track obstructions
  const trackObstructions = railDetections.filter(d => d.isOnTrack);
  const hasEmergency = trackObstructions.some(d => 
    d.boundingBox.center.x < egoState.transform.position.x + existingState.brakingDistance
  );
  
  // Determine target speed based on signals
  let targetSpeed = existingState.targetSpeed;
  if (existingState.currentSignal) {
    switch (existingState.currentSignal.state) {
      case 'stop':
        targetSpeed = 0;
        break;
      case 'approach':
        targetSpeed = Math.min(targetSpeed, 15); // ~30 mph
        break;
      case 'restricted':
        targetSpeed = Math.min(targetSpeed, 7); // ~15 mph
        break;
    }
  }
  
  // Update braking distance
  const trainMass = 1000000; // 1000 tons
  const brakingDist = calculateRailBrakingDistance(
    vec3Length(egoState.velocity),
    trainMass,
    0 // Flat for now
  );
  
  return {
    detections: railDetections,
    newState: {
      tracks,
      currentSignal: existingState.currentSignal,
      nextSignals: existingState.nextSignals,
      currentSpeed: vec3Length(egoState.velocity),
      targetSpeed,
      brakingDistance: brakingDist,
      emergencyBraking: hasEmergency,
      gradeCrossings: existingState.gradeCrossings,
    },
  };
}

// Info card content
export const RAIL_INFO_CARD = {
  name: 'Rail: Fixed-path Autonomy',
  sensors: 'Forward-facing lidar (300m range), radar, track circuit sensors, wayside signals',
  internals: 'Fixed-path motion on track, signal-based speed control, track occupancy detection, grade crossing monitoring, kilometer-scale braking distance modeling',
  strengths: 'Simplified path planning (fixed track), centralized signal control, no lateral steering required, existing safety infrastructure',
  weaknesses: 'Cannot avoid obstacles laterally, very long stopping distances (1-2 km for freight), depends on wayside infrastructure',
  example: 'Rail autonomy systems use fixed track infrastructure and centralized signaling for safe train operations.',
};
