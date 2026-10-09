/**
 * Main simulation loop - renderer-independent
 * Can run in browser or headless in Node.js
 */

import type {
  Entity, EgoState, Environment, Scenario,
  RideRequest, TakeoverEvent, Vec3
} from './types';
import { 
  CityConfig, WorldMap, generateCityMap, updateTrafficLights,
  TrafficVehicle, updateTrafficVehicle, Pedestrian, updatePedestrian,
  generateRideRequest
} from './world';
import { vec3, vec3Distance, SeededRandom } from './math';
import { createEgoState, updateVehicle, VehicleInput } from './vehicle';
import { simulateLidarScan, LIDAR_CONFIGS } from '../sensors/lidar';
import { runPerception, Track } from '../stacks/perception';
import { planTrajectory, createPlannerState, PlannerState, oracleSupervisor } from '../planning/planner';
import { Recorder, Recording } from '../recorder/recorder';

export interface SimulationConfig {
  seed: number;
  profile: string;
  environment: Environment;
  useOracle: boolean;
  maxDuration: number; // seconds
  cityConfig: CityConfig;
}

const DEFAULT_CITY_CONFIG: CityConfig = {
  gridSize: 6,
  blockSize: 100,
  laneWidth: 3.5,
  sidewalkWidth: 2,
};

export interface SimulationState {
  timestamp: number;
  frameNumber: number;
  worldMap: WorldMap;
  ego: EgoState;
  trafficVehicles: TrafficVehicle[];
  pedestrians: Pedestrian[];
  environment: Environment;
  rideRequests: RideRequest[];
  currentRide: RideRequest | null;
  route: Vec3[];
  plannerState: PlannerState;
  perceptionTracks: Track[];
  activeScenarios: Scenario[];
  isRunning: boolean;
  controlSource: 'policy' | 'human' | 'oracle';
  lastTakeover?: TakeoverEvent;
}

export class Simulation {
  private config: SimulationConfig;
  private state: SimulationState;
  private recorder: Recorder;
  private rng: SeededRandom;
  private entityIdCounter: number = 0;
  
  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = {
      seed: config.seed ?? Date.now(),
      profile: config.profile ?? 'baseline_lidar',
      environment: config.environment ?? { timeOfDay: 'day', weather: 'clear', visibility: 1 },
      useOracle: config.useOracle ?? false,
      maxDuration: config.maxDuration ?? 300,
      cityConfig: config.cityConfig ?? DEFAULT_CITY_CONFIG,
    };
    
    this.rng = new SeededRandom(this.config.seed);
    this.recorder = new Recorder(
      this.config.profile,
      this.config.seed,
      this.config.environment
    );
    
    this.state = this.initializeState();
  }
  
  private initializeState(): SimulationState {
    const worldMap = generateCityMap(this.config.seed, this.config.cityConfig);
    
    // Spawn ego at first spawn point
    const spawnPoint = worldMap.spawnPoints[0] ?? vec3(0, 0, 0);
    const ego = createEgoState('car', spawnPoint, Math.PI / 2);
    
    // Create initial traffic
    const trafficVehicles = this.spawnTrafficVehicles(worldMap, 20);
    
    // Create initial pedestrians
    const pedestrians = this.spawnPedestrians(worldMap, 30);
    
    // Generate initial ride request
    const rideRequest = generateRideRequest(worldMap.pickupPoints, this.rng, 1);
    
    return {
      timestamp: 0,
      frameNumber: 0,
      worldMap,
      ego,
      trafficVehicles,
      pedestrians,
      environment: this.config.environment,
      rideRequests: [rideRequest],
      currentRide: null,
      route: [],
      plannerState: createPlannerState(),
      perceptionTracks: [],
      activeScenarios: [],
      isRunning: true,
      controlSource: 'policy',
    };
  }
  
  private spawnTrafficVehicles(worldMap: WorldMap, count: number): TrafficVehicle[] {
    const vehicles: TrafficVehicle[] = [];
    
    for (let i = 0; i < count; i++) {
      const laneIdx = this.rng.nextInt(0, worldMap.lanes.length - 1);
      const lane = worldMap.lanes[laneIdx]!;
      if (lane.type !== 'driving' || lane.points.length < 2) continue;
      
      const progress = this.rng.nextFloat(0.1, 0.9);
      const pointIdx = Math.floor(progress * (lane.points.length - 1));
      const point = lane.points[pointIdx]!;
      
      vehicles.push({
        id: this.entityIdCounter++,
        classType: this.rng.next() < 0.1 ? 'truck' : 'car',
        transform: { position: point.position, rotation: point.direction },
        boundingBox: {
          center: point.position,
          size: this.rng.next() < 0.1 ? vec3(8, 2.5, 3) : vec3(4.5, 1.8, 1.5),
          yaw: point.direction,
        },
        velocity: vec3(0, 0, 0),
        isStatic: false,
        occlusionLevel: 0,
        laneId: lane.id,
        laneProgress: progress,
        targetSpeed: point.speedLimit * this.rng.nextFloat(0.8, 1.0),
      });
    }
    
    return vehicles;
  }
  
  private spawnPedestrians(_worldMap: WorldMap, count: number): Pedestrian[] {
    const pedestrians: Pedestrian[] = [];
    
    for (let i = 0; i < count; i++) {
      const x = this.rng.nextFloat(-200, 200);
      const y = this.rng.nextFloat(-200, 200);
      
      pedestrians.push({
        id: this.entityIdCounter++,
        classType: 'pedestrian',
        transform: { position: vec3(x, y, 0.9), rotation: this.rng.nextFloat(0, Math.PI * 2) },
        boundingBox: {
          center: vec3(x, y, 0.9),
          size: vec3(0.5, 0.5, 1.7),
          yaw: 0,
        },
        velocity: vec3(0, 0, 0),
        isStatic: false,
        occlusionLevel: 0,
        targetPosition: vec3(x + this.rng.nextFloat(-30, 30), y + this.rng.nextFloat(-30, 30), 0),
        state: 'walking',
        waitTime: 0,
      });
    }
    
    return pedestrians;
  }
  
  step(dt: number, humanInput?: VehicleInput): void {
    if (!this.state.isRunning) return;
    
    this.state.timestamp += dt * 1000;
    this.state.frameNumber++;
    
    // Update traffic lights
    const trafficLights = updateTrafficLights(
      this.state.worldMap.trafficLights,
      this.state.timestamp
    );
    this.state.worldMap.trafficLights = trafficLights;
    
    // Update traffic vehicles
    for (let i = 0; i < this.state.trafficVehicles.length; i++) {
      this.state.trafficVehicles[i] = updateTrafficVehicle(
        this.state.trafficVehicles[i]!,
        this.state.worldMap.lanes,
        trafficLights,
        this.state.trafficVehicles,
        dt
      );
    }
    
    // Update pedestrians
    for (let i = 0; i < this.state.pedestrians.length; i++) {
      this.state.pedestrians[i] = updatePedestrian(
        this.state.pedestrians[i]!,
        trafficLights,
        dt,
        this.rng
      );
    }
    
    // Collect all entities for sensing
    const allEntities: Entity[] = [
      ...this.state.worldMap.staticEntities,
      ...this.state.trafficVehicles,
      ...this.state.pedestrians,
    ];
    
    // Simulate lidar
    const lidarScan = simulateLidarScan(
      LIDAR_CONFIGS['roofLidar']!,
      this.state.ego,
      allEntities,
      this.state.environment,
      this.state.timestamp,
      this.config.seed
    );
    
    // Run perception
    const { detections, tracks } = runPerception(
      lidarScan.points,
      this.state.perceptionTracks,
      dt
    );
    this.state.perceptionTracks = tracks;
    
    // Plan trajectory
    const plannerInput = {
      egoState: this.state.ego,
      detections,
      route: this.state.route,
      trafficLightStates: new Map(trafficLights.map(l => [l.id, l.state])),
    };
    
    const { output: plannerOutput, newState: newPlannerState } = planTrajectory(
      plannerInput,
      this.state.plannerState
    );
    this.state.plannerState = newPlannerState;
    
    // Determine control input
    let vehicleInput: VehicleInput;
    let takeover: TakeoverEvent | undefined;
    
    if (humanInput) {
      // Human takeover
      vehicleInput = humanInput;
      this.state.controlSource = 'human';
    } else if (this.config.useOracle) {
      // Check oracle supervisor
      const groundTruthDetections = allEntities
        .filter(e => !e.isStatic)
        .map(e => ({
          id: e.id,
          classType: e.classType,
          confidence: 1,
          boundingBox: e.boundingBox,
          velocity: e.velocity,
        }));
      
      const oracleResult = oracleSupervisor(
        this.state.ego,
        groundTruthDetections,
        plannerOutput.acceleration,
        plannerOutput.steering
      );
      
      if (oracleResult.takeover) {
        vehicleInput = {
          throttle: oracleResult.accel! > 0 ? oracleResult.accel! / 3 : 0,
          steering: oracleResult.steering!,
          brake: oracleResult.accel! < 0 ? -oracleResult.accel! / 8 : 0,
        };
        this.state.controlSource = 'oracle';
        takeover = {
          timestamp: this.state.timestamp,
          frameNumber: this.state.frameNumber,
          reason: oracleResult.reason as TakeoverEvent['reason'],
          egoState: this.state.ego,
        };
        this.state.lastTakeover = takeover;
      } else {
        vehicleInput = {
          throttle: plannerOutput.acceleration > 0 ? plannerOutput.acceleration / 3 : 0,
          steering: plannerOutput.steering,
          brake: plannerOutput.acceleration < 0 ? -plannerOutput.acceleration / 8 : 0,
        };
        this.state.controlSource = 'policy';
      }
    } else {
      vehicleInput = {
        throttle: plannerOutput.acceleration > 0 ? plannerOutput.acceleration / 3 : 0,
        steering: plannerOutput.steering,
        brake: plannerOutput.acceleration < 0 ? -plannerOutput.acceleration / 8 : 0,
      };
      this.state.controlSource = 'policy';
    }
    
    // Update ego vehicle
    this.state.ego = updateVehicle(this.state.ego, vehicleInput, dt);
    
    // Record frame
    this.recorder.recordFrame(
      this.state.timestamp,
      this.state.frameNumber,
      this.state.ego,
      allEntities,
      trafficLights,
      { lidarPoints: lidarScan.points },
      { timestamp: this.state.timestamp, detections },
      plannerInput,
      plannerOutput,
      this.state.controlSource,
      this.state.activeScenarios[0],
      takeover
    );
    
    // Check completion
    if (this.state.timestamp / 1000 >= this.config.maxDuration) {
      this.state.isRunning = false;
    }
  }
  
  // Inject a scenario
  injectScenario(scenario: Scenario): void {
    this.state.activeScenarios.push(scenario);
    
    switch (scenario.type) {
      case 'jaywalker':
        this.spawnJaywalker();
        break;
      case 'occluded_pedestrian':
        this.spawnOccludedPedestrian();
        break;
      case 'vehicle_cutin':
        this.spawnCutinVehicle();
        break;
    }
  }
  
  private spawnJaywalker(): void {
    const egoPos = this.state.ego.transform.position;
    const egoYaw = this.state.ego.transform.rotation;
    
    // Spawn 20m ahead, 8m to the side
    const spawnX = egoPos.x + Math.cos(egoYaw) * 20 + Math.cos(egoYaw + Math.PI / 2) * 8;
    const spawnY = egoPos.y + Math.sin(egoYaw) * 20 + Math.sin(egoYaw + Math.PI / 2) * 8;
    
    // Target is across the road
    const targetX = egoPos.x + Math.cos(egoYaw) * 25 + Math.cos(egoYaw - Math.PI / 2) * 8;
    const targetY = egoPos.y + Math.sin(egoYaw) * 25 + Math.sin(egoYaw - Math.PI / 2) * 8;
    
    this.state.pedestrians.push({
      id: this.entityIdCounter++,
      classType: 'pedestrian',
      transform: { position: vec3(spawnX, spawnY, 0.9), rotation: egoYaw - Math.PI / 2 },
      boundingBox: {
        center: vec3(spawnX, spawnY, 0.9),
        size: vec3(0.5, 0.5, 1.7),
        yaw: egoYaw - Math.PI / 2,
      },
      velocity: vec3(0, 0, 0),
      isStatic: false,
      occlusionLevel: 0,
      targetPosition: vec3(targetX, targetY, 0),
      state: 'crossing',
      waitTime: 0,
    });
  }
  
  private spawnOccludedPedestrian(): void {
    const egoPos = this.state.ego.transform.position;
    const egoYaw = this.state.ego.transform.rotation;
    
    // First spawn an occluding truck
    const truckX = egoPos.x + Math.cos(egoYaw) * 15 + Math.cos(egoYaw + Math.PI / 2) * 4;
    const truckY = egoPos.y + Math.sin(egoYaw) * 15 + Math.sin(egoYaw + Math.PI / 2) * 4;
    
    this.state.worldMap.staticEntities.push({
      id: this.entityIdCounter++,
      classType: 'truck',
      transform: { position: vec3(truckX, truckY, 1.5), rotation: egoYaw },
      boundingBox: {
        center: vec3(truckX, truckY, 1.5),
        size: vec3(8, 2.5, 3),
        yaw: egoYaw,
      },
      velocity: vec3(0, 0, 0),
      isStatic: true,
      occlusionLevel: 0,
    });
    
    // Spawn pedestrian behind the truck
    const pedX = truckX + Math.cos(egoYaw + Math.PI / 2) * 3;
    const pedY = truckY + Math.sin(egoYaw + Math.PI / 2) * 3;
    const targetX = pedX + Math.cos(egoYaw - Math.PI / 2) * 12;
    const targetY = pedY + Math.sin(egoYaw - Math.PI / 2) * 12;
    
    this.state.pedestrians.push({
      id: this.entityIdCounter++,
      classType: 'pedestrian',
      transform: { position: vec3(pedX, pedY, 0.9), rotation: egoYaw - Math.PI / 2 },
      boundingBox: {
        center: vec3(pedX, pedY, 0.9),
        size: vec3(0.5, 0.5, 1.7),
        yaw: egoYaw - Math.PI / 2,
      },
      velocity: vec3(0, 0, 0),
      isStatic: false,
      occlusionLevel: 2,
      targetPosition: vec3(targetX, targetY, 0),
      state: 'crossing',
      waitTime: 0,
    });
  }
  
  private spawnCutinVehicle(): void {
    const egoPos = this.state.ego.transform.position;
    const egoYaw = this.state.ego.transform.rotation;
    const egoSpeed = Math.sqrt(
      this.state.ego.velocity.x ** 2 + this.state.ego.velocity.y ** 2
    );
    
    // Spawn in adjacent lane, slightly ahead
    const spawnX = egoPos.x + Math.cos(egoYaw) * 25 + Math.cos(egoYaw + Math.PI / 2) * 4;
    const spawnY = egoPos.y + Math.sin(egoYaw) * 25 + Math.sin(egoYaw + Math.PI / 2) * 4;
    
    // Find a nearby lane
    let targetLane = this.state.worldMap.lanes[0]!;
    let minDist = Infinity;
    
    for (const lane of this.state.worldMap.lanes) {
      if (lane.type !== 'driving') continue;
      for (const pt of lane.points) {
        const dist = vec3Distance(pt.position, vec3(spawnX, spawnY, 0));
        if (dist < minDist) {
          minDist = dist;
          targetLane = lane;
        }
      }
    }
    
    this.state.trafficVehicles.push({
      id: this.entityIdCounter++,
      classType: 'car',
      transform: { position: vec3(spawnX, spawnY, 0.8), rotation: egoYaw },
      boundingBox: {
        center: vec3(spawnX, spawnY, 0.8),
        size: vec3(4.5, 1.8, 1.5),
        yaw: egoYaw,
      },
      velocity: vec3(egoSpeed * 0.8, 0, 0),
      isStatic: false,
      occlusionLevel: 0,
      laneId: targetLane.id,
      laneProgress: 0.5,
      targetSpeed: egoSpeed * 0.7, // Slower, will cut in front
    });
  }
  
  // Takeover by human player
  takeover(reason: TakeoverEvent['reason']): void {
    this.state.controlSource = 'human';
    this.state.lastTakeover = {
      timestamp: this.state.timestamp,
      frameNumber: this.state.frameNumber,
      reason,
      egoState: this.state.ego,
    };
  }
  
  // Hand control back to policy
  releaseControl(): void {
    this.state.controlSource = 'policy';
  }
  
  acceptRide(rideId: number): void {
    const ride = this.state.rideRequests.find(r => r.id === rideId);
    if (ride) {
      ride.status = 'accepted';
      this.state.currentRide = ride;
      this.state.route = this.planRoute(
        this.state.ego.transform.position,
        ride.pickup
      );
    }
  }
  
  private planRoute(from: Vec3, to: Vec3): Vec3[] {
    // Simple straight-line route for now
    // Full implementation would use A* on lane graph
    const route: Vec3[] = [];
    const steps = 20;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      route.push(vec3(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        0
      ));
    }
    
    return route;
  }
  
  getState(): SimulationState {
    return this.state;
  }
  
  getRecording(): Recording {
    return this.recorder.getRecording();
  }
  
  reset(): void {
    this.rng = new SeededRandom(this.config.seed);
    this.recorder.clear();
    this.state = this.initializeState();
  }
}

// Headless simulation runner
export async function runHeadlessSimulation(
  config: Partial<SimulationConfig>,
  scenarios: Scenario[],
  onProgress?: (frame: number, total: number) => void
): Promise<Recording> {
  const sim = new Simulation({
    ...config,
    useOracle: true,
  });
  
  const dt = 0.1; // 10 Hz
  const maxFrames = (config.maxDuration ?? 300) / dt;
  
  // Schedule scenario injections
  const scenarioTimes = scenarios.map((s, i) => ({
    scenario: s,
    frame: Math.floor((i + 1) * maxFrames / (scenarios.length + 1)),
    injected: false,
  }));
  
  let frame = 0;
  while (sim.getState().isRunning && frame < maxFrames) {
    // Inject scenarios at scheduled times
    for (const st of scenarioTimes) {
      if (!st.injected && frame >= st.frame) {
        sim.injectScenario(st.scenario);
        st.injected = true;
      }
    }
    
    sim.step(dt);
    frame++;
    
    if (onProgress && frame % 100 === 0) {
      onProgress(frame, maxFrames);
    }
  }
  
  return sim.getRecording();
}
