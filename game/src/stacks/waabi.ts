/**
 * Waabi-style AI-first, interpretable end-to-end Stack
 * 
 * Features (based on publicly described Waabi approach):
 * - Fused lidar + camera + radar into BEV grid
 * - Interpretable intermediate representations
 * - Future occupancy heatmaps (1s, 2s, 3s)
 * - Candidate trajectory scoring
 * - Sim World: adversarial scenario generation
 */

import type {
  Detection, EgoState, Entity, Trajectory
} from '../sim/types';
import { 
  vec3, vec3Add, vec3Sub, vec3Scale, vec3Length,
  SeededRandom
} from '../sim/math';
import { Track, runPerception } from './perception';
import { simulateLidarScan, LIDAR_CONFIGS } from '../sensors/lidar';

// BEV occupancy grid
export interface BEVOccupancy {
  grid: Float32Array; // 100x100 BEV grid centered on ego
  resolution: number; // meters per cell
  extent: number; // total size in meters
}

// Future occupancy prediction
export interface FutureOccupancy {
  current: BEVOccupancy;
  t1s: BEVOccupancy; // 1 second prediction
  t2s: BEVOccupancy; // 2 seconds
  t3s: BEVOccupancy; // 3 seconds
}

// Candidate trajectory with cost
export interface CandidateTrajectory extends Trajectory {
  cost: number;
  costBreakdown: {
    collision: number;
    comfort: number;
    progress: number;
    laneDeviation: number;
  };
}

// Adversarial variant for Sim World
export interface AdversarialVariant {
  id: string;
  description: string;
  perturbations: Array<{
    actorId: number;
    type: 'timing' | 'speed' | 'path';
    delta: number;
  }>;
  result: 'pass' | 'fail' | 'pending';
  metrics?: {
    minTTC: number;
    maxDecel: number;
    hadCollision: boolean;
  };
}

// Sim World state
export interface SimWorldState {
  replayBuffer: Array<{
    timestamp: number;
    entities: Entity[];
    egoState: EgoState;
  }>;
  variants: AdversarialVariant[];
  lastGenerationTime: number;
}

// Waabi stack state
export interface WaabiStackState {
  tracks: Track[];
  occupancy: FutureOccupancy;
  candidateTrajectories: CandidateTrajectory[];
  selectedTrajectoryIndex: number;
  simWorld: SimWorldState;
}

export interface OccupancyAgent {
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  yaw: number;
  velocity?: { x: number; y: number; z: number };
  confidence?: number;
}

function splatOccupancy(
  grid: Float32Array,
  gridSize: number,
  resolution: number,
  extent: number,
  localX: number,
  localY: number,
  sizeX: number,
  sizeY: number,
  confidence: number
) {
  const gridX = (localX + extent) / resolution;
  const gridY = (localY + extent) / resolution;
  const sigmaX = Math.max(sizeX * 0.85, resolution * 1.6);
  const sigmaY = Math.max(sizeY * 0.85, resolution * 1.6);
  const halfX = Math.ceil((sigmaX * 2.8) / resolution);
  const halfY = Math.ceil((sigmaY * 2.8) / resolution);
  const cx0 = Math.floor(gridX);
  const cy0 = Math.floor(gridY);

  for (let dy = -halfY; dy <= halfY; dy++) {
    for (let dx = -halfX; dx <= halfX; dx++) {
      const cx = cx0 + dx;
      const cy = cy0 + dy;
      if (cx < 0 || cy < 0 || cx >= gridSize || cy >= gridSize) continue;
      const cellX = (cx + 0.5) * resolution - extent;
      const cellY = (cy + 0.5) * resolution - extent;
      const nx = (cellX - localX) / sigmaX;
      const ny = (cellY - localY) / sigmaY;
      const value = confidence * Math.exp(-0.5 * (nx * nx + ny * ny));
      if (value > 0.04) {
        const idx = cy * gridSize + cx;
        grid[idx] = Math.max(grid[idx] || 0, value);
      }
    }
  }
}

function worldToEgoXY(
  world: { x: number; y: number; z: number },
  egoState: EgoState
): { x: number; y: number } {
  const localPos = vec3Sub(world, egoState.transform.position);
  const cos = Math.cos(-egoState.transform.rotation);
  const sin = Math.sin(-egoState.transform.rotation);
  return {
    x: localPos.x * cos - localPos.y * sin,
    y: localPos.x * sin + localPos.y * cos,
  };
}

/** Dense BEV occupancy from world-frame agents (cars, peds) plus optional detections. */
export function createBEVOccupancyFromAgents(
  agents: OccupancyAgent[],
  egoState: EgoState,
  resolution: number = 0.8,
  extent: number = 32,
  predictSeconds: number = 0
): BEVOccupancy {
  const gridSize = Math.ceil(extent * 2 / resolution);
  const grid = new Float32Array(gridSize * gridSize);

  for (const agent of agents) {
    const px = agent.position.x + (agent.velocity?.x ?? 0) * predictSeconds;
    const py = agent.position.y + (agent.velocity?.y ?? 0) * predictSeconds;
    const local = worldToEgoXY({ x: px, y: py, z: 0 }, egoState);
    if (Math.abs(local.x) > extent + 8 || Math.abs(local.y) > extent + 8) continue;
    splatOccupancy(
      grid,
      gridSize,
      resolution,
      extent,
      local.x,
      local.y,
      agent.size.x,
      agent.size.y,
      agent.confidence ?? 0.9
    );
  }

  return { grid, resolution, extent };
}

export function predictFutureOccupancyFromAgents(
  agents: OccupancyAgent[],
  egoState: EgoState,
  resolution: number = 0.8,
  extent: number = 32
): FutureOccupancy {
  return {
    current: createBEVOccupancyFromAgents(agents, egoState, resolution, extent, 0),
    t1s: createBEVOccupancyFromAgents(agents, egoState, resolution, extent, 1),
    t2s: createBEVOccupancyFromAgents(agents, egoState, resolution, extent, 2),
    t3s: createBEVOccupancyFromAgents(agents, egoState, resolution, extent, 3),
  };
}

// Create BEV occupancy from detections (world-frame boxes)
export function createBEVOccupancy(
  detections: Detection[],
  egoState: EgoState,
  resolution: number = 0.5,
  extent: number = 50
): BEVOccupancy {
  return createBEVOccupancyFromAgents(
    detections.map(det => ({
      position: det.boundingBox.center,
      size: det.boundingBox.size,
      yaw: det.boundingBox.yaw,
      velocity: det.velocity,
      confidence: det.confidence,
    })),
    egoState,
    resolution,
    extent,
    0
  );
}

// Predict future occupancy
export function predictFutureOccupancy(
  current: BEVOccupancy,
  detections: Detection[],
  egoState: EgoState,
  resolution: number = 2.0,
  extent: number = 50
): FutureOccupancy {
  // Predict future positions based on velocity
  const predict = (tSeconds: number): BEVOccupancy => {
    const futureDetections = detections.map(det => ({
      ...det,
      boundingBox: {
        ...det.boundingBox,
        center: det.velocity 
          ? vec3Add(det.boundingBox.center, vec3Scale(det.velocity, tSeconds))
          : det.boundingBox.center,
      },
    }));
    return createBEVOccupancy(futureDetections, egoState, resolution, extent);
  };
  
  return {
    current,
    t1s: predict(1),
    t2s: predict(2),
    t3s: predict(3),
  };
}

// Generate candidate trajectories
export function generateCandidateTrajectories(
  egoState: EgoState,
  targetSpeed: number,
  numCandidates: number = 7
): CandidateTrajectory[] {
  const candidates: CandidateTrajectory[] = [];
  
  // Generate a fan of trajectories with different steering
  for (let i = 0; i < numCandidates; i++) {
    const steeringAngle = ((i - (numCandidates - 1) / 2) / (numCandidates - 1)) * 0.5; // -0.25 to 0.25 rad
    
    const points: Trajectory['points'] = [];
    let x = egoState.transform.position.x;
    let y = egoState.transform.position.y;
    let yaw = egoState.transform.rotation;
    let v = vec3Length(egoState.velocity);
    
    const wheelbase = 2.7;
    const dt = 0.2;
    
    for (let t = 0; t <= 3; t += dt) {
      points.push({
        position: vec3(x, y, 0),
        velocity: v,
        timestamp: t,
      });
      
      // Update using bicycle model
      const yawRate = (v / wheelbase) * Math.tan(steeringAngle);
      yaw += yawRate * dt;
      v = Math.min(targetSpeed, v + 0.5 * dt);
      
      x += v * Math.cos(yaw) * dt;
      y += v * Math.sin(yaw) * dt;
    }
    
    candidates.push({
      points,
      cost: 0,
      costBreakdown: { collision: 0, comfort: 0, progress: 0, laneDeviation: 0 },
    });
  }
  
  return candidates;
}

// Score trajectories against occupancy
export function scoreTrajectories(
  trajectories: CandidateTrajectory[],
  occupancy: FutureOccupancy,
  targetHeading: number
): CandidateTrajectory[] {
  const gridSize = Math.ceil(occupancy.current.extent * 2 / occupancy.current.resolution);
  
  return trajectories.map(traj => {
    let collisionCost = 0;
    let comfortCost = 0;
    let progressCost = 0;
    let laneDeviationCost = 0;
    
    for (let i = 0; i < traj.points.length; i++) {
      const point = traj.points[i]!;
      
      // Check occupancy at this time
      const occupGrid = i < 5 ? occupancy.current :
                        i < 10 ? occupancy.t1s :
                        i < 15 ? occupancy.t2s : occupancy.t3s;
      
      const gridX = Math.floor((point.position.x + occupGrid.extent) / occupGrid.resolution);
      const gridY = Math.floor((point.position.y + occupGrid.extent) / occupGrid.resolution);
      
      if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
        const occ = occupGrid.grid[gridY * gridSize + gridX] || 0;
        collisionCost += occ * 100;
      }
      
      // Progress: reward forward movement
      const progress = point.position.x * Math.cos(targetHeading) + 
                       point.position.y * Math.sin(targetHeading);
      progressCost -= progress * 0.1;
      
      // Comfort: penalize lateral acceleration
      if (i > 0) {
        const prev = traj.points[i - 1]!;
        const dx = point.position.x - prev.position.x;
        const dy = point.position.y - prev.position.y;
        const headingChange = Math.abs(Math.atan2(dy, dx));
        comfortCost += headingChange * 10;
      }
    }
    
    const totalCost = collisionCost + comfortCost + progressCost + laneDeviationCost;
    
    return {
      ...traj,
      cost: totalCost,
      costBreakdown: {
        collision: collisionCost,
        comfort: comfortCost,
        progress: progressCost,
        laneDeviation: laneDeviationCost,
      },
    };
  });
}

// Generate adversarial variants for Sim World
export function generateAdversarialVariants(
  replayBuffer: SimWorldState['replayBuffer'],
  rng: SeededRandom,
  numVariants: number = 20
): AdversarialVariant[] {
  if (replayBuffer.length < 10) return [];
  
  const variants: AdversarialVariant[] = [];
  
  for (let i = 0; i < numVariants; i++) {
    // Select a random frame
    const frameIdx = rng.nextInt(0, replayBuffer.length - 1);
    const frame = replayBuffer[frameIdx]!;
    
    // Select a random actor to perturb
    const dynamicEntities = frame.entities.filter(e => !e.isStatic);
    if (dynamicEntities.length === 0) continue;
    
    const actorIdx = rng.nextInt(0, dynamicEntities.length - 1);
    const actor = dynamicEntities[actorIdx]!;
    
    // Random perturbation type
    const pertType = rng.nextInt(0, 2) as 0 | 1 | 2;
    const types: Array<'timing' | 'speed' | 'path'> = ['timing', 'speed', 'path'];
    
    variants.push({
      id: `variant_${i}`,
      description: `${types[pertType]} perturbation on actor ${actor.id}`,
      perturbations: [{
        actorId: actor.id,
        type: types[pertType]!,
        delta: rng.nextFloat(-0.5, 0.5),
      }],
      result: 'pending',
    });
  }
  
  return variants;
}

// Evaluate a variant (simplified)
export function evaluateVariant(
  variant: AdversarialVariant,
  _replayBuffer: SimWorldState['replayBuffer'],
  _egoState: EgoState
): AdversarialVariant {
  // In a real system, would replay the scenario with perturbations
  // Here we simulate the outcome
  
  const rng = new SeededRandom(variant.id.length);
  const minTTC = rng.nextFloat(0.5, 5);
  const maxDecel = rng.nextFloat(1, 8);
  const hadCollision = minTTC < 1 && rng.next() < 0.3;
  
  return {
    ...variant,
    result: hadCollision ? 'fail' : 'pass',
    metrics: {
      minTTC,
      maxDecel,
      hadCollision,
    },
  };
}

// Run full Waabi-style perception and planning
export function runWaabiStack(
  egoState: EgoState,
  entities: Entity[],
  environment: { timeOfDay: 'day' | 'night'; weather: 'clear' | 'rain' | 'fog'; visibility: number },
  existingState: WaabiStackState,
  timestamp: number,
  seed: number,
  targetSpeed: number = 10
): {
  detections: Detection[];
  trajectories: CandidateTrajectory[];
  selectedTrajectory: CandidateTrajectory;
  occupancy: FutureOccupancy;
  newState: WaabiStackState;
} {
  const rng = new SeededRandom(seed + timestamp);
  
  // Simulate lidar
  const lidarScan = simulateLidarScan(
    LIDAR_CONFIGS['roofLidar']!,
    egoState,
    entities,
    environment,
    timestamp,
    seed
  );
  
  // Run base perception
  const { detections, tracks } = runPerception(
    lidarScan.points,
    existingState.tracks,
    0.1
  );
  
  // Dense BEV from the actual agents (traffic + peds) with predicted motion.
  // Lidar detections alone are too sparse for a heatmap.
  // 24 m extent / 1.5 m cells = 32×32 — large enough cells to read as a heatmap
  const bevResolution = 1.5;
  const bevExtent = 24;
  const agents: OccupancyAgent[] = entities
    .filter(e => !e.isStatic && e.classType !== 'building' && e.classType !== 'tree')
    .map(e => ({
      position: e.boundingBox.center,
      size: e.boundingBox.size,
      yaw: e.boundingBox.yaw,
      velocity: e.velocity,
      confidence: 0.92,
    }));
  const futureOccupancy = predictFutureOccupancyFromAgents(agents, egoState, bevResolution, bevExtent);
  
  // Generate and score candidate trajectories
  const candidates = generateCandidateTrajectories(egoState, targetSpeed);
  const scoredCandidates = scoreTrajectories(candidates, futureOccupancy, egoState.transform.rotation);
  
  // Select best trajectory
  let bestIdx = 0;
  let bestCost = Infinity;
  for (let i = 0; i < scoredCandidates.length; i++) {
    if (scoredCandidates[i]!.cost < bestCost) {
      bestCost = scoredCandidates[i]!.cost;
      bestIdx = i;
    }
  }
  
  // Update replay buffer
  const newReplayBuffer = [
    ...existingState.simWorld.replayBuffer.slice(-99),
    { timestamp, entities, egoState },
  ];
  
  // Generate adversarial variants periodically
  let newVariants = existingState.simWorld.variants;
  if (timestamp - existingState.simWorld.lastGenerationTime > 5000) {
    newVariants = generateAdversarialVariants(newReplayBuffer, rng);
    
    // Evaluate variants
    newVariants = newVariants.map(v => evaluateVariant(v, newReplayBuffer, egoState));
  }
  
  return {
    detections,
    trajectories: scoredCandidates,
    selectedTrajectory: scoredCandidates[bestIdx]!,
    occupancy: futureOccupancy,
    newState: {
      tracks,
      occupancy: futureOccupancy,
      candidateTrajectories: scoredCandidates,
      selectedTrajectoryIndex: bestIdx,
      simWorld: {
        replayBuffer: newReplayBuffer,
        variants: newVariants,
        lastGenerationTime: newVariants !== existingState.simWorld.variants 
          ? timestamp 
          : existingState.simWorld.lastGenerationTime,
      },
    },
  };
}

// Info card content
export const WAABI_INFO_CARD = {
  name: 'Waabi-style: AI-first, Interpretable End-to-End',
  sensors: 'Publicly described: lidars, cameras, radars fused into BEV representation',
  internals: 'BEV occupancy grid, probabilistic future occupancy heatmaps (1s, 2s, 3s), candidate trajectory scoring with costs, interpretable intermediate representations (not a black box)',
  strengths: 'End-to-end trainable, interpretable predictions, simulation-first development (Waabi World), adversarial scenario generation for robustness',
  weaknesses: 'Requires extensive simulation infrastructure, dependence on sim-to-real transfer',
  example: 'Waabi describes an AI-first stack trained in Waabi World simulator with adversarial scenarios and closed-loop learning, focusing on autonomous trucking.',
};
