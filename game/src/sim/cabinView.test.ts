import { describe, it, expect } from 'vitest';
import {
  COCKPIT,
  HAND_LOCK_DEG,
  LOOK_DOWN_DEG,
  ROAD_STEER_LOCK,
  driverEyeHeight,
  handWheelLockDeg,
  handWheelRotation,
  lookDownDeg,
  wheelViewOffset,
  windshieldFraction,
} from './cabinView';
import { AXLE_HEIGHT, BODY_CENTER_LOCAL_Y, BODY_HALF_HEIGHT } from './vehicleVisual';

describe('first-person cabin framing', () => {
  it('sits the driver on the left at about 1.2 m eye height', () => {
    expect(COCKPIT.eye.z).toBeLessThan(-0.25);
    expect(COCKPIT.wheel.z).toBeLessThan(0);
    expect(driverEyeHeight()).toBeGreaterThan(1.12);
    expect(driverEyeHeight()).toBeLessThan(1.28);
    expect(driverEyeHeight()).toBeCloseTo(1.2, 2);
    expect(AXLE_HEIGHT + COCKPIT.eye.y).toBeCloseTo(driverEyeHeight(), 5);
    expect(COCKPIT.fovDeg).toBeGreaterThanOrEqual(85);
    expect(COCKPIT.fovDeg).toBeLessThanOrEqual(90);
  });

  it('puts a ~36 cm wheel 0.55–0.65 m ahead, full rim, ~35% from the left', () => {
    const view = wheelViewOffset();
    expect(COCKPIT.wheelRadius).toBeGreaterThan(0.16);
    expect(COCKPIT.wheelRadius).toBeLessThan(0.22);
    expect(view.depth).toBeGreaterThan(0.54);
    expect(view.depth).toBeLessThan(0.66);
    expect(view.ndcY).toBeLessThan(-0.60);
    expect(view.ndcY).toBeGreaterThan(-0.85);
    // 35% from the left is ndcX ≈ -0.30.
    expect(view.ndcX).toBeLessThan(-0.18);
    expect(view.ndcX).toBeGreaterThan(-0.42);
    expect(view.widthFrac).toBeGreaterThan(0.14);
    expect(view.widthFrac).toBeLessThan(0.26);
    const rimTop = view.ndcY + view.radiusNdc;
    const rimBot = view.ndcY - view.radiusNdc;
    // Only the rim top may rise above the dash line.
    expect(rimTop).toBeLessThan(COCKPIT.dashTopNdc + 0.06);
    expect(rimTop).toBeGreaterThan(COCKPIT.dashTopNdc - 0.02);
    expect(rimBot).toBeGreaterThan(-1.12);
    expect(rimBot).toBeLessThan(-0.92);
  });

  it('keeps the driver’s eyes inside the greenhouse, under the roof', () => {
    const rockerTop = BODY_CENTER_LOCAL_Y + BODY_HALF_HEIGHT;
    expect(COCKPIT.eye.y).toBeGreaterThan(rockerTop + 0.12);
    expect(COCKPIT.eye.y).toBeLessThan(1.05);
    expect(COCKPIT.eye.x).toBeLessThan(COCKPIT.wheel.x);
    expect(COCKPIT.look.x).toBeGreaterThan(COCKPIT.wheel.x);
    expect(COCKPIT.look.y).toBeLessThan(COCKPIT.eye.y);
  });

  it('pitches down so the road fills the windshield and the dash is a low shelf', () => {
    expect(lookDownDeg()).toBeGreaterThan(9.5);
    expect(lookDownDeg()).toBeLessThan(12.5);
    expect(lookDownDeg()).toBeCloseTo(LOOK_DOWN_DEG, 0);
    expect(windshieldFraction()).toBeGreaterThan(0.68);
    expect(windshieldFraction()).toBeLessThan(0.78);
    expect(COCKPIT.dashTopNdc).toBeGreaterThan(-0.52);
    expect(COCKPIT.dashTopNdc).toBeLessThan(-0.38);
    expect(COCKPIT.wideFovDeg).toBeGreaterThanOrEqual(100);
    const tanV = Math.tan((COCKPIT.fovDeg * Math.PI) / 180 / 2);
    const horizonFromTop = (1 - Math.tan((lookDownDeg() * Math.PI) / 180) / tanV) / 2;
    expect(horizonFromTop).toBeGreaterThan(0.36);
    expect(horizonFromTop).toBeLessThan(0.44);
  });

  it('turns the hand wheel 450° each way and returns to centre', () => {
    expect(handWheelLockDeg(ROAD_STEER_LOCK)).toBeCloseTo(-HAND_LOCK_DEG, 5);
    expect(handWheelLockDeg(-ROAD_STEER_LOCK)).toBeCloseTo(HAND_LOCK_DEG, 5);
    expect(handWheelRotation(0)).toBeCloseTo(0);
    expect(handWheelRotation(0.4)).toBeLessThan(-1);
    expect(handWheelRotation(-0.4)).toBeGreaterThan(1);
  });
});
