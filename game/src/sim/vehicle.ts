/**
 * Arcade-realistic sedan dynamics (TypeScript; not the Rust step_vehicle kernel).
 * Dynamic bicycle + Pacejka-lite tyres, automatic gearbox, filtered WASD.
 */

import type { EgoState, Vec3, VehicleType } from './types';
import { clamp, normalizeAngle, vec3 } from './math';
import { MAX_COSMETIC_PITCH, MAX_COSMETIC_ROLL } from './vehicleVisual';

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
    maxSpeed: 54, // ~194 km/h
    maxAccel: 4.2,
    maxDecel: 9.81, // 1.0 g peak (ABS, dry)
    maxSteeringAngle: 0.55,
    mass: 1480,
    brakeForce: 16800,
    dragCoeff: 0.32,
  },
  truck: {
    wheelbase: 6.0,
    maxSpeed: 25,
    maxAccel: 1.5,
    maxDecel: 4.0,
    maxSteeringAngle: Math.PI / 8,
    mass: 35000,
    brakeForce: 80000,
    dragCoeff: 0.6,
  },
  train: {
    wheelbase: 20,
    maxSpeed: 35,
    maxAccel: 0.5,
    maxDecel: 1.0,
    maxSteeringAngle: 0,
    mass: 500000,
    brakeForce: 200000,
    dragCoeff: 0.05,
  },
  ship: {
    wheelbase: 100,
    maxSpeed: 10,
    maxAccel: 0.1,
    maxDecel: 0.05,
    maxSteeringAngle: Math.PI / 4,
    mass: 50000000,
    brakeForce: 100000,
    dragCoeff: 0.8,
  },
};

export interface VehicleInput {
  throttle: number; // 0..1 (or -1..1 for planner reverse)
  steering: number; // -1 to 1
  brake: number; // 0 to 1  (S key when gtaReverse)
  handbrake?: number; // 0 to 1
  /** W = throttle, S = brake then reverse once nearly stopped. */
  gtaReverse?: boolean;
}

const G = 9.81;
const RHO = 1.225;
const PHYS_SUBSTEPS = 2;
/** Pad force as a fraction of `brakeForce`; full pedal still saturates ABS. */
const BRAKE_PAD_GAIN = 0.95;
/** Longitudinal tyre utilisation under ABS (peak-μ, no lockup). */
const ABS_MU_UTIL = 1.01;
/** Brake-pressure rise 1/rate seconds (~0.12 s to full). */
const BRAKE_PRESSURE_RISE = 8.5;
const BRAKE_PRESSURE_FALL = 7;
/** Engine braking / overrun, N. ~0.35 m/s² on the sedan. */
const ENGINE_BRAKE_N = 520;
/** Hold S at rest this long before GTA reverse. */
const REVERSE_DWELL_SEC = 0.28;

/** Autopilot comfort deceleration (m/s²). */
export const COMFORT_DECEL = 3.0;
/** Autopilot / oracle emergency deceleration (m/s²). */
export const EMERGENCY_DECEL = 9.0;
const GEAR_RATIOS = [3.42, 2.05, 1.38, 1.05, 0.84, 0.67];
const FINAL_DRIVE = 3.72;
const REVERSE_RATIO = 3.15;
const WHEEL_RADIUS = 0.318;
const DRIVELINE_EFF = 0.9;
const IDLE_RPM = 850;
const REDLINE = 6400;
const SHIFT_UP_RPM = 5450;
const SHIFT_DOWN_RPM = 2100;

interface CarDynamics {
  mass: number;
  iz: number;
  a: number;
  b: number;
  cgHeight: number;
  caFront: number;
  caRear: number;
  mu: number;
  cd: number;
  area: number;
  crr: number;
  wheelRadius: number;
}

const CAR_DYN: CarDynamics = {
  mass: 1480,
  iz: 2680,
  a: 1.12,
  b: 1.58,
  cgHeight: 0.52,
  caFront: 95000,
  caRear: 110000,
  mu: 1.0,
  cd: 0.31,
  area: 2.22,
  crr: 0.013,
  wheelRadius: WHEEL_RADIUS,
};

function dynFor(type: VehicleType): CarDynamics {
  if (type === 'car') return CAR_DYN;
  const p = VEHICLE_PARAMS[type];
  const L = p.wheelbase;
  return {
    mass: p.mass,
    iz: p.mass * L * L * 0.22,
    a: L * 0.45,
    b: L * 0.55,
    cgHeight: 0.6,
    caFront: 40000,
    caRear: 45000,
    mu: 0.9,
    cd: p.dragCoeff,
    area: 3.5,
    crr: 0.015,
    wheelRadius: 0.4,
  };
}

/** Linear-to-saturated (Pacejka-lite) lateral force. */
export function tireLateralForce(slip: number, fz: number, mu: number, ca: number): number {
  const D = Math.max(mu * Math.max(fz, 80), 1);
  const B = ca / (1.3 * D);
  const x = B * slip;
  return -D * Math.sin(1.3 * Math.atan(x - (-0.2) * (x - Math.atan(x))));
}

function engineTorqueNm(rpm: number): number {
  const r = clamp(rpm, 700, REDLINE);
  if (r < 1400) return 150 + (250 - 150) * (r - 700) / 700;
  if (r < 4200) return 250 + (305 - 250) * (r - 1400) / 2800;
  if (r < 5600) return 305 + (275 - 305) * (r - 4200) / 1400;
  return 275 + (215 - 275) * (r - 5600) / (REDLINE - 5600);
}

/**
 * Map a requested +deceleration (m/s²) onto 0..1 brake pedal.
 * Comfort (~3) and emergency (~9) share the same sedan brake model.
 */
export function brakePedalForDecel(decel: number, vehicleType: VehicleType = 'car'): number {
  if (!(decel > 0.05)) return 0;
  const peak = Math.max(VEHICLE_PARAMS[vehicleType].maxDecel, 1);
  return clamp(decel / peak, 0, 1);
}

/** Planner/oracle accel (m/s²) → WASD-style vehicle input. */
export function vehicleInputFromAccel(
  accel: number,
  steering: number,
  vehicleType: VehicleType = 'car'
): VehicleInput {
  return {
    throttle: accel > 0 ? clamp(accel / 3, 0, 1) : 0,
    steering,
    brake: accel < 0 ? brakePedalForDecel(-accel, vehicleType) : 0,
  };
}

function hudStoppingDistance(speed: number, dyn: CarDynamics): number {
  if (speed < 0.25) return 0;
  const peakA = ABS_MU_UTIL * dyn.mu * G + dyn.crr * G + ENGINE_BRAKE_N / dyn.mass;
  const tRise = 1 / BRAKE_PRESSURE_RISE;
  return speed * tRise * 0.5 + (speed * speed) / (2 * Math.max(peakA, 1));
}

function approach(current: number, target: number, dt: number, up: number, down: number): number {
  const rate = Math.abs(target) >= Math.abs(current) && Math.sign(target) === Math.sign(current || target)
    ? up
    : (Math.abs(target) < Math.abs(current) ? down : up);
  const maxStep = rate * dt;
  const d = clamp(target - current, -maxStep, maxStep);
  return current + d;
}

function approachSteer(current: number, target: number, dt: number): number {
  const returning = Math.abs(target) < Math.abs(current) - 0.02;
  return approach(current, target, dt, 3.4, returning ? 6.2 : 3.4);
}

function maxSteerForSpeed(speed: number, peak: number, handbrake = 0): number {
  // Full lock at parking speeds; shrink with v^2 so 50 km/h A/D is ~0.5 g, not a slide.
  // Handbrake raises the budget so a flick can actually break the rear loose.
  const L = 2.7;
  const budget = 5.0 * (1 + 2.4 * clamp(handbrake, 0, 1));
  const fromG = budget * L / Math.max(speed * speed, 2.8);
  return clamp(Math.min(peak, fromG), 0.05, peak);
}

function finite(n: number | undefined, fallback = 0): number {
  return Number.isFinite(n) ? (n as number) : fallback;
}

export function syncBodyVelocity(state: EgoState, vx: number, vy: number, yawRateScale = 0.75): EgoState {
  const yaw = state.transform.rotation;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    ...state,
    velocity: vec3(vx, vy, 0),
    bodyVx: vx * c + vy * s,
    bodyVy: -vx * s + vy * c,
    yawRate: (state.yawRate ?? 0) * yawRateScale,
  };
}

function defaultPhysics(state: EgoState) {
  const yaw = state.transform.rotation;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const bodyVx = state.bodyVx ?? (state.velocity.x * c + state.velocity.y * s);
  const bodyVy = state.bodyVy ?? (-state.velocity.x * s + state.velocity.y * c);
  return {
    bodyVx: finite(bodyVx),
    bodyVy: finite(bodyVy),
    yawRate: finite(state.yawRate),
    gear: state.gear && state.gear !== 0 ? state.gear : 1,
    rpm: finite(state.rpm, IDLE_RPM),
    wheelSpin: finite(state.wheelSpin),
    steerFiltered: finite(state.steerFiltered),
    throttleFiltered: finite(state.throttleFiltered),
    brakeFiltered: finite(state.brakeFiltered),
    bodyRoll: finite(state.bodyRoll),
    bodyPitch: finite(state.bodyPitch),
    inReverse: !!state.inReverse,
    reverseHoldSec: finite(state.reverseHoldSec),
  };
}

function stepDynamics(
  posX: number,
  posY: number,
  yaw: number,
  u: number,
  v: number,
  r: number,
  steer: number,
  driveForce: number,
  brakeForce: number,
  handbrake: number,
  dyn: CarDynamics,
  dt: number
): { x: number; y: number; yaw: number; u: number; v: number; r: number; ax: number; ay: number; af: number; ar: number } {
  // Earth grip: weight is m·g, asphalt friction is μ·m·g. A gripped car cannot
  // crab — velocity stays on the nose and steering draws a curve (positive steer = left, +yaw).
  const L = dyn.a + dyn.b;
  const speed = Math.hypot(u, v);
  const MU = dyn.mu;

  const drag = 0.5 * RHO * dyn.cd * dyn.area * speed * speed;
  const rollR = dyn.crr * dyn.mass * G;
  const dragDir = Math.sign(u || 1);
  let fxBrake = -dragDir * brakeForce;
  const fxHb = -dragDir * handbrake * 9000;
  const absLimit = ABS_MU_UTIL * dyn.mu * dyn.mass * G;
  let fx: number;
  // ABS: keep longitudinal demand at peak-μ so the tyres do not lock/slide.
  // Handbrake skips this so Space can still break the rear loose.
  if (handbrake < 0.25) {
    fxBrake = clamp(fxBrake, -absLimit, absLimit);
    const tyreLong = clamp(driveForce + fxBrake + fxHb, -absLimit, absLimit);
    fx = tyreLong - dragDir * (drag + rollR);
  } else {
    fx = driveForce + fxBrake + fxHb - dragDir * (drag + rollR);
  }
  if (Math.abs(u) > 50) fx -= dragDir * (Math.abs(u) - 50) * 180;

  const parked = Math.abs(driveForce) < 120 && brakeForce < 40 && handbrake < 0.05 && Math.abs(u) < 0.25;
  const brakeHold = brakeForce > 250 && Math.abs(u) < 0.35 && Math.abs(driveForce) < 200 && handbrake < 0.25;
  let uDot = parked || brakeHold ? -u * 22 : fx / dyn.mass;
  let nu = u + uDot * dt;
  if (parked || brakeHold || (Math.abs(nu) < 0.05 && Math.abs(driveForce) < 40 && brakeForce < 40)) nu = 0;
  if (brakeForce > 200 && Math.sign(nu) !== Math.sign(u) && Math.abs(driveForce) < 80) nu = 0;

  const delta = clamp(steer, -0.6, 0.6);
  let nv = 0;
  let nr = 0;
  let af = 0;
  let ar = 0;

  if (Math.abs(nu) >= 0.35 && handbrake < 0.25) {
    const kappaCmd = Math.tan(delta) / L;
    const kappaMax = (MU * G) / Math.max(nu * nu, 1);
    const kappa = clamp(kappaCmd, -kappaMax, kappaMax);
    nr = clamp(nu * kappa, -1.6, 1.6);
    nv = 0;
    const uDen = Math.abs(nu) < 0.5 ? Math.sign(nu || 1) * 0.5 : nu;
    af = clamp(Math.atan2(dyn.a * nr, uDen) - delta, -0.25, 0.25);
    ar = clamp(Math.atan2(-dyn.b * nr, uDen), -0.25, 0.25);
  } else if (Math.abs(nu) >= 0.35) {
    // Handbrake: rear friction collapses, the nose rotates under the velocity.
    const kappa = Math.tan(delta) / L;
    nr = clamp(nu * kappa * (1 + 2.8 * handbrake) + r * 0.4, -2.4, 2.4);
    const stepOut = -Math.sign(nr || delta || 1) * (6 + 10 * handbrake) * dt;
    nv = clamp(v * 0.92 + stepOut, -14, 14);
    const uDen = Math.abs(nu) < 0.5 ? Math.sign(nu || 1) * 0.5 : nu;
    af = clamp(Math.atan2(nv + dyn.a * nr, uDen) - delta, -0.8, 0.8);
    ar = clamp(Math.atan2(nv - dyn.b * nr, uDen), -0.9, 0.9);
  } else {
    nr = 0;
    nv = 0;
  }

  if (!Number.isFinite(nu) || !Number.isFinite(nv) || !Number.isFinite(nr)) {
    nu = 0; nv = 0; nr = 0;
  }

  const nYaw = normalizeAngle(yaw + nr * dt);
  const c = Math.cos(nYaw);
  const s = Math.sin(nYaw);
  const vx = nu * c - nv * s;
  const vy = nu * s + nv * c;
  const ay = handbrake < 0.25 ? nu * nr : nv / Math.max(dt, 0.01);

  return {
    x: posX + vx * dt,
    y: posY + vy * dt,
    yaw: nYaw,
    u: nu,
    v: nv,
    r: nr,
    ax: uDot,
    ay,
    af,
    ar,
  };
}

export function updateVehicle(
  state: EgoState,
  input: VehicleInput,
  dt: number
): EgoState {
  const params = VEHICLE_PARAMS[state.vehicleType];
  const dyn = dynFor(state.vehicleType);
  const p = defaultPhysics(state);

  const rawThrottle = clamp(input.throttle, -1, 1);
  const rawSteer = clamp(input.steering, -1, 1);
  const rawBrake = clamp(input.brake, 0, 1);
  const rawHb = clamp(input.handbrake ?? 0, 0, 1);

  let wantThrottle = Math.max(0, rawThrottle);
  let wantBrake = rawBrake;
  let inReverse = p.inReverse;
  let reverseHoldSec = p.reverseHoldSec;

  if (input.gtaReverse) {
    const stopped = Math.abs(p.bodyVx) < 0.4 && Math.abs(p.bodyVy) < 0.4;
    if (!inReverse && stopped && rawBrake > 0.15 && wantThrottle < 0.05) {
      reverseHoldSec += dt;
    } else if (!inReverse) {
      reverseHoldSec = 0;
    }
    if (rawBrake > 0.15 && stopped && wantThrottle < 0.05) {
      if (inReverse || reverseHoldSec >= REVERSE_DWELL_SEC) {
        inReverse = true;
        wantThrottle = rawBrake;
        wantBrake = 0;
      } else {
        wantBrake = Math.max(wantBrake, rawBrake);
        wantThrottle = 0;
      }
    } else if (p.bodyVx > 0.6 || wantThrottle > 0.2) {
      inReverse = false;
      reverseHoldSec = 0;
    }
    if (inReverse && rawBrake > 0.05 && wantThrottle < 0.05) {
      wantThrottle = rawBrake;
      wantBrake = 0;
    }
    if (inReverse && rawThrottle > 0.1 && p.bodyVx < -0.4) {
      wantBrake = Math.max(wantBrake, rawThrottle);
      wantThrottle = 0;
    }
  } else if (rawThrottle < 0) {
    inReverse = p.bodyVx < 1.2;
    if (inReverse) {
      wantThrottle = -rawThrottle;
      wantBrake = rawBrake;
    } else {
      wantThrottle = 0;
      wantBrake = Math.max(rawBrake, -rawThrottle);
    }
  } else if (p.bodyVx > 1.2) {
    inReverse = false;
  }

  const steerFilt = approachSteer(p.steerFiltered, rawSteer, dt);
  const thrFilt = approach(p.throttleFiltered, wantThrottle, dt, 4.2, 6.5);
  const brkFilt = approach(p.brakeFiltered, wantBrake, dt, BRAKE_PRESSURE_RISE, BRAKE_PRESSURE_FALL);
  const hbFilt = approach(state.handbrake ?? 0, rawHb, dt, 10, 8);

  const speed = Math.hypot(p.bodyVx, p.bodyVy);
  const maxSteer = maxSteerForSpeed(speed, params.maxSteeringAngle, hbFilt);
  const steerAngle = clamp(steerFilt, -1, 1) * maxSteer;

  let gear = clamp(Math.round(p.gear), 1, 6);
  let rpm = p.rpm;
  const ratio = inReverse ? REVERSE_RATIO : (GEAR_RATIOS[gear - 1] ?? 1);
  const wheelOmega = Math.abs(p.bodyVx) / dyn.wheelRadius;
  rpm = wheelOmega * ratio * FINAL_DRIVE * 60 / (Math.PI * 2);
  if (speed < 0.6 && thrFilt < 0.05) rpm = IDLE_RPM;
  if (thrFilt > 0.2 && Math.abs(p.bodyVx) < 7) {
    rpm = Math.max(rpm, 2000 + 1600 * thrFilt);
  }
  rpm = clamp(Math.max(rpm, IDLE_RPM * (0.35 + 0.65 * thrFilt)), IDLE_RPM, REDLINE);

  if (!inReverse) {
    if (rpm > SHIFT_UP_RPM && gear < 6 && thrFilt > 0.15) gear += 1;
    else if (rpm < SHIFT_DOWN_RPM && gear > 1) gear -= 1;
  }

  const liveRatio = inReverse ? REVERSE_RATIO : (GEAR_RATIOS[gear - 1] ?? 1);
  const torque = engineTorqueNm(rpm) * thrFilt;
  let driveForce = (torque * liveRatio * FINAL_DRIVE * DRIVELINE_EFF) / dyn.wheelRadius;
  if (inReverse) driveForce = -Math.min(Math.max(driveForce, 2200 * thrFilt), 4200);
  else driveForce = Math.min(driveForce, 7200);
  if (!inReverse && thrFilt < 0.1 && Math.abs(p.bodyVx) > 0.55) {
    const fade = 1 - thrFilt / 0.1;
    driveForce -= Math.sign(p.bodyVx) * ENGINE_BRAKE_N * fade;
  }

  const brakeForce = brkFilt * params.brakeForce * BRAKE_PAD_GAIN;

  const h = dt / PHYS_SUBSTEPS;
  let x = state.transform.position.x;
  let y = state.transform.position.y;
  let yaw = state.transform.rotation;
  let u = p.bodyVx;
  let v = p.bodyVy;
  let r = p.yawRate;
  let ax = 0;
  let ay = 0;
  let af = 0;
  let ar = 0;

  for (let i = 0; i < PHYS_SUBSTEPS; i++) {
    const s = stepDynamics(x, y, yaw, u, v, r, steerAngle, driveForce, brakeForce, hbFilt, dyn, h);
    x = s.x; y = s.y; yaw = s.yaw; u = s.u; v = s.v; r = s.r;
    ax = s.ax; ay = s.ay; af = s.af; ar = s.ar;
  }

  u = clamp(finite(u), inReverse ? -12 : -16, params.maxSpeed);
  v = clamp(finite(v), -18, 18);
  r = clamp(finite(r), -2.8, 2.8);
  if (Math.abs(u) < 1.6 && hbFilt < 0.2) {
    af = 0;
    ar = 0;
    v = 0;
  }

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const vx = u * c - v * s;
  const vy = u * s + v * c;
  const worldSpeed = Math.hypot(vx, vy);
  const stoppingDistance = hudStoppingDistance(worldSpeed, dyn);

  // Cosmetic only, from body accel in g — not from the huge slip-angle number.
  const targetRoll = clamp((-ay / G) * 0.07, -MAX_COSMETIC_ROLL, MAX_COSMETIC_ROLL);
  const targetPitch = clamp((-ax / G) * 0.05, -MAX_COSMETIC_PITCH, MAX_COSMETIC_PITCH);
  const bodyRoll = clamp(approach(p.bodyRoll, targetRoll, dt, 3.5, 3.5), -MAX_COSMETIC_ROLL, MAX_COSMETIC_ROLL);
  const bodyPitch = clamp(approach(p.bodyPitch, targetPitch, dt, 6.5, 4.2), -MAX_COSMETIC_PITCH, MAX_COSMETIC_PITCH);
  const wheelSpin = p.wheelSpin + (u / dyn.wheelRadius) * dt;

  return {
    ...state,
    transform: {
      position: { x, y, z: state.transform.position.z },
      rotation: yaw,
    },
    velocity: vec3(finite(vx), finite(vy), 0),
    acceleration: vec3(finite(ax), finite(ay), 0),
    steering: steerAngle,
    throttle: inReverse ? -thrFilt : thrFilt,
    brake: brkFilt,
    mass: dyn.mass,
    stoppingDistance,
    bodyVx: u,
    bodyVy: v,
    yawRate: r,
    gear: inReverse ? -1 : gear,
    rpm,
    slipAngle: ar,
    slipAngleFront: af,
    slipAngleRear: ar,
    bodyRoll,
    bodyPitch,
    wheelSpin,
    handbrake: hbFilt,
    steerFiltered: steerFilt,
    throttleFiltered: thrFilt,
    brakeFiltered: brkFilt,
    inReverse,
    reverseHoldSec,
  };
}

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
    bodyVx: 0,
    bodyVy: 0,
    yawRate: 0,
    gear: 1,
    rpm: IDLE_RPM,
    slipAngle: 0,
    slipAngleFront: 0,
    slipAngleRear: 0,
    bodyRoll: 0,
    bodyPitch: 0,
    wheelSpin: 0,
    handbrake: 0,
    steerFiltered: 0,
    throttleFiltered: 0,
    brakeFiltered: 0,
    inReverse: false,
    reverseHoldSec: 0,
  };
}

export function formatGear(ego: EgoState): string {
  if (ego.inReverse || (ego.gear ?? 1) < 0) return 'R';
  const g = ego.gear ?? 1;
  if (Math.abs(ego.bodyVx ?? 0) < 0.25 && (ego.throttleFiltered ?? 0) < 0.05) return 'N';
  return `D${g}`;
}

// F5/F6 helpers removed; city vehicles stay on this TypeScript bicycle model.
