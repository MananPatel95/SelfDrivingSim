/**
 * Perception visualization — 10 Hz snapshots, GPU-animated every frame.
 * Instanced / BufferGeometry, capped point counts. Does not recast lidar.
 */

import * as THREE from 'three';
import { egoToWorld, vec3Length } from '../sim/math';
import { LANE_OFFSET } from '../sim/rightLane';
import type { EgoState, Entity, LidarPoint, PlannerOutput, Vec3 } from '../sim/types';
import type { Track } from '../stacks/perception';
import { CAMERA_CONFIG, type VisionDetection } from '../stacks/tesla';
import type { BEVOccupancy } from '../stacks/waabi';
import { writeOccupancyRgbaAiView } from './occupancyPaint';
import {
  createAnimUniforms,
  makeBarMaterial,
  makeBoxMaterial,
  makeFrustumMaterial,
  makeLaneMaterial,
  makeLidarPointsMaterial,
  makeRadarMaterial,
  makeRayMaterial,
  makeSweepMaterial,
  makeTrajMaterial,
  makeVoxelMaterial,
} from './perceptionShaders';
import {
  BOX_POP_S,
  type SnapPose,
  boxPopScale,
  interpolatePoses,
  lidarAzimuth,
  lidarSweepAngle,
  lerpOccupancy,
  rememberBirths,
  snapshotAlpha,
  worldToEgo,
} from './snapshotLerp';
import { spriteHitsReservedHud } from '../ui/hudPanels';

const _labelNdc = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export interface VizWorkStats {
  predArrayAllocs: number;
  planArrayAllocs: number;
  occupancyCellsVisited: number;
}

export const vizWorkStats: VizWorkStats = {
  predArrayAllocs: 0,
  planArrayAllocs: 0,
  occupancyCellsVisited: 0,
};

export function resetVizWorkStats() {
  vizWorkStats.predArrayAllocs = 0;
  vizWorkStats.planArrayAllocs = 0;
  vizWorkStats.occupancyCellsVisited = 0;
}

export type VizStack = 'tesla' | 'waymo' | 'waabi';

const MAX_POINTS = 5000;
const MAX_VOXELS = 500;
const MAX_FUTURE = 420;
const MAX_LABELS = 16;
const MAX_PRED = 24;
const MAX_RAYS = 32;
const LANE_SEGS = 40;
const TRAIL_SEGS = 5;

export interface DecisionInfo {
  text: string;
  severity: 'go' | 'slow' | 'brake';
}

export interface PerceptionVizInput {
  stack: VizStack;
  ego: EgoState;
  tracks: Track[];
  lidarPoints: LidarPoint[];
  agents: Entity[];
  groundTruth: Entity[];
  showGroundTruth: boolean;
  plannerOutput: PlannerOutput | null;
  visionDetections: VisionDetection[];
  occupancy?: BEVOccupancy;
  futureOccupancy?: { current: BEVOccupancy; t1s: BEVOccupancy; t2s: BEVOccupancy; t3s: BEVOccupancy };
  trajectories?: Array<{ points: Array<{ position: Vec3 }>; cost?: number }>;
  selectedTrajectoryIndex?: number;
  controlSource?: 'policy' | 'human' | 'oracle';
  rule?: { reason: string; severity: DecisionInfo['severity'] } | null;
  camera?: THREE.Camera;
  viewW?: number;
  viewH?: number;
  nowMs?: number;
}

interface OverlaySnapshot {
  timeMs: number;
  tracks: SnapPose[];
  dets: SnapPose[];
  occ?: Float32Array;
  occRes: number;
  occExtent: number;
  t1?: Float32Array;
  t2?: Float32Array;
  t3?: Float32Array;
}

function pathColor(severity: DecisionInfo['severity']): number {
  if (severity === 'brake') return 0xff3333;
  if (severity === 'slow') return 0xffaa00;
  return 0x33ff66;
}

export function computeDecision(input: PerceptionVizInput): DecisionInfo {
  if (input.controlSource === 'human') {
    return { text: 'Manual — press T to re-engage', severity: 'go' };
  }
  if (input.rule?.reason === 'Arrived') {
    return { text: 'Arrived', severity: 'go' };
  }
  if (input.rule && input.rule.severity !== 'go') {
    return { text: input.rule.reason, severity: input.rule.severity };
  }
  const ego = input.ego;
  const speed = vec3Length(ego.velocity);
  const heading = ego.transform.rotation;
  const fwd = { x: Math.cos(heading), y: Math.sin(heading) };

  let best: { id: number; cls: string; ttc: number; dist: number } | null = null;
  for (const track of input.tracks) {
    if (track.missedFrames > 0) continue;
    if (track.classType === 'pole' || track.classType === 'tree' || track.classType === 'building') continue;
    const world = egoToWorld(track.box.center, ego.transform.position, heading);
    const dx = world.x - ego.transform.position.x;
    const dy = world.y - ego.transform.position.y;
    const ahead = dx * fwd.x + dy * fwd.y;
    if (ahead < 1 || ahead > 80) continue;
    const lat = Math.abs(-dx * fwd.y + dy * fwd.x);
    if (lat > 4.5) continue;
    const closing = speed - (track.velocity.x * fwd.x + track.velocity.y * fwd.y);
    const ttc = closing > 0.3 ? ahead / closing : 99;
    if (!best || ttc < best.ttc) {
      best = { id: track.id, cls: track.classType, ttc, dist: ahead };
    }
  }

  const accel = input.plannerOutput?.acceleration ?? 0;
  if (best && best.ttc < 2.2 && (best.cls === 'pedestrian' || best.cls === 'cyclist')) {
    return {
      text: `Braking: ${best.cls} ID ${best.id} predicted in path in ${best.ttc.toFixed(1)}s`,
      severity: 'brake',
    };
  }
  if (best && best.ttc < 3.0) {
    return {
      text: `Slowing: ${best.cls} ID ${best.id} at ${best.dist.toFixed(0)}m (TTC ${best.ttc.toFixed(1)}s)`,
      severity: 'slow',
    };
  }
  if (accel < -2) {
    return { text: 'Braking: planner requested decel', severity: 'brake' };
  }
  if (accel < -0.4 || (best && best.dist < 25)) {
    return {
      text: best
        ? `Slowing: ${best.cls} ID ${best.id} at ${best.dist.toFixed(0)}m`
        : 'Slowing to match traffic',
      severity: 'slow',
    };
  }
  return { text: `Cruising: lane clear, ${Math.round(speed * 3.6)} km/h`, severity: 'go' };
}

export const LABEL_TARGET_PX = 16;
export const LABEL_MAX_PX = 22;
export const LABEL_ASPECT = 4;
export const LABEL_FADE_START = 36;
export const LABEL_FADE_END = 90;
export const LABEL_NEAR_HIDE = 3.5;

/** World height so a label stays ~16–22 px tall at this camera distance. */
export function labelWorldHeight(dist: number, viewH: number, fovDeg: number): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const worldPerPx = (2 * Math.max(0.6, dist) * Math.tan(vFov / 2)) / Math.max(1, viewH);
  return Math.min(LABEL_MAX_PX, LABEL_TARGET_PX) * worldPerPx;
}

export function labelOpacityForDistance(dist: number): number {
  if (dist < LABEL_NEAR_HIDE) return 0;
  if (dist >= LABEL_FADE_END) return 0;
  if (dist <= LABEL_FADE_START) return 0.88;
  return 0.88 * (1 - (dist - LABEL_FADE_START) / (LABEL_FADE_END - LABEL_FADE_START));
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.scale.set(LABEL_ASPECT * 0.4, 0.4, 1);
  return sprite;
}

/** On, but capped / faded / HUD-clipped so they cannot cover the panels. */
export const DRAW_WORLD_LABEL_SPRITES = true;

function nowMsOf(input?: PerceptionVizInput): number {
  if (input?.nowMs != null) return input.nowMs;
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function copyGrid(src?: Float32Array): Float32Array | undefined {
  if (!src) return undefined;
  return Float32Array.from(src);
}

function tracksToPoses(tracks: Track[]): SnapPose[] {
  const out: SnapPose[] = [];
  for (const track of tracks) {
    if (track.missedFrames > 0 || track.confidence < 0.4) continue;
    out.push({
      id: track.id,
      classType: track.classType,
      x: track.box.center.x,
      y: track.box.center.y,
      z: track.box.center.z,
      sx: track.box.size.x,
      sy: track.box.size.y,
      sz: track.box.size.z,
      yaw: track.box.yaw,
      vx: track.velocity.x,
      vy: track.velocity.y,
      confidence: track.confidence,
    });
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

function detsToPoses(dets: VisionDetection[], ego: EgoState): SnapPose[] {
  const out: SnapPose[] = [];
  const p = ego.transform.position;
  const yaw = ego.transform.rotation;
  for (const det of dets) {
    const loc = worldToEgo(det.center.x, det.center.y, det.center.z, p.x, p.y, yaw);
    out.push({
      id: det.entityId,
      classType: det.classType,
      x: loc.x,
      y: loc.y,
      z: loc.z,
      sx: det.size.x,
      sy: det.size.y,
      sz: det.size.z,
      yaw: 0,
      vx: 0,
      vy: 0,
      confidence: det.confidence,
    });
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

function instancedBox(max: number, extras: Record<string, number>): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const [name, size] of Object.entries(extras)) {
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(max * size), size));
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), max);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  return mesh;
}

function fillIdentity(mesh: THREE.InstancedMesh, dummy: THREE.Object3D, max: number) {
  dummy.position.set(0, 0, 0);
  dummy.quaternion.identity();
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

export class PerceptionVisualizer {
  readonly group = new THREE.Group();
  private rig = new THREE.Group();
  private uniforms = createAnimUniforms();

  private points: THREE.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private pointAz: Float32Array;

  private voxels: THREE.InstancedMesh;
  private futureVoxels: THREE.InstancedMesh;
  private boxes: THREE.InstancedMesh;
  private bars: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private rays: THREE.InstancedMesh;
  private radar: THREE.InstancedMesh;
  private sweep: THREE.Mesh;
  private frustumFill: THREE.Mesh;
  private frustumLines: THREE.Line[] = [];
  private laneLine: THREE.Line;
  private trailLine: THREE.LineSegments;
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  private predLines: THREE.Line[] = [];
  private planLine: THREE.Line;
  private labels: THREE.Sprite[] = [];
  private lastLabelKey = '';
  private predPts = new Float32Array(12 * 3);
  private planPts = new Float32Array(48 * 3);
  private dummy = new THREE.Object3D();
  private displayOcc = new Float32Array(0);

  private prevSnap: OverlaySnapshot | null = null;
  private currSnap: OverlaySnapshot | null = null;
  private lastSnapMs = 0;
  private lastInput: PerceptionVizInput | null = null;
  private lastDecision: DecisionInfo = { text: 'Cruising: lane clear', severity: 'go' };
  private trackBirths = new Map<number, number>();
  private detBirths = new Map<number, number>();
  private stack: VizStack = 'tesla';

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.rig);

    this.pointPos = new Float32Array(MAX_POINTS * 3);
    this.pointCol = new Float32Array(MAX_POINTS * 3);
    this.pointAz = new Float32Array(MAX_POINTS);
    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    pGeom.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3));
    pGeom.setAttribute('aAzimuth', new THREE.BufferAttribute(this.pointAz, 1));
    pGeom.setDrawRange(0, 0);
    this.points = new THREE.Points(pGeom, makeLidarPointsMaterial(this.uniforms));
    this.rig.add(this.points);

    const sweepGeo = new THREE.BoxGeometry(72, 2.6, 0.14);
    sweepGeo.translate(36, 1.15, 0);
    this.sweep = new THREE.Mesh(sweepGeo, makeSweepMaterial(this.uniforms));
    this.sweep.frustumCulled = false;
    this.sweep.renderOrder = 3;
    this.rig.add(this.sweep);

    const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0, 0.33, 0.66]), 1));
    this.radar = new THREE.InstancedMesh(ringGeo, makeRadarMaterial(this.uniforms), 3);
    this.radar.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.radar.frustumCulled = false;
    this.radar.count = 3;
    fillIdentity(this.radar, this.dummy, 3);
    this.rig.add(this.radar);

    this.voxels = instancedBox(MAX_VOXELS, { aPosA: 3, aPosB: 3, aSizeA: 3, aSizeB: 3, aHash: 1 });
    this.voxels.material = makeVoxelMaterial(this.uniforms, 0x44ddff, 0.38);
    fillIdentity(this.voxels, this.dummy, MAX_VOXELS);
    this.rig.add(this.voxels);

    this.futureVoxels = instancedBox(MAX_FUTURE, { aPosA: 3, aPosB: 3, aSizeA: 3, aSizeB: 3, aHash: 1 });
    this.futureVoxels.material = makeVoxelMaterial(this.uniforms, 0xaaccff, 0.18);
    fillIdentity(this.futureVoxels, this.dummy, MAX_FUTURE);
    this.rig.add(this.futureVoxels);

    this.boxes = instancedBox(MAX_LABELS, { aBirth: 1 });
    this.boxes.material = makeBoxMaterial(this.uniforms, 0x88ff88);
    this.rig.add(this.boxes);

    this.bars = instancedBox(MAX_LABELS, { aBirth: 1 });
    this.bars.material = makeBarMaterial(this.uniforms);
    const barCol = new Float32Array(MAX_LABELS * 3);
    this.bars.instanceColor = new THREE.InstancedBufferAttribute(barCol, 3);
    this.rig.add(this.bars);

    const arrowGeo = new THREE.ConeGeometry(0.14, 0.55, 6);
    arrowGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(new Float32Array(MAX_LABELS), 1));
    this.arrows = new THREE.InstancedMesh(arrowGeo, makeBarMaterial(this.uniforms), MAX_LABELS);
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    const arrowCol = new Float32Array(MAX_LABELS * 3);
    for (let i = 0; i < MAX_LABELS; i++) {
      arrowCol[i * 3] = 1;
      arrowCol[i * 3 + 1] = 0.85;
      arrowCol[i * 3 + 2] = 0.25;
    }
    this.arrows.instanceColor = new THREE.InstancedBufferAttribute(arrowCol, 3);
    this.rig.add(this.arrows);

    const rayGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    rayGeo.translate(0, 0, -0.5);
    rayGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(new Float32Array(MAX_RAYS), 1));
    this.rays = new THREE.InstancedMesh(rayGeo, makeRayMaterial(this.uniforms), MAX_RAYS);
    this.rays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rays.frustumCulled = false;
    this.rays.count = 0;
    this.rig.add(this.rays);

    this.frustumFill = this.buildFrustums();
    this.rig.add(this.frustumFill);

    const laneGeo = new THREE.BufferGeometry();
    const lanePos = new Float32Array(LANE_SEGS * 3);
    const laneAlong = new Float32Array(LANE_SEGS);
    for (let i = 0; i < LANE_SEGS; i++) {
      const d = 2 + i * 1.15;
      lanePos[i * 3] = d;
      lanePos[i * 3 + 1] = 0.08;
      lanePos[i * 3 + 2] = LANE_OFFSET;
      laneAlong[i] = d;
    }
    laneGeo.setAttribute('position', new THREE.BufferAttribute(lanePos, 3));
    laneGeo.setAttribute('aAlong', new THREE.BufferAttribute(laneAlong, 1));
    this.laneLine = new THREE.Line(laneGeo, makeLaneMaterial(this.uniforms));
    this.rig.add(this.laneLine);

    this.trailPos = new Float32Array(MAX_LABELS * TRAIL_SEGS * 2 * 3);
    this.trailCol = new Float32Array(MAX_LABELS * TRAIL_SEGS * 2 * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    trailGeo.setDrawRange(0, 0);
    this.trailLine = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }));
    this.rig.add(this.trailLine);

    const planGeom = new THREE.BufferGeometry();
    planGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.planLine = new THREE.Line(planGeom, new THREE.LineBasicMaterial({ color: 0x33ff66, linewidth: 2 }));
    this.group.add(this.planLine);

    for (let i = 0; i < MAX_PRED; i++) {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(12 * 3);
      const along = new Float32Array(12);
      for (let k = 0; k < 12; k++) along[k] = k;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      const selected = i === 0;
      const line = new THREE.Line(g, makeTrajMaterial(this.uniforms, selected));
      line.visible = false;
      this.rig.add(line);
      this.predLines.push(line);
    }
  }

  setEnabled(on: boolean) {
    this.group.visible = on;
  }

  setStack(stack: VizStack) {
    this.stack = stack;
    this.syncStackVisibility();
  }

  update(input: PerceptionVizInput): DecisionInfo {
    const decision = computeDecision(input);
    this.lastDecision = decision;
    this.lastInput = input;
    this.stack = input.stack;
    if (!this.group.visible) return decision;

    this.pushSnapshot(input);
    const live = input.ego.transform;
    this.animate(nowMsOf(input), { x: live.position.x, y: live.position.y, yaw: live.rotation });
    this.updateLabels(input);
    this.layoutWorldLabels(input);
    this.updatePlan(input, decision);
    return decision;
  }

  /** Per-display-frame: shader uniforms + interpolated instance poses. No perception. */
  animate(nowMs: number, liveEgo: { x: number; y: number; yaw: number; stack?: VizStack }) {
    if (liveEgo.stack) this.stack = liveEgo.stack;
    const tSec = nowMs * 0.001;
    this.uniforms.uTime.value = tSec;
    this.uniforms.uAlpha.value = this.prevSnap
      ? snapshotAlpha(nowMs, this.lastSnapMs)
      : 1;
    this.uniforms.uSweep.value = lidarSweepAngle(tSec);
    this.uniforms.uPulse.value = 0.5 + 0.5 * Math.sin(tSec * 5.6);

    this.rig.position.set(liveEgo.x, 0, -liveEgo.y);
    this.rig.rotation.y = liveEgo.yaw;

    const poses = this.interpolatedBoxPoses();
    this.applyBoxes(poses, tSec);
    this.applyBars(poses, tSec);
    this.applyArrows(poses);
    this.applyRays(poses);
    this.applyTrails(poses);
    this.applyPredictions(poses, nowMs);
    this.syncStackVisibility();
  }

  paintInset(canvas: HTMLCanvasElement) {
    if (!this.lastInput) return;
    const input = this.insetInput();
    renderAIViewCanvas(canvas, input, this.lastDecision, this.uniforms.uTime.value * 1000, this.detBirths, this.trackBirths);
  }

  private interpolatedBoxPoses(): SnapPose[] {
    if (!this.currSnap) return [];
    const t = this.uniforms.uAlpha.value;
    const prev = this.prevSnap;
    const boxSrc = this.stack === 'tesla' ? 'dets' : 'tracks';
    const curr = this.currSnap[boxSrc];
    const before = prev ? prev[boxSrc] : curr;
    return interpolatePoses(before, curr, t);
  }

  private insetInput(): PerceptionVizInput {
    const base = this.lastInput!;
    const t = this.uniforms.uAlpha.value;
    const occ = this.lerpOccForInset(t);
    return {
      ...base,
      occupancy: occ ?? base.occupancy,
      visionDetections: this.stack === 'tesla' ? this.posesAsDets(this.interpolatedBoxPoses(), base.ego) : base.visionDetections,
      tracks: this.stack === 'tesla' ? base.tracks : this.posesAsTracks(this.interpolatedBoxPoses()),
    };
  }

  private lerpOccForInset(t: number): BEVOccupancy | undefined {
    const curr = this.currSnap?.occ;
    if (!curr || !this.currSnap) return this.lastInput?.occupancy;
    if (this.displayOcc.length !== curr.length) this.displayOcc = new Float32Array(curr.length);
    const prev = this.prevSnap?.occ ?? curr;
    lerpOccupancy(this.displayOcc, prev, curr, t);
    return { grid: this.displayOcc, resolution: this.currSnap.occRes, extent: this.currSnap.occExtent };
  }

  private posesAsDets(poses: SnapPose[], ego: EgoState): VisionDetection[] {
    return poses.map(p => {
      const w = egoToWorld({ x: p.x, y: p.y, z: p.z }, ego.transform.position, ego.transform.rotation);
      return {
        entityId: p.id,
        classType: p.classType,
        center: w,
        size: { x: p.sx, y: p.sy, z: p.sz },
        confidence: p.confidence,
        cameraId: 'front_main',
        depth: Math.hypot(p.x, p.y),
      };
    });
  }

  private posesAsTracks(poses: SnapPose[]): Track[] {
    return poses.map(p => ({
      id: p.id,
      classType: p.classType as Track['classType'],
      box: {
        center: { x: p.x, y: p.y, z: p.z },
        size: { x: p.sx, y: p.sy, z: p.sz },
        yaw: p.yaw,
      },
      velocity: { x: p.vx, y: p.vy, z: 0 },
      age: 1,
      missedFrames: 0,
      confidence: p.confidence,
    }));
  }

  private pushSnapshot(input: PerceptionVizInput) {
    const timeMs = nowMsOf(input);
    const tSec = timeMs * 0.001;
    const tracks = tracksToPoses(input.tracks);
    const dets = detsToPoses(input.visionDetections, input.ego);
    rememberBirths(this.trackBirths, tracks.map(t => t.id), tSec);
    rememberBirths(this.detBirths, dets.map(d => d.id), tSec);

    const occ = input.futureOccupancy?.current ?? input.occupancy;
    const snap: OverlaySnapshot = {
      timeMs,
      tracks,
      dets,
      occ: occ ? copyGrid(occ.grid) : undefined,
      occRes: occ?.resolution ?? 1.5,
      occExtent: occ?.extent ?? 24,
      t1: copyGrid(input.futureOccupancy?.t1s.grid),
      t2: copyGrid(input.futureOccupancy?.t2s.grid),
      t3: copyGrid(input.futureOccupancy?.t3s.grid),
    };
    this.prevSnap = this.currSnap;
    this.currSnap = snap;
    this.lastSnapMs = timeMs;

    this.uploadPoints(input);
    this.uploadVoxels(input);
    this.uploadFuture(input);
    this.uploadTrajectories(input);
    this.syncFrustum();
  }

  private attr(mesh: THREE.InstancedMesh, name: string): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
  }

  private uploadPoints(input: PerceptionVizInput) {
    const { stack, lidarPoints, agents } = input;
    let n = 0;
    const push = (lx: number, ly: number, lz: number, r: number, g: number, b: number, az: number) => {
      if (n >= MAX_POINTS) return;
      const i = n * 3;
      this.pointPos[i] = lx;
      this.pointPos[i + 1] = lz;
      this.pointPos[i + 2] = -ly;
      this.pointCol[i] = r;
      this.pointCol[i + 1] = g;
      this.pointCol[i + 2] = b;
      this.pointAz[n] = az;
      n++;
    };

    const useLidar = stack === 'waymo' || stack === 'waabi';
    if (useLidar) {
      const step = Math.max(1, Math.ceil(lidarPoints.length / MAX_POINTS));
      for (let i = 0; i < lidarPoints.length && n < MAX_POINTS; i += step) {
        const p = lidarPoints[i]!;
        if (p.z < 0.25 && (p.ring % 3) !== 0) continue;
        const h = Math.max(0, Math.min(1, (p.z + 0.2) / 3));
        push(p.x, p.y, p.z + 0.05, 0.10 + h * 0.16, 0.32 + h * 0.38, 0.78 - h * 0.4, lidarAzimuth(p.x, p.y));
      }
    }

    if (stack === 'tesla') {
      for (const det of input.visionDetections) {
        const samples = det.classType === 'pedestrian' ? 18 : 40;
        const id = det.entityId;
        const loc = worldToEgo(
          det.center.x, det.center.y, 0,
          input.ego.transform.position.x, input.ego.transform.position.y, input.ego.transform.rotation,
        );
        for (let i = 0; i < samples && n < MAX_POINTS; i++) {
          const u = ((id * 13 + i * 17) % 1000) / 1000;
          const v = ((id * 29 + i * 11) % 1000) / 1000;
          const w = ((id * 7 + i * 19) % 1000) / 1000;
          const lx = loc.x + (u - 0.5) * det.size.x;
          const ly = loc.y + (v - 0.5) * det.size.y;
          push(lx, ly, 0.3 + w * det.size.z, 0.18, 0.72, 0.85, lidarAzimuth(lx, ly));
        }
      }
    }

    if (stack === 'waymo') {
      for (const agent of agents) {
        if (n >= MAX_POINTS) break;
        const loc = worldToEgo(
          agent.boundingBox.center.x, agent.boundingBox.center.y, 1.2,
          input.ego.transform.position.x, input.ego.transform.position.y, input.ego.transform.rotation,
        );
        push(loc.x, loc.y, loc.z, 1, 0.4, 0.1, lidarAzimuth(loc.x, loc.y));
      }
    }

    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('aAzimuth') as THREE.BufferAttribute).needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.computeBoundingSphere();
  }

  private writeVoxelCell(
    mesh: THREE.InstancedMesh,
    index: number,
    gx: number,
    gy: number,
    prevV: number,
    currV: number,
    resolution: number,
    extent: number,
  ) {
    const lx = gx * resolution - extent + resolution * 0.5;
    const ly = gy * resolution - extent + resolution * 0.5;
    const posA = this.attr(mesh, 'aPosA');
    const posB = this.attr(mesh, 'aPosB');
    const sizeA = this.attr(mesh, 'aSizeA');
    const sizeB = this.attr(mesh, 'aSizeB');
    const hash = this.attr(mesh, 'aHash');
    const threeX = lx;
    const threeZ = -ly;
    posA.setXYZ(index, threeX, 0, threeZ);
    posB.setXYZ(index, threeX, 0, threeZ);
    const w = resolution * 1.05;
    sizeA.setXYZ(index, w, 0.2 + prevV * 1.15, w);
    sizeB.setXYZ(index, w, 0.2 + currV * 1.15, w);
    hash.setX(index, ((gx * 12.9898 + gy * 78.233) % 1 + 1) % 1);
  }

  private uploadGridVoxels(
    mesh: THREE.InstancedMesh,
    prev: Float32Array | undefined,
    curr: Float32Array | undefined,
    resolution: number,
    extent: number,
    max: number,
    thresh: number,
  ): number {
    if (!curr) {
      mesh.count = 0;
      return 0;
    }
    const gridSize = Math.sqrt(curr.length);
    const prevG = prev && prev.length === curr.length ? prev : curr;
    const step = gridSize > 70 ? 2 : 1;
    let count = 0;
    for (let gy = 0; gy < gridSize && count < max; gy += step) {
      for (let gx = 0; gx < gridSize && count < max; gx += step) {
        const i = gy * gridSize + gx;
        const a = prevG[i] || 0;
        const b = curr[i] || 0;
        vizWorkStats.occupancyCellsVisited++;
        if (a < thresh && b < thresh) continue;
        this.writeVoxelCell(mesh, count, gx, gy, a, b, resolution, extent);
        count++;
      }
    }
    this.attr(mesh, 'aPosA').needsUpdate = true;
    this.attr(mesh, 'aPosB').needsUpdate = true;
    this.attr(mesh, 'aSizeA').needsUpdate = true;
    this.attr(mesh, 'aSizeB').needsUpdate = true;
    this.attr(mesh, 'aHash').needsUpdate = true;
    mesh.count = count;
    return count;
  }

  private uploadTeslaVoxels(input: PerceptionVizInput) {
    const mesh = this.voxels;
    const prev = this.prevSnap?.dets ?? [];
    const curr = this.currSnap?.dets ?? detsToPoses(input.visionDetections, input.ego);
    const prevMap = new Map(prev.map(d => [d.id, d]));
    let count = 0;
    const posA = this.attr(mesh, 'aPosA');
    const posB = this.attr(mesh, 'aPosB');
    const sizeA = this.attr(mesh, 'aSizeA');
    const sizeB = this.attr(mesh, 'aSizeB');
    const hash = this.attr(mesh, 'aHash');
    for (const det of curr) {
      const before = prevMap.get(det.id) ?? { ...det, sz: 0.05 };
      const nx = Math.min(3, Math.max(2, Math.ceil(det.sx / 1.1)));
      const ny = Math.min(2, Math.max(2, Math.ceil(det.sy / 1.1)));
      const nz = Math.min(2, Math.max(1, Math.ceil(det.sz / 1.2)));
      for (let ix = 0; ix < nx && count < MAX_VOXELS; ix++) {
        for (let iy = 0; iy < ny && count < MAX_VOXELS; iy++) {
          for (let iz = 0; iz < nz && count < MAX_VOXELS; iz++) {
            const ox = (ix - nx / 2) * 0.6;
            const oy = (iy - ny / 2) * 0.6;
            const ax = before.x + ox;
            const ay = before.y + oy;
            const bx = det.x + ox;
            const by = det.y + oy;
            posA.setXYZ(count, ax, iz * 0.55, -ay);
            posB.setXYZ(count, bx, iz * 0.55, -by);
            sizeA.setXYZ(count, 0.55, 0.55, 0.55);
            sizeB.setXYZ(count, 0.55, 0.55, 0.55);
            hash.setX(count, ((det.id * 0.17 + ix * 0.3 + iy) % 1 + 1) % 1);
            count++;
          }
        }
      }
    }
    posA.needsUpdate = true;
    posB.needsUpdate = true;
    sizeA.needsUpdate = true;
    sizeB.needsUpdate = true;
    hash.needsUpdate = true;
    mesh.count = count;
  }

  private uploadVoxels(input: PerceptionVizInput) {
    if (input.stack === 'tesla') {
      this.uploadTeslaVoxels(input);
      return;
    }
    if (input.stack === 'waabi') {
      this.uploadGridVoxels(
        this.voxels,
        this.prevSnap?.occ,
        this.currSnap?.occ,
        this.currSnap?.occRes ?? 1.5,
        this.currSnap?.occExtent ?? 24,
        MAX_VOXELS,
        0.12,
      );
      return;
    }
    this.voxels.count = 0;
  }

  private uploadFuture(input: PerceptionVizInput) {
    if (input.stack !== 'waabi' || !this.currSnap) {
      this.futureVoxels.count = 0;
      return;
    }
    const layers: Array<{ prev?: Float32Array; curr?: Float32Array }> = [
      { prev: this.prevSnap?.t1, curr: this.currSnap.t1 },
      { prev: this.prevSnap?.t2, curr: this.currSnap.t2 },
      { prev: this.prevSnap?.t3, curr: this.currSnap.t3 },
    ];
    const res = this.currSnap.occRes;
    const extent = this.currSnap.occExtent;
    const mesh = this.futureVoxels;
    const posA = this.attr(mesh, 'aPosA');
    const posB = this.attr(mesh, 'aPosB');
    const sizeA = this.attr(mesh, 'aSizeA');
    const sizeB = this.attr(mesh, 'aSizeB');
    const hash = this.attr(mesh, 'aHash');
    let count = 0;
    const per = Math.floor(MAX_FUTURE / 3);
    for (let layer = 0; layer < layers.length; layer++) {
      const curr = layers[layer]!.curr;
      if (!curr) continue;
      const prevG = layers[layer]!.prev && layers[layer]!.prev!.length === curr.length
        ? layers[layer]!.prev!
        : curr;
      const gridSize = Math.sqrt(curr.length);
      const step = gridSize > 40 ? 2 : 1;
      let layerCount = 0;
      const slide = (layer + 1) * 0.45;
      for (let gy = 0; gy < gridSize && layerCount < per && count < MAX_FUTURE; gy += step) {
        for (let gx = 0; gx < gridSize && layerCount < per && count < MAX_FUTURE; gx += step) {
          const i = gy * gridSize + gx;
          const a = prevG[i] || 0;
          const b = curr[i] || 0;
          if (a < 0.14 && b < 0.14) continue;
          const lx = gx * res - extent + res * 0.5 + slide;
          const ly = gy * res - extent + res * 0.5;
          posA.setXYZ(count, lx, 0, -ly);
          posB.setXYZ(count, lx + 0.35, 0, -ly);
          const w = res * 1.15;
          sizeA.setXYZ(count, w, 0.15 + a * 0.9, w);
          sizeB.setXYZ(count, w, 0.15 + b * 0.9, w);
          hash.setX(count, (((gx + layer * 9) * 0.13 + gy * 0.07) % 1 + 1) % 1);
          count++;
          layerCount++;
        }
      }
    }
    posA.needsUpdate = true;
    posB.needsUpdate = true;
    sizeA.needsUpdate = true;
    sizeB.needsUpdate = true;
    hash.needsUpdate = true;
    mesh.count = count;
  }

  private applyBoxes(poses: SnapPose[], tSec: number) {
    const dummy = this.dummy;
    const birthAttr = this.attr(this.boxes, 'aBirth');
    const births = this.stack === 'tesla' ? this.detBirths : this.trackBirths;
    let count = 0;
    for (const p of poses) {
      if (count >= MAX_LABELS) break;
      dummy.position.set(p.x, Math.max(p.z, p.sz / 2), -p.y);
      dummy.scale.set(Math.max(p.sx, 0.6), Math.max(p.sz, 0.8), Math.max(p.sy, 0.6));
      dummy.rotation.set(0, -p.yaw, 0);
      dummy.updateMatrix();
      this.boxes.setMatrixAt(count, dummy.matrix);
      birthAttr.setX(count, births.get(p.id) ?? (tSec - BOX_POP_S));
      count++;
    }
    this.boxes.count = count;
    this.boxes.instanceMatrix.needsUpdate = true;
    birthAttr.needsUpdate = true;
  }

  private applyBars(poses: SnapPose[], tSec: number) {
    const dummy = this.dummy;
    const birthAttr = this.attr(this.bars, 'aBirth');
    const births = this.stack === 'tesla' ? this.detBirths : this.trackBirths;
    const col = this.bars.instanceColor as THREE.InstancedBufferAttribute | null;
    let count = 0;
    for (const p of poses) {
      if (count >= MAX_LABELS) break;
      const h = 0.15 + p.confidence * 0.85;
      dummy.position.set(p.x, Math.max(p.sz, 0.8) + 0.15 + h / 2, -p.y);
      dummy.scale.set(0.18, h, 0.18);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.bars.setMatrixAt(count, dummy.matrix);
      birthAttr.setX(count, births.get(p.id) ?? (tSec - BOX_POP_S));
      const g = p.confidence;
      col?.setXYZ(count, 1 - g, 0.35 + g * 0.65, 0.15);
      count++;
    }
    this.bars.count = count;
    this.bars.instanceMatrix.needsUpdate = true;
    birthAttr.needsUpdate = true;
    if (col) col.needsUpdate = true;
  }

  private applyArrows(poses: SnapPose[]) {
    if (this.stack === 'tesla') {
      this.arrows.count = 0;
      return;
    }
    const dummy = this.dummy;
    let count = 0;
    for (const p of poses) {
      if (count >= MAX_LABELS) break;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 0.4) continue;
      dummy.position.set(p.x + p.vx * 0.25, Math.max(p.sz, 0.8) * 0.55, -(p.y + p.vy * 0.25));
      _dir.set(p.vx, 0, -p.vy).normalize();
      dummy.quaternion.setFromUnitVectors(_up, _dir);
      dummy.scale.setScalar(0.7 + Math.min(1.4, speed * 0.12));
      dummy.updateMatrix();
      this.arrows.setMatrixAt(count, dummy.matrix);
      count++;
    }
    this.arrows.count = count;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  private applyRays(poses: SnapPose[]) {
    if (this.stack !== 'tesla') {
      this.rays.count = 0;
      return;
    }
    const dummy = this.dummy;
    let count = 0;
    for (const p of poses) {
      if (count >= MAX_RAYS) break;
      const tx = p.x;
      const ty = Math.max(0.4, p.sz * 0.5);
      const tz = -p.y;
      const len = Math.hypot(tx, ty - 1.15, tz);
      dummy.position.set(0, 1.15, 0);
      dummy.scale.set(1, 1, 1);
      dummy.lookAt(tx, ty, tz);
      dummy.scale.set(1, 1, Math.max(0.5, len));
      dummy.updateMatrix();
      this.rays.setMatrixAt(count, dummy.matrix);
      count++;
    }
    this.rays.count = count;
    this.rays.instanceMatrix.needsUpdate = true;
  }

  private applyTrails(poses: SnapPose[]) {
    if (this.stack !== 'waymo') {
      this.trailLine.geometry.setDrawRange(0, 0);
      return;
    }
    let n = 0;
    for (const p of poses) {
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 0.3) continue;
      for (let s = 0; s < TRAIL_SEGS; s++) {
        const t0 = s * 0.12;
        const t1 = (s + 1) * 0.12;
        const i = n * 6;
        this.trailPos[i] = p.x - p.vx * t0;
        this.trailPos[i + 1] = 0.35;
        this.trailPos[i + 2] = -(p.y - p.vy * t0);
        this.trailPos[i + 3] = p.x - p.vx * t1;
        this.trailPos[i + 4] = 0.35;
        this.trailPos[i + 5] = -(p.y - p.vy * t1);
        const fade0 = 1 - s / TRAIL_SEGS;
        const fade1 = 1 - (s + 1) / TRAIL_SEGS;
        this.trailCol[i] = 1 * fade0;
        this.trailCol[i + 1] = 0.7 * fade0;
        this.trailCol[i + 2] = 0.2 * fade0;
        this.trailCol[i + 3] = 1 * fade1;
        this.trailCol[i + 4] = 0.7 * fade1;
        this.trailCol[i + 5] = 0.2 * fade1;
        n++;
      }
    }
    (this.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.trailLine.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.trailLine.geometry.setDrawRange(0, n * 2);
  }

  private uploadTrajectories(input: PerceptionVizInput) {
    const trajs = input.trajectories;
    if (input.stack !== 'waabi' || !trajs || trajs.length === 0) return;
    const ego = input.ego.transform;
    const selected = input.selectedTrajectoryIndex ?? 0;
    let used = 0;
    for (let i = 0; i < trajs.length && used < this.predLines.length; i++) {
      const traj = trajs[i]!;
      const pts = this.predPts;
      const nPts = Math.min(12, traj.points.length);
      const along = this.predLines[used]!.geometry.getAttribute('aAlong') as THREE.BufferAttribute;
      for (let t = 0; t < 12; t++) {
        const src = traj.points[Math.min(t, nPts - 1)]!;
        const loc = worldToEgo(src.position.x, src.position.y, 0.4, ego.position.x, ego.position.y, ego.rotation);
        pts[t * 3] = loc.x;
        pts[t * 3 + 1] = 0.35;
        pts[t * 3 + 2] = -loc.y;
        along.setX(t, t);
      }
      const line = this.predLines[used++]!;
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(pts);
      attr.needsUpdate = true;
      along.needsUpdate = true;
      line.visible = true;
      const selectedMat = i === selected;
      const mat = line.material as THREE.ShaderMaterial;
      mat.uniforms['uColor']?.value.set(selectedMat ? 0x33ff66 : 0xff8833);
      mat.transparent = true;
      line.renderOrder = selectedMat ? 4 : 2;
      line.scale.setScalar(selectedMat ? 1 : 1);
    }
    for (let i = used; i < this.predLines.length; i++) this.predLines[i]!.visible = false;
  }

  private applyPredictions(poses: SnapPose[], _nowMs: number) {
    if (this.stack === 'waabi') return;
    if (this.stack !== 'waymo') {
      for (const line of this.predLines) line.visible = false;
      return;
    }
    let used = 0;
    const pts = this.predPts;
    for (const p of poses) {
      if (used >= this.predLines.length) break;
      for (let t = 0; t < 12; t++) {
        const s = t * 0.25;
        pts[t * 3] = p.x + p.vx * s;
        pts[t * 3 + 1] = 0.4;
        pts[t * 3 + 2] = -(p.y + p.vy * s);
      }
      const line = this.predLines[used++]!;
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(pts);
      attr.needsUpdate = true;
      line.visible = true;
    }
    for (let i = used; i < this.predLines.length; i++) this.predLines[i]!.visible = false;
  }

  private buildFrustums(): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const cams: number[] = [];
    for (let i = 0; i < CAMERA_CONFIG.length; i++) {
      const cam = CAMERA_CONFIG[i]!;
      const half = (cam.fov * Math.PI / 180) / 2;
      const len = cam.id === 'rear' ? 14 : 18;
      const edge = (yaw: number) => ({ x: Math.cos(yaw) * len, y: Math.sin(yaw) * len });
      const l = edge(cam.yaw - half);
      const r = edge(cam.yaw + half);
      positions.push(0, 1.15, 0, l.x, 1.15, -l.y, r.x, 1.15, -r.y);
      uvs.push(0.5, 0, 0, 1, 1, 1);
      cams.push(i, i, i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aCam', new THREE.Float32BufferAttribute(cams, 1));
    const mesh = new THREE.Mesh(geo, makeFrustumMaterial(this.uniforms));
    mesh.frustumCulled = false;
    for (const cam of CAMERA_CONFIG) {
      const half = (cam.fov * Math.PI / 180) / 2;
      const len = cam.id === 'rear' ? 14 : 18;
      const edge = (yaw: number) => new THREE.Vector3(Math.cos(yaw) * len, 1.15, -Math.sin(yaw) * len);
      const pts = [
        new THREE.Vector3(0, 1.15, 0),
        edge(cam.yaw - half),
        new THREE.Vector3(0, 1.15, 0),
        edge(cam.yaw + half),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.4 }),
      );
      this.rig.add(line);
      this.frustumLines.push(line);
    }
    return mesh;
  }

  private syncFrustum() {
    const show = this.stack === 'tesla';
    this.frustumFill.visible = show;
    this.frustumLines.forEach(l => { l.visible = show; });
  }

  private syncStackVisibility() {
    const tesla = this.stack === 'tesla';
    const waymo = this.stack === 'waymo';
    const waabi = this.stack === 'waabi';
    this.points.visible = waymo || tesla;
    this.sweep.visible = waymo;
    this.radar.visible = waymo;
    this.radar.count = waymo ? 3 : 0;
    this.voxels.visible = tesla || waabi;
    this.futureVoxels.visible = waabi;
    this.boxes.visible = tesla || waymo || waabi;
    this.bars.visible = tesla || waymo || waabi;
    this.arrows.visible = waymo || waabi;
    this.rays.visible = tesla;
    this.laneLine.visible = waymo;
    this.trailLine.visible = waymo;
    this.frustumFill.visible = tesla;
    this.frustumLines.forEach(l => { l.visible = tesla; });
  }

  private updatePlan(input: PerceptionVizInput, decision: DecisionInfo) {
    const ego = input.ego;
    const traj = input.plannerOutput?.trajectory?.points ?? [];
    const pts = this.planPts;
    let n = 0;
    if (traj.length > 1) {
      const step = Math.max(1, Math.floor(traj.length / 40));
      for (let i = 0; i < traj.length && n < 48; i += step) {
        const p = traj[i]!;
        pts[n * 3] = p.position.x;
        pts[n * 3 + 1] = 0.35;
        pts[n * 3 + 2] = -p.position.y;
        n++;
      }
    } else {
      const speed = Math.max(2, vec3Length(ego.velocity));
      for (let i = 0; i < 16; i++) {
        const d = i * 2.5;
        pts[n * 3] = ego.transform.position.x + Math.cos(ego.transform.rotation) * d;
        pts[n * 3 + 1] = 0.35;
        pts[n * 3 + 2] = -(ego.transform.position.y + Math.sin(ego.transform.rotation) * d);
        n++;
      }
      void speed;
    }
    const attr = this.planLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(pts);
    attr.needsUpdate = true;
    this.planLine.geometry.setDrawRange(0, n);
    (this.planLine.material as THREE.LineBasicMaterial).color.setHex(pathColor(decision.severity));
  }

  /** Cap screen size, fade with distance, and hide labels under HUD chrome. */
  private layoutWorldLabels(input: PerceptionVizInput) {
    const cam = input.camera;
    const vw = input.viewW ?? 0;
    const vh = input.viewH ?? 0;
    if (this.labels.length === 0) return;
    const fov = cam instanceof THREE.PerspectiveCamera ? cam.fov : 60;
    const camPos = cam?.position;
    for (const sprite of this.labels) {
      const dist = camPos
        ? camPos.distanceTo(sprite.position)
        : 20;
      const h = labelWorldHeight(dist, vh > 0 ? vh : 720, fov);
      sprite.scale.set(h * LABEL_ASPECT, h, 1);
      const opacity = labelOpacityForDistance(dist);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = opacity;
      if (!cam || vw < 8 || vh < 8) {
        sprite.visible = opacity > 0.04;
        continue;
      }
      _labelNdc.copy(sprite.position).project(cam);
      const sx = (_labelNdc.x * 0.5 + 0.5) * vw;
      const sy = (1 - (_labelNdc.y * 0.5 + 0.5)) * vh;
      const behind = _labelNdc.z >= 1 || _labelNdc.z < -1;
      sprite.visible = !behind && opacity > 0.04 && !spriteHitsReservedHud(sx, sy, vw, vh);
    }
  }

  private updateLabels(input: PerceptionVizInput) {
    if (!DRAW_WORLD_LABEL_SPRITES) {
      if (this.labels.length > 0) {
        for (const s of this.labels) this.group.remove(s);
        this.labels = [];
        this.lastLabelKey = '';
      }
      return;
    }
    const ego = input.ego;
    const keyParts: string[] = [];
    const items: Array<{ text: string; color: string; x: number; y: number; z: number }> = [];

    const tracks = input.tracks
      .filter(t => t.missedFrames === 0 && t.confidence >= 0.4)
      .slice(0, MAX_LABELS);
    for (const track of tracks) {
      const world = egoToWorld(track.box.center, ego.transform.position, ego.transform.rotation);
      const conf = Math.round(track.confidence * 100);
      items.push({
        text: `${track.classType} #${track.id} ${conf}%`,
        color: '#88ff88',
        x: world.x,
        y: Math.max(track.box.size.z, 1.4) + 0.6,
        z: -world.y,
      });
      keyParts.push(`${track.id}:${conf}`);
    }

    if (input.showGroundTruth) {
      for (const gt of input.groundTruth) {
        const covered = tracks.some(t => {
          const w = egoToWorld(t.box.center, ego.transform.position, ego.transform.rotation);
          const dx = w.x - gt.boundingBox.center.x;
          const dy = w.y - gt.boundingBox.center.y;
          return dx * dx + dy * dy < 9;
        });
        if (!covered) {
          items.push({
            text: `MISS ${gt.classType}`,
            color: '#ff3333',
            x: gt.boundingBox.center.x,
            y: 2.4,
            z: -gt.boundingBox.center.y,
          });
          keyParts.push(`m${gt.id}`);
        }
      }
    }

    const key = keyParts.join('|');
    if (key !== this.lastLabelKey) {
      this.lastLabelKey = key;
      for (const s of this.labels) this.group.remove(s);
      this.labels = items.slice(0, MAX_LABELS).map(it => {
        const sprite = makeLabelSprite(it.text, it.color);
        sprite.position.set(it.x, it.y, it.z);
        this.group.add(sprite);
        return sprite;
      });
    } else {
      items.slice(0, this.labels.length).forEach((it, i) => {
        this.labels[i]!.position.set(it.x, it.y, it.z);
      });
    }
  }
}

export function renderAIViewCanvas(
  canvas: HTMLCanvasElement,
  input: PerceptionVizInput,
  decision: DecisionInfo,
  nowMs?: number,
  detBirths?: Map<number, number>,
  trackBirths?: Map<number, number>,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#0b0f18';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#7fd7ff';
  ctx.font = 'bold 12px sans-serif';
  const titles: Record<VizStack, string> = {
    tesla: 'Tesla · cameras only → voxels (no lidar/map)',
    waymo: 'Waymo · lidar+radar+map fused boxes',
    waabi: 'Waabi · BEV occupancy now + 1–3s future',
  };
  ctx.fillText(titles[input.stack], 8, 16);

  const tSec = (nowMs ?? 0) * 0.001;
  const pulse = 0.55 + 0.45 * Math.sin(tSec * 5.6);

  if (input.stack === 'waabi' && input.occupancy) {
    const occ = input.occupancy;
    const side = Math.min(w - 16, h - 36);
    const x0 = 8;
    const y0 = 24;
    const img = ctx.createImageData(w, h);
    img.data.fill(0);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 11;
      img.data[i + 1] = 15;
      img.data[i + 2] = 24;
      img.data[i + 3] = 255;
    }
    writeOccupancyRgbaAiView(img.data, w, occ, x0, y0, side, side);
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#7fd7ff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(titles[input.stack], 8, 16);
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(x0 + side / 2, y0 + side / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    if (input.trajectories && input.trajectories.length > 0) {
      const selected = input.selectedTrajectoryIndex ?? 0;
      ctx.save();
      ctx.translate(x0 + side / 2, y0 + side / 2);
      ctx.scale(2.2, -2.2);
      const egoX = input.ego.transform.position.x;
      const egoY = input.ego.transform.position.y;
      ctx.setLineDash([1.2, 0.8]);
      ctx.lineDashOffset = -tSec * 8;
      for (let i = 0; i < input.trajectories.length; i++) {
        const traj = input.trajectories[i]!;
        const isSel = i === selected;
        ctx.strokeStyle = isSel ? '#33ff66' : '#ff8833';
        ctx.globalAlpha = isSel ? 0.95 : 0.35 + 0.25 * pulse;
        ctx.lineWidth = isSel ? 0.55 : 0.22;
        ctx.beginPath();
        const cut = isSel ? traj.points.length : Math.max(2, Math.floor(traj.points.length * (0.35 + 0.65 * ((tSec * 0.7) % 1))));
        for (let j = 0; j < cut; j++) {
          const pt = traj.points[j]!;
          const dx = pt.position.x - egoX;
          const dy = pt.position.y - egoY;
          if (j === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  } else {
    const ego = input.ego;
    ctx.strokeStyle = '#223';
    ctx.strokeRect(8, 24, w - 16, h - 48);
    const dets = input.stack === 'tesla' ? input.visionDetections : input.tracks.filter(t => t.missedFrames === 0);
    const births = input.stack === 'tesla' ? detBirths : trackBirths;
    for (const det of dets) {
      const center = 'center' in det ? det.center : egoToWorld(det.box.center, ego.transform.position, ego.transform.rotation);
      const relx = center.x - ego.transform.position.x;
      const rely = center.y - ego.transform.position.y;
      const localX = relx * Math.cos(-ego.transform.rotation) - rely * Math.sin(-ego.transform.rotation);
      const localY = relx * Math.sin(-ego.transform.rotation) + rely * Math.cos(-ego.transform.rotation);
      if (localX < 1 || localX > 60) continue;
      const u = 0.5 - (localY / localX) * 0.55;
      const v = 0.62 - 1.6 / localX;
      const bx = 8 + u * (w - 16);
      const by = 24 + v * (h - 48);
      const cls = 'classType' in det ? det.classType : 'obj';
      const conf = 'confidence' in det ? det.confidence : 0.8;
      const id = 'entityId' in det ? det.entityId : 'id' in det ? det.id : 0;
      const pop = births ? boxPopScale(tSec - (births.get(id) ?? (tSec - BOX_POP_S))) : 1;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * pop;
      ctx.translate(bx, by);
      ctx.scale(0.2 + 0.8 * pop, 0.2 + 0.8 * pop);
      ctx.strokeStyle = cls === 'pedestrian' ? '#ff66ff' : '#66ff88';
      ctx.lineWidth = 2;
      const bw = cls === 'pedestrian' ? 18 : 36;
      const bh = cls === 'pedestrian' ? 34 : 22;
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
      ctx.fillStyle = conf > 0.7 ? '#44ff88' : conf > 0.45 ? '#ffcc44' : '#ff6644';
      ctx.fillRect(-bw / 2, -bh / 2 - 5, bw * conf, 3);
      ctx.fillStyle = '#d0ffe8';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${cls} ${Math.round(conf * 100)}%`, -bw / 2, -bh / 2 - 7);
      ctx.restore();
    }
  }

  ctx.fillStyle = decision.severity === 'brake' ? '#ff6666' : decision.severity === 'slow' ? '#ffcc66' : '#7dffa2';
  ctx.font = '11px sans-serif';
  ctx.fillText(decision.text.slice(0, 64), 8, h - 8);
}

export function projectWorldToCanvas(
  world: Vec3,
  ego: EgoState,
  width: number,
  height: number
): { x: number; y: number; depth: number } | null {
  const relx = world.x - ego.transform.position.x;
  const rely = world.y - ego.transform.position.y;
  const localX = relx * Math.cos(-ego.transform.rotation) - rely * Math.sin(-ego.transform.rotation);
  const localY = relx * Math.sin(-ego.transform.rotation) + rely * Math.cos(-ego.transform.rotation);
  if (localX < 0.5) return null;
  return {
    x: width * (0.5 - (localY / localX) * 0.55),
    y: height * (0.62 - 1.6 / localX),
    depth: localX,
  };
}
