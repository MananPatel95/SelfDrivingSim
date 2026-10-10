export default function init(): Promise<void>;
export function cast_rays(
  ox: number, oy: number, oz: number,
  dirs: Float32Array, boxes: Float32Array, maxRange: number
): Float32Array;
export function fill_occupancy(
  resolution: number, extent: number,
  centers: Float32Array, sizes: Float32Array, values: Float32Array
): Float32Array;
export function step_vehicle(
  x: number, y: number, yaw: number, vx: number, vy: number,
  throttle: number, steering: number, brake: number, dt: number,
  wheelbase: number, maxSpeed: number, maxAccel: number, maxDecel: number
): Float32Array;
export function filter_ground(points: Float32Array, zThresh: number): Float32Array;
