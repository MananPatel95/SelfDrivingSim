/**
 * Core simulation types - renderer-independent, works in browser and Node.js
 */

// Basic geometry types
export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Transform {
  position: Vec3;
  rotation: number; // yaw in radians
}

export interface BoundingBox3D {
  center: Vec3;
  size: Vec3; // length (x), width (y), height (z)
  yaw: number;
}

// Entity types
export type EntityClass = 
  | 'car' | 'truck' | 'bus' | 'motorcycle' | 'bicycle'
  | 'pedestrian' | 'cyclist'
  | 'traffic_light' | 'traffic_sign' | 'pole' | 'tree'
  | 'building' | 'barrier' | 'cone'
  | 'train' | 'ship' | 'boat' | 'buoy'
  | 'bridge' | 'platform' | 'signal' | 'quay';

export interface Entity {
  id: number;
  classType: EntityClass;
  transform: Transform;
  boundingBox: BoundingBox3D;
  velocity: Vec3;
  isStatic: boolean;
  occlusionLevel: 0 | 1 | 2; // 0 = visible, 1 = partially occluded, 2 = heavily occluded
}

// Ego vehicle types
export type VehicleType = 'car' | 'truck' | 'train' | 'ship';

export interface EgoState {
  vehicleType: VehicleType;
  transform: Transform;
  velocity: Vec3;
  acceleration: Vec3;
  steering: number;
  throttle: number;
  brake: number;
  mass: number; // kg
  stoppingDistance: number; // meters at current speed
}

// Traffic light
export type TrafficLightState = 'red' | 'yellow' | 'green';

export interface TrafficLight {
  id: number;
  position: Vec3;
  state: TrafficLightState;
  forLaneIds: number[];
}

// Road network
export interface LanePoint {
  position: Vec3;
  direction: number; // yaw
  width: number;
  speedLimit: number;
}

export interface Lane {
  id: number;
  points: LanePoint[];
  type: 'driving' | 'parking' | 'sidewalk' | 'crosswalk' | 'rail' | 'water' | 'fairway';
  connections: number[]; // connected lane IDs
}

export interface Intersection {
  id: number;
  center: Vec3;
  radius: number;
  incomingLanes: number[];
  outgoingLanes: number[];
  trafficLightIds: number[];
}

// World state
export interface WorldState {
  timestamp: number; // ms since start
  frameNumber: number;
  entities: Entity[];
  trafficLights: TrafficLight[];
  ego: EgoState;
}

// Environment
export interface Environment {
  timeOfDay: 'day' | 'night';
  weather: 'clear' | 'rain' | 'fog';
  visibility: number; // 0-1
}

// Scenario
export type ScenarioType = 
  | 'jaywalker' 
  | 'occluded_pedestrian' 
  | 'vehicle_cutin'
  | 'weather_change'
  | 'stalled_vehicle'
  | 'heavy_rain'
  | 'dense_fog'
  | 'level_crossing_blocked'
  | 'small_boat_crossing';

export interface Scenario {
  type: ScenarioType;
  triggeredAt?: number;
  params: Record<string, unknown>;
}

// Ride request
export interface RideRequest {
  id: number;
  passengerName: string;
  pickup: Vec3;
  dropoff: Vec3;
  fare: number;
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
}

// Takeover
export type TakeoverReason = 
  | 'perception_miss'
  | 'planning_too_cautious'
  | 'planning_unsafe'
  | 'other';

export interface TakeoverEvent {
  timestamp: number;
  frameNumber: number;
  reason: TakeoverReason;
  egoState: EgoState;
  duration?: number;
}

// Recording frame
export interface RecordingFrame {
  profile: string;
  timestamp: number;
  frameNumber: number;
  environment: Environment;
  scenario?: Scenario;
  scenarioSeed: number;
  egoState: EgoState;
  groundTruth: Entity[];
  trafficLights: TrafficLight[];
  sensorData: SensorDataBundle;
  perceptionOutput: PerceptionOutput;
  plannerInput: PlannerInput;
  plannerOutput: PlannerOutput;
  controlSource: 'policy' | 'human' | 'oracle';
  activeModelVersions: {
    perception?: string;
    policy?: string;
  };
  takeover?: TakeoverEvent;
}

// Sensor data (modality-specific)
export interface LidarPoint {
  x: number;
  y: number;
  z: number;
  intensity: number;
  ring: number;
  radialVelocity?: number; // FMCW only
  groundTruthId?: number;
  groundTruthClass?: EntityClass;
}

export interface RadarDetection {
  range: number;
  azimuth: number;
  radialVelocity: number;
  rcs: number; // radar cross section
  groundTruthId?: number;
}

export interface AISMessage {
  mmsi: number;
  name: string;
  position: Vec3;
  course: number;
  speed: number;
  timestamp: number;
}

export interface SensorDataBundle {
  lidarPoints?: LidarPoint[];
  radarDetections?: RadarDetection[];
  aisMessages?: AISMessage[];
  cameraFrameIds?: string[]; // references to saved images
  depthMapId?: string;
}

// Perception output
export interface Detection {
  id: number;
  classType: EntityClass;
  confidence: number;
  boundingBox: BoundingBox3D;
  velocity?: Vec3;
  trackId?: number;
  pointsInBox?: number;
}

export interface PerceptionOutput {
  timestamp: number;
  detections: Detection[];
  occupancyGrid?: Float32Array; // BEV occupancy
  futureOccupancy?: Float32Array[]; // 1s, 2s, 3s predictions
}

// Planning
export interface Trajectory {
  points: Array<{
    position: Vec3;
    velocity: number;
    timestamp: number;
  }>;
  cost?: number;
}

export interface PlannerInput {
  egoState: EgoState;
  detections: Detection[];
  occupancyGrid?: Float32Array;
  route: Vec3[];
  trafficLightStates: Map<number, TrafficLightState>;
}

export interface PlannerOutput {
  trajectory: Trajectory;
  acceleration: number;
  steering: number;
  candidateTrajectories?: Trajectory[];
  selectedTrajectoryIndex?: number;
}

// Stack profile interface
export interface StackProfile {
  id: string;
  name: string;
  description: string;
  vehicleType: VehicleType;
  sensorSuite: SensorSuiteConfig;
  hasHDMap: boolean;
  hasGeofence: boolean;
}

export interface SensorSuiteConfig {
  lidars: LidarConfig[];
  radars: RadarConfig[];
  cameras: CameraConfig[];
  hasAIS?: boolean;
}

export interface LidarConfig {
  id: string;
  position: Vec3;
  rotation: Vec3;
  verticalFov: [number, number]; // min, max degrees
  horizontalFov: [number, number];
  beams: number;
  horizontalResolution: number;
  maxRange: number;
  isFMCW: boolean;
}

export interface RadarConfig {
  id: string;
  position: Vec3;
  rotation: Vec3;
  fov: [number, number];
  maxRange: number;
}

export interface CameraConfig {
  id: string;
  position: Vec3;
  rotation: Vec3;
  fov: number;
  resolution: [number, number];
}
