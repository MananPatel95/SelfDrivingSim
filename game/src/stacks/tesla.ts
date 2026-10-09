/**
 * Tesla-style Vision-Only Stack
 * 
 * Features (based on publicly described Tesla approach):
 * - Cameras only (no radar, no lidar)
 * - Depth from monocular inference (simulated with noise)
 * - No HD map; lanes are inferred
 * - End-to-end neural network (pixels → trajectory)
 */

import type {
  Detection, Vec3, EgoState, Entity, BoundingBox3D
} from '../sim/types';
import { 
  vec3, vec3Add, vec3Sub, vec3Scale, vec3Length,
  rotateVec3, SeededRandom
} from '../sim/math';
import { Track, updateTracks, tracksToDetections } from './perception';

// Camera view
export interface CameraView {
  id: string;
  fov: number;
  yaw: number; // Camera facing direction relative to ego
  resolution: [number, number];
}

// Simulated depth from camera
export interface DepthEstimate {
  position: Vec3;
  depth: number;
  uncertainty: number;
  classType: string;
}

// Pseudo-lidar occupancy voxel grid
export interface OccupancyVoxels {
  grid: Float32Array;
  resolution: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

// Inferred lane
export interface InferredLane {
  points: Vec3[];
  confidence: number;
  isEgoLane: boolean;
}

// Tesla stack state
export interface TeslaStackState {
  tracks: Track[];
  occupancyVoxels: OccupancyVoxels;
  inferredLanes: InferredLane[];
  trafficLightState: 'red' | 'yellow' | 'green' | 'unknown';
}

// 8 camera setup (Tesla-like)
export const CAMERA_CONFIG: CameraView[] = [
  { id: 'front_main', fov: 50, yaw: 0, resolution: [1920, 1080] },
  { id: 'front_wide', fov: 120, yaw: 0, resolution: [1920, 1080] },
  { id: 'front_narrow', fov: 35, yaw: 0, resolution: [1920, 1080] },
  { id: 'front_left', fov: 80, yaw: Math.PI / 4, resolution: [1280, 960] },
  { id: 'front_right', fov: 80, yaw: -Math.PI / 4, resolution: [1280, 960] },
  { id: 'side_left', fov: 90, yaw: Math.PI / 2, resolution: [1280, 960] },
  { id: 'side_right', fov: 90, yaw: -Math.PI / 2, resolution: [1280, 960] },
  { id: 'rear', fov: 80, yaw: Math.PI, resolution: [1280, 960] },
];

// Simulate monocular depth estimation with uncertainty
export function estimateDepthFromCamera(
  entity: Entity,
  camera: CameraView,
  egoState: EgoState,
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  rng: SeededRandom
): DepthEstimate | null {
  // Transform entity to ego frame
  const relPos = vec3Sub(entity.boundingBox.center, egoState.transform.position);
  const localPos = rotateVec3(relPos, -egoState.transform.rotation);
  
  // Check if in camera FOV
  const entityAngle = Math.atan2(localPos.y, localPos.x);
  const halfFov = (camera.fov * Math.PI / 180) / 2;
  const cameraAngle = camera.yaw;
  
  const angleDiff = Math.abs(entityAngle - cameraAngle);
  if (angleDiff > halfFov && angleDiff < 2 * Math.PI - halfFov) {
    return null; // Not in FOV
  }
  
  const depth = vec3Length(localPos);
  
  // Depth uncertainty increases with distance (monocular depth is noisy)
  let depthUncertainty = 0.05 * depth; // 5% at baseline
  
  // Weather effects
  if (environment.weather === 'rain') depthUncertainty *= 1.5;
  if (environment.weather === 'fog') depthUncertainty *= 2.5;
  if (environment.timeOfDay === 'night') depthUncertainty *= 2;
  
  // Add noise
  const noisyDepth = depth + rng.nextGaussian(0, depthUncertainty);
  
  // Skip if too uncertain or out of range
  if (noisyDepth < 1 || noisyDepth > 150 || depthUncertainty > depth * 0.5) {
    return null;
  }
  
  return {
    position: vec3Add(egoState.transform.position, vec3Scale(rotateVec3(localPos, egoState.transform.rotation), noisyDepth / depth)),
    depth: noisyDepth,
    uncertainty: depthUncertainty,
    classType: entity.classType,
  };
}

// Create pseudo-lidar occupancy from depth estimates
export function createOccupancyVoxels(
  depthEstimates: DepthEstimate[],
  egoState: EgoState,
  resolution: number = 0.5,
  sizeX: number = 100,
  sizeY: number = 50,
  sizeZ: number = 10
): OccupancyVoxels {
  const gridX = Math.ceil(sizeX / resolution);
  const gridY = Math.ceil(sizeY / resolution);
  const gridZ = Math.ceil(sizeZ / resolution);
  const grid = new Float32Array(gridX * gridY * gridZ);
  
  for (const est of depthEstimates) {
    // Convert to ego-centered grid coordinates
    const relPos = vec3Sub(est.position, egoState.transform.position);
    const localPos = rotateVec3(relPos, -egoState.transform.rotation);
    
    const gx = Math.floor((localPos.x + sizeX / 2) / resolution);
    const gy = Math.floor((localPos.y + sizeY / 2) / resolution);
    const gz = Math.floor(localPos.z / resolution);
    
    if (gx >= 0 && gx < gridX && gy >= 0 && gy < gridY && gz >= 0 && gz < gridZ) {
      const idx = gz * gridX * gridY + gy * gridX + gx;
      // Confidence inversely proportional to uncertainty
      const confidence = 1 / (1 + est.uncertainty / est.depth);
      grid[idx] = Math.max(grid[idx] || 0, confidence);
    }
  }
  
  return { grid, resolution, sizeX, sizeY, sizeZ };
}

// Infer lanes from scene (very simplified)
export function inferLanes(
  egoState: EgoState,
  rng: SeededRandom
): InferredLane[] {
  const lanes: InferredLane[] = [];
  
  // Ego lane (always inferred with high confidence)
  const egoLanePoints: Vec3[] = [];
  for (let d = 0; d < 50; d += 5) {
    const x = egoState.transform.position.x + Math.cos(egoState.transform.rotation) * d;
    const y = egoState.transform.position.y + Math.sin(egoState.transform.rotation) * d;
    egoLanePoints.push(vec3(x + rng.nextGaussian(0, 0.1), y + rng.nextGaussian(0, 0.1), 0));
  }
  lanes.push({
    points: egoLanePoints,
    confidence: 0.85 + rng.nextFloat(0, 0.1),
    isEgoLane: true,
  });
  
  // Adjacent lanes (inferred with lower confidence)
  for (const offset of [-3.5, 3.5]) {
    const lanePoints: Vec3[] = [];
    const perpX = -Math.sin(egoState.transform.rotation) * offset;
    const perpY = Math.cos(egoState.transform.rotation) * offset;
    
    for (let d = 0; d < 40; d += 5) {
      const x = egoState.transform.position.x + Math.cos(egoState.transform.rotation) * d + perpX;
      const y = egoState.transform.position.y + Math.sin(egoState.transform.rotation) * d + perpY;
      lanePoints.push(vec3(x + rng.nextGaussian(0, 0.2), y + rng.nextGaussian(0, 0.2), 0));
    }
    
    lanes.push({
      points: lanePoints,
      confidence: 0.5 + rng.nextFloat(0, 0.3),
      isEgoLane: false,
    });
  }
  
  return lanes;
}

// Detect traffic light state from camera (simplified)
export function detectTrafficLight(
  _entities: Entity[],
  _egoState: EgoState,
  trafficLights: Array<{ state: 'red' | 'yellow' | 'green' }>,
  rng: SeededRandom
): 'red' | 'yellow' | 'green' | 'unknown' {
  // Find closest traffic light ahead
  let closestState: 'red' | 'yellow' | 'green' | 'unknown' = 'unknown';
  
  for (const light of trafficLights) {
    // Assume traffic lights are detected via camera with some chance of error
    if (rng.next() < 0.9) {
      closestState = light.state;
    }
  }
  
  return closestState;
}

// Run Tesla-style vision perception
export function runTeslaPerception(
  egoState: EgoState,
  entities: Entity[],
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  trafficLights: Array<{ state: 'red' | 'yellow' | 'green' }>,
  existingState: TeslaStackState,
  timestamp: number,
  seed: number
): {
  detections: Detection[];
  occupancyVoxels: OccupancyVoxels;
  inferredLanes: InferredLane[];
  newState: TeslaStackState;
} {
  const rng = new SeededRandom(seed + timestamp);
  
  // Get depth estimates from all cameras
  const depthEstimates: DepthEstimate[] = [];
  
  for (const entity of entities) {
    if (entity.isStatic && entity.classType === 'building') continue; // Skip buildings
    
    for (const camera of CAMERA_CONFIG) {
      const estimate = estimateDepthFromCamera(entity, camera, egoState, environment, rng);
      if (estimate) {
        depthEstimates.push(estimate);
        break; // One detection per entity (best camera wins)
      }
    }
  }
  
  // Create occupancy voxels (pseudo-lidar)
  const occupancyVoxels = createOccupancyVoxels(depthEstimates, egoState);
  
  // Convert depth estimates to raw detections
  const rawDetections = depthEstimates.map((est) => {
    // Size estimation is poor from monocular
    const sizeEstimate: BoundingBox3D = {
      center: est.position,
      size: getDefaultSize(est.classType),
      yaw: egoState.transform.rotation, // Can't estimate yaw well
    };
    
    return {
      box: sizeEstimate,
      classType: est.classType as Detection['classType'],
      confidence: 1 / (1 + est.uncertainty / est.depth),
      pointsInBox: Math.floor(100 / (1 + est.uncertainty)),
    };
  });
  
  // Update tracks
  const tracks = updateTracks(existingState.tracks, rawDetections, 0.1);
  const detections = tracksToDetections(tracks);
  
  // Infer lanes
  const inferredLanes = inferLanes(egoState, rng);
  
  // Detect traffic lights
  const trafficLightState = detectTrafficLight(entities, egoState, trafficLights, rng);
  
  return {
    detections,
    occupancyVoxels,
    inferredLanes,
    newState: {
      tracks,
      occupancyVoxels,
      inferredLanes,
      trafficLightState,
    },
  };
}

function getDefaultSize(classType: string): Vec3 {
  switch (classType) {
    case 'car': return vec3(4.5, 1.8, 1.5);
    case 'truck': return vec3(8, 2.5, 3);
    case 'pedestrian': return vec3(0.5, 0.5, 1.7);
    case 'cyclist': return vec3(1.8, 0.5, 1.5);
    default: return vec3(2, 2, 2);
  }
}

// Info card content
export const TESLA_INFO_CARD = {
  name: 'Tesla-style: Vision Only',
  sensors: 'Publicly described: cameras only (Tesla states no radar or lidar is needed)',
  internals: 'Depth from monocular inference, 3D occupancy voxels from cameras (pseudo-lidar), lanes inferred (no HD map), traffic light detection from vision, end-to-end neural network (pixels → trajectory)',
  strengths: 'Lower cost sensors, no lidar or radar needed, works globally without pre-mapping, can read traffic signs/lights',
  weaknesses: 'Depth uncertainty at range (especially at night or in rain), no instant velocity measurements, dependent on good lighting and visibility',
  example: 'Tesla FSD is described as an end-to-end neural network using cameras only, without relying on detailed pre-built HD maps.',
};
