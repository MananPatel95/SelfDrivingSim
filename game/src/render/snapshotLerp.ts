/**
 * Interpolate 10 Hz perception snapshots on the display path.
 * Perception itself is not recomputed between ticks.
 */

export const PERCEPTION_PERIOD_MS = 100;
/** Visual 360° sweep (shader + beam). Independent of the 10 Hz WASM cast. */
export const LIDAR_SWEEP_PERIOD_S = 1;
/** Fade after the beam. ~100° trail at 1 rev/s — a comet, not a full ring. */
export const LIDAR_DECAY_S = 0.28;
export const BOX_POP_S = 0.22;

export interface SnapPose {
  id: number;
  classType: string;
  /** Ego-local metres. */
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  /** Yaw relative to ego. */
  yaw: number;
  vx: number;
  vy: number;
  confidence: number;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapPi(b - a) * t;
}

/** 0 at the last 10 Hz snapshot, 1 when the next tick is due. */
export function snapshotAlpha(
  nowMs: number,
  lastSnapMs: number,
  periodMs: number = PERCEPTION_PERIOD_MS,
): number {
  if (periodMs <= 0) return 1;
  return clamp01((nowMs - lastSnapMs) / periodMs);
}

export function pairById(
  prev: SnapPose[],
  curr: SnapPose[],
): Array<{ prev: SnapPose | undefined; curr: SnapPose }> {
  const map = new Map<number, SnapPose>();
  for (const p of prev) map.set(p.id, p);
  return curr.map(c => ({ prev: map.get(c.id), curr: c }));
}

export function interpolatePose(prev: SnapPose | undefined, curr: SnapPose, t: number): SnapPose {
  if (!prev || t >= 1) return { ...curr };
  if (t <= 0) return { ...prev, id: curr.id, classType: curr.classType };
  return {
    id: curr.id,
    classType: curr.classType,
    x: lerp(prev.x, curr.x, t),
    y: lerp(prev.y, curr.y, t),
    z: lerp(prev.z, curr.z, t),
    sx: lerp(prev.sx, curr.sx, t),
    sy: lerp(prev.sy, curr.sy, t),
    sz: lerp(prev.sz, curr.sz, t),
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    vx: lerp(prev.vx, curr.vx, t),
    vy: lerp(prev.vy, curr.vy, t),
    confidence: lerp(prev.confidence, curr.confidence, t),
  };
}

export function interpolatePoses(prev: SnapPose[], curr: SnapPose[], t: number): SnapPose[] {
  return pairById(prev, curr).map(({ prev: p, curr: c }) => interpolatePose(p, c, t));
}

export function worldToEgo(
  wx: number,
  wy: number,
  wz: number,
  egoX: number,
  egoY: number,
  egoYaw: number,
): { x: number; y: number; z: number } {
  const dx = wx - egoX;
  const dy = wy - egoY;
  const c = Math.cos(-egoYaw);
  const s = Math.sin(-egoYaw);
  return { x: dx * c - dy * s, y: dx * s + dy * c, z: wz };
}

/** Ego-local lidar hit → Three.js world (x, height, -y). Anchors returns on the road. */
export function lidarLocalToWorldThree(
  lx: number,
  ly: number,
  lz: number,
  egoX: number,
  egoY: number,
  egoYaw: number,
): { x: number; y: number; z: number } {
  const c = Math.cos(egoYaw);
  const s = Math.sin(egoYaw);
  const wx = egoX + lx * c - ly * s;
  const wy = egoY + lx * s + ly * c;
  return { x: wx, y: lz, z: -wy };
}

export function lidarAzimuth(x: number, y: number): number {
  return Math.atan2(y, x);
}

/** Azimuth of a Three.js world point relative to live ego (matches the lidar decay shader). */
export function lidarAzimuthFromWorldThree(
  threeX: number,
  threeZ: number,
  egoX: number,
  egoY: number,
  egoYaw: number,
): number {
  const loc = worldToEgo(threeX, -threeZ, 0, egoX, egoY, egoYaw);
  return lidarAzimuth(loc.x, loc.y);
}

export function lidarSweepAngle(timeS: number, periodS: number = LIDAR_SWEEP_PERIOD_S): number {
  const twoPi = Math.PI * 2;
  const p = periodS > 0 ? periodS : LIDAR_SWEEP_PERIOD_S;
  const f = timeS / p;
  return (f - Math.floor(f)) * twoPi;
}

/** True when a CCW sweep from `prev` to `curr` crossed `azimuth` (handles wrap). */
export function lidarSweepCrossed(
  azimuth: number,
  prevSweep: number,
  currSweep: number,
): boolean {
  const twoPi = Math.PI * 2;
  let span = currSweep - prevSweep;
  span = ((span % twoPi) + twoPi) % twoPi;
  if (span <= 1e-9) return false;
  let d = azimuth - prevSweep;
  d = ((d % twoPi) + twoPi) % twoPi;
  return d <= span;
}

/** Seconds since the sweep last crossed this azimuth. */
export function lidarSweepAge(
  azimuth: number,
  sweepAngle: number,
  periodS: number = LIDAR_SWEEP_PERIOD_S,
): number {
  const twoPi = Math.PI * 2;
  let d = sweepAngle - azimuth;
  d = ((d % twoPi) + twoPi) % twoPi;
  return (d / twoPi) * periodS;
}

export function lidarDecayAlpha(ageS: number, decayS: number = LIDAR_DECAY_S): number {
  if (ageS <= 0) return 1;
  return Math.exp(-ageS / Math.max(1e-6, decayS));
}

export function boxPopScale(ageS: number, popS: number = BOX_POP_S): number {
  if (ageS <= 0) return 0;
  if (ageS >= popS) return 1;
  const x = ageS / popS;
  return x * x * (3 - 2 * x);
}

export function poseAgeS(id: number, births: Map<number, number>, nowS: number): number {
  const b = births.get(id);
  return b === undefined ? popSDefault() : Math.max(0, nowS - b);
}

function popSDefault(): number {
  return BOX_POP_S;
}

export function rememberBirths(
  births: Map<number, number>,
  ids: Iterable<number>,
  nowS: number,
): void {
  const seen = new Set<number>();
  for (const id of ids) {
    seen.add(id);
    if (!births.has(id)) births.set(id, nowS);
  }
  for (const id of [...births.keys()]) {
    if (!seen.has(id)) births.delete(id);
  }
}

export function lerpOccupancy(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array,
  t: number,
): Float32Array {
  const n = Math.min(out.length, a.length, b.length);
  const u = 1 - t;
  for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0) * u + (b[i] ?? 0) * t;
  return out;
}
