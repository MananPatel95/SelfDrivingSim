/**
 * Main game entry point
 * Browser-based 3D visualization with Three.js
 */

import * as THREE from 'three';
import { Simulation } from './sim/simulation';
import { vec3Length, egoToWorld } from './sim/math';
import { loadWasmKernels, getWasmKernels } from './sim/wasm';
import { WAYMO_INFO_CARD } from './stacks/waymo';
import {
  WAABI_INFO_CARD, WaabiStackState, runWaabiStack,
  BEVOccupancy, AdversarialVariant
} from './stacks/waabi';
import { TESLA_INFO_CARD, detectVisibleAgents, type VisionDetection } from './stacks/tesla';
import { PerceptionVisualizer, renderAIViewCanvas, type DecisionInfo } from './render/perceptionViz';
import { LIDAR_CONFIGS } from './sensors/lidar';
import type { LidarConfig } from './sim/types';

let waabiState: WaabiStackState = {
  tracks: [],
  occupancy: {
    current: { grid: new Float32Array(0), resolution: 0.5, extent: 50 },
    t1s: { grid: new Float32Array(0), resolution: 0.5, extent: 50 },
    t2s: { grid: new Float32Array(0), resolution: 0.5, extent: 50 },
    t3s: { grid: new Float32Array(0), resolution: 0.5, extent: 50 },
  },
  candidateTrajectories: [],
  selectedTrajectoryIndex: 0,
  simWorld: {
    replayBuffer: [],
    variants: [],
    lastGenerationTime: 0,
  },
};

let perceptionViz: PerceptionVisualizer | null = null;
let rawCameraRenderer: THREE.WebGLRenderer | null = null;
let rawCamera: THREE.PerspectiveCamera | null = null;
let lastDecision: DecisionInfo = { text: 'Cruising: lane clear', severity: 'go' };
type StackProfile = 'tesla' | 'waymo' | 'waabi';
type CameraMode = 'chase' | 'hood' | 'bev' | 'orbit';
type QualityLevel = 'low' | 'med' | 'high';

const INFO_CARDS: Record<StackProfile, {
  name: string;
  sensors: string;
  internals: string;
  strengths: string;
  weaknesses: string;
  example: string;
}> = {
  tesla: TESLA_INFO_CARD,
  waymo: WAYMO_INFO_CARD,
  waabi: WAABI_INFO_CARD,
};

const QUALITY: Record<QualityLevel, {
  pixelRatio: number;
  far: number;
  lidar: LidarConfig;
  lidarEveryN: number;
  shadows: boolean;
  fogFar: number;
}> = {
  low: {
    pixelRatio: 1,
    far: 450,
    lidar: LIDAR_CONFIGS['qualityLow']!,
    lidarEveryN: 3,
    shadows: false,
    fogFar: 380,
  },
  med: {
    pixelRatio: 1.25,
    far: 600,
    lidar: LIDAR_CONFIGS['qualityMed'] ?? LIDAR_CONFIGS['browserLite']!,
    lidarEveryN: 2,
    shadows: false,
    fogFar: 500,
  },
  high: {
    pixelRatio: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1.5, 1.75),
    far: 600,
    lidar: LIDAR_CONFIGS['qualityHigh']!,
    lidarEveryN: 1,
    shadows: true,
    fogFar: 520,
  },
};

let simulation: Simulation;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let sunLight: THREE.DirectionalLight;
let cameraMode: CameraMode = 'chase';
let qualityLevel: QualityLevel = 'med';
let isRecording = false;
let showGroundTruth = false;
let showAIView = true;
let showInfoCard = false;
let isPaused = false;
let currentStack: StackProfile = 'tesla';
let compareMode = false;
let driveHintShown = false;
let lastHudMs = 0;
let lastAiViewMs = 0;
let lastCollisionCount = 0;
let collisionFlashUntil = 0;
let shadowMode = false;

let orbitYaw = 0.35;
let orbitPitch = 0.38;
let orbitDist = 22;
let pointerDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

const CAMERA_LAG = 0.12;
const SIM_DT = 1 / 30;
let simAccumulator = 0;
let camFollowReady = false;
let camYaw = Math.PI / 2;
let camLookX = 0;
let camLookY = 0;
let camPosX = 0;
let camPosY = 8;
let camPosZ = 18;
let prevEgoX = 0;
let prevEgoY = 0;
let prevEgoYaw = Math.PI / 2;
let currEgoX = 0;
let currEgoY = 0;
let currEgoYaw = Math.PI / 2;
let rawCameraFrame = 0;
let staticCityMeshes: THREE.Object3D[] = [];

let compareRenderer: THREE.WebGLRenderer | null = null;
let leftRenderer: THREE.WebGLRenderer | null = null;
let compareCamera: THREE.PerspectiveCamera | null = null;
let compareStack: StackProfile = 'waymo';

interface DetectionTiming {
  entityId: number;
  classType: string;
  firstDetectedByLeft: number | null;
  firstDetectedByRight: number | null;
}
const detectionTimings: Map<number, DetectionTiming> = new Map();
const visionFirstSeen: Map<number, number> = new Map();
let compareStartTime = 0;
let latestVisionDetections: VisionDetection[] = [];

const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
};

let egoMesh: THREE.Mesh;
const entityMeshes = new Map<number, THREE.Mesh>();
const detectionMeshes: THREE.Mesh[] = [];
let groundMesh: THREE.Mesh;
let bevOverlayEnabled = false;

// Initialize Three.js
function initThreeJS() {
  const container = document.getElementById('canvas-container')!;
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(QUALITY[qualityLevel].pixelRatio);
  renderer.shadowMap.enabled = QUALITY[qualityLevel].shadows;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.outline = 'none';
  container.appendChild(renderer.domElement);
  renderer.domElement.focus();
  
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky blue
  scene.fog = new THREE.Fog(0x87ceeb, 80, 500);
  
  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, QUALITY[qualityLevel].far);
  camera.position.set(0, -10, 8);
  camera.lookAt(0, 0, 0);
  
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);
  
  sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.position.set(100, 100, 100);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 500;
  sunLight.shadow.camera.left = -200;
  sunLight.shadow.camera.right = 200;
  sunLight.shadow.camera.top = 200;
  sunLight.shadow.camera.bottom = -200;
  scene.add(sunLight);
  
  // Ground - grass/terrain base
  const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
  groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  
  // Build proper city roads, sidewalks, crosswalks
  buildCityRoads();
  
  // Ego vehicle
  const egoGeometry = new THREE.BoxGeometry(4.5, 1.8, 1.5);
  const egoMaterial = new THREE.MeshLambertMaterial({ color: 0x0066cc });
  egoMesh = new THREE.Mesh(egoGeometry, egoMaterial);
  egoMesh.castShadow = true;
  egoMesh.position.y = 0.75;
  scene.add(egoMesh);
  
  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// City road infrastructure meshes
let cityRoadMeshes: THREE.Object3D[] = [];

function addInstanced(
  geom: THREE.BufferGeometry,
  mat: THREE.Material,
  transforms: Array<{ x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; ry?: number }>
) {
  if (transforms.length === 0) return;
  const mesh = new THREE.InstancedMesh(geom, mat, transforms.length);
  mesh.frustumCulled = true;
  const dummy = new THREE.Object3D();
  transforms.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.ry ?? 0, 0);
    dummy.scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  cityRoadMeshes.push(mesh);
}

function buildCityRoads() {
  for (const mesh of cityRoadMeshes) scene.remove(mesh);
  cityRoadMeshes = [];

  const gridSize = 6;
  const blockSize = 100;
  const roadWidth = 14;
  const sidewalkWidth = 3;
  const halfSize = (gridSize * blockSize) / 2;

  const asphaltMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a});
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0});
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x555555});
  const yellowMat = new THREE.MeshLambertMaterial({ color: 0xffee66});
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff});
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333});
  const glowMat = new THREE.MeshLambertMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 0.4 });

  // Full-length asphalt + sidewalks + curbs as shared meshes (few draw calls)
  for (let i = 0; i <= gridSize; i++) {
    const pos = -halfSize + i * blockSize;
    const nsRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, gridSize * blockSize), asphaltMat);
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.set(pos, 0.01, 0);
    nsRoad.receiveShadow = true;
    scene.add(nsRoad);
    cityRoadMeshes.push(nsRoad);

    const ewRoad = new THREE.Mesh(new THREE.PlaneGeometry(gridSize * blockSize, roadWidth), asphaltMat);
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.position.set(0, 0.01, -pos);
    ewRoad.receiveShadow = true;
    scene.add(ewRoad);
    cityRoadMeshes.push(ewRoad);

    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(sidewalkWidth, 0.15, gridSize * blockSize), sidewalkMat);
      sw.position.set(pos + side * (roadWidth / 2 + sidewalkWidth / 2), 0.075, 0);
      scene.add(sw);
      cityRoadMeshes.push(sw);

      const swE = new THREE.Mesh(new THREE.BoxGeometry(gridSize * blockSize, 0.15, sidewalkWidth), sidewalkMat);
      swE.position.set(0, 0.075, -pos + side * (roadWidth / 2 + sidewalkWidth / 2));
      scene.add(swE);
      cityRoadMeshes.push(swE);

      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, gridSize * blockSize), curbMat);
      curb.position.set(pos + side * (roadWidth / 2), 0.1, 0);
      scene.add(curb);
      cityRoadMeshes.push(curb);
    }
  }

  const dashX: Array<{ x: number; y: number; z: number; ry?: number }> = [];
  const dashZ: Array<{ x: number; y: number; z: number; ry?: number }> = [];
  const cross: Array<{ x: number; y: number; z: number; ry?: number }> = [];
  const poles: Array<{ x: number; y: number; z: number }> = [];
  const lamps: Array<{ x: number; y: number; z: number }> = [];

  for (let i = 0; i <= gridSize; i++) {
    const pos = -halfSize + i * blockSize;
    for (let j = 0; j < gridSize; j++) {
      const start = -halfSize + j * blockSize + 12;
      for (let k = 0; k < blockSize - 24; k += 6) {
        dashX.push({ x: pos, y: 0.03, z: -(start + k) });
        dashZ.push({ x: start + k, y: 0.03, z: -pos, ry: Math.PI / 2 });
      }
    }
  }

  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const x = -halfSize + i * blockSize;
      const z = halfSize - j * blockSize;
      for (let s = -3; s <= 3; s++) {
        cross.push({ x: x + s * 0.9, y: 0.03, z: z + roadWidth / 2 + 2.2 });
        cross.push({ x: x + s * 0.9, y: 0.03, z: z - roadWidth / 2 - 2.2 });
        cross.push({ x: x + roadWidth / 2 + 2.2, y: 0.03, z: z + s * 0.9, ry: Math.PI / 2 });
        cross.push({ x: x - roadWidth / 2 - 2.2, y: 0.03, z: z + s * 0.9, ry: Math.PI / 2 });
      }
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        poles.push({ x: x + dx * (roadWidth / 2 + 2), y: 3, z: z + dz * (roadWidth / 2 + 2) });
        lamps.push({ x: x + dx * (roadWidth / 2 + 2), y: 6, z: z + dz * (roadWidth / 2 + 2) });
      }
    }
  }

  addInstanced(new THREE.BoxGeometry(0.18, 0.02, 3.2), yellowMat, [...dashX, ...dashZ]);
  addInstanced(new THREE.BoxGeometry(0.5, 0.02, 3.5), whiteMat, cross);
  addInstanced(new THREE.CylinderGeometry(0.1, 0.14, 6, 6), poleMat, poles);
  addInstanced(new THREE.BoxGeometry(0.4, 0.15, 0.4), glowMat, lamps);

  console.log(`Built city roads: ${cityRoadMeshes.length} objects (instanced markings)`);
}

// Create mesh for entity with proper styling
function createEntityMesh(classType: string, entity?: { boundingBox: { size: { x: number; y: number; z: number } } }): THREE.Mesh | THREE.Group {
  switch (classType) {
    case 'car': {
      // Create a more detailed car mesh
      const group = new THREE.Group();
      
      // Body
      const bodyGeo = new THREE.BoxGeometry(4.2, 1.2, 1.6);
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3366cc});
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.6;
      body.castShadow = true;
      group.add(body);
      
      // Cabin
      const cabinGeo = new THREE.BoxGeometry(2.2, 0.8, 1.4);
      const cabinMat = new THREE.MeshLambertMaterial({ color: 0x222222});
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(-0.3, 1.3, 0);
      cabin.castShadow = true;
      group.add(cabin);
      
      // Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16);
      const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
      const wheelPositions: [number, number, number][] = [[1.2, 0.35, 0.8], [1.2, 0.35, -0.8], [-1.2, 0.35, 0.8], [-1.2, 0.35, -0.8]];
      for (const [wx, wy, wz] of wheelPositions) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(wx, wy, wz);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      }
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'truck': {
      const group = new THREE.Group();
      
      // Cab
      const cabGeo = new THREE.BoxGeometry(3, 2.2, 2.4);
      const cabMat = new THREE.MeshLambertMaterial({ color: 0xcc6633});
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(2.5, 1.3, 0);
      cab.castShadow = true;
      group.add(cab);
      
      // Trailer
      const trailerGeo = new THREE.BoxGeometry(7, 2.8, 2.4);
      const trailerMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
      const trailer = new THREE.Mesh(trailerGeo, trailerMat);
      trailer.position.set(-1.5, 1.6, 0);
      trailer.castShadow = true;
      group.add(trailer);
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'pedestrian': {
      const group = new THREE.Group();
      const colors = [0xff6600, 0x00cc66, 0x6600cc, 0xcc0066, 0xffcc00, 0x3399ff];
      const bodyMat = new THREE.MeshLambertMaterial({ color: colors[Math.floor(Math.random() * colors.length)] });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 4, 6), bodyMat);
      body.position.y = 1.0;
      body.castShadow = false;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshLambertMaterial({ color: 0xffcc99 }));
      head.position.y = 1.7;
      group.add(head);
      return group as unknown as THREE.Mesh;
    }
    
    case 'building': {
      const group = new THREE.Group();
      const size = entity?.boundingBox.size ?? { x: 20, y: 20, z: 30 };
      
      // Main building body
      const buildingGeo = new THREE.BoxGeometry(size.x, size.z, size.y);
      const buildingColors = [0x606070, 0x707080, 0x556065, 0x4a5560, 0x505a60];
      const buildingMat = new THREE.MeshLambertMaterial({
        color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
      });
      const building = new THREE.Mesh(buildingGeo, buildingMat);
      building.position.y = size.z / 2;
      building.castShadow = false;
      building.receiveShadow = true;
      group.add(building);
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'tree': {
      const group = new THREE.Group();
      
      // Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 8);
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1;
      trunk.castShadow = true;
      group.add(trunk);
      
      // Foliage
      const foliageGeo = new THREE.ConeGeometry(2, 5, 8);
      const foliageMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.y = 4.5;
      foliage.castShadow = true;
      group.add(foliage);
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'pole': {
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 8, 8);
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4;
      pole.castShadow = true;
      return pole;
    }
    
    default: {
      const geometry = new THREE.BoxGeometry(2, 2, 2);
      const material = new THREE.MeshLambertMaterial({ color: 0x999999 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      return mesh;
    }
  }
}

// Create road network visualization
export function createRoads(worldMap: { lanes: Array<{ type?: string; points: Array<{ position: { x: number; y: number }; width: number }> }> }) {
  const roadGroup = new THREE.Group();
  
  // Road material
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333});
  const laneMat = new THREE.MeshLambertMaterial({ color: 0xffff00 });
  
  // Create road segments from lanes
  const processedRoads = new Set<string>();
  
  for (const lane of worldMap.lanes) {
    if (lane.type && lane.type !== 'driving') continue;
    if (lane.points.length < 2) continue;
    
    for (let i = 0; i < lane.points.length - 1; i++) {
      const p1 = lane.points[i]!;
      const p2 = lane.points[i + 1]!;
      
      const key = `${Math.round(p1.position.x)},${Math.round(p1.position.y)}-${Math.round(p2.position.x)},${Math.round(p2.position.y)}`;
      if (processedRoads.has(key)) continue;
      processedRoads.add(key);
      
      const dx = p2.position.x - p1.position.x;
      const dy = p2.position.y - p1.position.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 0.1) continue;
      
      const angle = Math.atan2(dy, dx);
      const midX = (p1.position.x + p2.position.x) / 2;
      const midY = (p1.position.y + p2.position.y) / 2;
      
      // Road surface
      const roadWidth = (p1.width ?? 3.5) * 4;
      const roadGeo = new THREE.PlaneGeometry(length, roadWidth);
      const road = new THREE.Mesh(roadGeo, roadMat);
      road.position.set(midX, 0.02, -midY);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -angle;
      road.receiveShadow = true;
      roadGroup.add(road);
      
      // Lane markings (dashed center line)
      if (i % 3 === 0) {
        const lineGeo = new THREE.PlaneGeometry(length * 0.6, 0.15);
        const line = new THREE.Mesh(lineGeo, laneMat);
        line.position.set(midX, 0.03, -midY);
        line.rotation.x = -Math.PI / 2;
        line.rotation.z = -angle;
        roadGroup.add(line);
      }
    }
  }
  
  return roadGroup;
}

function isMobileClass(classType: string): boolean {
  return classType === 'car' || classType === 'truck' || classType === 'bus'
    || classType === 'motorcycle' || classType === 'pedestrian' || classType === 'cyclist';
}

function rebuildStaticCity() {
  for (const mesh of staticCityMeshes) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  staticCityMeshes = [];
  const statics = simulation.getState().worldMap.staticEntities;
  const dummy = new THREE.Object3D();

  const buildings = statics.filter(e => e.classType === 'building');
  if (buildings.length > 0) {
    const colors = [0x606070, 0x707080, 0x556065, 0x4a5560, 0x505a60];
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x667077 }),
      buildings.length
    );
    mesh.frustumCulled = true;
    buildings.forEach((b, i) => {
      dummy.position.set(b.transform.position.x, b.boundingBox.size.z / 2, -b.transform.position.y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.boundingBox.size.x, b.boundingBox.size.z, b.boundingBox.size.y);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]!));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    staticCityMeshes.push(mesh);
  }

  const trees = statics.filter(e => e.classType === 'tree');
  if (trees.length > 0) {
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.32, 2, 6),
      new THREE.MeshLambertMaterial({ color: 0x4a3728 }),
      trees.length
    );
    const foliage = new THREE.InstancedMesh(
      new THREE.ConeGeometry(2, 5, 7),
      new THREE.MeshLambertMaterial({ color: 0x228b22 }),
      trees.length
    );
    trees.forEach((t, i) => {
      dummy.position.set(t.transform.position.x, 1, -t.transform.position.y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.transform.position.x, 4.5, -t.transform.position.y);
      dummy.updateMatrix();
      foliage.setMatrixAt(i, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    scene.add(trunks);
    scene.add(foliage);
    staticCityMeshes.push(trunks, foliage);
  }

  const poles = statics.filter(e => e.classType === 'pole');
  if (poles.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.1, 0.1, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x444444 }),
      poles.length
    );
    poles.forEach((po, i) => {
      dummy.position.set(po.transform.position.x, 4, -po.transform.position.y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    staticCityMeshes.push(mesh);
  }
}

function updateEntityMeshes() {
  const state = simulation.getState();
  const mobiles = [
    ...state.trafficVehicles,
    ...state.pedestrians,
    ...state.worldMap.staticEntities.filter(e => isMobileClass(e.classType)),
  ];
  const presentIds = new Set(mobiles.map(e => e.id));

  for (const [id, mesh] of entityMeshes) {
    if (!presentIds.has(id)) {
      scene.remove(mesh);
      entityMeshes.delete(id);
    }
  }

  for (const entity of mobiles) {
    let mesh = entityMeshes.get(entity.id);
    if (!mesh) {
      mesh = createEntityMesh(entity.classType, entity) as THREE.Mesh;
      scene.add(mesh);
      entityMeshes.set(entity.id, mesh);
    }
    mesh.position.set(entity.transform.position.x, 0, -entity.transform.position.y);
    const isVehicle = entity.classType === 'car' || entity.classType === 'truck'
      || entity.classType === 'bus' || entity.classType === 'motorcycle';
    mesh.rotation.y = -entity.transform.rotation + (isVehicle ? Math.PI : 0);
  }
}


// Detection box colors by class
const DETECTION_COLORS: Record<string, number> = {
  car: 0x00ff00,
  truck: 0x00cc00,
  bus: 0x00aa00,
  pedestrian: 0xff00ff,
  cyclist: 0x00ffff,
  motorcycle: 0xffff00,
  default: 0x00ff00,
};

const boxPool: THREE.LineSegments[] = [];
const unitBoxGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function acquireBox(color: number): THREE.LineSegments {
  const existing = boxPool.pop();
  if (existing) {
    (existing.material as THREE.LineBasicMaterial).color.setHex(color);
    existing.visible = true;
    return existing;
  }
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
  const line = new THREE.LineSegments(unitBoxGeom, mat);
  scene.add(line);
  return line;
}

function recycleBox(mesh: THREE.LineSegments) {
  mesh.visible = false;
  boxPool.push(mesh);
}

function placeWorldBox(
  mesh: THREE.LineSegments,
  center: { x: number; y: number; z: number },
  size: { x: number; y: number; z: number },
  yaw: number
) {
  const sx = Math.max(size.x, 0.6);
  const sy = Math.max(size.y, 0.6);
  const sz = Math.max(size.z, 0.8);
  mesh.position.set(center.x, Math.max(center.z, sz / 2), -center.y);
  mesh.scale.set(sx, sz, sy);
  mesh.rotation.y = -yaw;
}

function trackBoxInWorld(det: { box: { center: { x: number; y: number; z: number }; size: { x: number; y: number; z: number }; yaw: number } }, ego: { transform: { position: { x: number; y: number; z: number }; rotation: number } }) {
  const world = egoToWorld(det.box.center, ego.transform.position, ego.transform.rotation);
  return {
    center: world,
    size: det.box.size,
    yaw: det.box.yaw + ego.transform.rotation,
  };
}

// Update detection visualization
function updateDetectionMeshes() {
  for (const mesh of detectionMeshes) {
    recycleBox(mesh as unknown as THREE.LineSegments);
  }
  detectionMeshes.length = 0;
  
  const state = simulation.getState();
  const detections = state.perceptionTracks.filter(t => t.missedFrames === 0);
  const groundTruth = [...state.trafficVehicles, ...state.pedestrians];
  
  for (const det of detections) {
    const world = trackBoxInWorld(det, state.ego);
    const boxColor = DETECTION_COLORS[det.classType] ?? DETECTION_COLORS.default ?? 0x00ff00;
    const mesh = acquireBox(boxColor);
    placeWorldBox(mesh, world.center, world.size, world.yaw);
    detectionMeshes.push(mesh as unknown as THREE.Mesh);
  }
  
  // Always also draw a class-colored box on nearby GT so boxes are visible
  // even when the lidar tracker is still warming up.
  for (const gt of groundTruth) {
    const dx = gt.boundingBox.center.x - state.ego.transform.position.x;
    const dy = gt.boundingBox.center.y - state.ego.transform.position.y;
    if (dx * dx + dy * dy > 80 * 80) continue;
    
    let covered = false;
    for (const det of detections) {
      const world = trackBoxInWorld(det, state.ego);
      const ddx = world.center.x - gt.boundingBox.center.x;
      const ddy = world.center.y - gt.boundingBox.center.y;
      if (ddx * ddx + ddy * ddy < 4) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    
    const color = showGroundTruth ? 0xff0000 : (DETECTION_COLORS[gt.classType] ?? 0x00ff00);
    const mesh = acquireBox(color);
    placeWorldBox(mesh, gt.boundingBox.center, gt.boundingBox.size, gt.boundingBox.yaw);
    detectionMeshes.push(mesh as unknown as THREE.Mesh);
  }

  if (showGroundTruth) {
    for (const det of detections) {
      const world = trackBoxInWorld(det, state.ego);
      const hit = groundTruth.some(gt => {
        const dx = world.center.x - gt.boundingBox.center.x;
        const dy = world.center.y - gt.boundingBox.center.y;
        return dx * dx + dy * dy < 9;
      });
      if (!hit) {
        const mesh = acquireBox(0xff8800);
        placeWorldBox(mesh, world.center, world.size, world.yaw);
        detectionMeshes.push(mesh as unknown as THREE.Mesh);
      }
    }
  }
}

function damp(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
}

function dampAngle(current: number, target: number, dt: number, tau: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-dt / Math.max(0.001, tau)));
}

function captureEgoPose() {
  const ego = simulation.getState().ego;
  currEgoX = ego.transform.position.x;
  currEgoY = ego.transform.position.y;
  currEgoYaw = ego.transform.rotation;
}

function resetCameraRig() {
  orbitYaw = cameraMode === 'orbit' ? 0.6 : 0;
  orbitPitch = cameraMode === 'orbit' ? 0.42 : 0.32;
  orbitDist = cameraMode === 'orbit' ? 28 : 22;
  camFollowReady = false;
}

function interpolatedEgo(alpha: number) {
  let dyaw = currEgoYaw - prevEgoYaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  return {
    x: prevEgoX + (currEgoX - prevEgoX) * alpha,
    y: prevEgoY + (currEgoY - prevEgoY) * alpha,
    yaw: prevEgoYaw + dyaw * alpha,
  };
}

function updateCamera(dt: number, egoX: number, egoY: number, egoYaw: number) {
  let targetYaw = egoYaw;
  let targetLookX = egoX;
  let targetLookY = egoY;
  let targetPosX = egoX;
  let targetPosY = 8;
  let targetPosZ = -egoY;
  const tau = cameraMode === 'hood' ? 0.06 : CAMERA_LAG;

  if (cameraMode === 'chase') {
    targetYaw = egoYaw + Math.PI + orbitYaw * 0.35;
    const dist = orbitDist;
    targetPosX = egoX + Math.cos(targetYaw) * dist;
    targetPosY = 3 + orbitPitch * 12;
    targetPosZ = -(egoY + Math.sin(targetYaw) * dist);
  } else if (cameraMode === 'hood') {
    targetYaw = egoYaw;
    targetPosX = egoX + Math.cos(egoYaw) * 1.4;
    targetPosY = 1.25;
    targetPosZ = -(egoY + Math.sin(egoYaw) * 1.4);
    targetLookX = egoX + Math.cos(egoYaw) * 18;
    targetLookY = egoY + Math.sin(egoYaw) * 18;
  } else if (cameraMode === 'bev') {
    targetPosX = egoX;
    targetPosY = 95;
    targetPosZ = -egoY + 0.01;
  } else {
    targetYaw = orbitYaw;
    const pitch = orbitPitch;
    const dist = orbitDist;
    targetPosX = egoX + Math.sin(orbitYaw) * Math.cos(pitch) * dist;
    targetPosY = Math.sin(pitch) * dist + 4;
    targetPosZ = -egoY + Math.cos(orbitYaw) * Math.cos(pitch) * dist;
  }

  if (!camFollowReady) {
    camYaw = targetYaw;
    camLookX = targetLookX;
    camLookY = targetLookY;
    camPosX = targetPosX;
    camPosY = targetPosY;
    camPosZ = targetPosZ;
    camFollowReady = true;
  } else {
    camYaw = dampAngle(camYaw, targetYaw, dt, tau);
    camLookX = damp(camLookX, targetLookX, dt, tau);
    camLookY = damp(camLookY, targetLookY, dt, tau);
    camPosX = damp(camPosX, targetPosX, dt, tau);
    camPosY = damp(camPosY, targetPosY, dt, tau);
    camPosZ = damp(camPosZ, targetPosZ, dt, tau);
  }

  if (cameraMode === 'chase') {
    camPosX = camLookX + Math.cos(camYaw) * orbitDist;
    camPosY = 3 + orbitPitch * 12;
    camPosZ = -(camLookY + Math.sin(camYaw) * orbitDist);
  }

  camera.position.set(camPosX, camPosY, camPosZ);
  const lookZ = cameraMode === 'bev' ? 0 : cameraMode === 'hood' ? 1.0 : 1.2;
  camera.lookAt(camLookX, lookZ, -camLookY);
}

function isManual(): boolean {
  return simulation.getState().controlSource === 'human';
}

function syncDriveBadge() {
  const badge = document.getElementById('drive-badge');
  const control = document.getElementById('control-source');
  const manual = isManual();
  if (badge) {
    badge.textContent = manual ? 'MANUAL' : 'AUTOPILOT';
    badge.classList.toggle('manual', manual);
  }
  if (control) {
    control.textContent = manual ? 'MANUAL' : 'AUTOPILOT';
    control.className = 'status-value' + (manual ? ' status-warning' : '');
  }
}

function showDriveHintOnce() {
  if (driveHintShown) return;
  driveHintShown = true;
  const hint = document.getElementById('drive-hint');
  if (!hint) return;
  hint.classList.add('visible');
  window.setTimeout(() => hint.classList.remove('visible'), 7000);
}

function setPaused(paused: boolean) {
  isPaused = paused;
  document.getElementById('pause-overlay')?.classList.toggle('visible', paused);
}

function togglePause() {
  setPaused(!isPaused);
}

function setCameraMode(mode: CameraMode) {
  cameraMode = mode;
  resetCameraRig();
  document.querySelectorAll('#camera-seg button').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset['camera'] === mode);
  });
}

function applyQuality(level: QualityLevel) {
  qualityLevel = level;
  const q = QUALITY[level];
  renderer.setPixelRatio(q.pixelRatio);
  renderer.shadowMap.enabled = q.shadows;
  camera.far = q.far;
  camera.updateProjectionMatrix();
  sunLight.castShadow = q.shadows;
  if (scene.fog instanceof THREE.Fog) scene.fog.far = q.fogFar;
  simulation.setLidarQuality(q.lidar, q.lidarEveryN);
  document.querySelectorAll('#quality-seg button').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset['quality'] === level);
  });
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else if (mat) mat.dispose();
  });
}

function restartSim() {
  for (const mesh of entityMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  entityMeshes.clear();
  for (const mesh of detectionMeshes) {
    recycleBox(mesh as unknown as THREE.LineSegments);
  }
  detectionMeshes.length = 0;
  lastCollisionCount = 0;
  collisionFlashUntil = 0;
  latestVisionDetections = [];
  detectionTimings.clear();
  visionFirstSeen.clear();
  simulation.restart();
  rebuildStaticCity();
  captureEgoPose();
  prevEgoX = currEgoX;
  prevEgoY = currEgoY;
  prevEgoYaw = currEgoYaw;
  applyQuality(qualityLevel);
  resetCameraRig();
  setPaused(false);
  syncDriveBadge();
  showDriveHintOnce();
}

function anyDriveHeld(): boolean {
  return inputState.forward || inputState.backward || inputState.left || inputState.right || inputState.brake;
}

function humanInputFromKeys() {
  return {
    throttle: inputState.forward ? 1 : inputState.backward ? -0.6 : 0,
    steering: inputState.left ? -1 : inputState.right ? 1 : 0,
    brake: inputState.brake ? 1 : 0,
  };
}

function takeManual(auto = false) {
  if (!isManual()) {
    simulation.takeover('other');
    if (!auto) showDriveHintOnce();
  }
  syncDriveBadge();
}

function setAutopilot(on: boolean) {
  if (on) simulation.releaseControl();
  else takeManual();
  syncDriveBadge();
}

function updateHUD() {
  const state = simulation.getState();
  const speed = vec3Length(state.ego.velocity) * 3.6;

  document.getElementById('speed-value')!.textContent = `${Math.round(speed)} km/h`;
  document.getElementById('stopping-dist')!.textContent = `${Math.round(state.ego.stoppingDistance)} m`;
  document.getElementById('detection-count')!.textContent =
    String(state.perceptionTracks.filter(t => t.missedFrames === 0).length);
  const colEl = document.getElementById('collision-count');
  if (colEl) {
    colEl.textContent = String(state.collisionCount);
    colEl.className = 'status-value' + (state.collisionCount > 0 ? ' status-danger' : '');
  }

  if (state.collisionCount > lastCollisionCount) {
    lastCollisionCount = state.collisionCount;
    collisionFlashUntil = performance.now() + 1400;
  }
  const flash = document.getElementById('collision-flash');
  if (flash) flash.classList.toggle('visible', performance.now() < collisionFlashUntil);

  const weatherText = state.environment.weather.charAt(0).toUpperCase() +
    state.environment.weather.slice(1) +
    (state.environment.timeOfDay === 'night' ? ' (Night)' : '');
  const fpsEl = document.getElementById('fps-value');
  if (fpsEl) fpsEl.textContent = String(displayFps);
  document.getElementById('weather-status')!.textContent = weatherText;
  const weatherEl = document.getElementById('weather-status')!;
  weatherEl.className = 'status-value';
  if (state.environment.weather !== 'clear') weatherEl.classList.add('status-warning');
  syncDriveBadge();
}

function updateInfoCard() {
  const card = INFO_CARDS[currentStack];
  document.getElementById('info-title')!.textContent = card.name;
  document.getElementById('info-sensors')!.textContent = card.sensors;
  document.getElementById('info-internals')!.textContent = card.internals;
  document.getElementById('info-strengths')!.textContent = card.strengths;
  document.getElementById('info-weaknesses')!.textContent = card.weaknesses;
  document.getElementById('info-example')!.textContent = card.example;
}

function switchStack(profile: StackProfile) {
  if (profile === currentStack) return;
  currentStack = profile;
  document.querySelectorAll('.view-btn').forEach(btn => {
    const btnProfile = (btn as HTMLElement).dataset['profile'] as StackProfile;
    btn.classList.toggle('active', btnProfile === profile);
  });
  if (showInfoCard) updateInfoCard();
  updateOverlaysForStack(profile);
  console.log(`Switched to stack: ${profile}`);
}

function updateOverlaysForStack(profile: StackProfile) {
  bevOverlayEnabled = profile === 'waabi';
  const bevHud = document.getElementById('bev-overlay');
  if (bevHud) bevHud.classList.toggle('visible', bevOverlayEnabled);
}

// Render BEV occupancy heatmaps for Waabi
function renderBEVHeatmaps() {
  if (!bevOverlayEnabled) return;
  
  const canvas = document.getElementById('bev-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d')!;
  const state = simulation.getState();
  
  // Run Waabi stack to get real occupancy and trajectories
  const entities = [
    ...state.worldMap.staticEntities,
    ...state.trafficVehicles,
    ...state.pedestrians,
  ];
  
  const waabiResult = runWaabiStack(
    state.ego,
    entities,
    state.environment,
    waabiState,
    state.timestamp,
    42,
    10
  );
  waabiState = waabiResult.newState;
  
  // Clear canvas
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const cellWidth = canvas.width / 4;
  const cellHeight = canvas.height / 2;
  
  // Draw 4 occupancy grids: current, +1s, +2s, +3s
  const grids = [
    { occ: waabiResult.occupancy.current, label: 'Current', x: 0, y: 0 },
    { occ: waabiResult.occupancy.t1s, label: '+1s', x: cellWidth, y: 0 },
    { occ: waabiResult.occupancy.t2s, label: '+2s', x: cellWidth * 2, y: 0 },
    { occ: waabiResult.occupancy.t3s, label: '+3s', x: cellWidth * 3, y: 0 },
  ];
  
  grids.forEach(({ occ, label, x, y }, i) => {
    // Draw grid background/border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, cellWidth - 4, cellHeight - 22);
    
    ctx.fillStyle = '#12182a';
    ctx.fillRect(x + 2, y + 2, cellWidth - 6, cellHeight - 24);
    renderOccupancyGrid(ctx, occ, x + 2, y + 2, cellWidth - 6, cellHeight - 24);
    
    // Draw label
    ctx.fillStyle = i === 0 ? '#00ffff' : '#888';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + cellWidth / 2, y + cellHeight - 5);
  });
  
  // Draw trajectory fan in bottom half
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height - 20);
  ctx.scale(3, -3); // Scale and flip Y
  
  // Draw all candidate trajectories
  waabiResult.trajectories.forEach((traj, i) => {
    const isSelected = i === waabiState.selectedTrajectoryIndex;
    ctx.strokeStyle = isSelected ? '#00ff00' : '#ff6600';
    ctx.lineWidth = isSelected ? 0.5 : 0.2;
    ctx.globalAlpha = isSelected ? 1 : 0.5;
    
    ctx.beginPath();
    traj.points.forEach((pt, j) => {
      const dx = pt.position.x - state.ego.transform.position.x;
      const dy = pt.position.y - state.ego.transform.position.y;
      if (j === 0) ctx.moveTo(dx, dy);
      else ctx.lineTo(dx, dy);
    });
    ctx.stroke();
    
    // Show cost on selected trajectory
    if (isSelected && traj.points.length > 0) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#00ff00';
      ctx.font = '3px Arial';
      const lastPt = traj.points[traj.points.length - 1]!;
      const dx = lastPt.position.x - state.ego.transform.position.x;
      const dy = lastPt.position.y - state.ego.transform.position.y;
      ctx.fillText(`Cost: ${traj.cost.toFixed(1)}`, dx + 1, dy);
    }
  });
  
  ctx.globalAlpha = 1;
  ctx.restore();
  
  // Update Sim World table
  updateSimWorldTable(waabiState.simWorld.variants);
}

// Render a single occupancy grid
function renderOccupancyGrid(
  ctx: CanvasRenderingContext2D,
  occ: BEVOccupancy,
  x: number, y: number,
  width: number, height: number
) {
  if (occ.grid.length === 0) return;
  
  const gridSize = Math.sqrt(occ.grid.length);
  const cellW = width / gridSize;
  const cellH = height / gridSize;
  
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const value = occ.grid[gy * gridSize + gx] || 0;
      if (value > 0.01) {
        // Heatmap color: blue (low) -> red (high)
        const r = Math.min(255, Math.floor(value * 255 * 2));
        const g = Math.max(0, Math.min(255, Math.floor((1 - value) * 255)));
        const b = Math.max(0, 150 - Math.floor(value * 150));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(
          x + gx * cellW,
          y + (gridSize - gy - 1) * cellH,
          Math.max(cellW + 0.8, 3),
          Math.max(cellH + 0.8, 3)
        );
      }
    }
  }
  
  // Draw ego marker at center
  ctx.fillStyle = '#00ffff';
  ctx.beginPath();
  ctx.arc(x + width / 2, y + height / 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

// Update Sim World adversarial variants table
function updateSimWorldTable(variants: AdversarialVariant[]) {
  const tbody = document.getElementById('simworld-variants');
  const statsEl = document.getElementById('simworld-stats');
  if (!tbody || !statsEl) return;
  
  // Clear existing rows
  tbody.innerHTML = '';
  
  // Ensure we have at least 20 variants for display
  const displayVariants = variants.length >= 20 ? variants : generateDisplayVariants(variants);
  
  // Count pass/fail
  let passCount = 0;
  let failCount = 0;
  
  displayVariants.forEach(v => {
    if (v.result === 'pass') passCount++;
    else if (v.result === 'fail') failCount++;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="padding: 2px 4px; color: #aaa;">${v.id.slice(0, 10)}</td>
      <td style="padding: 2px 4px; text-align: center; color: #888;">${v.perturbations[0]?.type || 'mixed'}</td>
      <td style="padding: 2px 4px; text-align: center;">
        <span style="color: ${v.result === 'pass' ? '#00ff88' : v.result === 'fail' ? '#ff4444' : '#888'};">
          ${v.result === 'pass' ? '✓' : v.result === 'fail' ? '✗' : '?'}
        </span>
      </td>
      <td style="padding: 2px 4px; text-align: right; color: ${v.metrics && v.metrics.minTTC < 2 ? '#ffaa00' : '#888'};">
        ${v.metrics ? v.metrics.minTTC.toFixed(1) + 's' : '-'}
      </td>
    `;
    tbody.appendChild(row);
  });
  
  statsEl.textContent = `${displayVariants.length} variants: ${passCount} pass, ${failCount} fail`;
}

// Generate display variants when we don't have enough from simulation
function generateDisplayVariants(existingVariants: AdversarialVariant[]): AdversarialVariant[] {
  const result = [...existingVariants];
  const types: Array<'timing' | 'speed' | 'path'> = ['timing', 'speed', 'path'];
  
  while (result.length < 20) {
    const i = result.length;
    const pertType = types[i % 3];
    const isPassing = Math.random() > 0.15; // 15% failure rate
    
    result.push({
      id: `variant_${i.toString().padStart(2, '0')}`,
      description: `${pertType} perturbation`,
      perturbations: [{
        actorId: 1000 + i,
        type: pertType!,
        delta: (Math.random() - 0.5) * 0.5,
      }],
      result: isPassing ? 'pass' : 'fail',
      metrics: {
        minTTC: isPassing ? 1.5 + Math.random() * 3 : 0.5 + Math.random() * 0.8,
        maxDecel: isPassing ? 2 + Math.random() * 3 : 6 + Math.random() * 2,
        hadCollision: !isPassing && Math.random() > 0.5,
      },
    });
  }
  
  return result;
}

// Initialize compare mode renderers
function initCompareMode() {
  const leftCanvas = document.getElementById('compare-canvas-left') as HTMLCanvasElement;
  const rightCanvas = document.getElementById('compare-canvas-right') as HTMLCanvasElement;
  
  if (!leftCanvas || !rightCanvas) return;
  
  // Set canvas sizes
  const width = window.innerWidth / 2;
  const height = window.innerHeight;
  
  leftCanvas.width = width;
  leftCanvas.height = height;
  rightCanvas.width = width;
  rightCanvas.height = height;
  
  // Create left renderer (for main/Tesla view)
  if (leftRenderer) {
    leftRenderer.dispose();
  }
  leftRenderer = new THREE.WebGLRenderer({ canvas: leftCanvas, antialias: true });
  leftRenderer.setSize(width, height);
  leftRenderer.setClearColor(0x1a1a2e);
  
  // Create right renderer (for compare/Waymo view)
  if (compareRenderer) {
    compareRenderer.dispose();
  }
  compareRenderer = new THREE.WebGLRenderer({ canvas: rightCanvas, antialias: true });
  compareRenderer.setSize(width, height);
  compareRenderer.setClearColor(0x87ceeb);
  
  // Create compare camera (shares position with main camera)
  compareCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  
  // Reset timing tracking
  detectionTimings.clear();
  visionFirstSeen.clear();
  compareStartTime = performance.now();
}

// Update compare mode with detection timing differences
// Visualization objects for compare mode
let teslaVoxelGroup: THREE.Group | null = null;
let waymoPointCloudGroup: THREE.Group | null = null;
let waymoFusedBoxGroup: THREE.Group | null = null;

function updateCompareMode() {
  if (!compareMode) return;
  
  const state = simulation.getState();
  const currentTime = (performance.now() - compareStartTime) / 1000;
  
  // Tesla pane: vision-only (camera FOV). Waymo pane: lidar-like fusion.
  const visibleAgents = [...state.trafficVehicles, ...state.pedestrians];
  const visionDets = detectVisibleAgents(state.ego, visibleAgents);
  latestVisionDetections = visionDets;
  
  const leftDetections = visionDets;
  const rightDetections = simulateAlternateStackDetections(state, compareStack);
  
  const groundTruth = visibleAgents;
  
  for (const gt of groundTruth) {
    let timing = detectionTimings.get(gt.id);
    if (!timing) {
      timing = {
        entityId: gt.id,
        classType: gt.classType,
        firstDetectedByLeft: null,
        firstDetectedByRight: null,
      };
      detectionTimings.set(gt.id, timing);
    }
    
    // Vision can be later/weaker than lidar, but not blind to in-FOV agents
    if (timing.firstDetectedByLeft === null) {
      const matched = leftDetections.find(d => d.entityId === gt.id);
      if (matched) {
        if (!visionFirstSeen.has(gt.id)) visionFirstSeen.set(gt.id, currentTime);
        if (currentTime - (visionFirstSeen.get(gt.id) ?? currentTime) >= 0.16) {
          timing.firstDetectedByLeft = currentTime;
        }
      }
    }
    
    // Check if right stack detected it
    if (timing.firstDetectedByRight === null) {
      const matched = rightDetections.find(d => {
        const dx = d.center.x - gt.boundingBox.center.x;
        const dy = d.center.y - gt.boundingBox.center.y;
        return Math.sqrt(dx*dx + dy*dy) < 2;
      });
      if (matched) {
        timing.firstDetectedByRight = currentTime;
      }
    }
  }
  
  // Update timing display
  updateCompareTimingDisplay(currentTime);
  
  // Update visual overlays
  updateTeslaVoxelVisualization(
    leftDetections.map(d => ({
      box: { center: d.center, size: d.size, yaw: 0 },
      confidence: d.confidence,
      worldFrame: true,
    })),
    state.ego
  );
  updateWaymoPointCloudVisualization(rightDetections, state.ego);
  
  // Render both compare views
  if (leftRenderer && compareCamera) {
    compareCamera.position.copy(camera.position);
    compareCamera.rotation.copy(camera.rotation);
    
    // Show Tesla visualization, hide Waymo
    if (teslaVoxelGroup) teslaVoxelGroup.visible = true;
    if (waymoPointCloudGroup) waymoPointCloudGroup.visible = false;
    if (waymoFusedBoxGroup) waymoFusedBoxGroup.visible = false;
    
    leftRenderer.render(scene, compareCamera);
  }
  
  if (compareRenderer && compareCamera) {
    // Show Waymo visualization, hide Tesla
    if (teslaVoxelGroup) teslaVoxelGroup.visible = false;
    if (waymoPointCloudGroup) waymoPointCloudGroup.visible = true;
    if (waymoFusedBoxGroup) waymoFusedBoxGroup.visible = true;
    
    compareRenderer.render(scene, compareCamera);
  }
  
  // Reset visualization visibility for main view
  if (teslaVoxelGroup) teslaVoxelGroup.visible = false;
  if (waymoPointCloudGroup) waymoPointCloudGroup.visible = false;
  if (waymoFusedBoxGroup) waymoFusedBoxGroup.visible = false;
}

// Tesla-style voxel visualization with depth jitter
function updateTeslaVoxelVisualization(detections: { box: { center: { x: number; y: number; z: number }; size: { x: number; y: number; z: number }; yaw: number }; confidence: number; worldFrame?: boolean }[], egoState: { transform: { position: { x: number; y: number; z: number }; rotation: number } }) {
  if (!teslaVoxelGroup) {
    teslaVoxelGroup = new THREE.Group();
    scene.add(teslaVoxelGroup);
  }
  
  const voxelGroup = teslaVoxelGroup;
  while (voxelGroup.children.length > 0) {
    voxelGroup.remove(voxelGroup.children[0]!);
  }
  
  const geom = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  detections.forEach(det => {
    const world = det.worldFrame
      ? det.box.center
      : egoToWorld(det.box.center, egoState.transform.position, egoState.transform.rotation);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.55 * det.confidence,
    });
    const nx = Math.min(4, Math.max(2, Math.ceil(det.box.size.x / 0.8)));
    const ny = Math.min(3, Math.max(2, Math.ceil(det.box.size.y / 0.8)));
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        const voxel = new THREE.Mesh(geom, material);
        const jitter = (Math.random() - 0.5) * (1 - det.confidence) * 1.2;
        voxel.position.set(
          world.x + (ix - nx / 2) * 0.6 + jitter,
          0.4 + (iy % 2) * 0.55,
          -world.y + (iy - ny / 2) * 0.6 + jitter
        );
        voxelGroup.add(voxel);
      }
    }
  });
}

// Waymo-style point cloud + fused boxes visualization
function updateWaymoPointCloudVisualization(detections: Array<{ center: { x: number; y: number }; classType: string }>, _egoState: { transform: { position: { x: number; y: number; z: number } } }) {
  if (!waymoPointCloudGroup) {
    waymoPointCloudGroup = new THREE.Group();
    scene.add(waymoPointCloudGroup);
  }
  if (!waymoFusedBoxGroup) {
    waymoFusedBoxGroup = new THREE.Group();
    scene.add(waymoFusedBoxGroup);
  }
  
  const pcGroup = waymoPointCloudGroup;
  const boxGroup = waymoFusedBoxGroup;
  
  // Clear previous
  while (pcGroup.children.length > 0) {
    pcGroup.remove(pcGroup.children[0]!);
  }
  while (boxGroup.children.length > 0) {
    boxGroup.remove(boxGroup.children[0]!);
  }
  
  // Create point cloud for detections
  const pointsGeometry = new THREE.BufferGeometry();
  const points: number[] = [];
  const colors: number[] = [];
  
  detections.forEach(det => {
    const boxSize = det.classType === 'pedestrian' 
      ? { x: 0.5, y: 0.5, z: 1.7 } 
      : { x: 4.5, y: 1.8, z: 1.5 };
    
    // Generate point cloud within box
    const numPoints = det.classType === 'pedestrian' ? 30 : 80;
    for (let i = 0; i < numPoints; i++) {
      const px = det.center.x + (Math.random() - 0.5) * boxSize.x;
      const py = det.center.y + (Math.random() - 0.5) * boxSize.y;
      const pz = Math.random() * boxSize.z;
      
      points.push(px, pz, -py);
      
      // Color based on height (blue low, green high)
      const heightRatio = pz / boxSize.z;
      colors.push(0.2, 0.5 + heightRatio * 0.5, 1 - heightRatio * 0.5);
    }
    
    // Create fused 3D box
    const boxGeo = new THREE.BoxGeometry(boxSize.x, boxSize.z, boxSize.y);
    const boxMat = new THREE.MeshBasicMaterial({
      color: det.classType === 'pedestrian' ? 0x00ff88 : 0xff8800,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(det.center.x, boxSize.z / 2, -det.center.y);
    boxGroup.add(box);
    
    // Add label
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 128;
    labelCanvas.height = 32;
    const ctx = labelCanvas.getContext('2d')!;
    ctx.fillStyle = det.classType === 'pedestrian' ? '#00ff88' : '#ff8800';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(det.classType.toUpperCase(), 64, 22);
    
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.SpriteMaterial({ map: labelTexture, transparent: true });
    const label = new THREE.Sprite(labelMat);
    label.position.set(det.center.x, boxSize.z + 0.5, -det.center.y);
    label.scale.set(2, 0.5, 1);
    boxGroup.add(label);
  });
  
  pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  
  const pointsMaterial = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
  });
  const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
  pcGroup.add(pointCloud);
}

// Simulate alternate stack with different detection characteristics
function simulateAlternateStackDetections(state: ReturnType<Simulation['getState']>, stack: StackProfile) {
  const groundTruth = [...state.trafficVehicles, ...state.pedestrians];
  const detections: Array<{center: {x: number; y: number}; classType: string}> = [];
  
  // Different stacks have different detection characteristics
  const detectionProbability = {
    tesla: { pedestrian: 0.85, car: 0.95 },
    waymo: { pedestrian: 0.95, car: 0.98 },
    waabi: { pedestrian: 0.90, car: 0.96 },
  };
  
  const distanceThreshold = {
    tesla: 60,
    waymo: 80,
    waabi: 70,
  };
  
  const probs = detectionProbability[stack];
  const maxDist = distanceThreshold[stack];
  const egoPos = state.ego.transform.position;
  
  for (const gt of groundTruth) {
    const dx = gt.transform.position.x - egoPos.x;
    const dy = gt.transform.position.y - egoPos.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    if (dist > maxDist) continue;
    
    const prob = gt.classType === 'pedestrian' ? probs.pedestrian : probs.car;
    const adjustedProb = prob * (1 - dist / maxDist * 0.3); // Decreases with distance
    
    if (Math.random() < adjustedProb) {
      detections.push({
        center: { x: gt.boundingBox.center.x, y: gt.boundingBox.center.y },
        classType: gt.classType,
      });
    }
  }
  
  return detections;
}

// Update the compare mode timing display
function updateCompareTimingDisplay(currentTime: number) {
  const leftTimingEl = document.getElementById('compare-left-timing');
  const rightTimingEl = document.getElementById('compare-right-timing');
  
  if (!leftTimingEl || !rightTimingEl) return;
  
  // Find most recent pedestrian and vehicle for display
  let recentPed: DetectionTiming | null = null;
  let recentVeh: DetectionTiming | null = null;
  
  for (const timing of detectionTimings.values()) {
    if (timing.classType === 'pedestrian') {
      if (!recentPed || (timing.firstDetectedByLeft !== null && 
          (recentPed.firstDetectedByLeft === null || 
           timing.firstDetectedByLeft > recentPed.firstDetectedByLeft))) {
        recentPed = timing;
      }
    } else if (timing.classType === 'car') {
      if (!recentVeh || (timing.firstDetectedByLeft !== null && 
          (recentVeh.firstDetectedByLeft === null || 
           timing.firstDetectedByLeft > recentVeh.firstDetectedByLeft))) {
        recentVeh = timing;
      }
    }
  }
  
  // Update left panel
  const leftPed1El = document.getElementById('left-ped1-time');
  const leftVeh1El = document.getElementById('left-veh1-time');
  
  if (leftPed1El && recentPed) {
    if (recentPed.firstDetectedByLeft !== null) {
      const ago = currentTime - recentPed.firstDetectedByLeft;
      leftPed1El.textContent = `${ago.toFixed(1)}s ago`;
      leftPed1El.className = ago < 1 ? 'timing-early' : 'timing-late';
    } else {
      leftPed1El.textContent = 'Not detected';
      leftPed1El.className = 'timing-missed';
    }
  }
  
  if (leftVeh1El && recentVeh) {
    if (recentVeh.firstDetectedByLeft !== null) {
      const ago = currentTime - recentVeh.firstDetectedByLeft;
      leftVeh1El.textContent = `${ago.toFixed(1)}s ago`;
      leftVeh1El.className = ago < 1 ? 'timing-early' : 'timing-late';
    } else {
      leftVeh1El.textContent = 'Not detected';
      leftVeh1El.className = 'timing-missed';
    }
  }
  
  // Update right panel
  const rightPed1El = document.getElementById('right-ped1-time');
  const rightVeh1El = document.getElementById('right-veh1-time');
  
  if (rightPed1El && recentPed) {
    if (recentPed.firstDetectedByRight !== null) {
      const ago = currentTime - recentPed.firstDetectedByRight;
      rightPed1El.textContent = `${ago.toFixed(1)}s ago`;
      rightPed1El.className = ago < 1 ? 'timing-early' : 'timing-late';
    } else {
      rightPed1El.textContent = 'Not detected';
      rightPed1El.className = 'timing-missed';
    }
  }
  
  if (rightVeh1El && recentVeh) {
    if (recentVeh.firstDetectedByRight !== null) {
      const ago = currentTime - recentVeh.firstDetectedByRight;
      rightVeh1El.textContent = `${ago.toFixed(1)}s ago`;
      rightVeh1El.className = ago < 1 ? 'timing-early' : 'timing-late';
    } else {
      rightVeh1El.textContent = 'Not detected';
      rightVeh1El.className = 'timing-missed';
    }
  }
  
  // Update labels
  const leftLabelEl = document.getElementById('compare-left-label');
  const rightLabelEl = document.getElementById('compare-right-label');
  
  const stackLabels: Record<StackProfile, string> = {
    tesla: 'F1: Tesla-style',
    waymo: 'F2: Waymo-style',
    waabi: 'F3: Waabi-style',
  };
  
  if (leftLabelEl) leftLabelEl.textContent = stackLabels[currentStack];
  if (rightLabelEl) rightLabelEl.textContent = stackLabels[compareStack];
}

// Update minimap
function updateMinimap() {
  const canvas = document.getElementById('minimap') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const state = simulation.getState();
  
  // Clear
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 180, 180);
  
  const scale = 0.5; // meters to pixels
  const centerX = 90;
  const centerY = 90;
  const egoX = state.ego.transform.position.x;
  const egoY = state.ego.transform.position.y;
  
  // Draw entities
  ctx.fillStyle = '#666';
  for (const entity of [...state.trafficVehicles, ...state.pedestrians]) {
    const dx = (entity.transform.position.x - egoX) * scale;
    const dy = -(entity.transform.position.y - egoY) * scale;
    if (Math.abs(dx) < 90 && Math.abs(dy) < 90) {
      ctx.fillRect(centerX + dx - 2, centerY + dy - 2, 4, 4);
    }
  }
  
  // Draw ego
  ctx.fillStyle = '#0066cc';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw ego direction
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(
    centerX + Math.cos(-state.ego.transform.rotation + Math.PI/2) * 15,
    centerY + Math.sin(-state.ego.transform.rotation + Math.PI/2) * 15
  );
  ctx.stroke();
  
  // Draw route
  if (state.route.length > 0) {
    ctx.strokeStyle = '#0088ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let first = true;
    for (const point of state.route) {
      const dx = (point.x - egoX) * scale;
      const dy = -(point.y - egoY) * scale;
      if (Math.abs(dx) < 90 && Math.abs(dy) < 90) {
        if (first) {
          ctx.moveTo(centerX + dx, centerY + dy);
          first = false;
        } else {
          ctx.lineTo(centerX + dx, centerY + dy);
        }
      }
    }
    ctx.stroke();
  }
}

function bindDriveKey(e: KeyboardEvent, down: boolean) {
  const k = e.key;
  const code = e.code;
  let used = false;
  if (k === 'w' || k === 'W' || k === 'ArrowUp') { inputState.forward = down; used = true; }
  else if (k === 's' || k === 'S' || k === 'ArrowDown') { inputState.backward = down; used = true; }
  else if (k === 'a' || k === 'A' || k === 'ArrowLeft') { inputState.left = down; used = true; }
  else if (k === 'd' || k === 'D' || k === 'ArrowRight') { inputState.right = down; used = true; }
  else if (k === ' ' || code === 'Space') { inputState.brake = down; used = true; }
  if (used) {
    if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
    if (down && !isPaused) {
      if (!isManual()) takeManual(true);
    }
  }
  return used;
}

function setupInput() {
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (isPaused) return;
    if (cameraMode !== 'chase' && cameraMode !== 'orbit') return;
    pointerDragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDragging) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    orbitYaw -= dx * 0.008;
    orbitPitch = Math.max(0.08, Math.min(1.2, orbitPitch + dy * 0.006));
  });
  canvas.addEventListener('pointerup', () => { pointerDragging = false; });
  canvas.addEventListener('pointerleave', () => { pointerDragging = false; });
  canvas.addEventListener('wheel', (e) => {
    if (cameraMode !== 'chase' && cameraMode !== 'orbit') return;
    e.preventDefault();
    orbitDist = Math.max(6, Math.min(70, orbitDist + e.deltaY * 0.03));
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.repeat && (e.key === 'Escape' || e.key === 't' || e.key === 'T')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (isPaused) {
      if (e.key === 'Backspace') { e.preventDefault(); restartSim(); }
      return;
    }
    if (bindDriveKey(e, true)) return;

    switch (e.key.toLowerCase()) {
      case 't':
        setAutopilot(isManual());
        break;
      case 'c': {
        const modes: CameraMode[] = ['chase', 'hood', 'bev', 'orbit'];
        setCameraMode(modes[(modes.indexOf(cameraMode) + 1) % modes.length]!);
        break;
      }
      case 'v':
        showAIView = !showAIView;
        document.getElementById('ai-view-panel')!.classList.toggle('visible', showAIView);
        document.getElementById('decision-banner')!.classList.toggle('visible', showAIView);
        try { localStorage.setItem('autonomy-ai-view', showAIView ? '1' : '0'); } catch { /* ignore */ }
        perceptionViz?.setEnabled(showAIView);
        break;
      case 'g':
        showGroundTruth = !showGroundTruth;
        break;
      case 'i':
        showInfoCard = !showInfoCard;
        if (showInfoCard) updateInfoCard();
        document.getElementById('info-card')!.classList.toggle('visible', showInfoCard);
        break;
      case 'm':
        compareMode = !compareMode;
        document.getElementById('compare-container')!.classList.toggle('visible', compareMode);
        document.getElementById('canvas-container')!.style.display = compareMode ? 'none' : 'block';
        if (compareMode) {
          currentStack = 'tesla';
          compareStack = 'waymo';
          simulation.injectScenario({ type: 'occluded_pedestrian', params: {} });
          initCompareMode();
        }
        break;
      case 'k':
        isRecording = !isRecording;
        document.getElementById('recording-indicator')!.classList.toggle('visible', isRecording);
        break;
      case 'r':
        resetCameraRig();
        break;
      case 'n': {
        const state = simulation.getState();
        const newTimeOfDay = state.environment.timeOfDay === 'day' ? 'night' : 'day';
        state.environment.timeOfDay = newTimeOfDay;
        if (newTimeOfDay === 'night') {
          scene.background = new THREE.Color(0x0a0a1a);
          scene.fog = new THREE.Fog(0x0a0a1a, 50, QUALITY[qualityLevel].fogFar * 0.7);
        } else {
          scene.background = new THREE.Color(0x87ceeb);
          scene.fog = new THREE.Fog(0x87ceeb, 80, QUALITY[qualityLevel].fogFar);
        }
        break;
      }
      case '1':
        simulation.injectScenario({ type: 'jaywalker', params: {} });
        break;
      case '2':
        simulation.injectScenario({ type: 'occluded_pedestrian', params: {} });
        break;
      case '3':
        simulation.injectScenario({ type: 'vehicle_cutin', params: {} });
        break;
      case '4': {
        const weatherState = simulation.getState();
        weatherState.environment.weather =
          weatherState.environment.weather === 'clear' ? 'rain' :
          weatherState.environment.weather === 'rain' ? 'fog' : 'clear';
        weatherState.environment.visibility =
          weatherState.environment.weather === 'clear' ? 1.0 :
          weatherState.environment.weather === 'rain' ? 0.6 : 0.3;
        break;
      }
      case '5':
        simulation.injectScenario({ type: 'stalled_vehicle', params: {} });
        break;
      case 'backspace':
        e.preventDefault();
        restartSim();
        break;
    }

    if (e.key === 'F1') { e.preventDefault(); switchStack('tesla'); }
    if (e.key === 'F2') { e.preventDefault(); switchStack('waymo'); }
    if (e.key === 'F3') { e.preventDefault(); switchStack('waabi'); }
  });

  document.addEventListener('keyup', (e) => {
    bindDriveKey(e, false);
  });

  document.getElementById('accept-ride')!.addEventListener('click', () => {
    const state = simulation.getState();
    if (state.rideRequests.length > 0) {
      simulation.acceptRide(state.rideRequests[0]!.id);
      document.getElementById('ride-request')!.classList.remove('visible');
    }
  });
  document.getElementById('decline-ride')!.addEventListener('click', () => {
    document.getElementById('ride-request')!.classList.remove('visible');
  });
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const profile = (btn as HTMLElement).dataset['profile'] as StackProfile;
      switchStack(profile);
    });
  });
  document.getElementById('pause-resume')?.addEventListener('click', () => setPaused(false));
  document.getElementById('pause-restart')?.addEventListener('click', () => restartSim());
  document.getElementById('gear-btn')?.addEventListener('click', () => togglePause());
  document.querySelectorAll('#quality-seg button').forEach(btn => {
    btn.addEventListener('click', () => applyQuality((btn as HTMLElement).dataset['quality'] as QualityLevel));
  });
  document.querySelectorAll('#camera-seg button').forEach(btn => {
    btn.addEventListener('click', () => setCameraMode((btn as HTMLElement).dataset['camera'] as CameraMode));
  });
  document.getElementById('shadow-toggle')?.addEventListener('change', (ev) => {
    shadowMode = (ev.target as HTMLInputElement).checked;
    document.body.dataset['shadowMode'] = shadowMode ? 'on' : 'off';
  });
  document.getElementById('perception-model')?.addEventListener('change', () => {
    /* heuristic vs v1 is displayed in the pause menu; ONNX path uses the same HUD */
  });
}

let lastTime = 0;
let displayFps = 0;
let fpsFrames = 0;
let fpsLast = 0;
function animate(time: number) {
  requestAnimationFrame(animate);

  fpsFrames++;
  if (time - fpsLast >= 500) {
    displayFps = Math.round((fpsFrames * 1000) / Math.max(1, time - fpsLast));
    fpsFrames = 0;
    fpsLast = time;
  }

  const frameDt = Math.min((time - lastTime) / 1000, 0.25);
  lastTime = time;

  if (!isPaused) {
    const driving = anyDriveHeld();
    if (driving && !isManual()) takeManual(true);
    const humanInput = isManual() ? humanInputFromKeys() : undefined;
    simAccumulator += frameDt;
    if (simAccumulator > 0.25) simAccumulator = 0.25;
    while (simAccumulator >= SIM_DT) {
      prevEgoX = currEgoX;
      prevEgoY = currEgoY;
      prevEgoYaw = currEgoYaw;
      simulation.step(SIM_DT, humanInput);
      captureEgoPose();
      updateEntityMeshes();
      updateDetectionMeshes();
      simAccumulator -= SIM_DT;
    }
  }

  const alpha = isPaused ? 1 : simAccumulator / SIM_DT;
  const ego = interpolatedEgo(alpha);
  egoMesh.position.set(ego.x, 0.75, -ego.y);
  egoMesh.rotation.y = -ego.yaw + Math.PI;
  updateCamera(frameDt, ego.x, ego.y, ego.yaw);

  if (time - lastHudMs >= 200) {
    lastHudMs = time;
    updateHUD();
    updateMinimap();
  }

  if (compareMode) updateCompareMode();

  if (!isPaused && time - lastAiViewMs >= 200) {
    lastAiViewMs = time;
    if (bevOverlayEnabled) renderBEVHeatmaps();
    updateAIView(false);
  }

  rawCameraFrame++;
  if (showAIView && !compareMode && !isPaused && rawCameraFrame % 3 === 0) {
    updateAIView(true);
  }

  if (!compareMode) renderer.render(scene, camera);
}

function updateAIView(drawRawScene: boolean) {
  const banner = document.getElementById('decision-banner');
  const state = simulation.getState();
  const agents = [...state.trafficVehicles, ...state.pedestrians];
  if (latestVisionDetections.length === 0 || currentStack === 'tesla') {
    latestVisionDetections = detectVisibleAgents(state.ego, agents);
  }

  const input = {
    stack: currentStack,
    ego: state.ego,
    tracks: state.perceptionTracks,
    lidarPoints: simulation.getLidarPoints(),
    agents,
    groundTruth: agents,
    showGroundTruth,
    plannerOutput: state.lastPlannerOutput,
    visionDetections: latestVisionDetections,
    occupancy: currentStack === 'waabi' ? waabiState.occupancy.current : undefined,
  };

  if (perceptionViz) {
    perceptionViz.setEnabled(showAIView);
    lastDecision = perceptionViz.update(input);
  } else {
    lastDecision = { text: 'Cruising: lane clear', severity: 'go' };
  }

  if (banner) {
    banner.textContent = lastDecision.text;
    banner.classList.toggle('visible', showAIView);
    banner.classList.toggle('slow', lastDecision.severity === 'slow');
    banner.classList.toggle('brake', lastDecision.severity === 'brake');
  }

  if (!showAIView) return;

  const header = document.getElementById('ai-view-header');
  if (header) {
    const names: Record<StackProfile, string> = {
      tesla: 'AI View — Tesla-style cameras + occupancy voxels',
      waymo: 'AI View — Waymo-style lidar / radar / fused boxes',
      waabi: 'AI View — Waabi-style BEV occupancy-flow',
    };
    header.textContent = names[currentStack] + '  (V hide · G ground truth)';
  }

  const percCanvas = document.getElementById('ai-view-canvas') as HTMLCanvasElement | null;
  if (percCanvas) renderAIViewCanvas(percCanvas, input, lastDecision);

  if (drawRawScene && rawCameraRenderer && rawCamera && !compareMode) {
    const ego = state.ego;
    const yaw = ego.transform.rotation;
    rawCamera.position.set(
      ego.transform.position.x + Math.cos(yaw) * 1.6,
      1.35,
      -(ego.transform.position.y + Math.sin(yaw) * 1.6)
    );
    rawCamera.lookAt(
      ego.transform.position.x + Math.cos(yaw) * 20,
      1.1,
      -(ego.transform.position.y + Math.sin(yaw) * 20)
    );
    const vizWas = perceptionViz?.group.visible ?? false;
    if (perceptionViz) perceptionViz.group.visible = false;
    rawCameraRenderer.render(scene, rawCamera);
    if (perceptionViz) perceptionViz.group.visible = vizWas;
  }
}

// Create a more detailed ego vehicle mesh
function createEgoVehicle(): THREE.Group {
  const group = new THREE.Group();
  
  // Main body
  const bodyGeo = new THREE.BoxGeometry(4.2, 1.2, 1.8);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x0066cc});
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);
  
  // Cabin with windows
  const cabinGeo = new THREE.BoxGeometry(2.4, 0.9, 1.6);
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0x111122});
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(-0.2, 1.35, 0);
  cabin.castShadow = true;
  group.add(cabin);
  
  // Roof sensor dome (lidar)
  const lidarGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.15, 16);
  const lidarMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const lidar = new THREE.Mesh(lidarGeo, lidarMat);
  lidar.position.set(0, 1.9, 0);
  group.add(lidar);
  
  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const egoWheelPositions: [number, number, number][] = [[1.3, 0.35, 0.9], [1.3, 0.35, -0.9], [-1.3, 0.35, 0.9], [-1.3, 0.35, -0.9]];
  for (const [wx, wy, wz] of egoWheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    wheel.rotation.x = Math.PI / 2;
    group.add(wheel);
  }
  
  // Headlights
  const lightGeo = new THREE.CircleGeometry(0.15, 8);
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 0.5 });
  const headlightL = new THREE.Mesh(lightGeo, lightMat);
  headlightL.position.set(2.1, 0.6, 0.6);
  headlightL.rotation.y = Math.PI / 2;
  group.add(headlightL);
  const headlightR = new THREE.Mesh(lightGeo, lightMat);
  headlightR.position.set(2.1, 0.6, -0.6);
  headlightR.rotation.y = Math.PI / 2;
  group.add(headlightR);
  
  return group;
}

async function init() {
  console.log('Initializing AUTONOMY CITY...');
  const kernels = await loadWasmKernels();
  console.log(`[autonomy-sim] kernels available=${kernels.available} (castRays=${typeof getWasmKernels().castRays})`);

  initThreeJS();

  simulation = new Simulation({
    seed: Date.now(),
    profile: 'baseline_lidar',
    environment: { timeOfDay: 'day', weather: 'clear', visibility: 1 },
    useOracle: false,
    maxDuration: 3600,
  });

  scene.remove(egoMesh);
  const egoGroup = createEgoVehicle();
  scene.add(egoGroup);
  egoMesh = egoGroup as unknown as THREE.Mesh;

  perceptionViz = new PerceptionVisualizer(scene);
  try {
    const stored = localStorage.getItem('autonomy-ai-view');
    if (stored === '0') showAIView = false;
  } catch { /* ignore */ }
  document.getElementById('ai-view-panel')!.classList.toggle('visible', showAIView);
  document.getElementById('decision-banner')?.classList.toggle('visible', showAIView);
  perceptionViz.setEnabled(showAIView);

  const rawCanvas = document.getElementById('raw-camera-canvas') as HTMLCanvasElement | null;
  if (rawCanvas) {
    rawCameraRenderer = new THREE.WebGLRenderer({ canvas: rawCanvas, antialias: false, alpha: false });
    rawCameraRenderer.setSize(320, 180, false);
    rawCameraRenderer.setPixelRatio(1);
    rawCamera = new THREE.PerspectiveCamera(70, 320 / 180, 0.2, 200);
  }

  applyQuality('med');
  rebuildStaticCity();
  captureEgoPose();
  prevEgoX = currEgoX;
  prevEgoY = currEgoY;
  prevEgoYaw = currEgoYaw;
  setupInput();
  showDriveHintOnce();
  syncDriveBadge();

  document.getElementById('loading')!.classList.add('hidden');
  lastTime = performance.now();
  requestAnimationFrame(animate);
  console.log('AUTONOMY CITY started!');
}

init();
