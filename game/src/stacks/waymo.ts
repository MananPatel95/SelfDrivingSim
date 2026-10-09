/**
 * Waymo-style Multi-sensor + HD Map Stack
 * 
 * Features (based on publicly described Waymo Driver):
 * - 13 cameras, 4 lidars, 6 radars (we simulate roof lidar + perimeter + radar)
 * - HD prior map with lane centerlines, stop lines, crosswalks, lights
 * - Localization by matching lidar to map with uncertainty ellipse
 * - Geofence: refuses rides outside mapped zone
 * - Multi-sensor fusion: per-sensor detections → fused tracks
 */

import type {
  LidarPoint, Detection, Vec3, EgoState, Entity, RadarDetection,
  Lane, TrafficLight
} from '../sim/types';
import { 
  vec3, vec3Add, vec3Scale, vec3Distance, 
  SeededRandom 
} from '../sim/math';
import { Track, runPerception } from './perception';
import { simulateLidarScan, LIDAR_CONFIGS, mergeLidarScans } from '../sensors/lidar';
import { simulateRadarScan, RADAR_CONFIGS } from '../sensors/radar';

// HD Map representation
export interface HDMap {
  laneCenterlines: Lane[];
  stopLines: Array<{ position: Vec3; laneId: number }>;
  crosswalks: Array<{ corners: [Vec3, Vec3, Vec3, Vec3] }>;
  trafficLightPositions: Array<{ position: Vec3; laneIds: number[] }>;
  geofenceBounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// Localization state with uncertainty
export interface LocalizationState {
  pose: { position: Vec3; yaw: number };
  uncertainty: { positionSigma: number; yawSigma: number }; // Meters and radians
  lastMatchScore: number;
}

// Fused detection with multi-sensor confidence
export interface FusedDetection extends Detection {
  sensors: Array<'lidar' | 'radar' | 'camera'>;
  radarVelocity?: Vec3;
  prediction3s?: Vec3; // 3-second predicted position
}

// Waymo-style stack state
export interface WaymoStackState {
  localization: LocalizationState;
  tracks: Track[];
  hdMap: HDMap;
  insideGeofence: boolean;
}

// Create HD map from world map lanes
export function createHDMap(
  lanes: Lane[],
  trafficLights: TrafficLight[],
  geofenceRadius: number = 250
): HDMap {
  const stopLines: HDMap['stopLines'] = [];
  const crosswalks: HDMap['crosswalks'] = [];
  
  // Extract stop lines and crosswalks from lanes
  for (const lane of lanes) {
    if (lane.type === 'crosswalk' && lane.points.length >= 4) {
      crosswalks.push({
        corners: [
          lane.points[0]!.position,
          lane.points[1]!.position,
          lane.points[2]!.position,
          lane.points[3]!.position,
        ] as [Vec3, Vec3, Vec3, Vec3],
      });
    }
    
    // Add stop line at end of driving lanes (before intersections)
    if (lane.type === 'driving' && lane.points.length > 0) {
      const lastPoint = lane.points[lane.points.length - 1]!;
      stopLines.push({
        position: lastPoint.position,
        laneId: lane.id,
      });
    }
  }
  
  return {
    laneCenterlines: lanes.filter(l => l.type === 'driving'),
    stopLines,
    crosswalks,
    trafficLightPositions: trafficLights.map(l => ({
      position: l.position,
      laneIds: l.forLaneIds,
    })),
    geofenceBounds: {
      minX: -geofenceRadius,
      maxX: geofenceRadius,
      minY: -geofenceRadius,
      maxY: geofenceRadius,
    },
  };
}

// Localize by matching lidar scan to HD map features
export function localize(
  _lidarPoints: LidarPoint[],
  priorPose: { position: Vec3; yaw: number },
  _hdMap: HDMap,
  rng: SeededRandom
): LocalizationState {
  // Simulate ICP-like localization
  // In reality, would match point cloud to map
  
  // Add small uncertainty
  const positionNoise = rng.nextGaussian(0, 0.05);
  const yawNoise = rng.nextGaussian(0, 0.01);
  
  const matchScore = 0.95 + rng.nextFloat(-0.05, 0.05);
  
  // Uncertainty increases if match score is low
  const positionSigma = 0.1 / matchScore;
  const yawSigma = 0.02 / matchScore;
  
  return {
    pose: {
      position: vec3Add(priorPose.position, vec3(positionNoise, positionNoise * 0.5, 0)),
      yaw: priorPose.yaw + yawNoise,
    },
    uncertainty: {
      positionSigma,
      yawSigma,
    },
    lastMatchScore: matchScore,
  };
}

// Check if position is inside geofence
export function isInsideGeofence(position: Vec3, hdMap: HDMap): boolean {
  const bounds = hdMap.geofenceBounds;
  return (
    position.x >= bounds.minX && position.x <= bounds.maxX &&
    position.y >= bounds.minY && position.y <= bounds.maxY
  );
}

// Fuse lidar detections with radar
export function fuseSensors(
  lidarDetections: Detection[],
  radarDetections: RadarDetection[],
  egoState: EgoState
): FusedDetection[] {
  const fused: FusedDetection[] = [];
  const radarMatched = new Set<number>();
  
  // Start with lidar detections
  for (const lidarDet of lidarDetections) {
    const fusedDet: FusedDetection = {
      ...lidarDet,
      sensors: ['lidar'],
    };
    
    // Try to match with radar
    for (let i = 0; i < radarDetections.length; i++) {
      if (radarMatched.has(i)) continue;
      
      const radar = radarDetections[i]!;
      
      // Convert radar polar to Cartesian
      const radarWorldYaw = egoState.transform.rotation + radar.azimuth;
      const radarX = egoState.transform.position.x + Math.cos(radarWorldYaw) * radar.range;
      const radarY = egoState.transform.position.y + Math.sin(radarWorldYaw) * radar.range;
      
      const dist = vec3Distance(
        lidarDet.boundingBox.center,
        vec3(radarX, radarY, lidarDet.boundingBox.center.z)
      );
      
      // Match threshold: 3 meters
      if (dist < 3) {
        radarMatched.add(i);
        fusedDet.sensors.push('radar');
        
        // Use radar velocity (more accurate than tracking-derived)
        const radarVelX = radar.radialVelocity * Math.cos(radarWorldYaw);
        const radarVelY = radar.radialVelocity * Math.sin(radarWorldYaw);
        fusedDet.radarVelocity = vec3(radarVelX, radarVelY, 0);
        
        // Boost confidence with multi-sensor agreement
        fusedDet.confidence = Math.min(0.99, fusedDet.confidence + 0.1);
        break;
      }
    }
    
    // Add 3-second prediction
    const vel = fusedDet.radarVelocity || fusedDet.velocity || vec3(0, 0, 0);
    fusedDet.prediction3s = vec3Add(
      fusedDet.boundingBox.center,
      vec3Scale(vel, 3)
    );
    
    fused.push(fusedDet);
  }
  
  // Add radar-only detections (objects visible to radar but not lidar)
  for (let i = 0; i < radarDetections.length; i++) {
    if (radarMatched.has(i)) continue;
    if (!radarDetections[i]!.groundTruthId) continue; // Skip clutter
    
    const radar = radarDetections[i]!;
    
    const radarWorldYaw = egoState.transform.rotation + radar.azimuth;
    const radarX = egoState.transform.position.x + Math.cos(radarWorldYaw) * radar.range;
    const radarY = egoState.transform.position.y + Math.sin(radarWorldYaw) * radar.range;
    
    const radarVelX = radar.radialVelocity * Math.cos(radarWorldYaw);
    const radarVelY = radar.radialVelocity * Math.sin(radarWorldYaw);
    
    fused.push({
      id: 10000 + i,
      classType: 'car', // Radar can't classify well
      confidence: 0.5,
      boundingBox: {
        center: vec3(radarX, radarY, 1),
        size: vec3(4, 2, 1.5), // Default car size
        yaw: radarWorldYaw,
      },
      velocity: vec3(radarVelX, radarVelY, 0),
      radarVelocity: vec3(radarVelX, radarVelY, 0),
      sensors: ['radar'],
      prediction3s: vec3(
        radarX + radarVelX * 3,
        radarY + radarVelY * 3,
        1
      ),
    });
  }
  
  return fused;
}

// Get lane assignment for a position
export function getLaneAssignment(
  position: Vec3,
  hdMap: HDMap
): { lane: Lane; offset: number; heading: number } | null {
  let closestLane: Lane | null = null;
  let closestDist = Infinity;
  let closestPoint: { position: Vec3; direction: number } | null = null;
  
  for (const lane of hdMap.laneCenterlines) {
    for (const point of lane.points) {
      const dist = vec3Distance(position, point.position);
      if (dist < closestDist) {
        closestDist = dist;
        closestLane = lane;
        closestPoint = point;
      }
    }
  }
  
  if (!closestLane || !closestPoint || closestDist > 10) {
    return null;
  }
  
  return {
    lane: closestLane,
    offset: closestDist,
    heading: closestPoint.direction,
  };
}

// Run full Waymo-style perception
export function runWaymoPerception(
  egoState: EgoState,
  entities: Entity[],
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  hdMap: HDMap,
  existingState: WaymoStackState,
  timestamp: number,
  seed: number
): {
  detections: FusedDetection[];
  newState: WaymoStackState;
} {
  const rng = new SeededRandom(seed + timestamp);
  
  // Simulate multi-lidar (roof + perimeter)
  const roofScan = simulateLidarScan(
    LIDAR_CONFIGS['roofLidar']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed
  );
  
  const frontLeftScan = simulateLidarScan(
    LIDAR_CONFIGS['frontLidarLeft']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed + 1
  );
  
  const frontRightScan = simulateLidarScan(
    LIDAR_CONFIGS['frontLidarRight']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed + 2
  );
  
  // Merge lidar scans
  const allLidarPoints = mergeLidarScans([roofScan, frontLeftScan, frontRightScan]);
  
  // Simulate radar
  const frontRadar = simulateRadarScan(
    RADAR_CONFIGS['frontRadar']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed + 3
  );
  
  const rearRadar = simulateRadarScan(
    RADAR_CONFIGS['rearRadar']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed + 4
  );
  
  const allRadar = [...frontRadar.detections, ...rearRadar.detections];
  
  // Localize against HD map
  const localization = localize(
    allLidarPoints,
    { position: egoState.transform.position, yaw: egoState.transform.rotation },
    hdMap,
    rng
  );
  
  // Check geofence
  const insideGeofence = isInsideGeofence(egoState.transform.position, hdMap);
  
  // Run base perception
  const { detections: lidarDetections, tracks } = runPerception(
    allLidarPoints,
    existingState.tracks,
    0.1
  );
  
  // Fuse with radar
  const fusedDetections = fuseSensors(lidarDetections, allRadar, egoState);
  
  return {
    detections: fusedDetections,
    newState: {
      localization,
      tracks,
      hdMap,
      insideGeofence,
    },
  };
}

// Info card content
export const WAYMO_INFO_CARD = {
  name: 'Waymo-style: Multi-sensor + HD Map',
  sensors: 'Publicly described: 13 cameras, 4 lidars, 6 radars (6th-gen Waymo Driver)',
  internals: 'HD prior map layers (lanes, crosswalks, lights), lidar-to-map localization with pose uncertainty, per-sensor detections → fused tracks with IDs and 3-second predictions',
  strengths: 'Multi-sensor redundancy (lidar, radar, camera), precise localization from detailed maps, handles occlusions via radar, high-quality curated HD maps',
  weaknesses: 'Geofenced to pre-mapped areas, map maintenance required, expensive sensor suite',
  example: 'Waymo operates robotaxis in mapped, geofenced service areas (Phoenix, San Francisco) using detailed prior maps and multi-sensor fusion.',
};
