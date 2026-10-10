/**
 * Perception visualization — what the stack actually consumes.
 * Instanced / BufferGeometry, capped point counts.
 */

import * as THREE from 'three';
import { egoToWorld, vec3Length } from '../sim/math';
import type { EgoState, Entity, LidarPoint, PlannerOutput, Vec3 } from '../sim/types';
import type { Track } from '../stacks/perception';
import type { AISTarget, MaritimeEncounter } from '../stacks/maritime';
import { CAMERA_CONFIG, type VisionDetection } from '../stacks/tesla';
import type { BEVOccupancy } from '../stacks/waabi';

export type VizStack = 'tesla' | 'waymo' | 'waabi' | 'aurora' | 'rail' | 'maritime';

const MAX_POINTS = 5000;
const MAX_VOXELS = 500;
const MAX_LABELS = 16;
const MAX_PRED = 24;

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
  aisTargets: AISTarget[];
  encounters: MaritimeEncounter[];
  maritimeAction: string;
  visionDetections: VisionDetection[];
  occupancy?: BEVOccupancy;
}

function pathColor(severity: DecisionInfo['severity']): number {
  if (severity === 'brake') return 0xff3333;
  if (severity === 'slow') return 0xffaa00;
  return 0x33ff66;
}

export function computeDecision(input: PerceptionVizInput): DecisionInfo {
  if (input.stack === 'maritime') {
    const primary = input.encounters
      .filter(e => e.tcpa > 0)
      .sort((a, b) => a.tcpa - b.tcpa)[0];
    if (primary) {
      const trend = primary.cpaDelta > 8 ? 'CPA opening' : primary.cpaDelta < -8 ? 'CPA closing' : 'CPA holding';
      return {
        text: `${input.maritimeAction} · ${primary.name} CPA ${Math.round(primary.cpa)}m (${trend}, was ${Math.round(primary.initialCpa)}m)`,
        severity: primary.cpa < 200 ? 'slow' : 'go',
      };
    }
    return { text: 'Open water: no collision risk', severity: 'go' };
  }

  const ego = input.ego;
  const speed = vec3Length(ego.velocity);
  const heading = ego.transform.rotation;
  const fwd = { x: Math.cos(heading), y: Math.sin(heading) };

  let best: { id: number; cls: string; ttc: number; dist: number } | null = null;
  for (const track of input.tracks) {
    if (track.missedFrames > 0) continue;
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(4.2, 1.05, 1);
  return sprite;
}

export class PerceptionVisualizer {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private voxels: THREE.InstancedMesh;
  private voxelDummy = new THREE.Object3D();
  private labels: THREE.Sprite[] = [];
  private predLines: THREE.Line[] = [];
  private planLine: THREE.Line;
  private frustumLines: THREE.Line[] = [];
  private aisLines: THREE.Line[] = [];
  private radarRing: THREE.Line;
  private lastLabelKey = '';

  constructor(scene: THREE.Scene) {
    scene.add(this.group);

    this.pointPos = new Float32Array(MAX_POINTS * 3);
    this.pointCol = new Float32Array(MAX_POINTS * 3);
    const pGeom = new THREE.BufferGeometry();
    pGeom.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    pGeom.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3));
    pGeom.setDrawRange(0, 0);
    this.points = new THREE.Points(pGeom, new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      sizeAttenuation: true,
    }));
    this.group.add(this.points);

    const voxelGeom = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const voxelMat = new THREE.MeshBasicMaterial({ color: 0x44ddff, transparent: true, opacity: 0.35 });
    this.voxels = new THREE.InstancedMesh(voxelGeom, voxelMat, MAX_VOXELS);
    this.voxels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.voxels.count = 0;
    this.voxels.frustumCulled = false;
    this.group.add(this.voxels);

    const planGeom = new THREE.BufferGeometry();
    planGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.planLine = new THREE.Line(planGeom, new THREE.LineBasicMaterial({ color: 0x33ff66, linewidth: 2 }));
    this.group.add(this.planLine);

    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 80, 0.4, -Math.sin(a) * 80));
    }
    this.radarRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0x33ffaa, transparent: true, opacity: 0.35 })
    );
    this.radarRing.visible = false;
    this.group.add(this.radarRing);

    for (let i = 0; i < MAX_PRED; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffaa33 }));
      line.visible = false;
      this.group.add(line);
      this.predLines.push(line);
    }
  }

  setEnabled(on: boolean) {
    this.group.visible = on;
  }

  update(input: PerceptionVizInput): DecisionInfo {
    const decision = computeDecision(input);
    if (!this.group.visible) return decision;

    this.updatePoints(input);
    this.updateVoxels(input);
    this.updatePredictions(input);
    this.updatePlan(input, decision);
    this.updateLabels(input);
    this.updateFrustums(input);
    this.updateMaritime(input);
    return decision;
  }

  private updatePoints(input: PerceptionVizInput) {
    const { stack, ego, lidarPoints, agents } = input;
    let n = 0;

    const push = (wx: number, wy: number, wz: number, r: number, g: number, b: number) => {
      if (n >= MAX_POINTS) return;
      const i = n * 3;
      this.pointPos[i] = wx;
      this.pointPos[i + 1] = wz;
      this.pointPos[i + 2] = -wy;
      this.pointCol[i] = r;
      this.pointCol[i + 1] = g;
      this.pointCol[i + 2] = b;
      n++;
    };

    const useLidar = stack === 'waymo' || stack === 'aurora' || stack === 'rail' || stack === 'waabi';
    if (useLidar) {
      const step = Math.max(1, Math.ceil(lidarPoints.length / MAX_POINTS));
      for (let i = 0; i < lidarPoints.length && n < MAX_POINTS; i += step) {
        const p = lidarPoints[i]!;
        const world = egoToWorld(p, ego.transform.position, ego.transform.rotation);
        if (stack === 'aurora' && p.radialVelocity !== undefined) {
          const v = p.radialVelocity;
          if (v < -1) push(world.x, world.y, world.z + 0.05, 0.1, 1, 0.2);
          else if (v > 1) push(world.x, world.y, world.z + 0.05, 1, 0.15, 0.1);
          else push(world.x, world.y, world.z + 0.05, 0.55, 0.55, 0.55);
        } else {
          const h = Math.max(0, Math.min(1, (p.z + 0.2) / 3));
          push(world.x, world.y, world.z + 0.05, 0.15 + h * 0.2, 0.4 + h * 0.5, 1 - h * 0.6);
        }
      }
    }

    if (stack === 'tesla') {
      for (const det of input.visionDetections) {
        const samples = det.classType === 'pedestrian' ? 18 : 40;
        for (let i = 0; i < samples && n < MAX_POINTS; i++) {
          push(
            det.center.x + (Math.random() - 0.5) * det.size.x,
            det.center.y + (Math.random() - 0.5) * det.size.y,
            0.3 + Math.random() * det.size.z,
            0.2, 0.9, 1
          );
        }
      }
    }

    if (stack === 'waymo') {
      // Sparse radar returns on agents
      for (const agent of agents) {
        if (n >= MAX_POINTS) break;
        push(agent.boundingBox.center.x, agent.boundingBox.center.y, 1.2, 1, 0.4, 0.1);
      }
    }

    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.computeBoundingSphere();
  }

  private updateVoxels(input: PerceptionVizInput) {
    const showVoxels = input.stack === 'tesla' || input.stack === 'waabi';
    this.voxels.visible = showVoxels;
    if (!showVoxels) {
      this.voxels.count = 0;
      return;
    }

    let count = 0;
    const dummy = this.voxelDummy;
    const ego = input.ego;

    if (input.stack === 'tesla') {
      for (const det of input.visionDetections) {
        const nx = Math.min(3, Math.max(2, Math.ceil(det.size.x / 1.1)));
        const ny = Math.min(2, Math.max(2, Math.ceil(det.size.y / 1.1)));
        const nz = Math.min(2, Math.max(1, Math.ceil(det.size.z / 1.2)));
        for (let ix = 0; ix < nx && count < MAX_VOXELS; ix++) {
          for (let iy = 0; iy < ny && count < MAX_VOXELS; iy++) {
            for (let iz = 0; iz < nz && count < MAX_VOXELS; iz++) {
              dummy.position.set(
                det.center.x + (ix - nx / 2) * 0.6,
                0.35 + iz * 0.55,
                -(det.center.y + (iy - ny / 2) * 0.6)
              );
              dummy.scale.setScalar(1);
              dummy.updateMatrix();
              this.voxels.setMatrixAt(count++, dummy.matrix);
            }
          }
        }
      }
    } else if (input.occupancy) {
      const occ = input.occupancy;
      const gridSize = Math.sqrt(occ.grid.length);
      const yaw = ego.transform.rotation;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const step = gridSize > 70 ? 2 : 1;
      for (let gy = 0; gy < gridSize && count < MAX_VOXELS; gy += step) {
        for (let gx = 0; gx < gridSize && count < MAX_VOXELS; gx += step) {
          const v = occ.grid[gy * gridSize + gx] || 0;
          if (v < 0.12) continue;
          const lx = gx * occ.resolution - occ.extent;
          const ly = gy * occ.resolution - occ.extent;
          const wx = ego.transform.position.x + lx * cos - ly * sin;
          const wy = ego.transform.position.y + lx * sin + ly * cos;
          dummy.position.set(wx, 0.15 + v * 0.4, -wy);
          dummy.scale.set(occ.resolution * 1.05, 0.25 + v, occ.resolution * 1.05);
          dummy.updateMatrix();
          this.voxels.setMatrixAt(count++, dummy.matrix);
        }
      }
    }

    this.voxels.count = count;
    this.voxels.instanceMatrix.needsUpdate = true;
  }

  private updatePredictions(input: PerceptionVizInput) {
    const ego = input.ego;
    let used = 0;
    for (const track of input.tracks) {
      if (used >= this.predLines.length) break;
      if (track.missedFrames > 0) continue;
      const world = egoToWorld(track.box.center, ego.transform.position, ego.transform.rotation);
      const pts = new Float32Array(12 * 3);
      for (let t = 0; t < 12; t++) {
        const s = t * 0.25;
        pts[t * 3] = world.x + track.velocity.x * s;
        pts[t * 3 + 1] = 0.4;
        pts[t * 3 + 2] = -(world.y + track.velocity.y * s);
      }
      const line = this.predLines[used++]!;
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(pts);
      attr.needsUpdate = true;
      line.visible = true;
    }
    for (let i = used; i < this.predLines.length; i++) this.predLines[i]!.visible = false;
  }

  private updatePlan(input: PerceptionVizInput, decision: DecisionInfo) {
    const ego = input.ego;
    const traj = input.plannerOutput?.trajectory?.points ?? [];
    const pts = new Float32Array(48 * 3);
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

  private updateLabels(input: PerceptionVizInput) {
    const ego = input.ego;
    const keyParts: string[] = [];
    const items: Array<{ text: string; color: string; x: number; y: number; z: number }> = [];

    const tracks = input.tracks.filter(t => t.missedFrames === 0).slice(0, MAX_LABELS);
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

  private updateFrustums(input: PerceptionVizInput) {
    const show = input.stack === 'tesla';
    if (!show) {
      this.frustumLines.forEach(l => { l.visible = false; });
      return;
    }
    if (this.frustumLines.length === 0) {
      for (const cam of CAMERA_CONFIG.slice(0, 5)) {
        const half = (cam.fov * Math.PI / 180) / 2;
        const len = 18;
        const pts = [
          new THREE.Vector3(0, 1.2, 0),
          new THREE.Vector3(Math.cos(cam.yaw - half) * len, 1.2, -Math.sin(cam.yaw - half) * len),
          new THREE.Vector3(0, 1.2, 0),
          new THREE.Vector3(Math.cos(cam.yaw + half) * len, 1.2, -Math.sin(cam.yaw + half) * len),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.45 })
        );
        this.group.add(line);
        this.frustumLines.push(line);
      }
    }
    const ego = input.ego;
    this.frustumLines.forEach(line => {
      line.visible = true;
      line.position.set(ego.transform.position.x, 0, -ego.transform.position.y);
      line.rotation.y = -ego.transform.rotation;
    });
  }

  private updateMaritime(input: PerceptionVizInput) {
    const show = input.stack === 'maritime';
    this.radarRing.visible = show;
    if (!show) {
      this.aisLines.forEach(l => { l.visible = false; });
      return;
    }
    const ego = input.ego;
    this.radarRing.position.set(ego.transform.position.x, 0, -ego.transform.position.y);

    while (this.aisLines.length < input.aisTargets.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffcc33 }));
      this.group.add(line);
      this.aisLines.push(line);
    }
    input.aisTargets.forEach((t, i) => {
      const line = this.aisLines[i]!;
      const arr = (line.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      arr[0] = ego.transform.position.x;
      arr[1] = 2;
      arr[2] = -ego.transform.position.y;
      arr[3] = t.position.x;
      arr[4] = 8;
      arr[5] = -t.position.y;
      (line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      line.visible = true;
    });
    for (let i = input.aisTargets.length; i < this.aisLines.length; i++) this.aisLines[i]!.visible = false;
  }
}

export function renderAIViewCanvas(
  canvas: HTMLCanvasElement,
  input: PerceptionVizInput,
  decision: DecisionInfo
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
    tesla: 'Tesla-style · cameras + occupancy voxels',
    waymo: 'Waymo-style · lidar + radar + fused boxes',
    waabi: 'Waabi-style · BEV occupancy-flow',
    aurora: 'Aurora-style · FMCW radial velocity',
    rail: 'Rail · track-corridor obstacles',
    maritime: 'Ship · radar / AIS + CPA vectors',
  };
  ctx.fillText(titles[input.stack], 8, 16);

  if (input.stack === 'waabi' && input.occupancy) {
    const occ = input.occupancy;
    const gridSize = Math.sqrt(occ.grid.length);
    const side = Math.min(w - 16, h - 36);
    const x0 = 8;
    const y0 = 24;
    const cell = side / gridSize;
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const v = occ.grid[gy * gridSize + gx] || 0;
        if (v < 0.05) continue;
        const r = Math.min(255, Math.floor(v * 255 * 1.6));
        const g = Math.max(0, Math.floor((1 - v) * 180));
        ctx.fillStyle = `rgb(${r},${g},${40})`;
        ctx.fillRect(x0 + gx * cell, y0 + (gridSize - gy - 1) * cell, cell + 0.4, cell + 0.4);
      }
    }
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(x0 + side / 2, y0 + side / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Project detections into a simple forward camera plane
    const ego = input.ego;
    ctx.strokeStyle = '#223';
    ctx.strokeRect(8, 24, w - 16, h - 48);
    const dets = input.stack === 'tesla' ? input.visionDetections : input.tracks.filter(t => t.missedFrames === 0);
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
      ctx.strokeStyle = cls === 'pedestrian' ? '#ff66ff' : '#66ff88';
      ctx.lineWidth = 2;
      const bw = cls === 'pedestrian' ? 18 : 36;
      const bh = cls === 'pedestrian' ? 34 : 22;
      ctx.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
      ctx.fillStyle = '#d0ffe8';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${cls} ${Math.round(conf * 100)}%`, bx - bw / 2, by - bh / 2 - 3);
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
