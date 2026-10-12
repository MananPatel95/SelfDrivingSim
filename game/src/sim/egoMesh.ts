/**
 * Kenney CC0 sedan-sports (GLB) plus a connected Tesla-style cockpit overlay.
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

export const SEDAN_MODEL_URL = '/models/sedan-sports.glb';
export const SILVER_PAINT = 0xc5cad1;
export const LAYER_WORLD = 0;
export const LAYER_COCKPIT = 1;
export const LAYER_EXTERIOR = 2;

/**
 * Kenney 8×8 colormap cells used as body paint on sedan-sports (glTF v=0 is
 * the top of the image). Glass, lights, chrome and tyres use other cells.
 */
export const BODY_PAINT_UV_CELLS: ReadonlyArray<readonly [number, number]> = [
  [3, 4],
  [3, 5],
  [6, 2],
  [6, 3],
];

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

function paintCellKey(col: number, row: number): string {
  return `${col},${row}`;
}

const PAINT_CELL_KEYS = new Set(BODY_PAINT_UV_CELLS.map(([c, r]) => paintCellKey(c, r)));

function silverizePaintCells(tex: THREE.Texture): THREE.Texture {
  const img = tex.image as { width: number; height: number } | undefined;
  const canDraw = typeof document !== 'undefined' && img && (img as HTMLCanvasElement).width;
  if (!canDraw) return tex;
  try {
    const src = img as CanvasImageSource;
    const canvas = document.createElement('canvas');
    canvas.width = (img as HTMLCanvasElement).width;
    canvas.height = (img as HTMLCanvasElement).height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return tex;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = data.data;
    const cols = 8;
    const rows = 8;
    const cw = canvas.width / cols;
    const ch = canvas.height / rows;
    for (let i = 0, y = 0; y < canvas.height; y += 1) {
      const row = Math.min(rows - 1, Math.floor(y / ch));
      for (let x = 0; x < canvas.width; x += 1, i += 4) {
        const col = Math.min(cols - 1, Math.floor(x / cw));
        if (!PAINT_CELL_KEYS.has(paintCellKey(col, row))) continue;
        const r = p[i]!;
        const g = p[i + 1]!;
        const b = p[i + 2]!;
        const lum = 0.25 * r + 0.5 * g + 0.25 * b;
        p[i] = Math.round(168 + lum * 0.22);
        p[i + 1] = Math.round(172 + lum * 0.21);
        p[i + 2] = Math.round(178 + lum * 0.2);
      }
    }
    ctx.putImageData(data, 0, 0);
    const next = new THREE.CanvasTexture(canvas);
    next.flipY = tex.flipY;
    next.colorSpace = tex.colorSpace;
    next.needsUpdate = true;
    return next;
  } catch {
    return tex;
  }
}

function isGlassTriangle(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  nax: number, nay: number, naz: number,
  nbx: number, nby: number, nbz: number,
  ncx: number, ncy: number, ncz: number,
): boolean {
  const y = (ay + by + cy) / 3;
  // Kenney-local: +Z forward, +X left, +Y up. Keep the painted roof.
  if (y < 0.52) return false;
  const nx = (nax + nbx + ncx) / 3;
  const ny = (nay + nby + ncy) / 3;
  const nz = (naz + nbz + ncz) / 3;
  if (nz > 0.38 && y < 0.98) return true;
  if (nz < -0.38 && y < 0.98) return true;
  if (Math.abs(nx) > 0.58 && y < 0.8 && ny < 0.35) return true;
  return false;
}

function splitBodyGlass(root: THREE.Object3D): void {
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a1f26 });
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !/^body$/i.test(mesh.name) || !mesh.parent) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    if (!pos || !nrm) return;
    const glassPos: number[] = [];
    const bodyPos: number[] = [];
    const bodyNrm: number[] = [];
    const bodyUv: number[] = [];
    const glassNrm: number[] = [];
    const push = (dst: number[], attr: THREE.BufferAttribute, i: number, n: number) => {
      for (let k = 0; k < n; k += 1) dst.push(attr.getComponent(i, k));
    };
    const visit = (a: number, b: number, c: number) => {
      const glass = isGlassTriangle(
        pos.getX(a), pos.getY(a), pos.getZ(a),
        pos.getX(b), pos.getY(b), pos.getZ(b),
        pos.getX(c), pos.getY(c), pos.getZ(c),
        nrm.getX(a), nrm.getY(a), nrm.getZ(a),
        nrm.getX(b), nrm.getY(b), nrm.getZ(b),
        nrm.getX(c), nrm.getY(c), nrm.getZ(c),
      );
      const pDst = glass ? glassPos : bodyPos;
      const nDst = glass ? glassNrm : bodyNrm;
      for (const i of [a, b, c]) {
        push(pDst, pos, i, 3);
        push(nDst, nrm, i, 3);
        if (!glass && uv) push(bodyUv, uv, i, 2);
      }
    };
    if (geo.index) {
      const idx = geo.index;
      for (let i = 0; i < idx.count; i += 3) visit(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    } else {
      for (let i = 0; i < pos.count; i += 3) visit(i, i + 1, i + 2);
    }
    if (glassPos.length === 0 || bodyPos.length === 0) return;
    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(bodyPos, 3));
    bodyGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bodyNrm, 3));
    if (bodyUv.length) bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bodyUv, 2));
    mesh.geometry = bodyGeo;
    const glassGeo = new THREE.BufferGeometry();
    glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3));
    glassGeo.setAttribute('normal', new THREE.Float32BufferAttribute(glassNrm, 3));
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.name = 'glass';
    glass.position.copy(mesh.position);
    glass.quaternion.copy(mesh.quaternion);
    glass.scale.copy(mesh.scale);
    mesh.parent.add(glass);
  });
}

function paintSilver(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || /^glass$/i.test(mesh.name)) return;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const next = list.map((mat) => {
      const mapped = (mat as THREE.MeshStandardMaterial).map ?? null;
      const processed = mapped ? silverizePaintCells(mapped) : null;
      return new THREE.MeshLambertMaterial({
        color: processed || mapped ? 0xffffff : SILVER_PAINT,
        map: processed ?? mapped ?? null,
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
  root.name = 'sedan-sports';
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

function cabinCamera(fovDeg: number, aspect = 16 / 9): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.05, 80);
  cam.position.set(COCKPIT.eye.x, COCKPIT.eye.y, COCKPIT.eye.z);
  cam.up.set(0, 1, 0);
  cam.lookAt(COCKPIT.look.x, COCKPIT.look.y, COCKPIT.look.z);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Point at NDC (x,y) and look-axis depth (metres in front of the camera). */
function rayPoint(cam: THREE.PerspectiveCamera, ndcX: number, ndcY: number, depth: number): THREE.Vector3 {
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  const tanH = tanV * cam.aspect;
  return new THREE.Vector3(ndcX * depth * tanH, ndcY * depth * tanV, -depth).applyMatrix4(cam.matrixWorld);
}

function frustumSlab(
  cam: THREE.PerspectiveCamera,
  ndcX0: number,
  ndcX1: number,
  ndcY0: number,
  ndcY1: number,
  d0: number,
  d1: number,
): THREE.BufferGeometry {
  const p = (x: number, y: number, d: number) => rayPoint(cam, x, y, d);
  const v = [
    p(ndcX0, ndcY0, d0),
    p(ndcX1, ndcY0, d0),
    p(ndcX0, ndcY1, d0),
    p(ndcX1, ndcY1, d0),
    p(ndcX0, ndcY0, d1),
    p(ndcX1, ndcY0, d1),
    p(ndcX0, ndcY1, d1),
    p(ndcX1, ndcY1, d1),
  ];
  const idx = [
    0, 2, 3, 0, 3, 1,
    5, 7, 6, 5, 6, 4,
    0, 1, 5, 0, 5, 4,
    2, 6, 7, 2, 7, 3,
    0, 4, 6, 0, 6, 2,
    1, 3, 7, 1, 7, 5,
  ];
  const pos = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i += 1) {
    const q = v[idx[i]!]!;
    pos[i * 3] = q.x;
    pos[i * 3 + 1] = q.y;
    pos[i * 3 + 2] = q.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function addStrut(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  r0: number,
  r1: number,
  mat: THREE.Material,
  name: string,
): THREE.Mesh {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, Math.max(len, 0.02), 10), mat);
  mesh.name = name;
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

function makeScreenFaceTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#1a3d4a';
    ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = '#2a5a68';
    ctx.fillRect(0, 0, 512, 36);
    ctx.fillStyle = '#8fd4e2';
    ctx.beginPath();
    ctx.arc(28, 18, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8e6ea';
    ctx.fillRect(48, 14, 70, 8);
    ctx.fillRect(130, 14, 44, 8);
    ctx.fillStyle = '#16303a';
    ctx.fillRect(16, 52, 250, 252);
    ctx.fillStyle = '#1f4d3c';
    ctx.beginPath();
    ctx.moveTo(40, 280);
    ctx.lineTo(90, 160);
    ctx.lineTo(200, 120);
    ctx.lineTo(240, 200);
    ctx.lineTo(180, 280);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3ec8ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(50, 270);
    ctx.quadraticCurveTo(140, 150, 230, 190);
    ctx.stroke();
    const tiles = [
      [286, 52, '#1a6f7a'],
      [394, 52, '#245a86'],
      [286, 158, '#3a4a22'],
      [394, 158, '#5a3a16'],
    ];
    for (const [x, y, color] of tiles) {
      ctx.fillStyle = String(color);
      ctx.fillRect(Number(x), Number(y), 102, 96);
      ctx.fillStyle = '#cfe8ee';
      ctx.fillRect(Number(x) + 12, Number(y) + 16, 60, 8);
      ctx.fillRect(Number(x) + 12, Number(y) + 32, 40, 6);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

function buildHandWheel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hand-wheel';
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
  group.name = 'cockpit';
  const dashTop = COCKPIT.dashTopNdc;
  const cam = cabinCamera(COCKPIT.fovDeg);

  const dashMat = new THREE.MeshLambertMaterial({ color: 0x5c646e, side: THREE.DoubleSide });
  const hoodMat = new THREE.MeshLambertMaterial({ color: 0xc5cad1, side: THREE.DoubleSide });
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x2a3038, side: THREE.DoubleSide });
  const columnMat = new THREE.MeshLambertMaterial({ color: 0x4a515a });
  const bezelMat = new THREE.MeshLambertMaterial({ color: 0x1b1f24 });
  const screenMap = makeScreenFaceTexture();
  const screenMat = screenMap
    ? new THREE.MeshBasicMaterial({ color: 0xffffff, map: screenMap })
    : new THREE.MeshBasicMaterial({ color: 0x1a6f7a });

  // Height is framed for the 70° hood view (bottom ~28%). Extra-wide X also fills the 95° still.
  const dash = new THREE.Mesh(frustumSlab(cam, -1.7, 1.7, -1.35, dashTop, 0.24, 0.98), dashMat);
  dash.name = 'dash';
  group.add(dash);

  const hood = new THREE.Mesh(frustumSlab(cam, -1.55, 1.55, dashTop - 0.01, -0.27, 0.9, 1.7), hoodMat);
  hood.name = 'hood';
  group.add(hood);

  const header = new THREE.Mesh(frustumSlab(cam, -1.08, 1.08, 0.9, 1.12, 0.4, 0.54), pillarMat);
  header.name = 'header';
  group.add(header);

  const pillarL0 = rayPoint(cam, -0.96, dashTop, 0.86);
  const pillarL1 = rayPoint(cam, -0.9, 0.98, 0.46);
  const pillarR0 = rayPoint(cam, 0.96, dashTop, 0.86);
  const pillarR1 = rayPoint(cam, 0.9, 0.98, 0.46);
  addStrut(group, pillarL0, pillarL1, 0.024, 0.016, pillarMat, 'pillar-left');
  addStrut(group, pillarR0, pillarR1, 0.024, 0.016, pillarMat, 'pillar-right');

  const screen = new THREE.Group();
  screen.name = 'centre-screen';
  // Thin in X so the lit face points back at the driver (camera looks +X).
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.176, 0.28), bezelMat);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.256, 0.156), screenMat);
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.006;
  screen.add(bezel, face);
  const sit = rayPoint(cam, 0.22, dashTop, 0.72);
  const sitInDash = rayPoint(cam, 0.22, dashTop - 0.08, 0.72);
  screen.position.set(sit.x, sit.y + 0.108, sit.z);
  screen.rotation.y = 0.22;
  addStrut(group, sitInDash, screen.position.clone(), 0.014, 0.02, bezelMat, 'screen-mount');
  group.add(screen);

  const steerWheel = buildHandWheel();
  steerWheel.position.set(COCKPIT.wheel.x, COCKPIT.wheel.y, COCKPIT.wheel.z);
  group.add(steerWheel);

  const columnEnd = rayPoint(cam, -0.2, -0.78, 0.68);
  addStrut(
    group,
    new THREE.Vector3(COCKPIT.wheel.x, COCKPIT.wheel.y, COCKPIT.wheel.z),
    columnEnd,
    0.03,
    0.04,
    columnMat,
    'steer-column',
  );

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

  splitBodyGlass(sedan);
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
