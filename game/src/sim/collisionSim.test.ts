import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { vec3, vec3Length } from './math';

describe('simulation collision response', () => {
  it('counts a car hit, shoves the traffic car, and drops autopilot to manual', () => {
    const sim = new Simulation({ seed: 3 });
    sim.setupHitDemo('car');
    expect(sim.getState().controlSource).toBe('policy');
    let hit = false;
    for (let i = 0; i < 45; i++) {
      sim.step(1 / 30);
      if (sim.getState().collisionCount > 0) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
    const state = sim.getState();
    expect(state.collisionCount).toBeGreaterThanOrEqual(1);
    expect(state.lastCollision?.classType).toBe('car');
    expect(state.controlSource).toBe('human');
    expect(state.lastTakeover?.reason).toBe('collision');
    const npc = state.trafficVehicles[0]!;
    expect(Math.hypot(npc.velocity.x, npc.velocity.y)).toBeGreaterThan(1);
    expect(Math.abs(npc.yawRate ?? 0)).toBeGreaterThan(0.05);
    const ego = state.ego;
    const gap = Math.hypot(
      ego.transform.position.x - npc.transform.position.x,
      ego.transform.position.y - npc.transform.position.y,
    );
    expect(gap).toBeGreaterThan(3.2);
  });

  it('snaps a fast pole hit and logs it once', () => {
    const sim = new Simulation({ seed: 3 });
    const poleId = sim.setupHitDemo('pole');
    const pole = sim.getState().worldMap.staticEntities.find(e => e.id === poleId)!;
    expect(pole).toBeTruthy();
    for (let i = 0; i < 40; i++) {
      sim.step(1 / 30, { throttle: 1, steering: 0, brake: 0, gtaReverse: true });
      if (sim.getState().brokenFurniture.length > 0) break;
    }
    const state = sim.getState();
    expect(state.collisionCount).toBeGreaterThanOrEqual(1);
    expect(state.lastCollision?.classType).toBe('pole');
    expect(state.brokenFurniture.length).toBeGreaterThanOrEqual(1);
    expect(state.brokenFurniture[0]!.classType).toBe('pole');
    expect(vec3Length(state.ego.velocity)).toBeLessThan(14);
    expect(state.ego.transform.position.y).toBeLessThan(pole.transform.position.y + 2.6);
  });

  it('snaps a fast sign and keeps the ego from passing through', () => {
    const sim = new Simulation({ seed: 3 });
    const signId = sim.setupHitDemo('sign');
    const sign0 = sim.getState().worldMap.staticEntities.find(e => e.id === signId)!;
    expect(sign0).toBeTruthy();
    for (let i = 0; i < 40; i++) {
      sim.step(1 / 30, { throttle: 1, steering: 0, brake: 0, gtaReverse: true });
      if (sim.getState().brokenFurniture.some(b => b.id === signId)) break;
    }
    const state = sim.getState();
    expect(state.collisionCount).toBeGreaterThanOrEqual(1);
    expect(state.lastCollision?.classType).toBe('stop_sign');
    expect(state.brokenFurniture.some(b => b.id === signId)).toBe(true);
    expect(state.ego.transform.position.y).toBeLessThan(sign0.transform.position.y + 2.6);
  });

  it('knocks a pedestrian into a tumble and logs the hit', () => {
    const sim = new Simulation({ seed: 3 });
    sim.setupHitDemo('pedestrian');
    for (let i = 0; i < 45; i++) {
      sim.step(1 / 30);
      if (sim.getState().collisionCount > 0) break;
    }
    const state = sim.getState();
    expect(state.collisionCount).toBeGreaterThanOrEqual(1);
    expect(state.lastCollision?.classType).toBe('pedestrian');
    expect(state.collisionLog.some(e => e.classType === 'pedestrian')).toBe(true);
    const ped = state.pedestrians[0]!;
    expect(ped.state).toBe('tumbling');
    expect(Math.hypot(ped.velocity.x, ped.velocity.y)).toBeGreaterThan(1);
    expect(Math.abs(ped.tumbleOmegaP ?? 0) + Math.abs(ped.tumblePitch ?? 0)).toBeGreaterThan(0.2);
    expect(state.controlSource).toBe('human');
  });

  it('does not increment the counter every frame while overlapping', () => {
    const sim = new Simulation({ seed: 3 });
    sim.setupHitDemo('car');
    for (let i = 0; i < 60; i++) sim.step(1 / 30);
    expect(sim.getState().collisionCount).toBeLessThanOrEqual(2);
    expect(sim.getState().collisionCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps a slow rub against a pole from snapping it', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginParked(vec3(3.5, -8, 0), Math.PI / 2);
    const pole = sim.getState().worldMap.staticEntities.find(e => e.classType === 'pole');
    expect(pole).toBeTruthy();
    sim.getState().ego = {
      ...sim.getState().ego,
      transform: { position: vec3(pole!.transform.position.x - 2.4, pole!.transform.position.y, 0), rotation: 0 },
      velocity: vec3(2.5, 0, 0),
      bodyVx: 2.5,
      bodyVy: 0,
    };
    sim.getState().controlSource = 'human';
    for (let i = 0; i < 20; i++) {
      sim.step(1 / 30, { throttle: 0.15, steering: 0, brake: 0, gtaReverse: true });
    }
    expect(sim.getState().brokenFurniture.length).toBe(0);
    const after = sim.getState().worldMap.staticEntities.find(e => e.id === pole!.id)!;
    expect(after.transform.position.x).toBeCloseTo(pole!.transform.position.x, 3);
  });
});
