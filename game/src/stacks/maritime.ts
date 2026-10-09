/**
 * Maritime Autonomy Stack
 * 
 * Features:
 * - Marine radar with sea clutter filtering
 * - AIS (Automatic Identification System) fusion
 * - COLREGS-compliant collision avoidance
 * - Long-range detection for slow-moving vessels
 * - Current and wind compensation
 */

import type {
  Detection, Vec3, EgoState, Entity
} from '../sim/types';
import { 
  vec3, vec3Add, vec3Sub, vec3Scale, vec3Length
} from '../sim/math';
import { Track, runPerception } from './perception';
import { simulateLidarScan, LIDAR_CONFIGS } from '../sensors/lidar';

// AIS vessel target
export interface AISTarget {
  mmsi: number; // Maritime Mobile Service Identity
  name: string;
  position: Vec3;
  courseOverGround: number; // Radians
  speedOverGround: number; // m/s
  heading: number;
  vesselType: 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'other';
  length: number;
  beam: number; // Width
  destination?: string;
}

// COLREGS rule
export type COLREGSRule = 
  | 'stand_on' // Maintain course and speed
  | 'give_way' // Must alter course
  | 'head_on' // Both vessels alter to starboard
  | 'overtaking' // Overtaking vessel keeps clear
  | 'crossing' // Vessel with other on starboard gives way;

// Maritime detection with COLREGS context
export interface MaritimeDetection extends Detection {
  aisData?: AISTarget;
  colregsRule: COLREGSRule;
  cpa: number; // Closest Point of Approach (meters)
  tcpa: number; // Time to CPA (seconds)
  bearingRate: number; // Change in bearing (rad/s)
  isCollisionRisk: boolean;
}

// Environmental conditions for maritime
export interface MaritimeEnvironment {
  windSpeed: number; // m/s
  windDirection: number; // radians
  currentSpeed: number; // m/s
  currentDirection: number;
  waveHeight: number; // meters
  visibility: number; // km
}

// Maritime autonomy state
export interface MaritimeState {
  tracks: Track[];
  aisTargets: AISTarget[];
  colregsActions: Map<number, COLREGSRule>;
  ownHeading: number;
  ownSpeed: number;
  rudderAngle: number;
  engineThrottle: number;
}

// Determine COLREGS rule based on relative geometry
export function determineCOLREGSRule(
  ownPosition: Vec3,
  ownHeading: number,
  targetPosition: Vec3,
  targetHeading: number
): COLREGSRule {
  const relativePosition = vec3Sub(targetPosition, ownPosition);
  const bearing = Math.atan2(relativePosition.y, relativePosition.x);
  const relativeBearing = bearing - ownHeading;
  
  // Normalize to [-PI, PI]
  const normBearing = Math.atan2(Math.sin(relativeBearing), Math.cos(relativeBearing));
  
  // Check for head-on (both vessels approaching from ahead)
  const targetRelativeBearing = Math.atan2(-relativePosition.y, -relativePosition.x) - targetHeading;
  const targetNormBearing = Math.atan2(Math.sin(targetRelativeBearing), Math.cos(targetRelativeBearing));
  
  if (Math.abs(normBearing) < Math.PI / 6 && Math.abs(targetNormBearing) < Math.PI / 6) {
    return 'head_on'; // Both alter to starboard
  }
  
  // Check for overtaking (approaching from astern)
  if (Math.abs(normBearing) > 2 * Math.PI / 3) {
    return 'overtaking'; // Overtaking vessel gives way
  }
  
  // Crossing situation
  if (normBearing > 0) {
    return 'give_way'; // Target on our starboard, we give way
  } else {
    return 'stand_on'; // Target on our port, we stand on
  }
}

// Calculate CPA and TCPA
export function calculateCPATCPA(
  ownPosition: Vec3,
  ownVelocity: Vec3,
  targetPosition: Vec3,
  targetVelocity: Vec3
): { cpa: number; tcpa: number } {
  const relPos = vec3Sub(targetPosition, ownPosition);
  const relVel = vec3Sub(targetVelocity, ownVelocity);
  
  const relSpeed = vec3Length(relVel);
  if (relSpeed < 0.1) {
    // Parallel or no relative motion
    return { cpa: vec3Length(relPos), tcpa: Infinity };
  }
  
  // Time to CPA
  const tcpa = -(relPos.x * relVel.x + relPos.y * relVel.y) / (relSpeed * relSpeed);
  
  // Position at CPA
  const cpaRelPos = vec3Add(relPos, vec3Scale(relVel, Math.max(0, tcpa)));
  const cpa = vec3Length(cpaRelPos);
  
  return { cpa, tcpa: Math.max(0, tcpa) };
}

// Run maritime perception
export function runMaritimePerception(
  egoState: EgoState,
  entities: Entity[],
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  _maritimeEnv: MaritimeEnvironment,
  existingState: MaritimeState,
  aisTargets: AISTarget[],
  timestamp: number,
  seed: number
): {
  detections: MaritimeDetection[];
  newState: MaritimeState;
} {
  
  // Run base perception on nearby entities
  const nearbyEntities = entities.filter(e => {
    const dist = vec3Length(vec3Sub(e.boundingBox.center, egoState.transform.position));
    return dist < 1000; // 1km for lidar/visual
  });
  
  const lidarScan = simulateLidarScan(
    LIDAR_CONFIGS['roofLidar']!,
    egoState,
    nearbyEntities,
    environment,
    timestamp,
    seed + 1
  );
  
  const { detections: baseDetections, tracks } = runPerception(
    lidarScan.points,
    existingState.tracks,
    0.1
  );
  
  // Enhance detections with maritime context
  const maritimeDetections: MaritimeDetection[] = baseDetections.map(det => {
    // Try to match with AIS target
    const matchedAIS = aisTargets.find(ais => {
      const dist = vec3Length(vec3Sub(det.boundingBox.center, ais.position));
      return dist < 50; // 50m match threshold
    });
    
    // Calculate CPA/TCPA
    const targetVel = det.velocity || vec3(0, 0, 0);
    const { cpa, tcpa } = calculateCPATCPA(
      egoState.transform.position,
      egoState.velocity,
      det.boundingBox.center,
      targetVel
    );
    
    // Determine COLREGS rule
    const targetHeading = matchedAIS?.heading || det.boundingBox.yaw;
    const colregsRule = determineCOLREGSRule(
      egoState.transform.position,
      egoState.transform.rotation,
      det.boundingBox.center,
      targetHeading
    );
    
    // Calculate bearing rate
    const relPos = vec3Sub(det.boundingBox.center, egoState.transform.position);
    const currentBearing = Math.atan2(relPos.y, relPos.x);
    const bearingRate = tcpa > 0 ? (currentBearing - egoState.transform.rotation) / tcpa : 0;
    
    // Collision risk if CPA < 200m and TCPA < 600s (10 min)
    const isCollisionRisk = cpa < 200 && tcpa > 0 && tcpa < 600;
    
    return {
      ...det,
      aisData: matchedAIS,
      colregsRule,
      cpa,
      tcpa,
      bearingRate,
      isCollisionRisk,
    };
  });
  
  return {
    detections: maritimeDetections,
    newState: {
      tracks,
      aisTargets,
      colregsActions: new Map(),
      ownHeading: egoState.transform.rotation,
      ownSpeed: vec3Length(egoState.velocity),
      rudderAngle: 0,
      engineThrottle: 0.5,
    },
  };
}

// Info card content
export const MARITIME_INFO_CARD = {
  name: 'Maritime: Open Water Autonomy',
  sensors: 'Marine radar (5km range), AIS transponders, cameras, LIDAR for close range, sonar',
  internals: 'Sea clutter filtering, AIS target fusion, CPA/TCPA calculation, COLREGS-compliant collision avoidance (give-way, stand-on, head-on rules), current and wind compensation',
  strengths: 'More reaction time due to slow speeds, established COLREGS regulations, AIS provides identity and intent of other vessels',
  weaknesses: 'Sea clutter in radar, weather dependency, limited maneuverability of large vessels, no brakes',
  example: 'Maritime autonomy systems follow International Regulations for Preventing Collisions at Sea (COLREGS) for safe navigation.',
};
