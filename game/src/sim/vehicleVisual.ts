/**
 * Visual pose of the sedan: wheels stay planted on the road.
 * Cosmetic roll/pitch rotate the body around an axle-height pivot only.
 * The lowest BODY point stays 12–15 cm above the road at max attitude.
 */

export const ROAD_SURFACE_Y = 0.02;
export const VISUAL_WHEEL_RADIUS = 0.38;
export const AXLE_HEIGHT = ROAD_SURFACE_Y + VISUAL_WHEEL_RADIUS;
export const MAX_COSMETIC_ROLL = (5 * Math.PI) / 180;
export const MAX_COSMETIC_PITCH = (3 * Math.PI) / 180;
/** Target ground clearance of the body sill at max roll + pitch. */
export const BODY_CLEARANCE = 0.135;

export const WHEEL_PLAN_OFFSETS: ReadonlyArray<{ x: number; z: number; front: boolean }> = [
  { x: 1.3, z: 0.92, front: true },
  { x: 1.3, z: -0.92, front: true },
  { x: -1.3, z: 0.92, front: false },
  { x: -1.3, z: -0.92, front: false },
];

/** Lower body / rocker (meters, local to the axle-height pivot). */
export const BODY_HALF_LENGTH = 1.15;
export const BODY_HALF_WIDTH = 0.76;
export const BODY_HALF_HEIGHT = 0.32;
/**
 * Pivot-local Y of the body-box center. Raised so max roll+pitch still
 * leaves BODY_CLEARANCE above the road (see lowestBodyPointY).
 */
export const BODY_CENTER_LOCAL_Y = 0.215;

export interface BodyPart {
  halfX: number;
  halfY: number;
  halfZ: number;
  cx: number;
  cy: number;
  cz: number;
}

export const BODY_PARTS: readonly BodyPart[] = [
  // Rocker / sill — the lowest painted body.
  { halfX: BODY_HALF_LENGTH, halfY: BODY_HALF_HEIGHT, halfZ: BODY_HALF_WIDTH, cx: 0, cy: BODY_CENTER_LOCAL_Y, cz: 0 },
  // Nose / tail sit higher so overhangs do not spear the road when pitching.
  { halfX: 0.55, halfY: 0.22, halfZ: 0.78, cx: 1.85, cy: BODY_CENTER_LOCAL_Y + 0.18, cz: 0 },
  { halfX: 0.5, halfY: 0.22, halfZ: 0.78, cx: -1.8, cy: BODY_CENTER_LOCAL_Y + 0.16, cz: 0 },
];

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
