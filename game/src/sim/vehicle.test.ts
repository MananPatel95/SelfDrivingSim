import { describe, it, expect } from 'vitest';
import { createEgoState, updateVehicle, tireLateralForce } from './vehicle';
import { vec3Length } from './math';

const DT = 1 / 30;

function drive(seconds: number, input: Parameters<typeof updateVehicle>[1], start = createEgoState('car', { x: 0, y: 0, z: 0 }, 0)) {
  let ego = start;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    ego = updateVehicle(ego, input, DT);
  }
  return ego;
}

describe('dynamic bicycle sedan', () => {
  it('accelerates 0 to 100 km/h in about 7–9 seconds', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    let t = 0;
    const limit = 14;
    while (t < limit && vec3Length(ego.velocity) * 3.6 < 100) {
      ego = updateVehicle(ego, { throttle: 1, steering: 0, brake: 0 }, DT);
      t += DT;
      expect(Number.isFinite(ego.transform.position.x)).toBe(true);
    }
    expect(vec3Length(ego.velocity) * 3.6).toBeGreaterThanOrEqual(100);
    expect(t).toBeGreaterThanOrEqual(6.5);
    expect(t).toBeLessThanOrEqual(9.5);
  });

  it('stops from 100 km/h in a plausible distance', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 27.78, velocity: { x: 27.78, y: 0, z: 0 } };
    const startX = ego.transform.position.x;
    let t = 0;
    while (t < 8 && Math.abs(ego.bodyVx ?? 0) > 0.4) {
      ego = updateVehicle(ego, { throttle: 0, steering: 0, brake: 1 }, DT);
      t += DT;
    }
    const dist = Math.abs(ego.transform.position.x - startX);
    expect(Math.abs(ego.bodyVx ?? 1)).toBeLessThan(0.8);
    expect(dist).toBeGreaterThan(28);
    expect(dist).toBeLessThan(60);
  });

  it('W+left curves left along the nose, not 45° to the right', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 8, velocity: { x: 8, y: 0, z: 0 } };
    ego = drive(2.2, { throttle: 0.6, steering: 1, brake: 0 }, ego);
    expect(ego.transform.rotation).toBeGreaterThan(0.35);
    expect(ego.transform.position.y).toBeGreaterThan(4);
    expect(ego.transform.position.x).toBeGreaterThan(4);
    const travel = Math.atan2(ego.velocity.y, ego.velocity.x);
    let err = travel - ego.transform.rotation;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    expect(Math.abs(err)).toBeLessThan((12 * Math.PI) / 180);
    expect(Math.abs(ego.bodyVy ?? 0)).toBeLessThan(0.8);
  });

  it('reaches a steady-state turn without NaNs', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 16, velocity: { x: 16, y: 0, z: 0 } };
    ego = drive(4.5, { throttle: 0.35, steering: 0.45, brake: 0 }, ego);
    expect(Number.isFinite(ego.transform.position.x)).toBe(true);
    expect(Number.isFinite(ego.transform.position.y)).toBe(true);
    expect(Number.isFinite(ego.transform.rotation)).toBe(true);
    expect(Number.isFinite(ego.yawRate ?? NaN)).toBe(true);
    expect(Number.isFinite(ego.slipAngleFront ?? NaN)).toBe(true);
    expect(Math.abs(ego.yawRate ?? 0)).toBeGreaterThan(0.08);
    expect(Math.abs(ego.transform.position.y)).toBeGreaterThan(4);
  });

  it('handbrake induces rear slip / oversteer', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 20, velocity: { x: 20, y: 0, z: 0 } };
    ego = drive(0.25, { throttle: 0.2, steering: 0.55, brake: 0, handbrake: 0 }, ego);
    const gripRear = Math.abs(ego.slipAngleRear ?? 0);
    ego = drive(0.45, { throttle: 0.15, steering: 0.7, brake: 0, handbrake: 1 }, ego);
    expect(Number.isFinite(ego.slipAngleRear ?? NaN)).toBe(true);
    expect(Math.abs(ego.slipAngleRear ?? 0)).toBeGreaterThan(0.12);
    expect(Math.abs(ego.slipAngleRear ?? 0)).toBeGreaterThan(Math.abs(ego.slipAngleFront ?? 0) * 0.7);
    expect(Math.abs(ego.slipAngleRear ?? 0)).toBeGreaterThan(gripRear);
  });

  it('reports ~0 slip when parked', () => {
    const ego = drive(1.0, { throttle: 0, steering: 0, brake: 1, handbrake: 0 });
    expect(Math.abs(ego.bodyVx ?? 0)).toBeLessThan(0.3);
    expect(Math.abs(ego.slipAngle ?? 0)).toBeLessThan(0.02);
  });

  it('does not spin in place at zero speed with full steer', () => {
    const ego = drive(1.2, { throttle: 0, steering: 1, brake: 0, handbrake: 0 });
    expect(Math.abs(ego.transform.rotation)).toBeLessThan(0.05);
    expect(Math.abs(ego.yawRate ?? 0)).toBeLessThan(0.05);
    expect(Math.abs(ego.transform.position.x)).toBeLessThan(0.05);
  });

  it('S+A brakes and turns without a 45° crab slide', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 12, velocity: { x: 12, y: 0, z: 0 } };
    ego = drive(1.0, { throttle: 0, steering: -1, brake: 1, gtaReverse: true }, ego);
    const speed = vec3Length(ego.velocity);
    const side = Math.abs(ego.bodyVy ?? 0);
    const along = Math.abs(ego.bodyVx ?? 0);
    expect(side).toBeLessThan(Math.max(1.5, along * 0.35));
    if (speed > 2) {
      const travel = Math.atan2(ego.velocity.y, ego.velocity.x);
      let err = travel - ego.transform.rotation;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      expect(Math.abs(err)).toBeLessThan((18 * Math.PI) / 180);
    }
    expect(ego.inReverse).toBe(false);
  });

  it('S+A from rest reverses along the car, not on a diagonal', () => {
    const ego = drive(1.6, { throttle: 0, steering: -1, brake: 1, gtaReverse: true });
    expect(ego.inReverse).toBe(true);
    expect(ego.bodyVx ?? 0).toBeLessThan(-1.5);
    const travel = Math.atan2(ego.bodyVy ?? 0, ego.bodyVx || -1);
    const fromLong = Math.min(Math.abs(travel), Math.abs(Math.abs(travel) - Math.PI));
    expect(fromLong).toBeLessThan((15 * Math.PI) / 180);
  });

  it('GTA reverse: S at rest drives backward', () => {
    const ego = drive(1.8, { throttle: 0, steering: 0, brake: 1, gtaReverse: true });
    expect(ego.inReverse).toBe(true);
    expect(ego.bodyVx ?? 0).toBeLessThan(-2.0);
  });

  it('Pacejka-lite saturates and stays finite', () => {
    const small = tireLateralForce(0.02, 4000, 1.0, 70000);
    const large = tireLateralForce(0.8, 4000, 1.0, 70000);
    expect(Math.abs(small)).toBeLessThan(Math.abs(large));
    expect(Math.abs(large)).toBeLessThan(4200);
    expect(Number.isFinite(large)).toBe(true);
  });

  it('50 km/h moderate steer stays under 6° slip and 1 g', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 13.9, velocity: { x: 13.9, y: 0, z: 0 } };
    ego = drive(3.2, { throttle: 0.28, steering: 0.4, brake: 0 }, ego);
    const slipDeg = Math.abs(ego.slipAngle ?? 0) * 180 / Math.PI;
    const latG = Math.abs(ego.acceleration.y) / 9.81;
    expect(Number.isFinite(slipDeg)).toBe(true);
    expect(slipDeg).toBeLessThan(6);
    expect(latG).toBeLessThan(1);
    expect(vec3Length(ego.velocity) * 3.6).toBeGreaterThan(35);
    expect(Math.abs(ego.bodyRoll ?? 0)).toBeLessThanOrEqual((5.1 * Math.PI) / 180);
  });

  it('12 km/h moderate steer does not blow slip to 60°', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 3.33, velocity: { x: 3.33, y: 0, z: 0 } };
    ego = drive(2.2, { throttle: 0.18, steering: 0.45, brake: 0 }, ego);
    const slipDeg = Math.abs(ego.slipAngle ?? 0) * 180 / Math.PI;
    expect(slipDeg).toBeLessThan(8);
    expect(Math.abs(ego.bodyRoll ?? 0)).toBeLessThanOrEqual((5.1 * Math.PI) / 180);
  });

  it('handbrake slide produces rear slip above 15°', () => {
    let ego = createEgoState('car', { x: 0, y: 0, z: 0 }, 0);
    ego = { ...ego, bodyVx: 20, velocity: { x: 20, y: 0, z: 0 } };
    ego = drive(0.2, { throttle: 0.25, steering: 0.55, brake: 0, handbrake: 0 }, ego);
    ego = drive(0.55, { throttle: 0.1, steering: 0.75, brake: 0, handbrake: 1 }, ego);
    const rearDeg = Math.abs(ego.slipAngleRear ?? 0) * 180 / Math.PI;
    expect(rearDeg).toBeGreaterThan(15);
    expect(Math.abs(ego.slipAngleRear ?? 0)).toBeGreaterThan(Math.abs(ego.slipAngleFront ?? 0) * 0.7);
  });
});
