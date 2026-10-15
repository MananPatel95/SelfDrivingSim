/** Pedestrian mesh faces local +Z (shoes / chest). Sim heading 0 is +X. */

export function headingFromVelocity(vx: number, vy: number, fallback: number): number {
  if (vx * vx + vy * vy < 1e-6) return fallback;
  return Math.atan2(vy, vx);
}

export function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current: number, target: number, dt: number, rate = 8): number {
  const d = angleDelta(target, current);
  const t = 1 - Math.exp(-rate * Math.max(0, dt));
  return current + d * t;
}

/** Three.js Yaw so local +Z walks along sim heading θ → world (cos θ, 0, −sin θ). */
export function pedestrianMeshYaw(simYaw: number): number {
  return simYaw + Math.PI / 2;
}
