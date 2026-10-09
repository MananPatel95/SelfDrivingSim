/**
 * Rule-based planner for autonomous driving
 * Consumes perception output (not ground truth)
 */

import type {
  Detection, EgoState, Vec3, Trajectory, PlannerInput, PlannerOutput,
  TrafficLightState
} from '../sim/types';
import { 
  vec3, vec3Sub, vec3Length, vec3Distance, 
  rotateVec3, normalizeAngle, calculateTTC, clamp 
} from '../sim/math';
import { VEHICLE_PARAMS } from '../sim/vehicle';

export interface PlannerConfig {
  targetSpeed: number; // m/s
  minFollowingDistance: number; // m
  timeGap: number; // seconds
  maxDecel: number; // m/s^2
  maxAccel: number; // m/s^2
  maxLateralAccel: number; // m/s^2
  collisionTimeThreshold: number; // TTC threshold in seconds
}

const DEFAULT_CONFIG: PlannerConfig = {
  targetSpeed: 11.2, // 25 mph = 40 km/h
  minFollowingDistance: 5,
  timeGap: 2.0,
  maxDecel: 4.0,
  maxAccel: 2.0,
  maxLateralAccel: 3.0,
  collisionTimeThreshold: 3.0,
};

export interface PlannerState {
  config: PlannerConfig;
  routeProgress: number;
  stoppedTime: number;
  lastSteeringError: number;
}

export function createPlannerState(config: Partial<PlannerConfig> = {}): PlannerState {
  return {
    config: { ...DEFAULT_CONFIG, ...config },
    routeProgress: 0,
    stoppedTime: 0,
    lastSteeringError: 0,
  };
}

export function planTrajectory(
  input: PlannerInput,
  state: PlannerState
): { output: PlannerOutput; newState: PlannerState } {
  const { egoState, detections, route, trafficLightStates } = input;
  const config = state.config;
  
  // Get current speed
  const speed = vec3Length(egoState.velocity);
  
  // Find target point on route
  const targetPoint = findTargetPoint(egoState, route, state.routeProgress, speed);
  const newRouteProgress = targetPoint.progress;
  
  // Calculate steering to follow route
  const steering = calculateSteering(egoState, targetPoint.point, speed);
  
  // Check for obstacles ahead
  const obstacleAhead = findClosestObstacleAhead(egoState, detections);
  
  // Check traffic lights
  const trafficLightStop = checkTrafficLights(egoState, route, trafficLightStates);
  
  // Calculate desired speed
  let desiredSpeed = config.targetSpeed;
  let stoppingDistance = Infinity;
  
  // Slow for obstacles
  if (obstacleAhead) {
    const followingDistance = Math.max(
      config.minFollowingDistance,
      speed * config.timeGap
    );
    stoppingDistance = Math.min(stoppingDistance, obstacleAhead.distance - followingDistance);
    
    // Match obstacle speed if following
    if (obstacleAhead.distance < followingDistance * 2) {
      desiredSpeed = Math.min(desiredSpeed, vec3Length(obstacleAhead.velocity || vec3(0, 0, 0)));
    }
  }
  
  // Stop for red lights
  if (trafficLightStop !== null) {
    stoppingDistance = Math.min(stoppingDistance, trafficLightStop - 3); // Stop 3m before
  }
  
  // Check for collision with any detection
  let emergencyBrake = false;
  for (const det of detections) {
    if (isVulnerableRoadUser(det.classType)) {
      const ttc = calculateTTC(
        egoState.transform.position,
        rotateVec3(egoState.velocity, egoState.transform.rotation),
        det.boundingBox.center,
        det.velocity || vec3(0, 0, 0),
        Math.max(det.boundingBox.size.x, det.boundingBox.size.y) / 2 + 2
      );
      
      if (ttc !== null && ttc < config.collisionTimeThreshold) {
        emergencyBrake = true;
        break;
      }
    }
  }
  
  // Calculate acceleration
  let acceleration: number;
  
  if (emergencyBrake) {
    acceleration = -config.maxDecel;
  } else if (stoppingDistance < speed * speed / (2 * config.maxDecel)) {
    // Need to brake to stop in time
    acceleration = -Math.min(config.maxDecel, speed * speed / (2 * Math.max(1, stoppingDistance)));
  } else if (speed < desiredSpeed) {
    acceleration = Math.min(config.maxAccel, (desiredSpeed - speed) * 0.5);
  } else if (speed > desiredSpeed) {
    acceleration = -Math.min(config.maxDecel, (speed - desiredSpeed) * 0.5);
  } else {
    acceleration = 0;
  }
  
  // Clamp acceleration
  acceleration = clamp(acceleration, -config.maxDecel, config.maxAccel);
  
  // Build trajectory (simple forward projection)
  const trajectory = buildTrajectory(egoState, acceleration, steering, 3.0);
  
  // Update state
  const newStoppedTime = speed < 0.1 ? state.stoppedTime + 0.1 : 0;
  
  return {
    output: {
      trajectory,
      acceleration,
      steering,
    },
    newState: {
      ...state,
      routeProgress: newRouteProgress,
      stoppedTime: newStoppedTime,
      lastSteeringError: steering,
    },
  };
}

function findTargetPoint(
  ego: EgoState,
  route: Vec3[],
  _currentProgress: number,
  speed: number
): { point: Vec3; progress: number } {
  if (route.length === 0) {
    return { point: ego.transform.position, progress: 0 };
  }
  
  // Look-ahead distance based on speed
  const lookAhead = Math.max(10, speed * 1.5);
  
  // Find closest point on route
  let closestDist = Infinity;
  let closestIdx = 0;
  
  for (let i = 0; i < route.length; i++) {
    const dist = vec3Distance(ego.transform.position, route[i]!);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }
  
  // Find target point at look-ahead distance
  let targetIdx = closestIdx;
  let distFromClosest = 0;
  
  while (targetIdx < route.length - 1 && distFromClosest < lookAhead) {
    distFromClosest += vec3Distance(route[targetIdx]!, route[targetIdx + 1]!);
    targetIdx++;
  }
  
  return {
    point: route[Math.min(targetIdx, route.length - 1)]!,
    progress: targetIdx / route.length,
  };
}

function calculateSteering(ego: EgoState, target: Vec3, _speed: number): number {
  const params = VEHICLE_PARAMS[ego.vehicleType];
  
  // Vector to target in world frame
  const toTarget = vec3Sub(target, ego.transform.position);
  
  // Desired heading
  const desiredHeading = Math.atan2(toTarget.y, toTarget.x);
  
  // Heading error
  const headingError = normalizeAngle(desiredHeading - ego.transform.rotation);
  
  // Pure pursuit: steering angle = atan(2 * L * sin(alpha) / lookahead)
  const lookahead = vec3Length(toTarget);
  if (lookahead < 1) return 0;
  
  const steeringAngle = Math.atan2(
    2 * params.wheelbase * Math.sin(headingError),
    lookahead
  );
  
  // Normalize to -1 to 1
  return clamp(steeringAngle / params.maxSteeringAngle, -1, 1);
}

interface ObstacleInfo {
  detection: Detection;
  distance: number;
  velocity: Vec3 | undefined;
}

function findClosestObstacleAhead(ego: EgoState, detections: Detection[]): ObstacleInfo | null {
  let closest: ObstacleInfo | null = null;
  let closestDist = Infinity;
  
  const egoDir = {
    x: Math.cos(ego.transform.rotation),
    y: Math.sin(ego.transform.rotation),
  };
  
  for (const det of detections) {
    // Skip static infrastructure
    if (det.classType === 'building' || det.classType === 'tree' || det.classType === 'pole') {
      continue;
    }
    
    const toTarget = vec3Sub(det.boundingBox.center, ego.transform.position);
    const dist = vec3Length(toTarget);
    
    // Check if ahead
    const ahead = (toTarget.x * egoDir.x + toTarget.y * egoDir.y) / dist;
    if (ahead < 0.5) continue; // Not sufficiently ahead
    
    // Check if in our lane (rough check)
    const lateral = Math.abs(toTarget.x * (-egoDir.y) + toTarget.y * egoDir.x);
    if (lateral > 3) continue; // Too far to the side
    
    if (dist < closestDist) {
      closestDist = dist;
      closest = { detection: det, distance: dist, velocity: det.velocity };
    }
  }
  
  return closest;
}

function checkTrafficLights(
  _ego: EgoState,
  _route: Vec3[],
  _lights: Map<number, TrafficLightState>
): number | null {
  // Simplified: check if any red light is within 30m ahead
  // In full implementation, would match lights to route lanes
  
  // This is a stub that would need traffic light positions
  // For now, return null (no light stop needed)
  return null;
}

function isVulnerableRoadUser(classType: string): boolean {
  return classType === 'pedestrian' || classType === 'cyclist' || classType === 'bicycle';
}

function buildTrajectory(
  ego: EgoState,
  acceleration: number,
  steering: number,
  duration: number
): Trajectory {
  const points: Trajectory['points'] = [];
  const params = VEHICLE_PARAMS[ego.vehicleType];
  
  let x = ego.transform.position.x;
  let y = ego.transform.position.y;
  let z = ego.transform.position.z;
  let yaw = ego.transform.rotation;
  let v = vec3Length(ego.velocity);
  
  const dt = 0.2;
  const steeringAngle = steering * params.maxSteeringAngle;
  
  for (let t = 0; t <= duration; t += dt) {
    points.push({
      position: vec3(x, y, z),
      velocity: v,
      timestamp: t,
    });
    
    // Update velocity
    v = Math.max(0, Math.min(params.maxSpeed, v + acceleration * dt));
    
    // Update heading
    if (v > 0.1) {
      const yawRate = (v / params.wheelbase) * Math.tan(steeringAngle);
      yaw = normalizeAngle(yaw + yawRate * dt);
    }
    
    // Update position
    x += v * Math.cos(yaw) * dt;
    y += v * Math.sin(yaw) * dt;
  }
  
  return { points };
}

// Oracle supervisor (has ground truth access)
export function oracleSupervisor(
  ego: EgoState,
  groundTruth: Detection[],
  _currentAccel: number,
  currentSteering: number
): { takeover: boolean; reason?: string; accel?: number; steering?: number } {
  const speed = vec3Length(ego.velocity);
  
  // Check all ground truth objects
  for (const obj of groundTruth) {
    const toTarget = vec3Sub(obj.boundingBox.center, ego.transform.position);
    const dist = vec3Length(toTarget);
    
    // Calculate TTC
    const ttc = calculateTTC(
      ego.transform.position,
      rotateVec3(ego.velocity, ego.transform.rotation),
      obj.boundingBox.center,
      obj.velocity || vec3(0, 0, 0),
      Math.max(obj.boundingBox.size.x, obj.boundingBox.size.y) / 2 + 1
    );
    
    // Emergency intervention for imminent collision
    if (ttc !== null && ttc < 1.5 && isVulnerableRoadUser(obj.classType)) {
      return {
        takeover: true,
        reason: 'perception_miss',
        accel: -VEHICLE_PARAMS[ego.vehicleType].maxDecel,
        steering: currentSteering,
      };
    }
    
    // Intervention for any close object
    if (dist < 3 && speed > 1) {
      return {
        takeover: true,
        reason: 'planning_unsafe',
        accel: -VEHICLE_PARAMS[ego.vehicleType].maxDecel,
        steering: currentSteering,
      };
    }
  }
  
  return { takeover: false };
}
