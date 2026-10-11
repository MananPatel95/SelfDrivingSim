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

/** AIS contacts placed hundreds of metres out on open-water geometries. */
export function createHarbourTraffic(): AISTarget[] {
  return [
    {
      // Head-on, 280 m to port, ~900 m ahead. Uncorrected CPA ≈ 280 m.
      // Starboard give-way increases CPA (opens to the east).
      mmsi: 123456789,
      name: 'CARGO STAR',
      position: { x: -280, y: 900, z: 0 },
      courseOverGround: -Math.PI / 2,
      speedOverGround: 5,
      heading: -Math.PI / 2,
      vesselType: 'cargo',
      length: 150,
      beam: 25,
    },
    {
      // Crossing from port at long range. CPA hundreds of metres.
      mmsi: 234567890,
      name: 'TANKER PRIME',
      position: { x: -620, y: 380, z: 0 },
      courseOverGround: 0,
      speedOverGround: 4,
      heading: 0,
      vesselType: 'tanker',
      length: 200,
      beam: 30,
    },
    {
      // Parallel / clear, large CPA.
      mmsi: 345678901,
      name: 'FERRY SWIFT',
      position: { x: 780, y: -180, z: 0 },
      courseOverGround: Math.PI / 2,
      speedOverGround: 7,
      heading: Math.PI / 2,
      vesselType: 'passenger',
      length: 100,
      beam: 20,
    },
  ];
}

export interface MaritimeEncounter {
  name: string;
  rule: COLREGSRule;
  cpa: number;
  tcpa: number;
  initialCpa: number;
  cpaDelta: number;
  range: number;
}

export interface COLREGSHelm {
  headingTarget: number | null;
  initialCpas: Map<string, number>;
  giveWayStarted: boolean;
}

export function createCOLREGSHelm(): COLREGSHelm {
  return { headingTarget: null, initialCpas: new Map(), giveWayStarted: false };
}

export function stepAISTargets(targets: AISTarget[], dt: number): AISTarget[] {
  return targets.map(t => ({
    ...t,
    position: {
      x: t.position.x + Math.cos(t.courseOverGround) * t.speedOverGround * dt,
      y: t.position.y + Math.sin(t.courseOverGround) * t.speedOverGround * dt,
      z: t.position.z,
    },
  }));
}

export function evaluateEncounters(
  egoPos: Vec3,
  egoVel: Vec3,
  egoHeading: number,
  targets: AISTarget[],
  helm: COLREGSHelm
): MaritimeEncounter[] {
  return targets.map(target => {
    const targetVel = {
      x: Math.cos(target.courseOverGround) * target.speedOverGround,
      y: Math.sin(target.courseOverGround) * target.speedOverGround,
      z: 0,
    };
    const { cpa, tcpa } = calculateCPATCPA(egoPos, egoVel, target.position, targetVel);
    const rule = determineCOLREGSRule(egoPos, egoHeading, target.position, target.heading);
    if (!helm.initialCpas.has(target.name)) {
      helm.initialCpas.set(target.name, cpa);
    }
    const initialCpa = helm.initialCpas.get(target.name) ?? cpa;
    const dx = target.position.x - egoPos.x;
    const dy = target.position.y - egoPos.y;
    return {
      name: target.name,
      rule,
      cpa,
      tcpa,
      initialCpa,
      cpaDelta: cpa - initialCpa,
      range: Math.sqrt(dx * dx + dy * dy),
    };
  });
}

export function planCOLREGSManoeuvre(
  egoHeading: number,
  encounters: MaritimeEncounter[],
  helm: COLREGSHelm
): { steering: number; throttle: number; primary: MaritimeEncounter | null; action: string } {
  let primary: MaritimeEncounter | null = null;
  let bestScore = Infinity;
  for (const enc of encounters) {
    if (enc.tcpa <= 0 || enc.tcpa > 180) continue;
    const score = enc.tcpa + enc.cpa / 20;
    if (score < bestScore) {
      bestScore = score;
      primary = enc;
    }
  }

  const needsGiveWay = !!primary && (
    primary.rule === 'head_on' || primary.rule === 'give_way' || primary.rule === 'crossing'
  ) && primary.cpa < 600;

  if (needsGiveWay && helm.headingTarget === null) {
    // Starboard is clockwise = decreasing yaw in this world frame.
    helm.headingTarget = egoHeading - (22 * Math.PI / 180);
    helm.giveWayStarted = true;
  }

  let steering = 0;
  let action = 'Monitor situation';
  if (helm.headingTarget !== null) {
    let err = helm.headingTarget - egoHeading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    steering = Math.max(-1, Math.min(1, err / 0.25));
    if (Math.abs(err) < 0.04) steering = 0;
    const trend = primary && primary.cpaDelta > 5 ? 'CPA opening' : 'CPA holding';
    action = `ACTION: Alter 22° to starboard — ${trend}`;
  } else if (primary?.rule === 'stand_on') {
    action = 'ACTION: Maintain course and speed';
  }

  return { steering, throttle: 0.45, primary, action };
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
