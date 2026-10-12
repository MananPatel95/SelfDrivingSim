import { describe, it, expect } from 'vitest';
import {
  buildEgoVisual,
  EGO_DRAW_CALL_BUDGET,
  LAYER_COCKPIT,
  LAYER_EXTERIOR,
  SILVER_PAINT,
  assembleEgoVisual,
  makePlaceholderSedan,
} from './egoMesh';
import { COCKPIT } from './cabinView';
import {
  BODY_HALF_WIDTH,
  ROAD_SURFACE_Y,
  SEDAN_HEIGHT,
  SEDAN_LENGTH,
  SEDAN_WIDTH,
  VISUAL_WHEEL_HALF_WIDTH,
  VISUAL_WHEEL_RADIUS,
  WHEEL_PLAN_OFFSETS,
} from './vehicleVisual';
import * as THREE from 'three';

describe('Kenney sedan mesh', () => {
  it('assembles four planted wheels and a left-hand cockpit', () => {
    const visual = buildEgoVisual();
    expect(visual.drawCalls).toBeLessThanOrEqual(EGO_DRAW_CALL_BUDGET);
    expect(visual.wheels).toHaveLength(4);
    expect(visual.steerWheel.children.length).toBeGreaterThanOrEqual(2);
    expect(visual.wheels.every((w) => w.spinAxis === 'x')).toBe(true);
  });

  it('places road wheels inside the body half-width and on the axle height', () => {
    const visual = buildEgoVisual();
    for (const wheel of visual.wheels) {
      const outer = Math.abs(wheel.pivot.position.z) + VISUAL_WHEEL_HALF_WIDTH;
      expect(outer).toBeLessThan(BODY_HALF_WIDTH);
      expect(wheel.pivot.position.y).toBeCloseTo(ROAD_SURFACE_Y + VISUAL_WHEEL_RADIUS, 5);
    }
    for (const spec of WHEEL_PLAN_OFFSETS) {
      expect(Math.abs(spec.z) + VISUAL_WHEEL_HALF_WIDTH).toBeLessThan(BODY_HALF_WIDTH);
    }
  });

  it('mounts the 36 cm hand wheel on the left in front of the driver', () => {
    const visual = buildEgoVisual();
    expect(visual.steerWheel.position.z).toBeCloseTo(COCKPIT.wheel.z, 5);
    expect(visual.steerWheel.position.x).toBeGreaterThan(COCKPIT.eye.x);
    expect(visual.steerWheel.position.y).toBeLessThan(COCKPIT.eye.y);
    expect(COCKPIT.wheelRadius).toBeCloseTo(0.18, 5);
  });

  it('fits the Kenney stand-in to about 4.7 × 1.85 × 1.45 m', () => {
    const visual = assembleEgoVisual(makePlaceholderSedan());
    const box = new THREE.Box3().setFromObject(visual.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(SEDAN_LENGTH * 0.85);
    expect(size.x).toBeLessThan(SEDAN_LENGTH * 1.15);
    expect(size.z).toBeGreaterThan(SEDAN_WIDTH * 0.7);
    expect(size.z).toBeLessThan(SEDAN_WIDTH * 1.2);
    expect(size.y).toBeGreaterThan(SEDAN_HEIGHT * 0.7);
    expect(size.y).toBeLessThan(SEDAN_HEIGHT * 1.25);
    expect(box.min.y).toBeGreaterThan(-0.02);
    expect(box.min.y).toBeLessThan(0.04);
  });

  it('paints the exterior silver and keeps cockpit / body on separate layers', () => {
    const visual = buildEgoVisual();
    let silver = 0;
    visual.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const color = (mat as THREE.MeshLambertMaterial).color;
        if (color && color.getHex() === SILVER_PAINT) silver += 1;
      }
    });
    expect(silver).toBeGreaterThan(0);
    expect(visual.bodyPivot.children.some((c) => c.layers.isEnabled(LAYER_EXTERIOR) || c.layers.isEnabled(LAYER_COCKPIT))).toBe(true);
  });
});
