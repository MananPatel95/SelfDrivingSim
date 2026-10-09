/**
 * Classical perception pipeline
 * Ground removal, clustering, box fitting, classification, tracking
 */

import type {
  LidarPoint, Detection, EntityClass, BoundingBox3D, Vec3
} from '../sim/types';
import { vec3, vec3Sub, vec3Add, vec3Scale, vec3Length } from '../sim/math';

// RANSAC ground removal
export function removeGround(
  points: LidarPoint[],
  maxDistance: number = 0.15,
  iterations: number = 100
): { ground: LidarPoint[]; nonGround: LidarPoint[] } {
  if (points.length < 3) {
    return { ground: [], nonGround: points };
  }
  
  let bestPlane: { a: number; b: number; c: number; d: number } | null = null;
  let bestInlierCount = 0;
  
  // Random sampling
  for (let iter = 0; iter < iterations; iter++) {
    // Pick 3 random points
    const idx1 = Math.floor(Math.random() * points.length);
    let idx2 = Math.floor(Math.random() * points.length);
    let idx3 = Math.floor(Math.random() * points.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * points.length);
    while (idx3 === idx1 || idx3 === idx2) idx3 = Math.floor(Math.random() * points.length);
    
    const p1 = points[idx1]!;
    const p2 = points[idx2]!;
    const p3 = points[idx3]!;
    
    // Compute plane
    const v1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
    const v2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
    
    // Cross product
    const normal = {
      x: v1.y * v2.z - v1.z * v2.y,
      y: v1.z * v2.x - v1.x * v2.z,
      z: v1.x * v2.y - v1.y * v2.x,
    };
    
    const len = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2);
    if (len < 1e-6) continue;
    
    const a = normal.x / len;
    const b = normal.y / len;
    const c = normal.z / len;
    const d = -(a * p1.x + b * p1.y + c * p1.z);
    
    // Skip if plane isn't roughly horizontal
    if (Math.abs(c) < 0.9) continue;
    
    // Count inliers
    let inlierCount = 0;
    for (const p of points) {
      const dist = Math.abs(a * p.x + b * p.y + c * p.z + d);
      if (dist < maxDistance) inlierCount++;
    }
    
    if (inlierCount > bestInlierCount) {
      bestInlierCount = inlierCount;
      bestPlane = { a, b, c, d };
    }
  }
  
  if (!bestPlane) {
    // Fallback: simple height threshold
    const ground = points.filter(p => p.z < 0.2);
    const nonGround = points.filter(p => p.z >= 0.2);
    return { ground, nonGround };
  }
  
  const ground: LidarPoint[] = [];
  const nonGround: LidarPoint[] = [];
  
  for (const p of points) {
    const dist = Math.abs(bestPlane.a * p.x + bestPlane.b * p.y + bestPlane.c * p.z + bestPlane.d);
    if (dist < maxDistance) {
      ground.push(p);
    } else {
      nonGround.push(p);
    }
  }
  
  return { ground, nonGround };
}

// DBSCAN-like clustering
export interface Cluster {
  points: LidarPoint[];
  centroid: Vec3;
  minBound: Vec3;
  maxBound: Vec3;
}

export function clusterPoints(
  points: LidarPoint[],
  eps: number = 0.5,
  minPoints: number = 5
): Cluster[] {
  if (points.length === 0) return [];
  
  const visited = new Set<number>();
  const clusters: Cluster[] = [];
  
  // Simple grid-based spatial hashing for neighbor search
  const cellSize = eps;
  const grid = new Map<string, number[]>();
  
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const cellX = Math.floor(p.x / cellSize);
    const cellY = Math.floor(p.y / cellSize);
    const cellZ = Math.floor(p.z / cellSize);
    const key = `${cellX},${cellY},${cellZ}`;
    
    const list = grid.get(key);
    if (list) {
      list.push(i);
    } else {
      grid.set(key, [i]);
    }
  }
  
  function getNeighbors(idx: number): number[] {
    const p = points[idx]!;
    const neighbors: number[] = [];
    
    const cellX = Math.floor(p.x / cellSize);
    const cellY = Math.floor(p.y / cellSize);
    const cellZ = Math.floor(p.z / cellSize);
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
          const cell = grid.get(key);
          if (cell) {
            for (const j of cell) {
              if (j !== idx) {
                const q = points[j]!;
                const dist = Math.sqrt(
                  (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2
                );
                if (dist < eps) {
                  neighbors.push(j);
                }
              }
            }
          }
        }
      }
    }
    
    return neighbors;
  }
  
  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    
    const neighbors = getNeighbors(i);
    if (neighbors.length < minPoints) continue;
    
    // Start new cluster
    const clusterPoints: LidarPoint[] = [points[i]!];
    visited.add(i);
    
    const queue = [...neighbors];
    const inQueue = new Set(neighbors);
    
    while (queue.length > 0) {
      const j = queue.shift()!;
      if (visited.has(j)) continue;
      
      visited.add(j);
      clusterPoints.push(points[j]!);
      
      const jNeighbors = getNeighbors(j);
      if (jNeighbors.length >= minPoints) {
        for (const k of jNeighbors) {
          if (!inQueue.has(k) && !visited.has(k)) {
            queue.push(k);
            inQueue.add(k);
          }
        }
      }
    }
    
    if (clusterPoints.length >= minPoints) {
      // Compute bounds
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let sumX = 0, sumY = 0, sumZ = 0;
      
      for (const p of clusterPoints) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        maxZ = Math.max(maxZ, p.z);
        sumX += p.x;
        sumY += p.y;
        sumZ += p.z;
      }
      
      clusters.push({
        points: clusterPoints,
        centroid: vec3(
          sumX / clusterPoints.length,
          sumY / clusterPoints.length,
          sumZ / clusterPoints.length
        ),
        minBound: vec3(minX, minY, minZ),
        maxBound: vec3(maxX, maxY, maxZ),
      });
    }
  }
  
  return clusters;
}

// Fit oriented bounding box to cluster
export function fitBoundingBox(cluster: Cluster): BoundingBox3D {
  const points = cluster.points;
  
  if (points.length < 3) {
    return {
      center: cluster.centroid,
      size: vec3Sub(cluster.maxBound, cluster.minBound),
      yaw: 0,
    };
  }
  
  // PCA for yaw estimation (simplified - just use 2D)
  const n = points.length;
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  
  let cxx = 0, cxy = 0, cyy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  
  // Principal axis angle
  const yaw = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  
  // Rotate points and find axis-aligned bounds
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  
  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    const u = dx * cos - dy * sin;
    const v = dx * sin + dy * cos;
    
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  
  const length = maxU - minU;
  const width = maxV - minV;
  const height = maxZ - minZ;
  
  // Center in rotated frame
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  
  // Rotate back to world frame
  const centerX = meanX + centerU * Math.cos(yaw) - centerV * Math.sin(yaw);
  const centerY = meanY + centerU * Math.sin(yaw) + centerV * Math.cos(yaw);
  const centerZ = (minZ + maxZ) / 2;
  
  return {
    center: vec3(centerX, centerY, centerZ),
    size: vec3(length, width, height),
    yaw,
  };
}

// Size-based heuristic classification
const CLASS_SIZE_RANGES: Record<EntityClass, { length: [number, number]; width: [number, number]; height: [number, number] }> = {
  pedestrian: { length: [0.3, 0.8], width: [0.3, 0.8], height: [1.0, 2.0] },
  cyclist: { length: [1.0, 2.5], width: [0.4, 1.0], height: [1.0, 2.0] },
  bicycle: { length: [1.0, 2.0], width: [0.3, 0.7], height: [0.5, 1.5] },
  motorcycle: { length: [1.5, 3.0], width: [0.5, 1.2], height: [1.0, 1.8] },
  car: { length: [3.5, 5.5], width: [1.5, 2.2], height: [1.2, 2.0] },
  truck: { length: [5.0, 20.0], width: [2.0, 3.0], height: [2.0, 4.5] },
  bus: { length: [8.0, 15.0], width: [2.2, 3.0], height: [2.5, 4.0] },
  tree: { length: [1.0, 10.0], width: [1.0, 10.0], height: [2.0, 20.0] },
  pole: { length: [0.1, 0.5], width: [0.1, 0.5], height: [2.0, 15.0] },
  traffic_light: { length: [0.3, 1.0], width: [0.3, 1.0], height: [0.3, 1.5] },
  traffic_sign: { length: [0.5, 2.0], width: [0.1, 0.5], height: [0.5, 2.0] },
  building: { length: [5.0, 100.0], width: [5.0, 100.0], height: [3.0, 100.0] },
  barrier: { length: [0.5, 10.0], width: [0.2, 1.0], height: [0.5, 1.5] },
  cone: { length: [0.2, 0.5], width: [0.2, 0.5], height: [0.3, 1.0] },
  train: { length: [10.0, 200.0], width: [2.5, 4.0], height: [3.0, 5.0] },
  ship: { length: [20.0, 400.0], width: [5.0, 60.0], height: [5.0, 50.0] },
  boat: { length: [3.0, 20.0], width: [1.0, 6.0], height: [1.0, 5.0] },
  buoy: { length: [0.5, 3.0], width: [0.5, 3.0], height: [0.5, 3.0] },
};

export function classifyBySize(box: BoundingBox3D): { classType: EntityClass; confidence: number } {
  const { x: length, y: width, z: height } = box.size;
  
  // Ensure length >= width (swap if needed for comparison)
  const l = Math.max(length, width);
  const w = Math.min(length, width);
  
  let bestClass: EntityClass = 'car';
  let bestScore = 0;
  
  for (const [classType, ranges] of Object.entries(CLASS_SIZE_RANGES)) {
    const lScore = scoreInRange(l, ranges.length);
    const wScore = scoreInRange(w, ranges.width);
    const hScore = scoreInRange(height, ranges.height);
    
    const score = lScore * wScore * hScore;
    if (score > bestScore) {
      bestScore = score;
      bestClass = classType as EntityClass;
    }
  }
  
  return { classType: bestClass, confidence: Math.min(0.95, bestScore) };
}

function scoreInRange(value: number, range: [number, number]): number {
  if (value < range[0]) {
    return Math.max(0, 1 - (range[0] - value) / range[0]);
  }
  if (value > range[1]) {
    return Math.max(0, 1 - (value - range[1]) / range[1]);
  }
  return 1;
}

// Simple Kalman-like tracker
export interface Track {
  id: number;
  classType: EntityClass;
  box: BoundingBox3D;
  velocity: Vec3;
  age: number;
  missedFrames: number;
  confidence: number;
}

let nextTrackId = 1;

export function updateTracks(
  tracks: Track[],
  detections: Array<{ box: BoundingBox3D; classType: EntityClass; confidence: number; pointsInBox: number }>,
  dt: number
): Track[] {
  const newTracks: Track[] = [];
  const matchedDetections = new Set<number>();
  
  // Predict track positions
  for (const track of tracks) {
    track.box.center = vec3Add(track.box.center, vec3Scale(track.velocity, dt));
    track.age++;
  }
  
  // Match detections to tracks (greedy nearest neighbor)
  for (const track of tracks) {
    let bestDist = 3.0; // Max matching distance
    let bestIdx = -1;
    
    for (let i = 0; i < detections.length; i++) {
      if (matchedDetections.has(i)) continue;
      
      const det = detections[i]!;
      const dist = vec3Length(vec3Sub(det.box.center, track.box.center));
      
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    
    if (bestIdx >= 0) {
      const det = detections[bestIdx]!;
      matchedDetections.add(bestIdx);
      
      // Update track with measurement
      const alpha = 0.3; // Smoothing factor
      const newCenter = vec3Add(
        vec3Scale(track.box.center, 1 - alpha),
        vec3Scale(det.box.center, alpha)
      );
      const newVelocity = vec3Scale(vec3Sub(det.box.center, track.box.center), 1 / dt);
      
      newTracks.push({
        ...track,
        box: { ...det.box, center: newCenter },
        velocity: vec3Add(vec3Scale(track.velocity, 0.7), vec3Scale(newVelocity, 0.3)),
        classType: det.classType,
        confidence: det.confidence,
        missedFrames: 0,
      });
    } else {
      // No match - coast
      track.missedFrames++;
      if (track.missedFrames < 10) {
        newTracks.push(track);
      }
    }
  }
  
  // Create new tracks for unmatched detections
  for (let i = 0; i < detections.length; i++) {
    if (!matchedDetections.has(i)) {
      const det = detections[i]!;
      if (det.pointsInBox >= 10) {
        newTracks.push({
          id: nextTrackId++,
          classType: det.classType,
          box: det.box,
          velocity: vec3(0, 0, 0),
          age: 0,
          missedFrames: 0,
          confidence: det.confidence,
        });
      }
    }
  }
  
  return newTracks;
}

// Convert tracks to detections
export function tracksToDetections(tracks: Track[]): Detection[] {
  return tracks
    .filter(t => t.age >= 2 && t.missedFrames === 0)
    .map(t => ({
      id: t.id,
      classType: t.classType,
      confidence: t.confidence,
      boundingBox: t.box,
      velocity: t.velocity,
      trackId: t.id,
      pointsInBox: 0, // Would need to recount
    }));
}

// Full perception pipeline
export function runPerception(
  points: LidarPoint[],
  existingTracks: Track[],
  dt: number
): { detections: Detection[]; tracks: Track[] } {
  // 1. Ground removal
  const { nonGround } = removeGround(points);
  
  // 2. Clustering
  const clusters = clusterPoints(nonGround, 0.5, 5);
  
  // 3. Box fitting and classification
  const rawDetections = clusters.map(cluster => {
    const box = fitBoundingBox(cluster);
    const { classType, confidence } = classifyBySize(box);
    return {
      box,
      classType,
      confidence,
      pointsInBox: cluster.points.length,
    };
  });
  
  // 4. Tracking
  const tracks = updateTracks(existingTracks, rawDetections, dt);
  
  // 5. Convert to output detections
  const detections = tracksToDetections(tracks);
  
  return { detections, tracks };
}
