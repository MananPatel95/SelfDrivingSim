/**
 * Per-stack live planning. F1/F2/F3 are not HUD-only: each view follows
 * a public-source planning style. See wiki/concepts/public-sources.md.
 *
 * Tesla (public): cameras-only, no HD map, end-to-end pixels→trajectory
 *   guided by a navigation route. Here: camera FOV detections + pursuit
 *   of the Manhattan nav polyline. No trained net.
 * Waymo (public): HD-map lane-graph routing + multi-sensor tracks.
 *   Here: walk procedural HD driving lanes; lidar/radar detections.
 * Waabi (public): BEV occupancy + 1–3 s forecast, score candidate
 *   trajectories. Here: agent-splat occupancy + route-attracted fan.
 */

import type { Detection, EgoState, Entity, EntityClass, Lane, PlannerInput, PlannerOutput, Vec3 } from '../sim/types';
import { clamp, normalizeAngle, vec3, vec3Distance, vec3Length, vec3Sub } from '../sim/math';
import { VEHICLE_PARAMS } from '../sim/vehicle';
import {
  LANE_OFFSET,
  mergeIntoLaneRoute,
  type ResolvedDestination,
} from '../sim/rightLane';
import { detectVisibleAgents } from '../stacks/tesla';
import {
  generateCandidateTrajectories,
  occupancyAgentsFromEntities,
  predictFutureOccupancyFromAgents,
  type CandidateTrajectory,
  type FutureOccupancy,
  type OccupancyAgent,
} from '../stacks/waabi';
import { createHDMap } from '../stacks/waymo';
import { laneGraphRoute } from './laneGraph';
import { planTrajectory, type PlannerState } from './planner';

export type PlannerStack = 'tesla' | 'waymo' | 'waabi';

export interface StackRouteInput {
  stack: PlannerStack;
  from: Vec3;
  heading: number;
  goal?: Vec3 | null;
  resolved?: ResolvedDestination | null;
  lanes: readonly Lane[];
}

/** Dest-faithful route for the active stack. Same `ResolvedDestination` for all three. */
export function buildStackRoute(input: StackRouteInput): Vec3[] {
  const { from, heading, goal, resolved } = input;
  if (input.stack === 'waymo') {
    const hd = createHDMap(input.lanes.slice(), []);
    return laneGraphRoute(hd.laneCenterlines, from, heading, resolved, goal);
  }
  return mergeIntoLaneRoute(from, heading, goal, LANE_OFFSET, resolved);
}

const VISION_CLASSES = new Set<string>([
  'car', 'truck', 'bus', 'motorcycle', 'bicycle',
  'pedestrian', 'cyclist',
  'stop_sign', 'yield_sign',
]);

/** Tesla live planner input: camera-FOV agents/signs only (no lidar). */
export function teslaVisionPlannerDetections(
  ego: EgoState,
  entities: readonly Entity[],
): Detection[] {
  const byId = new Map<number, Entity>();
  for (const e of entities) byId.set(e.id, e);
  const out: Detection[] = [];
  for (const v of detectVisibleAgents(ego, entities as Entity[])) {
    if (!VISION_CLASSES.has(v.classType)) continue;
    const src = byId.get(v.entityId);
    out.push({
      id: v.entityId,
      classType: v.classType as EntityClass,
      confidence: v.confidence,
      boundingBox: {
        center: v.center,
        size: v.size,
        yaw: src?.boundingBox.yaw ?? ego.transform.rotation,
      },
      velocity: src?.velocity,
    });
  }
  return out;
}

function steerToward(ego: EgoState, target: Vec3): number {
  const params = VEHICLE_PARAMS[ego.vehicleType];
  const toTarget = vec3Sub(target, ego.transform.position);
  const desiredHeading = Math.atan2(toTarget.y, toTarget.x);
  const headingError = normalizeAngle(desiredHeading - ego.transform.rotation);
  const lookahead = vec3Length(toTarget);
  if (lookahead < 1) return 0;
  const steeringAngle = Math.atan2(
    2 * params.wheelbase * Math.sin(headingError),
    lookahead,
  );
  return clamp(steeringAngle / params.maxSteeringAngle, -1, 1);
}

function closestRouteIndex(pos: Vec3, route: Vec3[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = vec3Distance(pos, route[i]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function distToRoute(pos: Vec3, route: Vec3[], fromIdx = 0): number {
  let best = Infinity;
  for (let i = fromIdx; i < route.length; i++) {
    const d = vec3Distance(pos, route[i]!);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 0;
}

function worldToEgo(world: Vec3, ego: EgoState): { x: number; y: number } {
  const dx = world.x - ego.transform.position.x;
  const dy = world.y - ego.transform.position.y;
  const c = Math.cos(-ego.transform.rotation);
  const s = Math.sin(-ego.transform.rotation);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

function sampleOccupancy(
  occupancy: FutureOccupancy,
  point: Vec3,
  ego: EgoState,
  timeIdx: number,
): number {
  const grid = timeIdx < 5 ? occupancy.current
    : timeIdx < 10 ? occupancy.t1s
    : timeIdx < 15 ? occupancy.t2s
    : occupancy.t3s;
  const local = worldToEgo(point, ego);
  const size = Math.ceil((grid.extent * 2) / grid.resolution);
  const gx = Math.floor((local.x + grid.extent) / grid.resolution);
  const gy = Math.floor((local.y + grid.extent) / grid.resolution);
  if (gx < 0 || gy < 0 || gx >= size || gy >= size) return 0;
  return grid.grid[gy * size + gx] || 0;
}

/** Route-following candidate so occupancy scoring cannot prefer a U-turn off the dest path. */
export function routeFollowCandidate(
  ego: EgoState,
  route: Vec3[],
  targetSpeed: number,
): CandidateTrajectory {
  const points: CandidateTrajectory['points'] = [];
  const speed = Math.max(2.4, Math.min(targetSpeed, vec3Length(ego.velocity) || targetSpeed));
  let idx = closestRouteIndex(ego.transform.position, route);
  let x = ego.transform.position.x;
  let y = ego.transform.position.y;
  let carry = 0;
  const dt = 0.2;
  for (let t = 0; t <= 3; t += dt) {
    points.push({ position: vec3(x, y, 0), velocity: speed, timestamp: t });
    let need = speed * dt + carry;
    while (need > 0 && idx < route.length - 1) {
      const nxt = route[idx + 1]!;
      const dx = nxt.x - x;
      const dy = nxt.y - y;
      const seg = Math.hypot(dx, dy);
      if (seg < 1e-4) {
        idx += 1;
        continue;
      }
      if (seg <= need) {
        x = nxt.x;
        y = nxt.y;
        need -= seg;
        idx += 1;
      } else {
        const u = need / seg;
        x += dx * u;
        y += dy * u;
        need = 0;
      }
    }
    carry = need;
  }
  return {
    points,
    cost: 0,
    costBreakdown: { collision: 0, comfort: 0, progress: 0, laneDeviation: 0 },
  };
}

export function scoreOccupancyCandidates(
  trajectories: CandidateTrajectory[],
  occupancy: FutureOccupancy,
  ego: EgoState,
  route: Vec3[],
): CandidateTrajectory[] {
  const dest = route[route.length - 1];
  const fromIdx = closestRouteIndex(ego.transform.position, route);
  return trajectories.map(traj => {
    let collision = 0;
    let comfort = 0;
    let progress = 0;
    let laneDeviation = 0;
    for (let i = 0; i < traj.points.length; i++) {
      const p = traj.points[i]!;
      collision += sampleOccupancy(occupancy, p.position, ego, i) * 100;
      laneDeviation += distToRoute(p.position, route, fromIdx);
      if (dest) progress -= 0.08 * (1 / (1 + vec3Distance(p.position, dest)));
      if (i > 0) {
        const prev = traj.points[i - 1]!;
        const h0 = Math.atan2(
          prev.position.y - (i > 1 ? traj.points[i - 2]!.position.y : ego.transform.position.y),
          prev.position.x - (i > 1 ? traj.points[i - 2]!.position.x : ego.transform.position.x),
        );
        const h1 = Math.atan2(
          p.position.y - prev.position.y,
          p.position.x - prev.position.x,
        );
        comfort += Math.abs(normalizeAngle(h1 - h0)) * 4;
      }
    }
    const cost = collision + comfort + progress + laneDeviation * 6;
    return {
      ...traj,
      cost,
      costBreakdown: {
        collision,
        comfort,
        progress,
        laneDeviation,
      },
    };
  });
}

export interface WaabiPlanResult {
  output: PlannerOutput;
  newState: PlannerState;
  occupancy: FutureOccupancy;
  candidates: CandidateTrajectory[];
  selectedIndex: number;
}

/**
 * Waabi live plan: score occupancy-forecast candidates attracted to the dest
 * route (so a legal left wins over a U-turn), then reuse `planTrajectory`
 * accel / stop / arrival. Overlay `tickWaabiView` is unchanged.
 */
export function planWaabiAlongRoute(
  input: PlannerInput,
  state: PlannerState,
  agents: OccupancyAgent[],
): WaabiPlanResult {
  const occupancy = predictFutureOccupancyFromAgents(
    agents,
    input.egoState,
    1.5,
    24,
  );
  const targetSpeed = state.config.targetSpeed;
  const fan = generateCandidateTrajectories(input.egoState, targetSpeed, 7);
  const along = routeFollowCandidate(input.egoState, input.route, targetSpeed);
  const scored = scoreOccupancyCandidates(
    [...fan, along],
    occupancy,
    input.egoState,
    input.route,
  );
  let bestIdx = 0;
  let bestCost = Infinity;
  for (let i = 0; i < scored.length; i++) {
    if (scored[i]!.cost < bestCost) {
      bestCost = scored[i]!.cost;
      bestIdx = i;
    }
  }
  const chosen = scored[bestIdx]!;
  const base = planTrajectory(input, state);
  const look = chosen.points[Math.min(4, chosen.points.length - 1)];
  let steering = base.output.steering;
  if (look && !input.rule?.mustStop) {
    steering = steerToward(input.egoState, look.position);
  }
  let acceleration = base.output.acceleration;
  if (chosen.costBreakdown.collision > 18) {
    acceleration = Math.min(acceleration, -2.4);
  }
  return {
    output: {
      ...base.output,
      acceleration,
      steering,
      trajectory: { points: chosen.points },
      candidateTrajectories: scored,
      selectedTrajectoryIndex: bestIdx,
      reason: base.output.reason ?? 'occupancy_forecast',
    },
    newState: base.newState,
    occupancy,
    candidates: scored,
    selectedIndex: bestIdx,
  };
}

export interface StackPlanContext {
  stack: PlannerStack;
  entities: readonly Entity[];
  agents?: OccupancyAgent[];
}

export function planForStack(
  input: PlannerInput,
  state: PlannerState,
  ctx: StackPlanContext,
): { output: PlannerOutput; newState: PlannerState } {
  if (ctx.stack === 'tesla') {
    return planTrajectory({
      ...input,
      detections: teslaVisionPlannerDetections(input.egoState, ctx.entities),
    }, state);
  }
  if (ctx.stack === 'waabi') {
    const agents = ctx.agents ?? occupancyAgentsFromEntities([ctx.entities], []);
    return planWaabiAlongRoute(input, state, agents);
  }
  return planTrajectory(input, state);
}

