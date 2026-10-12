/**
 * Modern EV sedan: constant-width tub, fender blisters, flush glass, light bars.
 * Same-material parts are merged so the car is a handful of draw calls.
 * Wheels sit inside the arches; the cabin is hollow so the driver camera is free.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COCKPIT } from './cabinView';
import {
  AXLE_HEIGHT,
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
  if (rot) g.rotateX(rot.x), g.rotateY(rot.y), g.rotateZ(rot.z);
  if (scale) g.scale(scale.x, scale.y, scale.z);
  g.translate(x, y, z);
  return g;
}

/** Cylinder along +X, then flatten Y and set half-width in Z. */
function hullTube(length: number, halfH: number, halfW: number, x: number, y: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, length, 28);
  g.rotateZ(Math.PI / 2);
  g.scale(1, halfH, halfW);
  g.translate(x, y, 0);
  return g;
}

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
  const mark = new THREE.MeshLambertMaterial({ color: 0xf4ead2, emissive: 0xffd27a, emissiveIntensity: 0.7 });

  const arc = Math.PI * 1.42;
  const gap = Math.PI * 2 - arc;
  const leatherParts: THREE.BufferGeometry[] = [
    xform(new THREE.TorusGeometry(R, tube, 8, 36, arc), 0, 0, 0, new THREE.Euler(Math.PI + gap / 2, Math.PI / 2, 0)),
  ];
  const chord = 2 * R * Math.sin(gap / 2);
  const barY = -R * Math.cos(gap / 2);
  leatherParts.push(xform(new THREE.CylinderGeometry(tube, tube, chord, 10), 0, barY, 0, new THREE.Euler(Math.PI / 2, 0, 0)));

  const metalParts: THREE.BufferGeometry[] = [
    xform(new THREE.CylinderGeometry(0.026, 0.03, 0.03, 16), 0, 0, 0, new THREE.Euler(0, 0, Math.PI / 2)),
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
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.028, 0.022), mark);
  notch.position.set(-0.016, R * 0.88, 0);
  group.add(notch);
  return group;
}

export function buildEgoVisual(): EgoVisual {
  const group = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = AXLE_HEIGHT;
  group.add(bodyPivot);

  const pearl = new THREE.MeshLambertMaterial({ color: 0xd5dbe3 });
  const cladding = new THREE.MeshLambertMaterial({ color: 0x14181e });
  const glass = new THREE.MeshLambertMaterial({
    color: 0x6f96aa,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const lamp = new THREE.MeshLambertMaterial({ color: 0xf4fbff, emissive: 0xc8e8ff, emissiveIntensity: 1.1 });
  const tail = new THREE.MeshLambertMaterial({ color: 0xff2a44, emissive: 0xff1433, emissiveIntensity: 0.95 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x12151a, side: THREE.DoubleSide });
  const screen = new THREE.MeshLambertMaterial({ color: 0x0b2a30, emissive: 0x1a8a96, emissiveIntensity: 0.6 });

  const pearlParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const lampParts: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];
  const dashParts: THREE.BufferGeometry[] = [];

  // Hood and rear deck only — the cabin stays hollow so the driver can see out.
  pearlParts.push(
    hullTube(1.55, 0.26, 0.74, 1.42, 0.20),
    hullTube(1.35, 0.26, 0.74, -1.32, 0.20),
    xform(new THREE.SphereGeometry(1, 18, 12), 2.12, 0.20, 0, undefined, new THREE.Vector3(0.55, 0.24, 0.76)),
    xform(new THREE.SphereGeometry(1, 18, 12), -2.00, 0.20, 0, undefined, new THREE.Vector3(0.52, 0.24, 0.76)),
    xform(new THREE.BoxGeometry(2.1, 0.18, 0.16), 0.0, 0.10, 0.64),
    xform(new THREE.BoxGeometry(2.1, 0.18, 0.16), 0.0, 0.10, -0.64),
  );

  // Fender blisters sit outboard of the tub and over the tires.
  for (const w of WHEEL_PLAN_OFFSETS) {
    const side = Math.sign(w.z) || 1;
    pearlParts.push(
      xform(
        new THREE.SphereGeometry(1, 16, 12),
        w.x,
        0.10,
        side * (Math.abs(w.z) - 0.04),
        undefined,
        new THREE.Vector3(0.48, 0.34, 0.28),
      ),
    );
    darkParts.push(
      xform(
        new THREE.TorusGeometry(VISUAL_WHEEL_RADIUS + 0.05, 0.055, 8, 18, Math.PI),
        w.x,
        0.02,
        side * (Math.abs(w.z) + 0.04),
        new THREE.Euler(0, side > 0 ? 0 : Math.PI, 0),
      ),
    );
  }

  // Flush glass roof (thin slab) + windshield / side / rear panes. Cabin stays hollow.
  glassParts.push(
    xform(new THREE.BoxGeometry(1.65, 0.035, 1.28), -0.20, 1.06, 0),
    glassPane(1.42, 0.62, 0.52, 0.76, 0, Math.PI / 2, 0.48),
    glassPane(1.35, 0.50, -0.15, 0.80, 0.70),
    glassPane(1.35, 0.50, -0.15, 0.80, -0.70, Math.PI),
    glassPane(1.28, 0.48, -0.95, 0.82, 0, -Math.PI / 2, -0.32),
  );

  darkParts.push(
    xform(new THREE.CylinderGeometry(0.015, 0.013, 0.70, 8), 0.42, 0.78, 0.60, new THREE.Euler(0, 0, 0.52)),
    xform(new THREE.CylinderGeometry(0.015, 0.013, 0.70, 8), 0.42, 0.78, -0.60, new THREE.Euler(0, 0, 0.52)),
    xform(new THREE.CylinderGeometry(0.013, 0.012, 0.52, 8), -0.78, 0.84, 0.60, new THREE.Euler(0, 0, -0.36)),
    xform(new THREE.CylinderGeometry(0.013, 0.012, 0.52, 8), -0.78, 0.84, -0.60, new THREE.Euler(0, 0, -0.36)),
  );

  // Full-width bars flush with the nose and tail, not sticks.
  lampParts.push(xform(new THREE.BoxGeometry(0.06, 0.04, 1.52), 2.22, 0.36, 0));
  tailParts.push(xform(new THREE.BoxGeometry(0.06, 0.035, 1.52), -2.16, 0.36, 0));

  // Interior: low dash, centre stack to the right of the left-seat wheel, seat behind the eye.
  dashParts.push(
    xform(new THREE.BoxGeometry(0.34, 0.06, 1.20), 0.58, 0.46, 0),
    xform(new THREE.BoxGeometry(0.16, 0.03, 0.32), 0.46, 0.50, 0.34),
    xform(new THREE.BoxGeometry(0.18, 0.14, 0.22), 0.50, 0.50, -0.02),
    xform(new THREE.BoxGeometry(0.32, 0.38, 0.40), -0.48, 0.40, 0.36),
    xform(new THREE.BoxGeometry(0.34, 0.06, 0.40), -0.16, 0.26, 0.36),
  );
  const screenMesh = new THREE.Mesh(xform(new THREE.BoxGeometry(0.018, 0.11, 0.20), 0.42, 0.56, -0.02), screen);
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
    const tire = new THREE.Mesh(
      wheelGeo ?? new THREE.CylinderGeometry(VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_RADIUS, VISUAL_WHEEL_HALF_WIDTH * 2, 20),
      tireMat,
    );
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
