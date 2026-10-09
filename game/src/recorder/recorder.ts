/**
 * Recording system for data collection
 * Common schema across all profiles
 */

import type {
  RecordingFrame, Entity, EgoState, Environment, Scenario,
  LidarPoint, TrafficLight, PlannerInput, PlannerOutput,
  TakeoverEvent, SensorDataBundle, PerceptionOutput
} from '../sim/types';

export interface Recording {
  version: string;
  profile: string;
  scenarioSeed: number;
  startTimestamp: number;
  environment: Environment;
  frames: RecordingFrame[];
  metadata: RecordingMetadata;
}

export interface RecordingMetadata {
  totalFrames: number;
  duration: number; // seconds
  totalTakeovers: number;
  totalCollisions: number;
  distanceTraveled: number; // meters
  scenarios: string[];
}

export class Recorder {
  private frames: RecordingFrame[] = [];
  private profile: string;
  private scenarioSeed: number;
  private startTimestamp: number;
  private environment: Environment;
  private activeModelVersions: { perception?: string; policy?: string };
  private lastPosition: { x: number; y: number } | null = null;
  private distanceTraveled: number = 0;
  private takeovers: TakeoverEvent[] = [];
  private scenarios: Set<string> = new Set();
  
  constructor(
    profile: string,
    scenarioSeed: number,
    environment: Environment,
    activeModelVersions: { perception?: string; policy?: string } = {}
  ) {
    this.profile = profile;
    this.scenarioSeed = scenarioSeed;
    this.startTimestamp = Date.now();
    this.environment = environment;
    this.activeModelVersions = activeModelVersions;
  }
  
  recordFrame(
    timestamp: number,
    frameNumber: number,
    egoState: EgoState,
    groundTruth: Entity[],
    trafficLights: TrafficLight[],
    sensorData: SensorDataBundle,
    perceptionOutput: PerceptionOutput,
    plannerInput: PlannerInput,
    plannerOutput: PlannerOutput,
    controlSource: 'policy' | 'human' | 'oracle',
    scenario?: Scenario,
    takeover?: TakeoverEvent
  ): void {
    // Track distance
    if (this.lastPosition) {
      const dx = egoState.transform.position.x - this.lastPosition.x;
      const dy = egoState.transform.position.y - this.lastPosition.y;
      this.distanceTraveled += Math.sqrt(dx * dx + dy * dy);
    }
    this.lastPosition = {
      x: egoState.transform.position.x,
      y: egoState.transform.position.y,
    };
    
    // Track scenarios
    if (scenario) {
      this.scenarios.add(scenario.type);
    }
    
    // Track takeovers
    if (takeover) {
      this.takeovers.push(takeover);
    }
    
    const frame: RecordingFrame = {
      profile: this.profile,
      timestamp,
      frameNumber,
      environment: this.environment,
      scenario,
      scenarioSeed: this.scenarioSeed,
      egoState,
      groundTruth,
      trafficLights,
      sensorData,
      perceptionOutput,
      plannerInput,
      plannerOutput,
      controlSource,
      activeModelVersions: this.activeModelVersions,
      takeover,
    };
    
    this.frames.push(frame);
  }
  
  getRecording(): Recording {
    const duration = this.frames.length > 0
      ? (this.frames[this.frames.length - 1]!.timestamp - this.frames[0]!.timestamp) / 1000
      : 0;
    
    return {
      version: '1.0.0',
      profile: this.profile,
      scenarioSeed: this.scenarioSeed,
      startTimestamp: this.startTimestamp,
      environment: this.environment,
      frames: this.frames,
      metadata: {
        totalFrames: this.frames.length,
        duration,
        totalTakeovers: this.takeovers.length,
        totalCollisions: 0, // Would need collision detection
        distanceTraveled: this.distanceTraveled,
        scenarios: Array.from(this.scenarios),
      },
    };
  }
  
  setActiveModelVersions(versions: { perception?: string; policy?: string }): void {
    this.activeModelVersions = versions;
  }
  
  updateEnvironment(environment: Environment): void {
    this.environment = environment;
  }
  
  clear(): void {
    this.frames = [];
    this.lastPosition = null;
    this.distanceTraveled = 0;
    this.takeovers = [];
    this.scenarios.clear();
  }
}

// Export recording to binary format for efficient storage
export function serializeLidarPoints(points: LidarPoint[]): ArrayBuffer {
  // Format: x, y, z, intensity, ring, [radialVelocity] per point
  const hasVelocity = points.length > 0 && points[0]!.radialVelocity !== undefined;
  const floatsPerPoint = hasVelocity ? 6 : 5;
  const buffer = new ArrayBuffer(4 + points.length * floatsPerPoint * 4);
  const view = new DataView(buffer);
  
  // Header: point count
  view.setUint32(0, points.length, true);
  
  let offset = 4;
  for (const p of points) {
    view.setFloat32(offset, p.x, true); offset += 4;
    view.setFloat32(offset, p.y, true); offset += 4;
    view.setFloat32(offset, p.z, true); offset += 4;
    view.setFloat32(offset, p.intensity, true); offset += 4;
    view.setFloat32(offset, p.ring, true); offset += 4;
    if (hasVelocity) {
      view.setFloat32(offset, p.radialVelocity ?? 0, true); offset += 4;
    }
  }
  
  return buffer;
}

export function deserializeLidarPoints(buffer: ArrayBuffer, hasVelocity: boolean = false): LidarPoint[] {
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const points: LidarPoint[] = [];
  const floatsPerPoint = hasVelocity ? 6 : 5;
  
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const point: LidarPoint = {
      x: view.getFloat32(offset, true), 
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
      intensity: view.getFloat32(offset + 12, true),
      ring: view.getFloat32(offset + 16, true),
    };
    
    if (hasVelocity) {
      point.radialVelocity = view.getFloat32(offset + 20, true);
    }
    
    points.push(point);
    offset += floatsPerPoint * 4;
  }
  
  return points;
}

// Export recording to JSON-based format
export function exportRecording(recording: Recording): {
  manifest: string;
  lidarBinary: ArrayBuffer[];
  frameData: string;
} {
  // Create manifest
  const manifest = JSON.stringify({
    version: recording.version,
    profile: recording.profile,
    scenarioSeed: recording.scenarioSeed,
    startTimestamp: recording.startTimestamp,
    environment: recording.environment,
    metadata: recording.metadata,
    frameCount: recording.frames.length,
  }, null, 2);
  
  // Extract lidar data to binary
  const lidarBinary: ArrayBuffer[] = [];
  const framesWithoutLidar = recording.frames.map(frame => {
    if (frame.sensorData.lidarPoints) {
      lidarBinary.push(serializeLidarPoints(frame.sensorData.lidarPoints));
      return {
        ...frame,
        sensorData: {
          ...frame.sensorData,
          lidarPoints: undefined,
          lidarBinaryIndex: lidarBinary.length - 1,
        },
      };
    }
    return frame;
  });
  
  const frameData = JSON.stringify(framesWithoutLidar);
  
  return { manifest, lidarBinary, frameData };
}
