import { describe, it, expect } from 'vitest';
import {
  BOX_POP_S,
  LIDAR_DECAY_S,
  LIDAR_SWEEP_PERIOD_S,
  PERCEPTION_PERIOD_MS,
  type SnapPose,
  boxPopScale,
  interpolatePose,
  interpolatePoses,
  lerp,
  lerpAngle,
  lerpOccupancy,
  lidarAzimuth,
  lidarDecayAlpha,
  lidarLocalToWorldThree,
  lidarSweepAge,
  lidarSweepAngle,
  rememberBirths,
  snapshotAlpha,
  worldToEgo,
  wrapPi,
} from './snapshotLerp';

function pose(partial: Partial<SnapPose> & { id: number }): SnapPose {
  return {
    classType: 'car',
    x: 0,
    y: 0,
    z: 0,
    sx: 4,
    sy: 2,
    sz: 1.5,
    yaw: 0,
    vx: 0,
    vy: 0,
    confidence: 0.9,
    ...partial,
  };
}

describe('snapshot interpolation', () => {
  it('maps 10 Hz ticks onto a 0–1 display alpha', () => {
    expect(PERCEPTION_PERIOD_MS).toBe(100);
    expect(snapshotAlpha(1000, 1000)).toBe(0);
    expect(snapshotAlpha(1050, 1000)).toBeCloseTo(0.5, 5);
    expect(snapshotAlpha(1100, 1000)).toBe(1);
    expect(snapshotAlpha(1200, 1000)).toBe(1);
    expect(snapshotAlpha(900, 1000)).toBe(0);
  });

  it('lerps matched track ids and holds new tracks at the current snapshot', () => {
    const prev = [pose({ id: 1, x: 0, y: 0, yaw: 0, confidence: 0.4, vx: 0 })];
    const curr = [
      pose({ id: 1, x: 10, y: 4, yaw: Math.PI / 2, confidence: 0.8, vx: 8 }),
      pose({ id: 2, x: 3, y: 1, confidence: 0.7 }),
    ];
    const mid = interpolatePoses(prev, curr, 0.5);
    expect(mid).toHaveLength(2);
    expect(mid[0]!.id).toBe(1);
    expect(mid[0]!.x).toBeCloseTo(5, 5);
    expect(mid[0]!.y).toBeCloseTo(2, 5);
    expect(mid[0]!.confidence).toBeCloseTo(0.6, 5);
    expect(mid[0]!.vx).toBeCloseTo(4, 5);
    expect(mid[1]!.id).toBe(2);
    expect(mid[1]!.x).toBe(3);
    const start = interpolatePose(prev[0], curr[0]!, 0);
    expect(start.x).toBe(0);
    const end = interpolatePose(prev[0], curr[0]!, 1);
    expect(end.x).toBe(10);
  });

  it('lerps yaw the short way across ±π', () => {
    expect(lerp(0, 10, 0.25)).toBeCloseTo(2.5, 5);
    expect(wrapPi(Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2, 5);
    const a = lerpAngle(3.0, -3.0, 0.5);
    expect(Math.abs(a)).toBeGreaterThan(2.5);
    expect(Math.abs(lerpAngle(-Math.PI + 0.1, Math.PI - 0.1, 0.5))).toBeGreaterThan(2.5);
  });

  it('converts world detections into ego-local and lerps occupancy cells', () => {
    const loc = worldToEgo(10, 4, 1, 0, 0, 0);
    expect(loc.x).toBeCloseTo(10, 5);
    expect(loc.y).toBeCloseTo(4, 5);
    const rotated = worldToEgo(0, 10, 0, 0, 0, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(10, 5);
    expect(rotated.y).toBeCloseTo(0, 5);
    const out = new Float32Array(4);
    lerpOccupancy(out, new Float32Array([0, 0, 1, 0.5]), new Float32Array([1, 0.5, 1, 0]), 0.5);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(0.25, 5);
    expect(out[2]).toBeCloseTo(1, 5);
    expect(out[3]).toBeCloseTo(0.25, 5);
  });

  it('decays lidar returns after the sweep and pops boxes in', () => {
    expect(lidarAzimuth(1, 0)).toBeCloseTo(0, 5);
    expect(lidarAzimuth(0, 1)).toBeCloseTo(Math.PI / 2, 5);
    const sweep = lidarSweepAngle(LIDAR_SWEEP_PERIOD_S * 0.25);
    expect(sweep).toBeCloseTo(Math.PI / 2, 5);
    expect(lidarSweepAge(sweep, sweep)).toBeCloseTo(0, 5);
    const age = lidarSweepAge(0, Math.PI);
    expect(age).toBeCloseTo(LIDAR_SWEEP_PERIOD_S * 0.5, 5);
    expect(lidarDecayAlpha(0)).toBe(1);
    expect(lidarDecayAlpha(LIDAR_DECAY_S)).toBeCloseTo(Math.exp(-1), 5);
    expect(lidarDecayAlpha(LIDAR_DECAY_S * 3)).toBeLessThan(0.1);
    expect(boxPopScale(-0.1)).toBe(0);
    expect(boxPopScale(0)).toBe(0);
    expect(boxPopScale(BOX_POP_S / 2)).toBeGreaterThan(0.4);
    expect(boxPopScale(BOX_POP_S / 2)).toBeLessThan(0.6);
    expect(boxPopScale(BOX_POP_S)).toBe(1);
    expect(boxPopScale(1)).toBe(1);
  });

  it('anchors ego-local lidar hits in world so they do not drag with a later pose', () => {
    const hit = lidarLocalToWorldThree(10, 0, 0.4, 0, 0, 0);
    expect(hit.x).toBeCloseTo(10, 5);
    expect(hit.z).toBeCloseTo(0, 5);
    const moved = lidarLocalToWorldThree(10, 0, 0.4, 5, 2, 0);
    expect(moved.x).toBeCloseTo(15, 5);
    expect(moved.z).toBeCloseTo(-2, 5);
    const rotated = lidarLocalToWorldThree(10, 0, 0.4, 0, 0, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0, 5);
    expect(rotated.z).toBeCloseTo(-10, 5);
    const back = worldToEgo(moved.x, -moved.z, moved.y, 5, 2, 0);
    expect(back.x).toBeCloseTo(10, 5);
    expect(back.y).toBeCloseTo(0, 5);
  });

  it('records first-seen times and drops ids that left the snapshot', () => {
    const births = new Map<number, number>();
    rememberBirths(births, [1, 2], 4);
    expect(births.get(1)).toBe(4);
    rememberBirths(births, [1, 3], 4.5);
    expect(births.get(1)).toBe(4);
    expect(births.get(3)).toBe(4.5);
    expect(births.has(2)).toBe(false);
  });
});
