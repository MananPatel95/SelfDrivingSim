/**
 * Driver’s-eye framing for first person.
 * Coordinates are body-pivot local: +X nose, +Y up, +Z left.
 * The wheel sits in the lower-left of a 16:9 frame so the road stays visible.
 */

export interface CabinVec {
  x: number;
  y: number;
  z: number;
}

export const COCKPIT = {
  eye: { x: -0.22, y: 0.92, z: 0.28 } satisfies CabinVec,
  look: { x: 18, y: 0.86, z: 0.0 } satisfies CabinVec,
  wheel: { x: 0.36, y: 0.78, z: 0.3 } satisfies CabinVec,
  wheelRadius: 0.2,
  fovDeg: 74,
  /**
   * Road steer (radians) → hand-wheel rotation.
   * Positive rotation.x swings the top of the rim toward screen-right,
   * so a left turn (positive steer, A) uses the opposite sign.
   */
  handGain: 4.6,
} as const;

export function handWheelRotation(steerRad: number): number {
  return -steerRad * COCKPIT.handGain;
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
): { ndcX: number; ndcY: number; radiusNdc: number; depth: number } {
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
  return {
    ndcX: (vx * rx + vy * ry + vz * rz) / depth / tanH,
    ndcY: (vx * ux + vy * uy + vz * uz) / depth / tanV,
    radiusNdc: layout.wheelRadius / depth / tanV,
    depth,
  };
}
