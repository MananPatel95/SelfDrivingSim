/**
 * Kenney CC0 sedan-sports (GLB) plus a connected Tesla-style cockpit overlay.
 * Wheels are detached so they stay planted while the body rolls about the axle.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COCKPIT, wheelViewOffset } from './cabinView';
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
  [2, 4],
  [2, 5],
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

export interface CockpitScreenInfo {
  speedKmh: number;
  autopilot: boolean;
  heading: number;
  x: number;
  y: number;
  banner: string;
}

export interface EgoVisual {
  group: THREE.Group;
  bodyPivot: THREE.Group;
  steerWheel: THREE.Group;
  wheels: EgoWheelRef[];
  drawCalls: number;
  eyeAnchor: THREE.Object3D;
  lookAnchor: THREE.Object3D;
  updateScreen: (info: CockpitScreenInfo) => void;
}

export const EGO_DRAW_CALL_BUDGET = 36;

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
  nax: number, _nay: number, naz: number,
  nbx: number, _nby: number, nbz: number,
  ncx: number, _ncy: number, ncz: number,
): boolean {
  // Kenney-local: +Z forward, +X left, +Y up.
  // Only the greenhouse openings — never hood, roof skin, doors, or rear quarters.
  const x = (ax + bx + cx) / 3;
  const y = (ay + by + cy) / 3;
  const z = (az + bz + cz) / 3;
  if (y < 0.56 || y > 0.96) return false;
  if (z > 0.52 || z < -0.58) return false;
  const nx = (nax + nbx + ncx) / 3;
  const nz = (naz + nbz + ncz) / 3;
  if (Math.abs(nx) > 0.85 && Math.abs(x) > 0.48 && y < 0.82 && z > -0.55 && z < 0.48) return true;
  if (nz > 0.4 && y > 0.68 && z > 0.2 && z < 0.5) return true;
  if (nz < -0.4 && y > 0.72 && z < -0.2 && z > -0.58 && Math.abs(x) < 0.5) return true;
  return false;
}

function splitBodyGlass(root: THREE.Object3D): void {
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a1f26 });
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !/^body$/i.test(mesh.name) || !mesh.parent) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
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

function matte(color: number, extras: ConstructorParameters<typeof THREE.MeshStandardMaterial>[0] = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.84,
    metalness: 0.06,
    side: THREE.DoubleSide,
    ...extras,
  });
}

function makeLogoTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#1a1c20';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#d8dde4';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TESLA', 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

function drawCockpitScreen(
  ctx: CanvasRenderingContext2D,
  info: CockpitScreenInfo,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = '#0b1116';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#151c22';
  ctx.fillRect(0, 0, w, 28);
  ctx.fillStyle = info.autopilot ? '#7ad3a0' : '#e6c56a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(info.autopilot ? 'AUTO' : 'MANUAL', 16, 19);
  ctx.fillStyle = '#8aa';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(info.banner.slice(0, 42), w - 14, 19);

  ctx.fillStyle = '#f3f6f8';
  ctx.font = 'bold 92px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(Math.round(info.speedKmh)), 28, 150);
  ctx.fillStyle = '#8aa';
  ctx.font = '18px sans-serif';
  ctx.fillText('km/h', 28, 178);

  // Top-down lane viz on the right half (Tesla-style visualization).
  const vx = w * 0.46;
  const vy = 40;
  const vw = w - vx - 16;
  const vh = h - vy - 16;
  ctx.fillStyle = '#1a2228';
  ctx.fillRect(vx, vy, vw, vh);
  ctx.fillStyle = '#2a3238';
  ctx.fillRect(vx + vw * 0.22, vy, vw * 0.56, vh);
  ctx.strokeStyle = '#c9a227';
  ctx.setLineDash([10, 12]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(vx + vw * 0.5, vy + 8);
  ctx.lineTo(vx + vw * 0.5, vy + vh - 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#d8dde4';
  ctx.lineWidth = 2;
  ctx.strokeRect(vx + vw * 0.22, vy + 2, vw * 0.56, vh - 4);

  const cx = vx + vw * 0.5;
  const cy = vy + vh * 0.72;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#c5cad1';
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(11, 16);
  ctx.lineTo(0, 10);
  ctx.lineTo(-11, 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function makeLiveScreen(): {
  mesh: THREE.Mesh;
  update: (info: CockpitScreenInfo) => void;
} | null {
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.33, 0.186),
    new THREE.MeshBasicMaterial({ color: 0x1a6f7a }),
  );
  face.name = 'screen-face';
  face.rotation.y = -Math.PI / 2;
  if (typeof document === 'undefined') {
    return { mesh: face, update: () => undefined };
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { mesh: face, update: () => undefined };
    drawCockpitScreen(ctx, {
      speedKmh: 0, autopilot: false, heading: 0, x: 0, y: 0, banner: 'Manual',
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    face.material = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
    return {
      mesh: face,
      update: (info) => {
        drawCockpitScreen(ctx, info);
        tex.needsUpdate = true;
      },
    };
  } catch {
    return { mesh: face, update: () => undefined };
  }
}

function buildHandWheel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hand-wheel';
  const R = COCKPIT.wheelRadius;
  const tube = COCKPIT.wheelTube;
  const leather = matte(0x16181c);
  const hubMat = matte(0x22262c, { roughness: 0.55, metalness: 0.18 });
  const spokeMat = matte(0x1c1f24, { roughness: 0.7 });

  addMerged(group, [xform(new THREE.TorusGeometry(R, tube, 10, 48), 0, 0, 0, new THREE.Euler(0, Math.PI / 2, 0))], leather, false);

  // Two downward spokes (~4 o'clock and 8 o'clock), Tesla-style round wheel.
  const spokeParts: THREE.BufferGeometry[] = [];
  for (const ang of [Math.PI * 0.72, Math.PI * 1.28]) {
    spokeParts.push(
      xform(
        new THREE.BoxGeometry(0.018, R * 0.72, 0.034),
        0,
        Math.cos(ang) * R * 0.34,
        Math.sin(ang) * R * 0.34,
        new THREE.Euler(ang, 0, 0),
      ),
    );
  }
  addMerged(group, spokeParts, spokeMat, false);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.036, 20), hubMat);
  hub.name = 'wheel-hub';
  hub.rotation.z = Math.PI / 2;
  group.add(hub);

  const logoMap = makeLogoTexture();
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.045),
    logoMap
      ? new THREE.MeshStandardMaterial({ map: logoMap, roughness: 0.45, metalness: 0.15 })
      : matte(0xd8dde4, { roughness: 0.4 }),
  );
  plate.name = 'wheel-logo';
  plate.rotation.y = -Math.PI / 2;
  plate.position.set(-0.02, 0, 0);
  group.add(plate);
  return group;
}

function buildCockpit(): {
  group: THREE.Group;
  steerWheel: THREE.Group;
  updateScreen: (info: CockpitScreenInfo) => void;
} {
  const group = new THREE.Group();
  group.name = 'cockpit';
  const dashTop = COCKPIT.dashTopNdc;
  const cam = cabinCamera(COCKPIT.fovDeg);
  // Camera-aligned dash, but the near face sits behind the rim so the wheel
  // stays in open air (a slab that starts in front of the wheel swallows it).
  const dashNear = wheelViewOffset().depth + 0.10;
  const dashFar = dashNear + 0.58;

  const dashMat = matte(0x1a1d21);
  const cowlMat = matte(0x2c3036, { roughness: 0.72 });
  const pillarMat = matte(0x101214);
  const columnMat = matte(0x2a2e33, { roughness: 0.6 });
  const bezelMat = matte(0x0e1013);
  const skinMat = matte(0x1a1512, { roughness: 0.95, transparent: true, opacity: 0.5 });
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xff7a33,
    emissive: 0xff6a22,
    emissiveIntensity: 0.55,
    roughness: 0.4,
    metalness: 0.0,
  });

  const dash = new THREE.Mesh(frustumSlab(cam, -1.85, 1.85, -1.42, dashTop, dashNear, dashFar), dashMat);
  dash.name = 'dash';
  group.add(dash);

  const footwell = new THREE.Mesh(frustumSlab(cam, -0.85, 0.35, -1.48, -0.95, 0.28, dashNear + 0.04), dashMat);
  footwell.name = 'footwell';
  group.add(footwell);

  const cowl = new THREE.Mesh(
    frustumSlab(cam, -1.6, 1.6, dashTop - 0.012, dashTop + 0.06, dashFar - 0.1, dashFar + 0.5),
    cowlMat,
  );
  cowl.name = 'hood';
  group.add(cowl);

  const strip = new THREE.Mesh(
    frustumSlab(cam, -1.12, 1.12, dashTop - 0.01, dashTop + 0.008, dashNear + 0.02, dashNear + 0.14),
    stripMat,
  );
  strip.name = 'ambient-strip';
  group.add(strip);

  const header = new THREE.Mesh(frustumSlab(cam, -1.12, 1.12, 0.82, 1.18, 0.42, 0.62), pillarMat);
  header.name = 'header';
  group.add(header);

  const pillarL0 = rayPoint(cam, -0.88, dashTop, dashNear + 0.06);
  const pillarL1 = rayPoint(cam, -0.82, 0.92, 0.44);
  const pillarR0 = rayPoint(cam, 0.88, dashTop, dashNear + 0.06);
  const pillarR1 = rayPoint(cam, 0.82, 0.92, 0.44);
  addStrut(group, pillarL0, pillarL1, 0.048, 0.028, pillarMat, 'pillar-left');
  addStrut(group, pillarR0, pillarR1, 0.048, 0.028, pillarMat, 'pillar-right');

  const live = makeLiveScreen();
  const screen = new THREE.Group();
  screen.name = 'centre-screen';
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.208, 0.36), bezelMat);
  const face = live?.mesh ?? new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.186), new THREE.MeshBasicMaterial({ color: 0x1a6f7a }));
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.007;
  screen.add(bezel, face);
  const sit = rayPoint(cam, 0.34, dashTop + 0.02, dashNear + 0.04);
  screen.position.set(sit.x, sit.y + 0.11, sit.z);
  screen.rotation.y = 0.14;
  const under = rayPoint(cam, 0.34, dashTop - 0.02, dashNear + 0.06);
  addStrut(
    group,
    under,
    new THREE.Vector3(screen.position.x + 0.01, screen.position.y - 0.06, screen.position.z),
    0.008,
    0.012,
    bezelMat,
    'screen-mount',
  );
  group.add(screen);

  const steerWheel = buildHandWheel();
  steerWheel.position.set(COCKPIT.wheel.x, COCKPIT.wheel.y, COCKPIT.wheel.z);
  group.add(steerWheel);

  const columnEnd = rayPoint(cam, -0.24, dashTop - 0.22, dashNear + 0.18);
  addStrut(
    group,
    new THREE.Vector3(COCKPIT.wheel.x, COCKPIT.wheel.y, COCKPIT.wheel.z),
    columnEnd,
    0.026,
    0.036,
    columnMat,
    'steer-column',
  );

  const kneeL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.13), skinMat);
  kneeL.name = 'knee-left';
  kneeL.position.set(COCKPIT.eye.x + 0.28, COCKPIT.wheel.y - 0.34, COCKPIT.wheel.z + 0.08);
  const kneeR = kneeL.clone();
  kneeR.name = 'knee-right';
  kneeR.position.set(COCKPIT.eye.x + 0.3, COCKPIT.wheel.y - 0.34, COCKPIT.wheel.z - 0.16);
  group.add(kneeL, kneeR);

  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.028, 0.07), skinMat);
  handL.name = 'hand-left';
  handL.position.set(COCKPIT.wheel.x - 0.01, COCKPIT.wheel.y - 0.03, COCKPIT.wheel.z + COCKPIT.wheelRadius * 0.62);
  const handR = handL.clone();
  handR.name = 'hand-right';
  handR.position.set(COCKPIT.wheel.x - 0.01, COCKPIT.wheel.y - 0.03, COCKPIT.wheel.z - COCKPIT.wheelRadius * 0.18);
  group.add(handL, handR);

  setLayerDeep(group, LAYER_COCKPIT);
  return { group, steerWheel, updateScreen: live?.update ?? (() => undefined) };
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

  const eyeAnchor = new THREE.Object3D();
  eyeAnchor.name = 'eye-anchor';
  eyeAnchor.position.set(COCKPIT.eye.x, COCKPIT.eye.y, COCKPIT.eye.z);
  bodyPivot.add(eyeAnchor);
  const lookAnchor = new THREE.Object3D();
  lookAnchor.name = 'look-anchor';
  lookAnchor.position.set(COCKPIT.look.x, COCKPIT.look.y, COCKPIT.look.z);
  bodyPivot.add(lookAnchor);

  const cabinFill = new THREE.PointLight(0xffe6cc, 0.55, 2.8, 1.4);
  cabinFill.name = 'cabin-fill';
  cabinFill.position.set(COCKPIT.eye.x + 0.15, COCKPIT.eye.y + 0.05, COCKPIT.eye.z);
  cabinFill.layers.set(LAYER_COCKPIT);
  bodyPivot.add(cabinFill);

  return {
    group,
    bodyPivot,
    steerWheel: cockpit.steerWheel,
    wheels,
    drawCalls: countMeshes(group),
    eyeAnchor,
    lookAnchor,
    updateScreen: cockpit.updateScreen,
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
