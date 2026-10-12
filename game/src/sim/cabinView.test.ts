import { describe, it, expect } from 'vitest';
import {
  COCKPIT,
  HAND_LOCK_DEG,
  ROAD_STEER_LOCK,
  driverEyeHeight,
  handWheelLockDeg,
  handWheelRotation,
  wheelViewOffset,
} from './cabinView';
import { AXLE_HEIGHT, BODY_CENTER_LOCAL_Y, BODY_HALF_HEIGHT } from './vehicleVisual';

describe('first-person cabin framing', () => {
  it('sits the driver on the left at about 1.2 m eye height', () => {
    expect(COCKPIT.eye.z).toBeGreaterThan(0.25);
    expect(COCKPIT.wheel.z).toBeGreaterThan(0.25);
    expect(Math.abs(COCKPIT.wheel.z - COCKPIT.eye.z)).toBeLessThan(0.12);
    expect(driverEyeHeight()).toBeGreaterThan(1.12);
    expect(driverEyeHeight()).toBeLessThan(1.28);
    expect(driverEyeHeight()).toBeCloseTo(1.2, 2);
    expect(AXLE_HEIGHT + COCKPIT.eye.y).toBeCloseTo(driverEyeHeight(), 5);
  });

  it('puts a 36 cm wheel left of centre in the lower third', () => {
    const view = wheelViewOffset();
    expect(COCKPIT.wheelRadius).toBeCloseTo(0.18, 5);
    expect(view.depth).toBeGreaterThan(0.35);
    expect(view.depth).toBeLessThan(0.95);
    expect(view.ndcY).toBeLessThan(-1 / 3);
    expect(view.ndcY).toBeGreaterThan(-0.88);
    expect(view.ndcX).toBeLessThan(0);
    expect(view.ndcX).toBeGreaterThan(-0.55);
    expect(view.radiusNdc).toBeGreaterThan(0.12);
    expect(view.radiusNdc).toBeLessThan(0.46);
    expect(Math.abs(view.ndcY) + view.radiusNdc * 0.45).toBeLessThan(1.05);
  });

  it('keeps the driver’s eyes inside the greenhouse, under the roof', () => {
    const rockerTop = BODY_CENTER_LOCAL_Y + BODY_HALF_HEIGHT;
    expect(COCKPIT.eye.y).toBeGreaterThan(rockerTop + 0.12);
    expect(COCKPIT.eye.y).toBeLessThan(1.05);
    expect(COCKPIT.eye.x).toBeLessThan(COCKPIT.wheel.x);
    expect(COCKPIT.look.x).toBeGreaterThan(COCKPIT.wheel.x);
  });

  it('turns the hand wheel 450° each way and returns to centre', () => {
    expect(handWheelLockDeg(ROAD_STEER_LOCK)).toBeCloseTo(-HAND_LOCK_DEG, 5);
    expect(handWheelLockDeg(-ROAD_STEER_LOCK)).toBeCloseTo(HAND_LOCK_DEG, 5);
    expect(handWheelRotation(0)).toBeCloseTo(0);
    // A = +steer = counter-clockwise (negative rotation.x).
    expect(handWheelRotation(0.4)).toBeLessThan(-1);
    expect(handWheelRotation(-0.4)).toBeGreaterThan(1);
  });
});
