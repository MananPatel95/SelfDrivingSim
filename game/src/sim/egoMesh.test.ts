import { describe, it, expect } from 'vitest';
import {
  BODY_PAINT_UV_CELLS,
  buildEgoVisual,
  EGO_DRAW_CALL_BUDGET,
  LAYER_COCKPIT,
  LAYER_EXTERIOR,
  SEDAN_MODEL_URL,
  SILVER_PAINT,
  assembleEgoVisual,
  applyCameraLayers,
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

function named(root: THREE.Object3D, name: string): THREE.Object3D {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (obj.name === name) found = obj;
  });
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function boxesTouch(a: THREE.Object3D, b: THREE.Object3D, slack = 0.06): boolean {
  a.updateWorldMatrix(true, true);
  b.updateWorldMatrix(true, true);
  const ba = new THREE.Box3().setFromObject(a).expandByScalar(slack);
  const bb = new THREE.Box3().setFromObject(b);
  return ba.intersectsBox(bb);
}

describe('Kenney sedan-sports mesh', () => {
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
    expect(COCKPIT.wheelRadius).toBeCloseTo(0.185, 5);
  });

  it('fits the Kenney stand-in to about 4.7 × 1.85 × 1.45 m', () => {
    const visual = assembleEgoVisual(makePlaceholderSedan());
    visual.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    visual.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.layers.isEnabled(LAYER_EXTERIOR)) return;
      if (!/body|wheel/i.test(mesh.name) && !visual.wheels.some((w) => w.mesh === mesh)) return;
      box.expandByObject(mesh);
    });
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(SEDAN_LENGTH * 0.85);
    expect(size.x).toBeLessThan(SEDAN_LENGTH * 1.15);
    expect(size.z).toBeGreaterThan(SEDAN_WIDTH * 0.7);
    expect(size.z).toBeLessThan(SEDAN_WIDTH * 1.2);
    expect(size.y).toBeGreaterThan(SEDAN_HEIGHT * 0.7);
    expect(size.y).toBeLessThan(SEDAN_HEIGHT * 1.55);
    expect(box.min.y).toBeGreaterThan(-0.02);
    expect(box.min.y).toBeLessThan(0.04);
  });

  it('loads the Kenney sedan-sports GLB and silvers only paint UV cells', () => {
    expect(SEDAN_MODEL_URL).toBe('/models/sedan-sports.glb');
    expect(BODY_PAINT_UV_CELLS).toContainEqual([2, 5]);
    expect(BODY_PAINT_UV_CELLS).toContainEqual([3, 4]);
    expect(BODY_PAINT_UV_CELLS).toContainEqual([3, 5]);
    expect(BODY_PAINT_UV_CELLS.every(([c, r]) => c >= 0 && c < 8 && r >= 0 && r < 8)).toBe(true);
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

  it('builds a connected cockpit: dash, hood, pillars, header, screen, column', () => {
    const visual = buildEgoVisual();
    visual.group.updateWorldMatrix(true, true);
    const dash = named(visual.group, 'dash');
    const hood = named(visual.group, 'hood');
    const left = named(visual.group, 'pillar-left');
    const right = named(visual.group, 'pillar-right');
    const header = named(visual.group, 'header');
    const screen = named(visual.group, 'centre-screen');
    const mount = named(visual.group, 'screen-mount');
    const column = named(visual.group, 'steer-column');
    expect(boxesTouch(dash, hood)).toBe(true);
    expect(boxesTouch(dash, left)).toBe(true);
    expect(boxesTouch(dash, right)).toBe(true);
    expect(boxesTouch(dash, column, 0.12)).toBe(true);
    expect(boxesTouch(dash, mount, 0.12)).toBe(true);
    expect(boxesTouch(mount, screen, 0.16)).toBe(true);
    const mountBox = new THREE.Box3().setFromObject(mount);
    const faceBox = new THREE.Box3().setFromObject(screen);
    // Mount stays under/behind the tablet — it must not cover the screen face.
    expect(mountBox.max.y).toBeLessThan(faceBox.max.y - 0.02);
    expect(boxesTouch(left, header)).toBe(true);
    expect(boxesTouch(right, header)).toBe(true);
    expect(boxesTouch(column, visual.steerWheel, 0.1)).toBe(true);
    const dashBox = new THREE.Box3().setFromObject(dash);
    const wheelBox = new THREE.Box3().setFromObject(visual.steerWheel);
    // Rim sits in open air in front of the dash (smaller +X is toward the driver).
    expect(wheelBox.max.x).toBeLessThan(dashBox.min.x + 0.08);
    expect(wheelBox.max.x).toBeGreaterThan(dashBox.min.x - 0.35);
    const screenBox = new THREE.Box3().setFromObject(screen);
    const screenSize = screenBox.getSize(new THREE.Vector3());
    expect(Math.max(screenSize.x, screenSize.z)).toBeGreaterThan(screenSize.y);
    expect(COCKPIT.wideFovDeg).toBeGreaterThan(COCKPIT.fovDeg);
    expect(COCKPIT.dashTopNdc).toBeGreaterThan(-0.2);
    expect(COCKPIT.dashTopNdc).toBeLessThan(0.12);
    named(visual.group, 'wheel-hub');
    named(visual.group, 'wheel-logo');
    named(visual.group, 'ambient-strip');
    expect(visual.eyeAnchor.position.x).toBeCloseTo(COCKPIT.eye.x, 5);
    expect(visual.lookAnchor.position.x).toBeCloseTo(COCKPIT.look.x, 5);
  });

  it('hides the exterior layer from a first-person camera', () => {
    const visual = buildEgoVisual();
    const cam = new THREE.PerspectiveCamera();
    applyCameraLayers(cam, true);
    expect(cam.layers.isEnabled(LAYER_COCKPIT)).toBe(true);
    expect(cam.layers.isEnabled(LAYER_EXTERIOR)).toBe(false);
    let exterior = 0;
    let cockpit = 0;
    visual.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.layers.isEnabled(LAYER_EXTERIOR)) exterior += 1;
      if (mesh.layers.isEnabled(LAYER_COCKPIT)) cockpit += 1;
    });
    expect(exterior).toBeGreaterThan(0);
    expect(cockpit).toBeGreaterThan(0);
  });
});
