/**
 * Visual pose of the sedan: wheels stay planted on the road.
 * Cosmetic roll/pitch rotate the body around an axle-height pivot only.
 */

export const ROAD_SURFACE_Y = 0.02;
export const VISUAL_WHEEL_RADIUS = 0.38;
export const AXLE_HEIGHT = ROAD_SURFACE_Y + VISUAL_WHEEL_RADIUS;
export const MAX_COSMETIC_ROLL = (5 * Math.PI) / 180;
export const MAX_COSMETIC_PITCH = (3 * Math.PI) / 180;

export const WHEEL_PLAN_OFFSETS: ReadonlyArray<{ x: number; z: number; front: boolean }> = [
  { x: 1.3, z: 0.92, front: true },
  { x: 1.3, z: -0.92, front: true },
  { x: -1.3, z: 0.92, front: false },
  { x: -1.3, z: -0.92, front: false },
];

export function clampCosmeticAttitude(roll: number, pitch: number): { roll: number; pitch: number } {
  return {
    roll: Math.max(-MAX_COSMETIC_ROLL, Math.min(MAX_COSMETIC_ROLL, roll)),
    pitch: Math.max(-MAX_COSMETIC_PITCH, Math.min(MAX_COSMETIC_PITCH, pitch)),
  };
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
  };
}

export function lowestWheelPointY(roll: number, pitch: number): number {
  return plantedVehiclePose(roll, pitch).lowestWheelY;
}
