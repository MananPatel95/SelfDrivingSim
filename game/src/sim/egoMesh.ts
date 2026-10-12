/**
 * Kenney CC0 sedan (GLB) plus a minimal Tesla-style cockpit overlay.
 * Wheels are detached so they stay planted while the body rolls about the axle.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COCKPIT } from './cabinView';
import {
  AXLE_HEIGHT,
  KENNEY_NATIVE_HEIGHT,
  KENNEY_NATIVE_LENGTH,
  KENNEY_NATIVE_WHEEL_RADIUS,
  KENNEY_NATIVE_WIDTH,
  ROAD_SURFACE_Y,
  SEDAN_HEIGHT,
  SEDAN_LENGTH,
  SEDAN_WIDTH,
  VISUAL_WHEEL_RADIUS,
  WHEEL_PLAN_OFFSETS,
} from './vehicleVisual';

export const SEDAN_MODEL_URL = '/models/sedan.glb';
export const SILVER_PAINT = 0xc5cad1;
export const LAYER_WORLD = 0;
export const LAYER_COCKPIT = 1;
export const LAYER_EXTERIOR = 2;

export interface EgoWheelRef {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  front: boolean;
  spinAxis: 'x' | 'y';
}

export interface EgoVisual {
  group: THREE.Group;
  bodyPivot: THREE.Group;
  steerWheel: THREE.Group;
  wheels: EgoWheelRef[];
  drawCalls: number;
}

export const EGO_DRAW_CALL_BUDGET = 24;

function xform(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rot?: THREE.Euler,
  scale?: THREE.Vector3,
): THREE.BufferGeometry {
  const g = geo.clone();
  if (rot) g.rotateX(rot.x), g.rotateY(rot.y), g.rotateZ(rot.z);
  if (scale) g.scale(scale.x, scale.y, scale.z);
  g.translate(x, y, z);
  return g;
}

function mergeOrNull(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const live = parts.filter((p) => p.getAttribute('position'));
  if (live.length === 0) return null;
  return mergeGeometries(live, false);
}

function addMerged(
  parent: THREE.Object3D,
  parts: THREE.BufferGeometry[],
  mat: THREE.Material,
  castShadow = true,
): THREE.Mesh | null {
  const geo = mergeOrNull(parts);
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function countMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) n += 1;
  });
  return n;
}

function setLayerDeep(root: THREE.Object3D, layer: number): void {
  root.traverse((obj) => {
    obj.layers.set(layer);
  });
}

export function applyCameraLayers(camera: THREE.Camera, hood: boolean): void {
  camera.layers.enable(LAYER_WORLD);
  if (hood) {
    camera.layers.enable(LAYER_COCKPIT);
    camera.layers.disable(LAYER_EXTERIOR);
  } else {
    camera.layers.enable(LAYER_EXTERIOR);
    camera.layers.disable(LAYER_COCKPIT);
  }
}

function paintSilver(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const next = list.map((mat) => {
      const mapped = (mat as THREE.MeshStandardMaterial).map ?? null;
      return new THREE.MeshLambertMaterial({
        color: SILVER_PAINT,
        map: mapped,
        transparent: false,
      });
    });
    mesh.material = next.length === 1 ? next[0]! : next;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** Kenney-shaped stand-in so tests can assemble without fetching a GLB. */
export function makePlaceholderSedan(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'sedan';
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(KENNEY_NATIVE_WIDTH, 1.15, KENNEY_NATIVE_LENGTH),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  body.name = 'body';
  body.position.set(0, 0.15 + 1.15 / 2, -0.025);
  root.add(body);

  const specs: Array<{ name: string; x: number; z: number }> = [
    { name: 'wheel-front-left', x: 0.3, z: 0.66 },
    { name: 'wheel-front-right', x: -0.3, z: 0.66 },
    { name: 'wheel-back-left', x: 0.3, z: -0.66 },
    { name: 'wheel-back-right', x: -0.3, z: -0.66 },
  ];
  for (const spec of specs) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(KENNEY_NATIVE_WHEEL_RADIUS, KENNEY_NATIVE_WHEEL_RADIUS, 0.35, 16),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    wheel.name = spec.name;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(spec.x, KENNEY_NATIVE_WHEEL_RADIUS, spec.z);
    root.add(wheel);
  }
  return root;
}

function buildHandWheel(): THREE.Group {
  const group = new THREE.Group();
  const R = COCKPIT.wheelRadius;
  const tube = COCKPIT.wheelTube;
  const leather = new THREE.MeshLambertMaterial({ color: 0x1b1e23, side: THREE.DoubleSide });
  const metal = new THREE.MeshLambertMaterial({ color: 0xc9d0d8, side: THREE.DoubleSide });
  const mark = new THREE.MeshLambertMaterial({ color: 0xf4ead2, emissive: 0xffd27a, emissiveIntensity: 0.55 });

  addMerged(group, [xform(new THREE.TorusGeometry(R, tube, 8, 40), 0, 0, 0, new THREE.Euler(0, Math.PI / 2, 0))], leather, false);

  const spokeParts: THREE.BufferGeometry[] = [
    xform(new THREE.CylinderGeometry(0.018, 0.022, 0.028, 14), 0, 0, 0, new THREE.Euler(0, 0, Math.PI / 2)),
  ];
  for (const ang of [-0.52, 0.52, Math.PI]) {
    spokeParts.push(
      xform(
        new THREE.BoxGeometry(0.008, R * 0.78, 0.012),
        0,
        Math.cos(ang) * R * 0.36,
        Math.sin(ang) * R * 0.36,
        new THREE.Euler(ang, 0, 0),
      ),
    );
  }
  addMerged(group, spokeParts, metal, false);
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.024, 0.02), mark);
  notch.position.set(-0.014, R * 0.9, 0);
  group.add(notch);
  return group;
}

function buildCockpit(): { group: THREE.Group; steerWheel: THREE.Group } {
  const group = new THREE.Group();
  const dashMat = new THREE.MeshLambertMaterial({ color: 0x16191e });
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x2c3036 });
  const screenMat = new THREE.MeshLambertMaterial({
    color: 0x07181c,
    emissive: 0x1a7a84,
    emissiveIntensity: 0.55,
  });

  // Thin dash strip only — no hood slab, no roof plane.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 1.18), dashMat);
  dash.position.set(0.55, COCKPIT.wheel.y - 0.08, 0.02);
  group.add(dash);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.2, 0.14), screenMat);
  screen.position.set(0.48, COCKPIT.wheel.y + 0.02, -0.06);
  group.add(screen);

  const pillarGeo = new THREE.CylinderGeometry(0.01, 0.009, 0.62, 8);
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(0.88, 0.86, 0.86);
  leftPillar.rotation.z = 0.28;
  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(0.88, 0.86, -0.86);
  rightPillar.rotation.z = 0.28;
  group.add(leftPillar, rightPillar);

  const steerWheel = buildHandWheel();
  steerWheel.position.set(COCKPIT.wheel.x, COCKPIT.wheel.y, COCKPIT.wheel.z);
  group.add(steerWheel);

  setLayerDeep(group, LAYER_COCKPIT);
  return { group, steerWheel };
}

/** Center a Kenney/placeholder wheel and put its axle along +Z (left/right). */
function orientWheelOnAxle(mesh: THREE.Mesh): void {
  const geo = mesh.geometry.clone();
  geo.computeBoundingBox();
  const size = geo.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(0.35, 0.6, 0.6);
  geo.center();
  mesh.geometry = geo;
  mesh.position.set(0, 0, 0);
  const axle = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
  if (axle === 'x') mesh.rotation.set(0, Math.PI / 2, 0);
  else if (axle === 'y') mesh.rotation.set(Math.PI / 2, 0, 0);
  else mesh.rotation.set(0, 0, 0);
  const nativeRadius = Math.max(size.x, size.y, size.z) / 2 || KENNEY_NATIVE_WHEEL_RADIUS;
  mesh.scale.setScalar(VISUAL_WHEEL_RADIUS / nativeRadius);
}

function collectWheels(root: THREE.Object3D): THREE.Mesh[] {
  const wheels: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && /wheel/i.test(obj.name)) {
      wheels.push(obj as THREE.Mesh);
    }
  });
  return wheels;
}

function fitKenneyBody(sedan: THREE.Object3D): void {
  // Kenney: +Z forward, +X left. Ours: +X forward, +Z left.
  sedan.rotation.y = Math.PI / 2;
  sedan.scale.set(
    SEDAN_WIDTH / KENNEY_NATIVE_WIDTH,
    SEDAN_HEIGHT / KENNEY_NATIVE_HEIGHT,
    SEDAN_LENGTH / KENNEY_NATIVE_LENGTH,
  );
  sedan.updateMatrixWorld(true);
}

/**
 * Turn a Kenney-style sedan scene (named `body` + `wheel-*` children) into the
 * runtime ego visual: silver body on a roll pivot, planted wheels, cockpit.
 */
export function assembleEgoVisual(source: THREE.Object3D): EgoVisual {
  const sedan = source.clone(true);
  fitKenneyBody(sedan);

  const group = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = AXLE_HEIGHT;
  group.add(bodyPivot);

  const wheelMeshes = collectWheels(sedan);
  const placed = new Set<string>();
  const wheels: EgoWheelRef[] = [];

  for (const mesh of wheelMeshes) {
    mesh.updateWorldMatrix(true, false);
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    const front = /front/i.test(mesh.name);
    const left = world.z >= 0;
    const key = `${front ? 'f' : 'r'}-${left ? 'l' : 'r'}`;
    placed.add(key);

    mesh.removeFromParent();
    orientWheelOnAxle(mesh);
    mesh.castShadow = true;

    const pivot = new THREE.Group();
    const plan = WHEEL_PLAN_OFFSETS.find((w) => w.front === front && Math.sign(w.z) === (left ? 1 : -1));
    pivot.position.set(plan?.x ?? world.x, AXLE_HEIGHT, plan?.z ?? world.z);
    pivot.add(mesh);
    group.add(pivot);
    setLayerDeep(pivot, LAYER_EXTERIOR);
    wheels.push({ pivot, mesh, front, spinAxis: 'x' });
  }

  // Guarantee four planted wheels even if a source mesh was missing.
  for (const spec of WHEEL_PLAN_OFFSETS) {
    const key = `${spec.front ? 'f' : 'r'}-${spec.z >= 0 ? 'l' : 'r'}`;
    if (placed.has(key)) continue;
    const pivot = new THREE.Group();
    pivot.position.set(spec.x, AXLE_HEIGHT, spec.z);
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_RADIUS * 0.7, 18),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
    );
    tire.rotation.x = Math.PI / 2;
    pivot.add(tire);
    group.add(pivot);
    setLayerDeep(pivot, LAYER_EXTERIOR);
    wheels.push({ pivot, mesh: tire, front: spec.front, spinAxis: 'x' });
  }

  paintSilver(sedan);
  sedan.position.y = ROAD_SURFACE_Y - AXLE_HEIGHT;
  setLayerDeep(sedan, LAYER_EXTERIOR);
  bodyPivot.add(sedan);

  const cockpit = buildCockpit();
  bodyPivot.add(cockpit.group);

  return {
    group,
    bodyPivot,
    steerWheel: cockpit.steerWheel,
    wheels,
    drawCalls: countMeshes(group),
  };
}

export function buildEgoVisual(source?: THREE.Object3D): EgoVisual {
  return assembleEgoVisual(source ?? makePlaceholderSedan());
}

export function loadEgoVisual(url = SEDAN_MODEL_URL): Promise<EgoVisual> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(assembleEgoVisual(gltf.scene)),
      undefined,
      reject,
    );
  });
}

export function sedanFittedSize(root: THREE.Object3D): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(root);
  return box.getSize(new THREE.Vector3());
}
