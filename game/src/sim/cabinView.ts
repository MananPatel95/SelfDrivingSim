/**
 * Driver’s-eye framing for first person.
 * Coordinates are body-pivot local: +X nose, +Y up, +Z left.
 * Driver's seat on screen-left (~1.2 m eye), 36 cm wheel in the lower-left third.
 */

import { VEHICLE_PARAMS } from './vehicle';
import { AXLE_HEIGHT } from './vehicleVisual';

export interface CabinVec {
  x: number;
  y: number;
  z: number;
}

/** Hand-wheel lock each way from centre, matching a modern EV rack. */
export const HAND_LOCK_DEG = 450;

export const ROAD_STEER_LOCK = VEHICLE_PARAMS.car.maxSteeringAngle;

export const COCKPIT = {
  /** Pivot-local. World eye height is AXLE_HEIGHT + eye.y ≈ 1.2 m. */
  eye: { x: -0.18, y: 1.2 - AXLE_HEIGHT, z: -0.38 } satisfies CabinVec,
  look: { x: 20, y: 1.2 - AXLE_HEIGHT - 0.04, z: -0.02 } satisfies CabinVec,
  wheel: { x: 0.50, y: 1.2 - AXLE_HEIGHT - 0.33, z: -0.42 } satisfies CabinVec,
  /** ~36 cm rim, left of centre in the lower third. */
  wheelRadius: 0.18,
  /** Rim tube radius (slim modern wheel). */
  wheelTube: 0.011,
  fovDeg: 70,
  /**
   * Road steer (radians) → hand-wheel rotation.
   * Positive rotation.x swings the top of the rim toward screen-right,
   * so a left turn (positive steer, A) uses the opposite sign.
   */
  handGain: (HAND_LOCK_DEG * Math.PI) / 180 / ROAD_STEER_LOCK,
} as const;

export function driverEyeHeight(): number {
  return AXLE_HEIGHT + COCKPIT.eye.y;
}

export function handWheelRotation(steerRad: number): number {
  return -steerRad * COCKPIT.handGain;
}

export function handWheelLockDeg(steerRad: number): number {
  return (handWheelRotation(steerRad) * 180) / Math.PI;
}

/**
 * Wheel center in the first-person frame.
 * ndcX/ndcY are -1..1 across the view (positive X is screen right, positive Y is up).
 */
export function wheelViewOffset(
  layout: {
    eye: CabinVec;
    look: CabinVec;
    wheel: CabinVec;
    wheelRadius: number;
    fovDeg: number;
  } = COCKPIT,
  aspect = 16 / 9,
): { ndcX: number; ndcY: number; radiusNdc: number; depth: number; areaFrac: number } {
  const fx = layout.look.x - layout.eye.x;
  const fy = layout.look.y - layout.eye.y;
  const fz = layout.look.z - layout.eye.z;
  const fl = Math.hypot(fx, fy, fz);
  const f = { x: fx / fl, y: fy / fl, z: fz / fl };
  // Match THREE.Camera.lookAt: backward = eye - target, right = up × backward.
  const bz = { x: -f.x, y: -f.y, z: -f.z };
  let rx = -bz.z;
  let ry = 0;
  let rz = bz.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * bz.z - rz * bz.y;
  const uy = rz * bz.x - rx * bz.z;
  const uz = rx * bz.y - ry * bz.x;

  const vx = layout.wheel.x - layout.eye.x;
  const vy = layout.wheel.y - layout.eye.y;
  const vz = layout.wheel.z - layout.eye.z;
  const depth = vx * f.x + vy * f.y + vz * f.z;
  const tanV = Math.tan((layout.fovDeg * Math.PI) / 180 / 2);
  const tanH = tanV * aspect;
  const ndcX = (vx * rx + vy * ry + vz * rz) / depth / tanH;
  const ndcY = (vx * ux + vy * uy + vz * uz) / depth / tanV;
  const radiusNdc = layout.wheelRadius / depth / tanV;
  return {
    ndcX,
    ndcY,
    radiusNdc,
    depth,
    areaFrac: (Math.PI * radiusNdc * radiusNdc) / 4,
  };
}
