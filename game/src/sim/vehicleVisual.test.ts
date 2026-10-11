import { describe, it, expect } from 'vitest';
import {
  ROAD_SURFACE_Y,
  MAX_COSMETIC_ROLL,
  MAX_COSMETIC_PITCH,
  lowestWheelPointY,
  plantedVehiclePose,
  clampCosmeticAttitude,
} from './vehicleVisual';

describe('planted wheels stay on the road', () => {
  it('rests the lowest wheel point on the road within 1 cm', () => {
    expect(lowestWheelPointY(0, 0)).toBeCloseTo(ROAD_SURFACE_Y, 2);
    expect(Math.abs(lowestWheelPointY(0, 0) - ROAD_SURFACE_Y)).toBeLessThan(0.01);
  });

  it('keeps wheels on the road at max cosmetic roll', () => {
    const pose = plantedVehiclePose(MAX_COSMETIC_ROLL, 0);
    expect(Math.abs(pose.lowestWheelY - ROAD_SURFACE_Y)).toBeLessThan(0.01);
    for (const wheel of pose.wheels) {
      expect(Math.abs(wheel.bottomY - ROAD_SURFACE_Y)).toBeLessThan(0.01);
    }
  });

  it('keeps wheels on the road at max cosmetic pitch', () => {
    const pose = plantedVehiclePose(0, MAX_COSMETIC_PITCH);
    expect(Math.abs(pose.lowestWheelY - ROAD_SURFACE_Y)).toBeLessThan(0.01);
  });

  it('clamps roll to about 5° and pitch to about 3°', () => {
    const a = clampCosmeticAttitude(1, 1);
    expect(a.roll).toBeCloseTo(MAX_COSMETIC_ROLL, 6);
    expect(a.pitch).toBeCloseTo(MAX_COSMETIC_PITCH, 6);
    expect(a.roll).toBeLessThanOrEqual((5.1 * Math.PI) / 180);
    expect(a.pitch).toBeLessThanOrEqual((3.1 * Math.PI) / 180);
  });
});
