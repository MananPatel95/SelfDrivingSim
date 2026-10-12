/**
 * Driver’s-eye framing for first person.
 * Coordinates are body-pivot local: +X nose, +Y up, +Z left.
 * Left-hand seat at ~1.2 m; the rim is ~0.6 m ahead, ~35% from the left of a 16:9 frame.
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

/** Pitch below the horizon so the road fills the windshield. */
export const LOOK_DOWN_DEG = 7;

export const COCKPIT = {
  /** Pivot-local. World eye height is AXLE_HEIGHT + eye.y ≈ 1.2 m. */
  eye: { x: -0.06, y: 1.2 - AXLE_HEIGHT, z: -0.34 } satisfies CabinVec,
  /**
   * 7° down, 12 m ahead, slightly toward the road centre. Horizon lands
   * ~40% from the top of a 70° frame.
   */
  look: { x: 11.851, y: -0.617, z: 0.08 } satisfies CabinVec,
  /**
   * 36 cm rim 0.60 m in front of the eye, screen-left (~35% from the left),
   * vertical centre such that the full rim sits between the dash and the
   * bottom edge.
   */
  wheel: { x: 0.515, y: 0.543, z: -0.544 } satisfies CabinVec,
  wheelRadius: 0.185,
  /** Slim modern rim tube. */
  wheelTube: 0.012,
  fovDeg: 70,
  /** Extra cockpit still: same layout, wider windshield view. */
  wideFovDeg: 95,
  /**
   * Dash top as NDC Y (bottom of frame = -1). 55% from the top of the frame
   * so the windshield (road + sky) is the upper ~55%.
   */
  dashTopNdc: -0.10,
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

export function lookDownDeg(
  layout: { eye: CabinVec; look: CabinVec } = COCKPIT,
): number {
  const dx = layout.look.x - layout.eye.x;
  const dy = layout.look.y - layout.eye.y;
  const dz = layout.look.z - layout.eye.z;
  const horiz = Math.hypot(dx, dz);
  return (Math.atan2(-dy, horiz) * 180) / Math.PI;
}

export function handWheelRotation(steerRad: number): number {
  return -steerRad * COCKPIT.handGain;
}

export function handWheelLockDeg(steerRad: number): number {
  return (handWheelRotation(steerRad) * 180) / Math.PI;
}

/** Windshield / road as a fraction of frame height. */
export function windshieldFraction(dashTopNdc = COCKPIT.dashTopNdc): number {
  return (1 - dashTopNdc) / 2;
}

function viewBasis(layout: { eye: CabinVec; look: CabinVec }) {
  const fx = layout.look.x - layout.eye.x;
  const fy = layout.look.y - layout.eye.y;
  const fz = layout.look.z - layout.eye.z;
  const fl = Math.hypot(fx, fy, fz);
  const f = { x: fx / fl, y: fy / fl, z: fz / fl };
  // Match THREE.Camera.lookAt: backward = eye - target, right = up × backward
  // = (bz.z, 0, -bz.x) with world up (0,1,0).
  const bz = { x: -f.x, y: -f.y, z: -f.z };
  let rx = bz.z;
  let ry = 0;
  let rz = -bz.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // Three.js up is backward × right.
  const ux = bz.y * rz - bz.z * ry;
  const uy = bz.z * rx - bz.x * rz;
  const uz = bz.x * ry - bz.y * rx;
  return { f, r: { x: rx, y: ry, z: rz }, u: { x: ux, y: uy, z: uz } };
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
): {
  ndcX: number;
  ndcY: number;
  radiusNdc: number;
  depth: number;
  areaFrac: number;
  widthFrac: number;
} {
  const { f, r, u } = viewBasis(layout);
  const vx = layout.wheel.x - layout.eye.x;
  const vy = layout.wheel.y - layout.eye.y;
  const vz = layout.wheel.z - layout.eye.z;
  const depth = vx * f.x + vy * f.y + vz * f.z;
  const tanV = Math.tan((layout.fovDeg * Math.PI) / 180 / 2);
  const tanH = tanV * aspect;
  const ndcX = (vx * r.x + vy * r.y + vz * r.z) / depth / tanH;
  const ndcY = (vx * u.x + vy * u.y + vz * u.z) / depth / tanV;
  const radiusNdc = layout.wheelRadius / depth / tanV;
  const widthFrac = (2 * layout.wheelRadius / depth / tanH) / 2;
  return {
    ndcX,
    ndcY,
    radiusNdc,
    depth,
    areaFrac: (Math.PI * radiusNdc * radiusNdc) / 4,
    widthFrac,
  };
}
