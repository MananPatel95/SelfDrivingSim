/**
 * Main simulation loop - renderer-independent
 * Can run in browser or headless in Node.js
 */

import type {
  Entity, EgoState, Environment, Scenario,
  RideRequest, TakeoverEvent, Vec3, LidarPoint
} from './types';
import { 
  CityConfig, WorldMap, generateCityMap, updateTrafficLights,
  TrafficVehicle, updateTrafficVehicle, Pedestrian, updatePedestrian,
  shouldYieldToPedestrian, type RoadActor,
  generateRideRequest, entityToRoadUser, spawnGraphTraffic, egoAsTraffic,
  isLegitimatelyQueued, nudgeOrRespawn,
  applyTrafficImpulse, knockPedestrian,
} from './world';
import { mergeIntoLaneRoute, placeInRightLane, tripRoute } from './rightLane';
import {
  type RuleDecision,
  type StopBook,
  decideIntersection,
} from './intersectionRules';

export type ZoneType = 'city';
import { vec3, vec3Distance, vec3Length, SeededRandom, egoToWorld, normalizeAngle } from './math';
import { createEgoState, updateVehicle, VehicleInput, vehicleInputFromAccel } from './vehicle';
import { simulateLidarScan, LIDAR_CONFIGS } from '../sensors/lidar';
import { runPerception, Track } from '../stacks/perception';
import { planTrajectory, createPlannerState, remainingRouteDistance, PlannerState, oracleSupervisor } from '../planning/planner';
import { Recorder, Recording } from '../recorder/recorder';
import type { PlannerOutput, LidarConfig } from './types';
import {
  SpatialGrid,
  advanceFurniture,
  applyEgoImpulse,
  applyImpulse,
  colliderRadius,
  egoCollisionBody,
  entityCollisionBody,
  furnitureFallen,
  isBreakableClass,
  isCollidableClass,
  isVehicleClass,
  makeFurnitureBreak,
  obstacleAhead,
  overlapColliders,
  separateBodies,
  separateEntities,
  shouldReportHit,
  shouldSnap,
  sweptBodyHit,
  type CollisionBody,
  type FurnitureBreak,
} from './collision';

export interface SimulationConfig {
  seed: number;
  profile: string;
  environment: Environment;
  useOracle: boolean;
  maxDuration: number; // seconds
  cityConfig: CityConfig;
  zone: ZoneType;
  lidarEveryN: number;
}

const DEFAULT_CITY_CONFIG: CityConfig = {
  gridSize: 6,
  blockSize: 100,
  laneWidth: 3.5,
  sidewalkWidth: 2,
};

export interface CollisionEvent {
  otherId: number;
  classType: string;
  at: number;
}

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
  lastPlannerOutput: PlannerOutput | null;
  lastRule: RuleDecision | null;
  arrived: boolean;
  collisionCount: number;
  lastCollision: CollisionEvent | null;
  collisionLog: CollisionEvent[];
  brokenFurniture: FurnitureBreak[];
}

export class Simulation {
  private config: SimulationConfig;
  private state: SimulationState;
  private recorder: Recorder;
  private rng: SeededRandom;
  private entityIdCounter: number = 0;
  private lastLidarPoints: LidarPoint[] = [];
  private lastPlannerOutput: PlannerOutput | null = null;
  private lidarConfig: LidarConfig = LIDAR_CONFIGS['browserLite']!;
  private lidarEveryN = 2;
  /** Ids currently overlapping the car, so a curb graze is one collision not one per frame. */
  private contactIds = new Set<number>();
  private stopBook: StopBook = { arrivals: new Map() };
  /** Last map-trip destination. Null when Just-drive / cruise has no goal. */
  private tripDestination: Vec3 | null = null;
  private tripHeading = 0;
  private prevEgoX = 0;
  private prevEgoY = 0;
  private spatialGrid = new SpatialGrid(8);
  private shovedStaticIds = new Set<number>();
  /** Ids that recently left contact, so a bounce is one collision not two. */
  private contactHoldUntil = new Map<number, number>();
  
  constructor(config: Partial<SimulationConfig> = {}) {
    const profile = config.profile ?? 'baseline_lidar';
    this.config = {
      seed: config.seed ?? Date.now(),
      profile,
      environment: config.environment ?? { timeOfDay: 'day', weather: 'clear', visibility: 1 },
      useOracle: config.useOracle ?? false,
      maxDuration: config.maxDuration ?? 300,
      cityConfig: config.cityConfig ?? DEFAULT_CITY_CONFIG,
      zone: 'city',
      lidarEveryN: config.lidarEveryN ?? 2,
    };
    this.lidarEveryN = this.config.lidarEveryN;
    
    this.rng = new SeededRandom(this.config.seed);
    this.recorder = new Recorder(
      this.config.profile,
      this.config.seed,
      this.config.environment
    );
    
    this.state = this.initializeState();
    this.prevEgoX = this.state.ego.transform.position.x;
    this.prevEgoY = this.state.ego.transform.position.y;
  }
  
  private initializeState(): SimulationState {
    this.lastPlannerOutput = null;
    this.lastLidarPoints = [];
    this.entityIdCounter = 0;
    this.stopBook = { arrivals: new Map() };
    this.shovedStaticIds.clear();
    this.spatialGrid.clear();
    this.contactIds.clear();
    this.contactHoldUntil.clear();
    const worldMap = generateCityMap(this.config.seed, this.config.cityConfig);
    const spawnPoint = worldMap.spawnPoints[0] ?? vec3(0, 0, 0);
    const ego = createEgoState('car', spawnPoint, Math.PI / 2);
    const trafficVehicles = this.spawnTrafficVehicles(worldMap, 20);
    const pedestrians = this.spawnPedestrians(worldMap, 22);
    
    // Generate ride request only for city zones
    const rideRequests: RideRequest[] = [];
    if (this.config.zone === 'city' && worldMap.pickupPoints.length > 0) {
      rideRequests.push(generateRideRequest(worldMap.pickupPoints, this.rng, 1));
    }
    
    return {
      timestamp: 0,
      frameNumber: 0,
      worldMap,
      ego,
      trafficVehicles,
      pedestrians,
      environment: this.config.environment,
      rideRequests,
      currentRide: null,
      route: [],
      plannerState: createPlannerState(),
      perceptionTracks: [],
      activeScenarios: [],
      isRunning: true,
      controlSource: 'policy',
      lastPlannerOutput: null,
      lastRule: null,
      arrived: false,
      collisionCount: 0,
      lastCollision: null,
      collisionLog: [],
      brokenFurniture: [],
    };
  }
  
  getZone(): ZoneType {
    return 'city';
  }
  
  private spawnTrafficVehicles(_worldMap: WorldMap, count: number): TrafficVehicle[] {
    const egoSpawn = this.config.cityConfig
      ? { x: this.config.cityConfig.laneWidth, y: -22 }
      : { x: 3.5, y: -22 };
    const vehicles = spawnGraphTraffic(
      count,
      this.rng,
      this.entityIdCounter,
      {
        gridSize: this.config.cityConfig.gridSize,
        blockSize: this.config.cityConfig.blockSize,
        laneWidth: this.config.cityConfig.laneWidth,
      },
      { x: egoSpawn.x, y: egoSpawn.y, radius: 18 },
    );
    this.entityIdCounter += vehicles.length;
    return vehicles;
  }
  
  private spawnPedestrians(_worldMap: WorldMap, count: number): Pedestrian[] {
    const pedestrians: Pedestrian[] = [];
    
    // City grid parameters (must match rendering)
    const gridSize = 6;
    const blockSize = 100;
    const halfSize = (gridSize * blockSize) / 2;
    const roadWidth = 14;
    const sidewalkOffset = roadWidth / 2 + 1.5; // Place on sidewalk
    
    const nearSpawn: Array<[number, number, number]> = [
      [8.8, -8, Math.PI / 2],
      [-8.8, 8, -Math.PI / 2],
      [8.8, 18, Math.PI / 2],
      [-8.8, -16, -Math.PI / 2],
      [18, 8.8, 0],
      [-14, -8.8, Math.PI],
      [8.8, 92, -Math.PI / 2],
      [-8.8, 108, Math.PI / 2],
    ];
    for (const [px, py, dir] of nearSpawn) {
      pedestrians.push({
        id: this.entityIdCounter++,
        classType: 'pedestrian',
        transform: { position: vec3(px, py, 0.9), rotation: dir },
        boundingBox: { center: vec3(px, py, 0.9), size: vec3(0.56, 0.56, 1.7), yaw: dir },
        velocity: vec3(Math.cos(dir) * 1.2, Math.sin(dir) * 1.2, 0),
        isStatic: false,
        occlusionLevel: 0,
        targetPosition: vec3(px + Math.cos(dir) * 40, py + Math.sin(dir) * 40, 0),
        state: 'walking',
        waitTime: 0,
      });
    }
    
    for (let i = 0; i < count; i++) {
      // Pick a random road to place pedestrian on sidewalk
      const roadIndex = this.rng.nextInt(0, gridSize);
      const roadPos = -halfSize + roadIndex * blockSize;
      const alongRoad = this.rng.nextFloat(-halfSize + 20, halfSize - 20);
      
      // Randomly choose NS or EW road, left or right sidewalk
      const isNSRoad = this.rng.nextFloat(0, 1) > 0.5;
      const isLeftSide = this.rng.nextFloat(0, 1) > 0.5;
      const sideOffset = isLeftSide ? -sidewalkOffset : sidewalkOffset;
      
      const x = isNSRoad ? roadPos + sideOffset : alongRoad;
      const y = isNSRoad ? alongRoad : roadPos + sideOffset;
      
      const walkDir = isNSRoad ? (isLeftSide ? -Math.PI / 2 : Math.PI / 2) : (isLeftSide ? Math.PI : 0);
      
      pedestrians.push({
        id: this.entityIdCounter++,
        classType: 'pedestrian',
        transform: { position: vec3(x, y, 0.9), rotation: walkDir + this.rng.nextFloat(-0.3, 0.3) },
        boundingBox: {
          center: vec3(x, y, 0.9),
          size: vec3(0.56, 0.56, 1.7),
          yaw: 0,
        },
        velocity: vec3(Math.cos(walkDir) * 1.2, Math.sin(walkDir) * 1.2, 0), // Walking speed ~1.2 m/s
        isStatic: false,
        occlusionLevel: 0,
        targetPosition: vec3(x + Math.cos(walkDir) * 50, y + Math.sin(walkDir) * 50, 0),
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
    
    const roadActors: RoadActor[] = [
      ...this.state.trafficVehicles.map(v => ({
        x: v.transform.position.x,
        y: v.transform.position.y,
        vx: v.velocity.x,
        vy: v.velocity.y,
      })),
      {
        x: this.state.ego.transform.position.x,
        y: this.state.ego.transform.position.y,
        vx: this.state.ego.velocity.x,
        vy: this.state.ego.velocity.y,
      },
    ];

    // Update pedestrians first so cars can yield to a crossing in progress
    for (let i = 0; i < this.state.pedestrians.length; i++) {
      this.state.pedestrians[i] = updatePedestrian(
        this.state.pedestrians[i]!,
        trafficLights,
        dt,
        this.rng,
        roadActors
      );
    }

    const nowSec = this.state.timestamp / 1000;
    const roadUsers = [
      ...this.state.trafficVehicles.map(entityToRoadUser),
      {
        id: -1,
        x: this.state.ego.transform.position.x,
        y: this.state.ego.transform.position.y,
        yaw: this.state.ego.transform.rotation,
        speed: vec3Length(this.state.ego.velocity),
      },
    ];
    const ruleCtx = {
      intersections: this.state.worldMap.controlledIntersections,
      book: this.stopBook,
      now: nowSec,
      others: roadUsers,
      rng: this.rng,
      city: {
        gridSize: this.config.cityConfig.gridSize,
        blockSize: this.config.cityConfig.blockSize,
        laneWidth: this.config.cityConfig.laneWidth,
      },
    };

    const movers = [...this.state.trafficVehicles, egoAsTraffic(this.state.ego)];
    for (let i = 0; i < this.state.trafficVehicles.length; i++) {
      this.state.trafficVehicles[i] = updateTrafficVehicle(
        this.state.trafficVehicles[i]!,
        this.state.worldMap.lanes,
        trafficLights,
        movers,
        dt,
        this.state.pedestrians,
        ruleCtx
      );
    }

    const egoPos = this.state.ego.transform.position;
    for (let i = 0; i < this.state.trafficVehicles.length; i++) {
      const car = this.state.trafficVehicles[i]!;
      const speed = Math.hypot(car.velocity.x, car.velocity.y);
      const inBox = this.state.worldMap.controlledIntersections.some(inter => {
        const dx = car.transform.position.x - inter.center.x;
        const dy = car.transform.position.y - inter.center.y;
        return dx * dx + dy * dy < 7 * 7;
      });
      const queued = isLegitimatelyQueued(car, movers, ruleCtx);
      let stuck = car.stuckTime ?? 0;
      if (speed < 0.3) stuck += dt;
      else stuck = 0;
      car.stuckTime = stuck;
      if ((car.impactCooldown ?? 0) > 0) continue;
      if (inBox && speed < 0.3 && stuck > 1.6) {
        this.state.trafficVehicles[i] = nudgeOrRespawn(car, this.rng, ruleCtx.city, egoPos, false);
      } else if (!queued && stuck > 10) {
        this.state.trafficVehicles[i] = nudgeOrRespawn(car, this.rng, ruleCtx.city, egoPos, true);
      } else if (!queued && stuck > 6) {
        this.state.trafficVehicles[i] = nudgeOrRespawn(car, this.rng, ruleCtx.city, egoPos, false);
      }
    }
    
    // Collect all entities for sensing
    const allEntities: Entity[] = [
      ...this.state.worldMap.staticEntities,
      ...this.state.trafficVehicles,
      ...this.state.pedestrians,
    ];
    
    const inBrowser = typeof window !== 'undefined';
    const lidarConfig = inBrowser ? this.lidarConfig : LIDAR_CONFIGS['roofLidar']!;
    const senseEntities = inBrowser
      ? allEntities.filter(e => {
          const dx = e.boundingBox.center.x - egoPos.x;
          const dy = e.boundingBox.center.y - egoPos.y;
          const range = e.classType === 'building' ? 50 : 70;
          return dx * dx + dy * dy < range * range;
        })
      : allEntities;
    
    const runLidar = !inBrowser || (this.state.frameNumber % this.lidarEveryN === 0);
    if (runLidar) {
      this.lastLidarPoints = simulateLidarScan(
        lidarConfig,
        this.state.ego,
        senseEntities,
        this.state.environment,
        this.state.timestamp,
        this.config.seed
      ).points;
    }
    
    // Run perception (boxes are in ego frame; convert for planning / display)
    const { detections, tracks } = runPerception(
      this.lastLidarPoints,
      this.state.perceptionTracks,
      dt
    );
    this.state.perceptionTracks = tracks;
    
    const yaw = this.state.ego.transform.rotation;
    const worldDetections = detections.map(d => ({
      ...d,
      boundingBox: {
        ...d.boundingBox,
        center: egoToWorld(d.boundingBox.center, egoPos, yaw),
        yaw: d.boundingBox.yaw + yaw,
      },
    }));
    
    // Plan trajectory
    const signDetections = this.state.worldMap.staticEntities
      .filter(e => e.classType === 'stop_sign' || e.classType === 'yield_sign')
      .filter(e => {
        const dx = e.transform.position.x - egoPos.x;
        const dy = e.transform.position.y - egoPos.y;
        return dx * dx + dy * dy < 55 * 55;
      })
      .map(e => ({
        id: e.id,
        classType: e.classType,
        confidence: 0.95,
        boundingBox: e.boundingBox,
        velocity: e.velocity,
      }));

    const egoUser = {
      id: -1,
      x: this.state.ego.transform.position.x,
      y: this.state.ego.transform.position.y,
      yaw: this.state.ego.transform.rotation,
      speed: vec3Length(this.state.ego.velocity),
    };
    const lastRule = decideIntersection(
      egoUser,
      this.state.trafficVehicles.map(entityToRoadUser),
      this.state.pedestrians.map(p => ({ x: p.transform.position.x, y: p.transform.position.y })),
      this.state.worldMap.controlledIntersections,
      this.stopBook,
      nowSec,
    );
    this.state.lastRule = lastRule;
    if (this.state.arrived) {
      this.state.lastRule = {
        maxSpeed: 0,
        mustStop: true,
        reason: 'Arrived',
        severity: 'go',
      };
    }

    const plannerInput = {
      egoState: this.state.ego,
      detections: [...worldDetections, ...signDetections],
      route: this.state.route,
      trafficLightStates: new Map(trafficLights.map(l => [l.id, l.state])),
      rule: this.state.lastRule,
    };
    
    const hazard = obstacleAhead(
      this.state.ego,
      allEntities.filter(e => e.classType !== 'barrier'),
      45,
      2.4
    );
    if (hazard && this.state.controlSource !== 'human') {
      plannerInput.detections = [
        ...plannerInput.detections,
        {
          id: hazard.entity.id,
          classType: hazard.entity.classType,
          confidence: 1,
          boundingBox: hazard.entity.boundingBox,
          velocity: hazard.entity.velocity,
        },
      ];
    }

    const { output: plannerOutput, newState: newPlannerState } = planTrajectory(
      plannerInput,
      this.state.plannerState
    );
    this.state.plannerState = newPlannerState;
    this.lastPlannerOutput = plannerOutput;
    this.state.lastPlannerOutput = plannerOutput;
    
    // Determine control input
    let vehicleInput: VehicleInput;
    let takeover: TakeoverEvent | undefined;
    
    if (humanInput || this.state.controlSource === 'human') {
      // Stay in manual after WASD or a collision drop until T re-engages.
      vehicleInput = humanInput ?? { throttle: 0, steering: 0, brake: 0 };
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
        vehicleInput = vehicleInputFromAccel(oracleResult.accel!, oracleResult.steering!);
        this.state.controlSource = 'oracle';
        takeover = {
          timestamp: this.state.timestamp,
          frameNumber: this.state.frameNumber,
          reason: oracleResult.reason as TakeoverEvent['reason'],
          egoState: this.state.ego,
        };
        this.state.lastTakeover = takeover;
      } else {
        vehicleInput = vehicleInputFromAccel(plannerOutput.acceleration, plannerOutput.steering);
        this.state.controlSource = 'policy';
      }
    } else {
      vehicleInput = vehicleInputFromAccel(plannerOutput.acceleration, plannerOutput.steering);
      this.state.controlSource = 'policy';
    }

    if (hazard && this.state.controlSource !== 'human') {
      const needStop = hazard.dist < 8 || (hazard.dist < 18 && vec3Length(this.state.ego.velocity) > 4);
      if (needStop) {
        vehicleInput = { ...vehicleInput, throttle: 0, brake: 1 };
      }
    }

    const yieldToPed = shouldYieldToPedestrian(
      this.state.ego.transform.position.x,
      this.state.ego.transform.position.y,
      this.state.ego.transform.rotation,
      this.state.pedestrians,
      vec3Length(this.state.ego.velocity)
    );
    if (yieldToPed) {
      vehicleInput = { ...vehicleInput, throttle: 0, brake: 1 };
    }

    if (this.state.arrived && this.state.controlSource !== 'human') {
      vehicleInput = { throttle: 0, steering: 0, brake: 1 };
    } else if (this.state.controlSource !== 'human' && lastRule.mustStop) {
      vehicleInput = { ...vehicleInput, throttle: 0, brake: 1 };
    } else if (this.state.controlSource !== 'human' && lastRule.maxSpeed < 8) {
      const speed = vec3Length(this.state.ego.velocity);
      if (speed > lastRule.maxSpeed + 0.3) {
        vehicleInput = { ...vehicleInput, throttle: 0, brake: Math.max(vehicleInput.brake, 0.45) };
      }
    }

    // Update ego vehicle (bicycle model). Collision impulse is applied after this.
    this.state.ego = updateVehicle(this.state.ego, vehicleInput, dt);
    this.maybeArrive();

    this.resolveWorldCollisions(dt);
    this.integrateBrokenFurniture(dt);
    this.integrateShovedStatics(dt);

    // NPC overlap: push cars apart. Ego/NPC pairs are handled by the impulse solver.
    this.separateTraffic();
    
    // Record frame
    this.recorder.recordFrame(
      this.state.timestamp,
      this.state.frameNumber,
      this.state.ego,
      allEntities,
      trafficLights,
      { lidarPoints: this.lastLidarPoints },
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
      case 'stalled_vehicle':
        this.spawnStalledVehicle();
        break;
      case 'heavy_rain':
        this.setWeather('rain', 0.5);
        break;
      case 'dense_fog':
        this.setWeather('fog', 0.3);
        break;
    }
  }
  
  // Set weather conditions
  private setWeather(weather: Environment['weather'], visibility: number): void {
    this.state.environment.weather = weather;
    this.state.environment.visibility = visibility;
  }
  
  // Spawn a stalled vehicle in the lane ahead
  private spawnStalledVehicle(): void {
    const egoPos = this.state.ego.transform.position;
    const egoYaw = this.state.ego.transform.rotation;
    
    // Spawn 30-40m ahead in the lane
    const dist = 30 + this.rng.nextFloat(0, 10);
    const spawnX = egoPos.x + Math.cos(egoYaw) * dist;
    const spawnY = egoPos.y + Math.sin(egoYaw) * dist;
    
    // Add a stalled car with hazard lights (static)
    this.state.worldMap.staticEntities.push({
      id: this.entityIdCounter++,
      classType: 'car',
      transform: { position: vec3(spawnX, spawnY, 0.75), rotation: egoYaw },
      boundingBox: {
        center: vec3(spawnX, spawnY, 0.75),
        size: vec3(4.5, 1.8, 1.5),
        yaw: egoYaw,
      },
      velocity: vec3(0, 0, 0),
      isStatic: true,
      occlusionLevel: 0,
    });
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

  /** Park the car and aim it. Used by the start menu before anyone drives. */
  faceAndPark(yaw: number): void {
    const ego = this.state.ego;
    this.state.ego = {
      ...ego,
      transform: { ...ego.transform, rotation: yaw },
      velocity: { x: 0, y: 0, z: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      steering: 0,
      throttle: 0,
      brake: 0,
      bodyVx: 0,
      bodyVy: 0,
      yawRate: 0,
      inReverse: false,
      steerFiltered: 0,
      throttleFiltered: 0,
      brakeFiltered: 0,
    };
  }

  /** Park where the car already is, with no route, and hand the wheel to the driver. */
  beginParked(at?: Vec3, yaw?: number): void {
    const pos = at ?? this.state.ego.transform.position;
    const face = yaw ?? this.state.ego.transform.rotation;
    this.faceAndPark(face);
    this.state.ego = {
      ...this.state.ego,
      transform: { position: { x: pos.x, y: pos.y, z: 0 }, rotation: face },
    };
    this.state.route = [];
    this.state.plannerState = createPlannerState();
    this.state.controlSource = 'human';
    this.tripDestination = null;
    this.tripHeading = 0;
    this.state.arrived = false;
    this.prevEgoX = this.state.ego.transform.position.x;
    this.prevEgoY = this.state.ego.transform.position.y;
  }

  /** Place the car on a start point and follow a right-hand-lane road route to a roadside pad. */
  beginTrip(start: Vec3, end: Vec3, mode: 'human' | 'policy'): void {
    const route = tripRoute(start, end);
    const next = route[Math.min(1, route.length - 1)] ?? end;
    const placed = route[0] ?? placeInRightLane(start.x, start.y, 0);
    const yaw = Math.atan2(next.y - placed.y, next.x - placed.x);
    this.faceAndPark(yaw);
    this.state.ego = {
      ...this.state.ego,
      transform: { position: { x: placed.x, y: placed.y, z: 0 }, rotation: yaw },
    };
    this.state.route = route;
    this.state.plannerState = createPlannerState();
    this.state.controlSource = mode;
    const pad = route[route.length - 1] ?? { x: end.x, y: end.y, z: 0 };
    this.tripDestination = { x: pad.x, y: pad.y, z: 0 };
    this.tripHeading = route.length >= 2
      ? Math.atan2(pad.y - route[route.length - 2]!.y, pad.x - route[route.length - 2]!.x)
      : yaw;
    this.state.arrived = false;
    this.prevEgoX = this.state.ego.transform.position.x;
    this.prevEgoY = this.state.ego.transform.position.y;
  }

  getTripDestination(): Vec3 | null {
    return this.tripDestination;
  }

  getTripHeading(): number {
    return this.tripHeading;
  }

  hasArrived(): boolean {
    return this.state.arrived;
  }

  private maybeArrive(): void {
    if (this.state.arrived || !this.tripDestination || this.state.controlSource === 'human') return;
    const dest = this.tripDestination;
    const ego = this.state.ego;
    const dist = vec3Distance(ego.transform.position, dest);
    const speed = vec3Length(ego.velocity);
    const remaining = remainingRouteDistance(ego, this.state.route);
    if (dist < 3.2 && speed < 0.65 && remaining < 6) {
      this.state.arrived = true;
      this.state.lastRule = {
        maxSpeed: 0,
        mustStop: true,
        reason: 'Arrived',
        severity: 'go',
      };
    }
  }

  /**
   * Hand control back to the planner from the current pose.
   * Rebuilds a right-lane route to the existing destination, or cruises ahead
   * if there is no trip. Stop / yield rules still apply on the next step.
   */
  reengageAutopilot(): { mode: 'trip' | 'cruise'; route: Vec3[] } {
    const ego = this.state.ego;
    const from = ego.transform.position;
    const heading = ego.transform.rotation;
    const goal = this.tripDestination;
    const route = mergeIntoLaneRoute(from, heading, goal);
    this.state.route = route;
    this.state.plannerState = createPlannerState();
    this.state.controlSource = 'policy';
    this.state.arrived = false;
    if (goal && route.length >= 2) {
      const tail = route[route.length - 1]!;
      const prev = route[route.length - 2]!;
      this.tripHeading = Math.atan2(tail.y - prev.y, tail.x - prev.x);
    }
    return { mode: goal ? 'trip' : 'cruise', route };
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

  getLidarPoints(): LidarPoint[] {
    return this.lastLidarPoints;
  }

  getLastPlannerOutput(): PlannerOutput | null {
    return this.lastPlannerOutput;
  }

  setLidarQuality(config: LidarConfig, everyN: number) {
    this.lidarConfig = config;
    this.lidarEveryN = Math.max(1, everyN);
  }

  restart(seed?: number): void {
    if (seed !== undefined) this.config.seed = seed;
    this.rng = new SeededRandom(this.config.seed);
    this.recorder.clear();
    this.contactIds.clear();
    this.tripDestination = null;
    this.state = this.initializeState();
    this.prevEgoX = this.state.ego.transform.position.x;
    this.prevEgoY = this.state.ego.transform.position.y;
  }

  /**
   * Place the ego on a collision course for screenshot / unit-test demos.
   * Autopilot is on so a hit drops control to manual.
   */
  setupHitDemo(kind: 'car' | 'pole' | 'sign' | 'pedestrian'): number {
    this.state.pedestrians = [];
    this.state.trafficVehicles = [];
    this.state.brokenFurniture = [];
    this.contactIds.clear();
    this.state.collisionCount = 0;
    this.state.lastCollision = null;
    this.state.collisionLog = [];
    const x = 3.5;
    const y0 = -26;
    this.beginParked(vec3(x, y0, 0), Math.PI / 2);
    this.state.route = [vec3(x, y0, 0), vec3(x, y0 + 90, 0)];
    this.state.controlSource = 'policy';
    this.state.ego = {
      ...this.state.ego,
      velocity: vec3(0, 16, 0),
      bodyVx: 16,
      bodyVy: 0,
      yawRate: 0,
    };
    this.prevEgoX = x;
    this.prevEgoY = y0;
    const targetY = -19.2;
    let targetId = -1;
    if (kind === 'car') {
      targetId = this.entityIdCounter++;
      this.state.trafficVehicles = [{
        id: targetId,
        classType: 'car',
        transform: { position: vec3(x + 0.55, targetY, 0.8), rotation: Math.PI / 2 },
        boundingBox: { center: vec3(x + 0.55, targetY, 0.8), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2 },
        velocity: vec3(0, 0, 0),
        isStatic: false,
        occlusionLevel: 0,
        laneId: 0,
        laneProgress: 0.4,
        targetSpeed: 0,
        yawRate: 0,
      }];
    } else if (kind === 'pedestrian') {
      targetId = this.entityIdCounter++;
      this.state.pedestrians = [{
        id: targetId,
        classType: 'pedestrian',
        transform: { position: vec3(x, targetY, 0.9), rotation: 0 },
        boundingBox: { center: vec3(x, targetY, 0.9), size: vec3(0.56, 0.56, 1.7), yaw: 0 },
        velocity: vec3(0, 0, 0),
        isStatic: false,
        occlusionLevel: 0,
        targetPosition: vec3(x, targetY, 0),
        state: 'waiting',
        waitTime: 0,
      }];
    } else {
      const classType = kind === 'pole' ? 'pole' : 'stop_sign';
      targetId = this.entityIdCounter++;
      this.state.worldMap.staticEntities.push({
        id: targetId,
        classType,
        transform: { position: vec3(x, targetY, classType === 'pole' ? 4 : 1.6), rotation: Math.PI / 2 },
        boundingBox: {
          center: vec3(x, targetY, classType === 'pole' ? 4 : 1.6),
          size: classType === 'pole' ? vec3(0.24, 0.24, 8) : vec3(0.24, 1.04, 3.2),
          yaw: Math.PI / 2,
        },
        velocity: vec3(0, 0, 0),
        isStatic: true,
        occlusionLevel: 0,
      });
    }
    return targetId;
  }

  private collectObstacles(): Entity[] {
    const broken = new Set(this.state.brokenFurniture.filter(furnitureFallen).map(b => b.id));
    return [
      ...this.state.trafficVehicles,
      ...this.state.pedestrians.filter(p => p.state !== 'tumbling' || (p.tumbleHeight ?? 0) > 0.2),
      ...this.state.worldMap.staticEntities.filter(e =>
        isCollidableClass(e.classType) && e.classType !== 'barrier' && !broken.has(e.id)
      ),
    ];
  }

  private resolveWorldCollisions(_dt: number): void {
    const ego = this.state.ego;
    const obstacles = this.collectObstacles();
    this.spatialGrid.clear();
    const bodies: CollisionBody[] = obstacles.map((e) => {
      const extra = e.classType === 'car' || e.classType === 'truck' || e.classType === 'bus'
        ? { yawRate: (e as TrafficVehicle).yawRate ?? 0, dynamic: true }
        : e.classType === 'pedestrian'
          ? { dynamic: true }
          : { dynamic: isVehicleClass(e.classType) };
      return entityCollisionBody(e, extra);
    });
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      this.spatialGrid.insert(i, b.x, b.y, colliderRadius(b.collider) + 0.4);
    }

    let egoBody = egoCollisionBody(ego);
    const moved = Math.hypot(egoBody.x - this.prevEgoX, egoBody.y - this.prevEgoY);
    if (moved > 0.4) {
      const nearbySweep = this.spatialGrid.query(egoBody.x, egoBody.y, colliderRadius(egoBody.collider) + moved + 1);
      let bestToi = 1;
      for (const idx of nearbySweep) {
        const other = bodies[idx]!;
        const swept = sweptBodyHit(
          this.prevEgoX, this.prevEgoY, egoBody.x, egoBody.y,
          0.96, other,
        );
        if (swept && swept.toi < bestToi) {
          bestToi = swept.toi;
        }
      }
      if (bestToi < 1) {
        const t = Math.max(0, bestToi - 0.02);
        egoBody.x = this.prevEgoX + (egoBody.x - this.prevEgoX) * t;
        egoBody.y = this.prevEgoY + (egoBody.y - this.prevEgoY) * t;
      }
    }

    const overlapping = new Set<number>();
    const reports: Array<{ id: number; classType: string; closing: number; depth: number }> = [];
    const queryR = colliderRadius(egoBody.collider) + 5;
    const nearby = this.spatialGrid.query(egoBody.x, egoBody.y, queryR);

    for (let iter = 0; iter < 5; iter++) {
      for (const idx of nearby) {
        const other = bodies[idx]!;
        const entity = obstacles[idx]!;
        if (isBreakableClass(entity.classType) && this.state.brokenFurniture.some(b => b.id === entity.id && furnitureFallen(b))) {
          continue;
        }
        const hit = overlapColliders(egoBody, other);
        if (!hit.hit || hit.depth < 0.002) continue;
        overlapping.add(entity.id);

        const relVx = egoBody.vx - other.vx;
        const relVy = egoBody.vy - other.vy;
        const closing = Math.max(0, -(relVx * hit.nx + relVy * hit.ny));
        const egoSpeed = Math.hypot(egoBody.vx, egoBody.vy);
        const snap = shouldSnap(entity.classType, Math.max(closing, egoSpeed * 0.9))
          && !this.state.brokenFurniture.some(b => b.id === entity.id);

        const e = Math.min(egoBody.restitution, other.restitution);
        const impulse = applyImpulse(egoBody, other, hit.nx, hit.ny, hit.cx, hit.cy, snap ? 0.06 : e);
        const sep = separateBodies(egoBody, other, hit.nx, hit.ny, hit.depth);

        egoBody = {
          ...egoBody,
          x: sep.ax,
          y: sep.ay,
          vx: impulse.avx,
          vy: impulse.avy,
          yawRate: impulse.aYawRate,
        };

        other.x = sep.bx;
        other.y = sep.by;
        other.vx = impulse.bvx;
        other.vy = impulse.bvy;
        other.yawRate = impulse.bYawRate;

        if (snap) {
          egoBody.vx *= 0.55;
          egoBody.vy *= 0.55;
          const kind = entity.classType as 'pole' | 'stop_sign' | 'yield_sign';
          this.state.brokenFurniture.push(
            makeFurnitureBreak(entity.id, kind, entity.transform.position.x, entity.transform.position.y, entity.transform.rotation, hit.nx, hit.ny),
          );
        }

        if (entity.classType === 'pedestrian' && (entity as Pedestrian).state !== 'tumbling') {
          const ped = entity as Pedestrian;
          const knocked = knockPedestrian(ped, hit.nx, hit.ny, closing, sep.bx, sep.by, impulse.bvx, impulse.bvy);
          const pi = this.state.pedestrians.findIndex(p => p.id === ped.id);
          if (pi >= 0) this.state.pedestrians[pi] = knocked;
        } else if (isVehicleClass(entity.classType)) {
          const trafficIdx = this.state.trafficVehicles.findIndex(c => c.id === entity.id);
          if (trafficIdx >= 0) {
            const car = this.state.trafficVehicles[trafficIdx]!;
            this.state.trafficVehicles[trafficIdx] = applyTrafficImpulse(
              car, sep.bx, sep.by, impulse.bvx, impulse.bvy, impulse.bYawRate,
              normalizeAngle(car.transform.rotation + impulse.bYawRate * (1 / 30)),
            );
          } else {
            entity.transform.position = { ...entity.transform.position, x: sep.bx, y: sep.by };
            entity.boundingBox = { ...entity.boundingBox, center: { ...entity.boundingBox.center, x: sep.bx, y: sep.by }, yaw: entity.transform.rotation };
            entity.velocity = vec3(impulse.bvx, impulse.bvy, 0);
            entity.isStatic = false;
            this.shovedStaticIds.add(entity.id);
          }
        }

        if (iter === 0 && shouldReportHit(closing, hit.depth)) {
          reports.push({ id: entity.id, classType: entity.classType, closing, depth: hit.depth });
        }
      }
    }

    this.state.ego = applyEgoImpulse(ego, egoBody.vx, egoBody.vy, egoBody.yawRate, egoBody.x, egoBody.y);
    this.prevEgoX = this.state.ego.transform.position.x;
    this.prevEgoY = this.state.ego.transform.position.y;

    const now = this.state.timestamp;
    for (const [id, until] of [...this.contactHoldUntil]) {
      if (until <= now) this.contactHoldUntil.delete(id);
    }
    for (const id of [...this.contactIds]) {
      if (overlapping.has(id)) continue;
      this.contactIds.delete(id);
      this.contactHoldUntil.set(id, now + 1600);
    }
    for (const report of reports) {
      if (this.contactIds.has(report.id)) continue;
      if ((this.contactHoldUntil.get(report.id) ?? 0) > now) continue;
      this.contactIds.add(report.id);
      this.state.collisionCount += 1;
      const event = { otherId: report.id, classType: report.classType, at: this.state.timestamp };
      this.state.lastCollision = event;
      this.state.collisionLog.push(event);
      if (this.state.controlSource !== 'human') {
        this.takeover('collision');
      }
    }
  }

  private integrateBrokenFurniture(dt: number): void {
    this.state.brokenFurniture = this.state.brokenFurniture.map(b => advanceFurniture(b, dt));
  }

  private integrateShovedStatics(dt: number): void {
    if (this.shovedStaticIds.size === 0) return;
    const damp = Math.exp(-2.4 * dt);
    for (const e of this.state.worldMap.staticEntities) {
      if (!this.shovedStaticIds.has(e.id)) continue;
      const vx = e.velocity.x * damp;
      const vy = e.velocity.y * damp;
      const x = e.transform.position.x + vx * dt;
      const y = e.transform.position.y + vy * dt;
      e.transform.position = { ...e.transform.position, x, y };
      e.boundingBox = { ...e.boundingBox, center: { ...e.boundingBox.center, x, y } };
      e.velocity = vec3(vx, vy, 0);
      if (Math.hypot(vx, vy) < 0.15) this.shovedStaticIds.delete(e.id);
    }
  }

  private separateTraffic(): void {
    const cars = this.state.trafficVehicles;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i]!;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j]!;
        const pushed = separateEntities(a.transform.position, a.boundingBox, b.boundingBox);
        if (!pushed) continue;
        a.transform.position = pushed;
        a.boundingBox = { ...a.boundingBox, center: { ...pushed, z: 0.8 } };
      }
    }
  }
  
  getRecording(): Recording {
    return this.recorder.getRecording();
  }
  
  reset(): void {
    this.rng = new SeededRandom(this.config.seed);
    this.recorder.clear();
    this.contactIds.clear();
    this.tripDestination = null;
    this.state = this.initializeState();
    this.prevEgoX = this.state.ego.transform.position.x;
    this.prevEgoY = this.state.ego.transform.position.y;
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
