/**
 * Vehicle dynamics - kinematic bicycle model for cars/trucks
 * Renderer-independent simulation
 */

import type { EgoState, Vec3, VehicleType } from './types';
import { clamp, normalizeAngle, vec3 } from './math';

export interface VehicleParams {
  wheelbase: number; // m
  maxSpeed: number; // m/s
  maxAccel: number; // m/s^2
  maxDecel: number; // m/s^2 (positive value)
  maxSteeringAngle: number; // radians
  mass: number; // kg
  brakeForce: number; // N
  dragCoeff: number;
}

export const VEHICLE_PARAMS: Record<VehicleType, VehicleParams> = {
  car: {
    wheelbase: 2.7,
    maxSpeed: 30, // ~108 km/h
    maxAccel: 3.0,
    maxDecel: 8.0,
    maxSteeringAngle: Math.PI / 6, // 30 degrees
    mass: 1500,
    brakeForce: 15000,
    dragCoeff: 0.3,
  },
  truck: {
    wheelbase: 6.0,
    maxSpeed: 25, // ~90 km/h
    maxAccel: 1.5,
    maxDecel: 4.0, // Trucks brake slower
    maxSteeringAngle: Math.PI / 8, // 22.5 degrees
    mass: 35000, // Loaded semi
    brakeForce: 80000,
    dragCoeff: 0.6,
  },
  train: {
    wheelbase: 20, // Car length
    maxSpeed: 35, // ~126 km/h
    maxAccel: 0.5,
    maxDecel: 1.0, // Very slow braking
    maxSteeringAngle: 0, // Cannot steer
    mass: 500000, // Freight train
    brakeForce: 200000,
    dragCoeff: 0.05,
  },
  ship: {
    wheelbase: 100, // Hull length
    maxSpeed: 10, // ~20 knots
    maxAccel: 0.1,
    maxDecel: 0.05, // Very slow stopping
    maxSteeringAngle: Math.PI / 4,
    mass: 50000000, // Container ship
    brakeForce: 100000, // Reverse thrust
    dragCoeff: 0.8, // Water drag
  },
};

export interface VehicleInput {
  throttle: number; // -1 to 1 (negative = reverse/brake)
  steering: number; // -1 to 1
  brake: number; // 0 to 1
}

export function updateVehicle(
  state: EgoState,
  input: VehicleInput,
  dt: number
): EgoState {
  const params = VEHICLE_PARAMS[state.vehicleType];
  
  // Clamp inputs
  const throttle = clamp(input.throttle, -1, 1);
  const steering = clamp(input.steering, -1, 1);
  const brake = clamp(input.brake, 0, 1);
  
  // Calculate steering angle
  const steeringAngle = steering * params.maxSteeringAngle;
  
  const heading = state.transform.rotation;
  const worldSpeed = Math.sqrt(state.velocity.x ** 2 + state.velocity.y ** 2);
  const forward = state.velocity.x * Math.cos(heading) + state.velocity.y * Math.sin(heading);
  const signedSpeed = worldSpeed > 0.05
    ? worldSpeed * Math.sign(forward || 1)
    : state.velocity.x;
  
  // Calculate acceleration
  let accel = 0;
  if (brake > 0) {
    const brakeAccel = (params.brakeForce * brake) / params.mass;
    accel = -Math.sign(signedSpeed || 1) * brakeAccel;
  } else {
    accel = throttle > 0 
      ? throttle * params.maxAccel 
      : throttle * params.maxDecel;
  }
  
  const dragForce = 0.5 * params.dragCoeff * worldSpeed * worldSpeed;
  const dragAccel = dragForce / params.mass;
  if (worldSpeed > 0.1) {
    accel -= dragAccel * Math.sign(signedSpeed || 1);
  }
  
  let newSpeed = signedSpeed + accel * dt;
  newSpeed = clamp(newSpeed, -params.maxSpeed * 0.3, params.maxSpeed);
  
  // Ships keep a cruise speed unless the operator is braking
  if (state.vehicleType === 'ship' && brake < 0.05 && newSpeed < 6) {
    newSpeed = Math.min(6, newSpeed + params.maxAccel * dt);
  }
  
  if (Math.abs(newSpeed) < 0.1 && Math.abs(throttle) < 0.1 && state.vehicleType !== 'ship') {
    newSpeed = 0;
  }
  
  // Kinematic bicycle model
  let yawRate = 0;
  if (Math.abs(newSpeed) > 0.1 && state.vehicleType !== 'train') {
    yawRate = (newSpeed / params.wheelbase) * Math.tan(steeringAngle);
  }
  
  const newYaw = normalizeAngle(state.transform.rotation + yawRate * dt);
  const vx = newSpeed * Math.cos(newYaw);
  const vy = newSpeed * Math.sin(newYaw);
  
  const newPos: Vec3 = {
    x: state.transform.position.x + vx * dt,
    y: state.transform.position.y + vy * dt,
    z: state.transform.position.z,
  };
  
  const stoppingDistance = (newSpeed * newSpeed) / (2 * params.maxDecel);
  
  return {
    ...state,
    transform: {
      position: newPos,
      rotation: newYaw,
    },
    velocity: vec3(vx, vy, 0),
    acceleration: vec3(accel, 0, 0),
    steering: steeringAngle,
    throttle,
    brake,
    stoppingDistance,
  };
}

// Create initial ego state
export function createEgoState(
  vehicleType: VehicleType,
  position: Vec3,
  rotation: number
): EgoState {
  return {
    vehicleType,
    transform: { position, rotation },
    velocity: vec3(0, 0, 0),
    acceleration: vec3(0, 0, 0),
    steering: 0,
    throttle: 0,
    brake: 0,
    mass: VEHICLE_PARAMS[vehicleType].mass,
    stoppingDistance: 0,
  };
}

// Train-specific dynamics (1D track following)
export function updateTrain(
  state: EgoState,
  input: VehicleInput,
  trackPoints: Vec3[],
  currentTrackIndex: number,
  dt: number
): { state: EgoState; trackIndex: number } {
  const params = VEHICLE_PARAMS.train;
  
  // Update speed along track
  let accel = 0;
  if (input.brake > 0) {
    const brakeAccel = (params.brakeForce * input.brake) / params.mass;
    accel = -brakeAccel;
  } else {
    accel = input.throttle * params.maxAccel;
  }
  
  let newSpeed = state.velocity.x + accel * dt;
  newSpeed = clamp(newSpeed, 0, params.maxSpeed);
  
  // Move along track
  let distance = newSpeed * dt;
  let idx = currentTrackIndex;
  
  while (distance > 0 && idx < trackPoints.length - 1) {
    const current = trackPoints[idx]!;
    const next = trackPoints[idx + 1]!;
    const segmentLength = Math.sqrt(
      (next.x - current.x) ** 2 + (next.y - current.y) ** 2
    );
    
    if (distance < segmentLength) {
      const t = distance / segmentLength;
      const newPos: Vec3 = {
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
        z: current.z,
      };
      const yaw = Math.atan2(next.y - current.y, next.x - current.x);
      
      return {
        state: {
          ...state,
          transform: { position: newPos, rotation: yaw },
          velocity: vec3(newSpeed, 0, 0),
          acceleration: vec3(accel, 0, 0),
          stoppingDistance: (newSpeed * newSpeed) / (2 * params.maxDecel),
        },
        trackIndex: idx,
      };
    }
    
    distance -= segmentLength;
    idx++;
  }
  
  // Reached end of track
  return {
    state: {
      ...state,
      velocity: vec3(0, 0, 0),
      acceleration: vec3(0, 0, 0),
      stoppingDistance: 0,
    },
    trackIndex: idx,
  };
}

// Ship dynamics (simple hull model with large turning circle)
export function updateShip(
  state: EgoState,
  input: VehicleInput,
  dt: number
): EgoState {
  const params = VEHICLE_PARAMS.ship;
  
  // Update throttle (very slow response)
  let accel = input.throttle * params.maxAccel;
  if (input.brake > 0) {
    // Reverse thrust
    accel = -params.maxDecel * input.brake;
  }
  
  const currentSpeed = Math.sqrt(state.velocity.x ** 2 + state.velocity.y ** 2) || state.velocity.x;
  let newSpeed = currentSpeed + accel * dt;
  // Cruise at ~12 knots unless braking
  if (input.brake < 0.05 && newSpeed < 6) {
    newSpeed = Math.min(6, newSpeed + params.maxAccel * 2 * dt);
  }
  newSpeed = clamp(newSpeed, -params.maxSpeed * 0.1, params.maxSpeed);
  
  // Large turning circle - yaw rate depends on speed and rudder
  const rudder = input.steering * params.maxSteeringAngle;
  const yawRate = (newSpeed / params.wheelbase) * Math.sin(rudder) * 0.1; // Very slow turn
  
  const newYaw = normalizeAngle(state.transform.rotation + yawRate * dt);
  
  const vx = newSpeed * Math.cos(newYaw);
  const vy = newSpeed * Math.sin(newYaw);
  
  const newPos: Vec3 = {
    x: state.transform.position.x + vx * dt,
    y: state.transform.position.y + vy * dt,
    z: state.transform.position.z,
  };
  
  // Water drag
  const drag = 0.5 * params.dragCoeff * newSpeed * newSpeed;
  const dragDecel = drag / params.mass;
  
  return {
    ...state,
    transform: { position: newPos, rotation: newYaw },
    velocity: vec3(
      (newSpeed - dragDecel * dt * Math.sign(newSpeed || 1)) * Math.cos(newYaw),
      (newSpeed - dragDecel * dt * Math.sign(newSpeed || 1)) * Math.sin(newYaw),
      0
    ),
    acceleration: vec3(accel, 0, 0),
    steering: rudder,
    throttle: input.throttle,
    brake: input.brake,
    stoppingDistance: (newSpeed * newSpeed) / (2 * params.maxDecel),
  };
}
