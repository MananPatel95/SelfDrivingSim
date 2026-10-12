/**
 * Modern EV sedan: smooth hull, flush glass, light bars, wheels in the arches.
 * Same-material parts are merged so the car is a handful of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COCKPIT } from './cabinView';
import {
  AXLE_HEIGHT,
  BODY_CENTER_LOCAL_Y,
  BODY_HALF_WIDTH,
  VISUAL_WHEEL_HALF_WIDTH,
  VISUAL_WHEEL_RADIUS,
  WHEEL_PLAN_OFFSETS,
} from './vehicleVisual';

export interface EgoWheelRef {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  front: boolean;
}

export interface EgoVisual {
  group: THREE.Group;
  bodyPivot: THREE.Group;
  steerWheel: THREE.Group;
  wheels: EgoWheelRef[];
  drawCalls: number;
}

function xform(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rot?: THREE.Euler,
  scale?: THREE.Vector3,
): THREE.BufferGeometry {
  const g = geo.clone();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (rot) q.setFromEuler(rot);
  m.compose(new THREE.Vector3(x, y, z), q, scale ?? new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** Plane in XY (normal +Z), then yaw about Y and rake about Z, then translate. */
function glassPane(w: number, h: number, x: number, y: number, z: number, yaw = 0, rake = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (yaw) g.rotateY(yaw);
  if (rake) g.rotateZ(rake);
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

function buildFlatBottomWheel(): THREE.Group {
  const group = new THREE.Group();
  const R = COCKPIT.wheelRadius;
  const tube = COCKPIT.wheelTube;
  const leather = new THREE.MeshLambertMaterial({ color: 0x1c1f24, side: THREE.DoubleSide });
  const metal = new THREE.MeshLambertMaterial({ color: 0xc9d0d8, side: THREE.DoubleSide });
  const mark = new THREE.MeshLambertMaterial({ color: 0xf4ead2, emissive: 0xffd27a, emissiveIntensity: 0.55 });

  // D-shape: ~250° of rim with a flat chord at the bottom.
  const arc = Math.PI * 1.42;
  const gap = Math.PI * 2 - arc;
  const leatherParts: THREE.BufferGeometry[] = [
    xform(new THREE.TorusGeometry(R, tube, 8, 36, arc), 0, 0, 0, new THREE.Euler(Math.PI + gap / 2, Math.PI / 2, 0)),
  ];
  const chord = 2 * R * Math.sin(gap / 2);
  const barY = -R * Math.cos(gap / 2);
  leatherParts.push(xform(new THREE.CylinderGeometry(tube, tube, chord, 10), 0, barY, 0, new THREE.Euler(Math.PI / 2, 0, 0)));

  const metalParts: THREE.BufferGeometry[] = [
    xform(new THREE.CylinderGeometry(0.028, 0.032, 0.034, 16), 0, 0, 0, new THREE.Euler(0, 0, Math.PI / 2)),
  ];
  for (const ang of [-0.55, 0.55]) {
    metalParts.push(
      xform(
        new THREE.BoxGeometry(0.01, R * 0.72, 0.014),
        0,
        Math.cos(ang) * R * 0.34,
        Math.sin(ang) * R * 0.34,
        new THREE.Euler(ang, 0, 0),
      ),
    );
  }
  metalParts.push(xform(new THREE.BoxGeometry(0.01, R * 0.42, 0.012), 0, barY * 0.45, 0));

  addMerged(group, leatherParts, leather, false);
  addMerged(group, metalParts, metal, false);
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.022, 0.02), mark);
  notch.position.set(-0.016, R * 0.88, 0);
  group.add(notch);
  return group;
}

export function buildEgoVisual(): EgoVisual {
  const group = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = AXLE_HEIGHT;
  group.add(bodyPivot);

  const pearl = new THREE.MeshLambertMaterial({ color: 0xd8dee6 });
  const cladding = new THREE.MeshLambertMaterial({ color: 0x15191f });
  const glass = new THREE.MeshLambertMaterial({
    color: 0x7aa3b8,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const lamp = new THREE.MeshLambertMaterial({ color: 0xf4fbff, emissive: 0xc8e8ff, emissiveIntensity: 1.05 });
  const tail = new THREE.MeshLambertMaterial({ color: 0xff2a44, emissive: 0xff1433, emissiveIntensity: 0.9 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x12151a, side: THREE.DoubleSide });
  const screen = new THREE.MeshLambertMaterial({ color: 0x0b2a30, emissive: 0x1a8a96, emissiveIntensity: 0.55 });

  const pearlParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const lampParts: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];
  const dashParts: THREE.BufferGeometry[] = [];

  // Smooth pebble hull — low, long, rounded. No box slabs.
  pearlParts.push(
    xform(new THREE.SphereGeometry(1, 28, 18), 0.06, BODY_CENTER_LOCAL_Y - 0.02, 0, undefined, new THREE.Vector3(2.18, 0.34, BODY_HALF_WIDTH)),
    xform(new THREE.SphereGeometry(1, 20, 14), 1.72, 0.22, 0, new THREE.Euler(0, 0, -0.12), new THREE.Vector3(0.78, 0.26, 0.88)),
    xform(new THREE.SphereGeometry(1, 20, 14), -1.68, 0.22, 0, new THREE.Euler(0, 0, 0.16), new THREE.Vector3(0.74, 0.26, 0.88)),
  );

  // Flush glass roof sitting above the cabin, not around the driver's eye.
  glassParts.push(
    xform(new THREE.SphereGeometry(1, 20, 12), -0.12, 0.98, 0, undefined, new THREE.Vector3(1.05, 0.11, 0.70)),
    glassPane(1.36, 0.82, 0.64, 0.80, 0, Math.PI / 2, 0.56),
    glassPane(0.95, 0.38, -0.08, 0.78, 0.72),
    glassPane(0.95, 0.38, -0.08, 0.78, -0.72, Math.PI),
    glassPane(1.05, 0.36, -0.84, 0.80, 0, -Math.PI / 2, -0.42),
  );

  // Thin A-pillars — keep the windshield open.
  darkParts.push(
    xform(new THREE.CylinderGeometry(0.016, 0.014, 0.72, 8), 0.46, 0.78, 0.58, new THREE.Euler(0, 0, 0.58)),
    xform(new THREE.CylinderGeometry(0.016, 0.014, 0.72, 8), 0.46, 0.78, -0.58, new THREE.Euler(0, 0, 0.58)),
    xform(new THREE.CylinderGeometry(0.014, 0.012, 0.55, 8), -0.72, 0.82, 0.58, new THREE.Euler(0, 0, -0.4)),
    xform(new THREE.CylinderGeometry(0.014, 0.012, 0.55, 8), -0.72, 0.82, -0.58, new THREE.Euler(0, 0, -0.4)),
  );

  // Full-width light bars.
  lampParts.push(xform(new THREE.BoxGeometry(0.04, 0.035, 1.72), 2.28, 0.40, 0));
  lampParts.push(xform(new THREE.BoxGeometry(0.03, 0.018, 0.22), 2.26, 0.40, 0.78));
  lampParts.push(xform(new THREE.BoxGeometry(0.03, 0.018, 0.22), 2.26, 0.40, -0.78));
  tailParts.push(xform(new THREE.BoxGeometry(0.04, 0.03, 1.72), -2.22, 0.40, 0));

  // Wheel arches + wells: fender sits outboard of the tire.
  const archR = VISUAL_WHEEL_RADIUS + 0.06;
  for (const w of WHEEL_PLAN_OFFSETS) {
    const side = Math.sign(w.z) || 1;
    const wellZ = side * (Math.abs(w.z) + 0.02);
    darkParts.push(
      xform(
        new THREE.TorusGeometry(archR, 0.07, 8, 16, Math.PI),
        w.x,
        0,
        wellZ,
        new THREE.Euler(0, side > 0 ? 0 : Math.PI, 0),
      ),
    );
    darkParts.push(
      xform(
        new THREE.CylinderGeometry(archR - 0.02, archR - 0.02, VISUAL_WHEEL_HALF_WIDTH * 2 + 0.06, 16, 1, true),
        w.x,
        0,
        w.z,
        new THREE.Euler(Math.PI / 2, 0, 0),
      ),
    );
  }

  // Cabin: low dash, centre stack, left seat — camera sits in the seat.
  dashParts.push(
    xform(new THREE.BoxGeometry(0.42, 0.08, 1.18), 0.62, 0.48, 0),
    xform(new THREE.BoxGeometry(0.18, 0.04, 0.36), 0.48, 0.54, 0.34),
    xform(new THREE.BoxGeometry(0.22, 0.16, 0.28), 0.52, 0.52, 0.0),
    xform(new THREE.BoxGeometry(0.36, 0.42, 0.42), -0.42, 0.42, 0.36),
    xform(new THREE.BoxGeometry(0.36, 0.08, 0.42), -0.12, 0.28, 0.36),
  );
  const screenMesh = new THREE.Mesh(
    xform(new THREE.BoxGeometry(0.02, 0.13, 0.24), 0.42, 0.58, 0.02),
    screen,
  );
  screenMesh.castShadow = false;
  bodyPivot.add(screenMesh);

  addMerged(bodyPivot, pearlParts, pearl, true);
  addMerged(bodyPivot, glassParts, glass, false);
  addMerged(bodyPivot, darkParts, cladding, true);
  addMerged(bodyPivot, lampParts, lamp, false);
  addMerged(bodyPivot, tailParts, tail, false);
  addMerged(bodyPivot, dashParts, dark, false);

  const steerWheel = buildFlatBottomWheel();
  steerWheel.position.set(COCKPIT.wheel.x, COCKPIT.wheel.y, COCKPIT.wheel.z);
  bodyPivot.add(steerWheel);

  const wheels: EgoWheelRef[] = [];
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const wheelGeo = mergeOrNull([
    xform(
      new THREE.CylinderGeometry(VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_HALF_WIDTH * 2, 20),
      0, 0, 0,
      new THREE.Euler(Math.PI / 2, 0, 0),
    ),
    new THREE.TorusGeometry(VISUAL_WHEEL_RADIUS * 0.55, 0.03, 8, 18),
  ]);
  for (const spec of WHEEL_PLAN_OFFSETS) {
    const pivot = new THREE.Group();
    pivot.position.set(spec.x, AXLE_HEIGHT, spec.z);
    const tire = new THREE.Mesh(wheelGeo ?? new THREE.CylinderGeometry(VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_HALF_WIDTH * 2, 20), tireMat);
    pivot.add(tire);
    group.add(pivot);
    wheels.push({ pivot, mesh: tire, front: spec.front });
  }

  return {
    group,
    bodyPivot,
    steerWheel,
    wheels,
    drawCalls: countMeshes(group),
  };
}

export const EGO_DRAW_CALL_BUDGET = 18;
