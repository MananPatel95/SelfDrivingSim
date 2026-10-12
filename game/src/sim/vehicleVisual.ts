/**
 * Visual pose of the sedan: wheels stay planted on the road.
 * Cosmetic roll/pitch rotate the body around an axle-height pivot only.
 * The lowest BODY point stays 12–15 cm above the road at max attitude.
 */

export const ROAD_SURFACE_Y = 0.02;
/** Kenney sedan-sports native AABB before our +X-forward fit (meters). */
export const KENNEY_NATIVE_LENGTH = 2.55;
export const KENNEY_NATIVE_WIDTH = 1.3;
export const KENNEY_NATIVE_HEIGHT = 1.1;
export const KENNEY_NATIVE_WHEEL_RADIUS = 0.3;
/** Visual wheel center |x| (left/right) and |z| (fore/aft) in Kenney space. */
export const KENNEY_NATIVE_WHEEL_LATERAL = 0.425;
export const KENNEY_NATIVE_WHEEL_LONG = 0.66;

/** Fitted sedan: ~4.7 × 1.85 × 1.45 m. */
export const SEDAN_LENGTH = 4.7;
export const SEDAN_WIDTH = 1.85;
export const SEDAN_HEIGHT = 1.45;
export const SEDAN_SCALE_LENGTH = SEDAN_LENGTH / KENNEY_NATIVE_LENGTH;
export const SEDAN_SCALE_WIDTH = SEDAN_WIDTH / KENNEY_NATIVE_WIDTH;
export const SEDAN_SCALE_HEIGHT = SEDAN_HEIGHT / KENNEY_NATIVE_HEIGHT;

/**
 * Road-wheel radius stays at the review-accepted size (old 1.3 m native height
 * scale). The sports body uses a shorter native height, so we do not grow the
 * tires with SEDAN_SCALE_HEIGHT.
 */
export const VISUAL_WHEEL_RADIUS = KENNEY_NATIVE_WHEEL_RADIUS * (SEDAN_HEIGHT / 1.3);
export const AXLE_HEIGHT = ROAD_SURFACE_Y + VISUAL_WHEEL_RADIUS;
export const MAX_COSMETIC_ROLL = (5 * Math.PI) / 180;
export const MAX_COSMETIC_PITCH = (3 * Math.PI) / 180;
/** Target ground clearance of the body sill at max roll + pitch. */
export const BODY_CLEARANCE = 0.135;

/** Half the tire width after a uniform wheel scale (circular tires). */
export const VISUAL_WHEEL_HALF_WIDTH = 0.175 * (SEDAN_HEIGHT / 1.3);

export const WHEEL_PLAN_OFFSETS: ReadonlyArray<{ x: number; z: number; front: boolean }> = [
  { x: KENNEY_NATIVE_WHEEL_LONG * SEDAN_SCALE_LENGTH, z: KENNEY_NATIVE_WHEEL_LATERAL * SEDAN_SCALE_WIDTH, front: true },
  { x: KENNEY_NATIVE_WHEEL_LONG * SEDAN_SCALE_LENGTH, z: -KENNEY_NATIVE_WHEEL_LATERAL * SEDAN_SCALE_WIDTH, front: true },
  { x: -KENNEY_NATIVE_WHEEL_LONG * SEDAN_SCALE_LENGTH, z: KENNEY_NATIVE_WHEEL_LATERAL * SEDAN_SCALE_WIDTH, front: false },
  { x: -KENNEY_NATIVE_WHEEL_LONG * SEDAN_SCALE_LENGTH, z: -KENNEY_NATIVE_WHEEL_LATERAL * SEDAN_SCALE_WIDTH, front: false },
];

/** Lower body / rocker (meters, local to the axle-height pivot). */
export const BODY_HALF_LENGTH = 1.35;
export const BODY_HALF_WIDTH = SEDAN_WIDTH / 2;
export const BODY_HALF_HEIGHT = 0.28;
/**
 * Pivot-local Y of the body-box center. Raised so max roll+pitch still
 * leaves BODY_CLEARANCE above the road (see lowestBodyPointY).
 */
export const BODY_CENTER_LOCAL_Y = 0.248;

export interface BodyPart {
  halfX: number;
  halfY: number;
  halfZ: number;
  cx: number;
  cy: number;
  cz: number;
}

export const BODY_PARTS: readonly BodyPart[] = [
  // Rocker / sill — the lowest painted body, wide enough to cover the tires.
  { halfX: BODY_HALF_LENGTH, halfY: BODY_HALF_HEIGHT, halfZ: BODY_HALF_WIDTH, cx: 0, cy: BODY_CENTER_LOCAL_Y, cz: 0 },
  // Nose / tail sit higher so overhangs do not spear the road when pitching.
  { halfX: 0.62, halfY: 0.20, halfZ: 0.90, cx: 2.05, cy: BODY_CENTER_LOCAL_Y + 0.14, cz: 0 },
  { halfX: 0.58, halfY: 0.20, halfZ: 0.90, cx: -2.00, cy: BODY_CENTER_LOCAL_Y + 0.12, cz: 0 },
];

/** Outer face of a tire in |z|. Must stay inside BODY_HALF_WIDTH. */
export function tireOuterHalfWidth(): number {
  return Math.max(...WHEEL_PLAN_OFFSETS.map((w) => Math.abs(w.z))) + VISUAL_WHEEL_HALF_WIDTH;
}

export function clampCosmeticAttitude(roll: number, pitch: number): { roll: number; pitch: number } {
  return {
    roll: Math.max(-MAX_COSMETIC_ROLL, Math.min(MAX_COSMETIC_ROLL, roll)),
    pitch: Math.max(-MAX_COSMETIC_PITCH, Math.min(MAX_COSMETIC_PITCH, pitch)),
  };
}

/**
 * Three.js Euler YXZ (yaw=0, pitch=x, roll applied as z = -roll) → local Y.
 * Matches egoBodyPivot.rotation.order = 'YXZ'.
 */
export function eulerYxzLocalY(x: number, y: number, z: number, roll: number, pitch: number): number {
  const a = Math.cos(pitch);
  const b = Math.sin(pitch);
  const e = Math.cos(-roll);
  const f = Math.sin(-roll);
  return a * f * x + a * e * y - b * z;
}

export function lowestBodyPointY(roll: number, pitch: number): number {
  const att = clampCosmeticAttitude(roll, pitch);
  let minLocal = Infinity;
  for (const part of BODY_PARTS) {
    for (const sx of [-1, 1] as const) {
      for (const sy of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const y = eulerYxzLocalY(
            part.cx + sx * part.halfX,
            part.cy + sy * part.halfY,
            part.cz + sz * part.halfZ,
            att.roll,
            att.pitch
          );
          if (y < minLocal) minLocal = y;
        }
      }
    }
  }
  return AXLE_HEIGHT + minLocal;
}

export interface WheelContact {
  x: number;
  y: number;
  z: number;
  bottomY: number;
  front: boolean;
}

/**
 * Wheel contacts live on the un-rolled root. Body roll/pitch must not move them.
 */
export function plantedVehiclePose(roll: number, pitch: number): {
  roll: number;
  pitch: number;
  wheels: WheelContact[];
  lowestWheelY: number;
  lowestBodyY: number;
} {
  const attitude = clampCosmeticAttitude(roll, pitch);
  const wheels = WHEEL_PLAN_OFFSETS.map((w) => ({
    x: w.x,
    y: AXLE_HEIGHT,
    z: w.z,
    bottomY: AXLE_HEIGHT - VISUAL_WHEEL_RADIUS,
    front: w.front,
  }));
  return {
    ...attitude,
    wheels,
    lowestWheelY: Math.min(...wheels.map((w) => w.bottomY)),
    lowestBodyY: lowestBodyPointY(attitude.roll, attitude.pitch),
  };
}

export function lowestWheelPointY(roll: number, pitch: number): number {
  return plantedVehiclePose(roll, pitch).lowestWheelY;
}

/**
 * Yaw for a mesh whose nose is local +X.
 * Sim heading θ moves in (cos θ, sin θ), drawn as Three.js (cos θ, 0, -sin θ).
 * rotation.y = θ points that nose along the heading. rotation.y = -θ + π points it sideways or backward.
 */
export function meshYawForHeading(simYaw: number): number {
  return simYaw;
}

export function noseInSimPlane(simYaw: number): { x: number; y: number } {
  const phi = meshYawForHeading(simYaw);
  return { x: Math.cos(phi), y: Math.sin(phi) };
}
