/**
 * Main game entry point
 * Browser-based 3D visualization with Three.js
 */

import * as THREE from 'three';
import { Simulation } from './sim/simulation';
import { vec3Length, egoToWorld, clamp } from './sim/math';
import { formatGear } from './sim/vehicle';
import { destinationPinWorld, PAD_ALONG, PAD_WIDTH, tripRoute } from './sim/rightLane';
import { COCKPIT, HAND_LOCK_DEG, handWheelRotation } from './sim/cabinView';
import {
  applyCameraLayers,
  loadEgoVisual,
  LAYER_COCKPIT,
  LAYER_EXTERIOR,
  LAYER_WORLD,
  type CockpitScreenInfo,
} from './sim/egoMesh';
import {
  PANEL_IDS,
  PANEL_STORAGE_KEY,
  avoidReserved,
  defaultStates,
  parsePanelStates,
  serializePanelStates,
  panelsKeyAction,
  reservedHudRects,
  type PanelId,
  type PanelState,
} from './ui/hudPanels';
import {
  AXLE_HEIGHT,
  ROAD_SURFACE_Y,
  clampCosmeticAttitude,
  meshYawForHeading,
} from './sim/vehicleVisual';
import { STACK_VIEW_COPY, CAMERA_VIEW_COPY, aiViewTitle, type StackProfile as ViewStack, type CameraMode as ViewCamera } from './ui/viewCopy';
import {
  DEST_PIN_COLOR,
  ROUTE_CORE,
  ROUTE_HALO,
  autopilotRouteOnMinimap,
  destinationOnMinimap,
  paintDestPin,
  projectToMinimap,
  routeStrokeWidths,
} from './ui/minimapRoute';
import {
  canStart,
  createTripMenu,
  dismissTripMenu,
  drawStartCityMap,
  justDrive,
  menuBanner,
  menuLead,
  menuStatus,
  menuTitle,
  onArrived,
  pickRandomDestination,
  pickTripDestination,
  setTripCamera,
  setTripStack,
  startMapToWorld,
  startTrip,
  type TripMenuState,
} from './ui/startMenu';
import { loadWasmKernels, getWasmKernels } from './sim/wasm';
import { WAYMO_INFO_CARD } from './stacks/waymo';
import {
  WAABI_INFO_CARD, WaabiStackState, runWaabiStack,
  BEVOccupancy, AdversarialVariant
} from './stacks/waabi';
import { TESLA_INFO_CARD, detectVisibleAgents, hudDetectionCount, type VisionDetection } from './stacks/tesla';
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
type StackProfile = ViewStack;
type CameraMode = ViewCamera;
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
let gameStarted = false;
let tripMenu: TripMenuState = createTripMenu({ x: 3.5, y: -22 });
let menuOrbitYaw = 0.85;
const MENU_ORBIT_SPEED = 0.11;
let suppressArrivedMenu = false;
let currentStack: StackProfile = 'tesla';
let compareMode = false;
let driveHintShown = false;
let lastHudMs = 0;
let lastAiViewMs = 0;
let lastCollisionCount = 0;
let collisionFlashUntil = 0;
let shadowMode = false;

let orbitYaw = 0;
let orbitPitch = 0.22;
let orbitDist = 9.2;
let rmbOrbiting = false;
let lastMouseCamMs = -1e9;
let showPhysDebug = false;
/** Pixels per metre on the minimap. Scroll over the map to change it. */
let minimapScale = 1.35;
/** Ground-level side camera for wheel/sill verification. */
let debugSideCam: { height: number; side: number; lookY: number } | null = null;
/** 3/4 hero camera in body-pivot local metres. */
let debugHeroCam: { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } | null = null;
/** Photo-only hand-wheel angle (degrees, left positive). */
let shotHandDeg: number | null = null;
/** Photo-only hood FOV override (degrees). */
let shotFov: number | null = null;
let photoMode = false;
const CHASE_RETURN_DELAY = 1.5;
const CHASE_DIST_DEFAULT = 9.2;
const ORBIT_DIST_DEFAULT = 22;

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
let prevEgoRoll = 0;
let prevEgoPitch = 0;
let currEgoX = 0;
let currEgoY = 0;
let currEgoYaw = Math.PI / 2;
let currEgoRoll = 0;
let currEgoPitch = 0;
let currSteer = 0;
let currWheelSpin = 0;
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

let egoMesh: THREE.Object3D;
let egoBodyPivot: THREE.Group | null = null;
let egoSteerWheel: THREE.Group | null = null;
let egoEyeAnchor: THREE.Object3D | null = null;
let egoLookAnchor: THREE.Object3D | null = null;
let egoUpdateScreen: ((info: CockpitScreenInfo) => void) | null = null;
let panelStates: Record<PanelId, PanelState> = defaultStates();
let panelsHidden = false;
let reengageIgnoreDrive = false;
let autopilotBannerUntil = 0;
const PANEL_EL: Record<PanelId, string> = {
  explainer: 'view-explainer',
  'ai-view': 'ai-view-panel',
  info: 'info-card',
};
let egoWheels: Array<{ pivot: THREE.Group; mesh: THREE.Mesh; front: boolean; spinAxis?: 'x' | 'y' }> = [];
const entityMeshes = new Map<number, THREE.Mesh>();
const detectionMeshes: THREE.Mesh[] = [];
let groundMesh: THREE.Mesh;
let bevOverlayEnabled = false;
let collisionShotHold = false;
let collisionShotAt = 0;
let collisionCam: { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } | null = null;
let poleInstanced: THREE.InstancedMesh | null = null;
let poleEntityIds: number[] = [];
const signMeshes = new Map<number, THREE.Object3D>();
const furnitureVisuals = new Map<number, THREE.Object3D>();
const poleDummy = new THREE.Object3D();

// Initialize Three.js
function initThreeJS() {
  const container = document.getElementById('canvas-container')!;
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(QUALITY[qualityLevel].pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = QUALITY[qualityLevel].shadows;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.outline = 'none';
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
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
  applyCameraLayers(camera, false);
  
  const ambientLight = new THREE.AmbientLight(0x6a6a6a, 0.7);
  const hemi = new THREE.HemisphereLight(0xc8d8ee, 0x2a241c, 0.45);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-80, 40, -40);
  sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.position.set(100, 100, 100);
  for (const light of [ambientLight, hemi, fillLight, sunLight]) {
    light.layers.enable(LAYER_WORLD);
    light.layers.enable(LAYER_COCKPIT);
    light.layers.enable(LAYER_EXTERIOR);
    scene.add(light);
  }
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 500;
  sunLight.shadow.camera.left = -200;
  sunLight.shadow.camera.right = 200;
  sunLight.shadow.camera.top = 200;
  sunLight.shadow.camera.bottom = -200;
  
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
let destinationMarker: THREE.Group | null = null;

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

/** Pink roadside pad + map pin. Visible on asphalt; minimap uses the same color. */
function createDestinationMarker(): THREE.Group {
  const group = new THREE.Group();
  const pink = new THREE.MeshLambertMaterial({
    color: DEST_PIN_COLOR,
    emissive: DEST_PIN_COLOR,
    emissiveIntensity: 0.42,
  });
  const pinkPad = new THREE.MeshLambertMaterial({
    color: DEST_PIN_COLOR,
    emissive: DEST_PIN_COLOR,
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.88,
  });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const pad = new THREE.Mesh(new THREE.PlaneGeometry(PAD_ALONG, PAD_WIDTH), pinkPad);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.035;
  pad.receiveShadow = true;
  group.add(pad);

  const pin = new THREE.Group();
  pin.name = 'dest-pin';
  pin.position.set(PAD_ALONG / 2 - 1.05, 0, PAD_WIDTH / 2 - 0.12);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.85, 8), white);
  stem.position.y = 0.95;
  stem.castShadow = true;
  pin.add(stem);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 14), pink);
  cone.position.y = 1.58;
  cone.rotation.x = Math.PI;
  cone.castShadow = true;
  pin.add(cone);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), pink);
  head.position.y = 2.02;
  head.castShadow = true;
  pin.add(head);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), white);
  bead.position.y = 2.02;
  pin.add(bead);
  group.add(pin);

  group.visible = false;
  group.traverse((obj) => { obj.layers.set(LAYER_WORLD); });
  return group;
}

function syncDestinationMarker(): void {
  if (!destinationMarker) return;
  const dest = simulation.getTripDestination();
  if (!dest) {
    destinationMarker.visible = false;
    return;
  }
  destinationMarker.visible = true;
  destinationMarker.position.set(dest.x, 0, -dest.y);
  destinationMarker.rotation.y = meshYawForHeading(simulation.getTripHeading());
  const pin = destinationMarker.getObjectByName('dest-pin');
  if (pin) pin.visible = !simulation.hasArrived();
}

function isTripMenuOpen(): boolean {
  return tripMenu.open && !photoMode;
}

// Create mesh for entity with proper styling
function createEntityMesh(classType: string, entity?: { boundingBox: { size: { x: number; y: number; z: number } } }): THREE.Mesh | THREE.Group {
  switch (classType) {
    case 'car': {
      const group = new THREE.Group();
      const npcRadius = 0.35;
      const npcAxle = ROAD_SURFACE_Y + npcRadius;

      const bodyGeo = new THREE.BoxGeometry(4.2, 1.2, 1.6);
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3366cc});
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.6;
      body.castShadow = true;
      group.add(body);

      const cabinGeo = new THREE.BoxGeometry(2.2, 0.8, 1.4);
      const cabinMat = new THREE.MeshLambertMaterial({ color: 0x222222});
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(-0.3, 1.3, 0);
      cabin.castShadow = true;
      group.add(cabin);

      const wheelGeo = new THREE.CylinderGeometry(npcRadius, npcRadius, 0.2, 16);
      const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
      const wheelPositions: [number, number, number][] = [
        [1.2, npcAxle, 0.8], [1.2, npcAxle, -0.8],
        [-1.2, npcAxle, 0.8], [-1.2, npcAxle, -0.8],
      ];
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
      const truckRadius = 0.42;
      const truckAxle = ROAD_SURFACE_Y + truckRadius;
      const truckWheel = new THREE.CylinderGeometry(truckRadius, truckRadius, 0.28, 12);
      const truckWheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
      for (const [wx, wz] of [[3.2, 1.1], [3.2, -1.1], [-3.4, 1.1], [-3.4, -1.1], [-1.2, 1.1], [-1.2, -1.1]] as Array<[number, number]>) {
        const wheel = new THREE.Mesh(truckWheel, truckWheelMat);
        wheel.position.set(wx, truckAxle, wz);
        wheel.rotation.x = Math.PI / 2;
        group.add(wheel);
      }
      
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
      const shirts = [0xff6600, 0x00cc66, 0x3366cc, 0xcc3366, 0xffcc00, 0x663399];
      const pantsCol = [0x1e2a44, 0x333333, 0x4a3728, 0x223322][Math.floor(Math.random() * 4)]!;
      const shirt = new THREE.MeshLambertMaterial({ color: shirts[Math.floor(Math.random() * shirts.length)] });
      const pants = new THREE.MeshLambertMaterial({ color: pantsCol });
      const skin = new THREE.MeshLambertMaterial({ color: 0xffccaa });
      const shoe = new THREE.MeshLambertMaterial({ color: 0x222222 });

      const limb = (mat: THREE.Material, radius: number, length: number) => {
        const pivot = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.05, length - radius * 2), 3, 6), mat);
        mesh.position.y = -length / 2;
        pivot.add(mesh);
        return pivot;
      };

      const hipY = ROAD_SURFACE_Y + 0.92;
      const leftLeg = limb(pants, 0.07, 0.78);
      const rightLeg = limb(pants, 0.07, 0.78);
      leftLeg.position.set(-0.11, hipY, 0);
      rightLeg.position.set(0.11, hipY, 0);
      const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.22), shoe);
      leftShoe.position.set(0, -0.78, 0.04);
      rightLeg.add(leftShoe.clone());
      leftLeg.add(leftShoe);
      group.add(leftLeg, rightLeg);

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.2), shirt);
      torso.position.y = hipY + 0.28;
      group.add(torso);

      const leftArm = limb(shirt, 0.05, 0.55);
      const rightArm = limb(shirt, 0.05, 0.55);
      leftArm.position.set(-0.24, hipY + 0.46, 0);
      rightArm.position.set(0.24, hipY + 0.46, 0);
      group.add(leftArm, rightArm);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), skin);
      head.position.y = hipY + 0.66;
      group.add(head);

      group.userData.walk = { leftLeg, rightLeg, leftArm, rightArm };
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

    case 'stop_sign': {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 2.7, 8),
        new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
      );
      pole.position.y = 1.35;
      group.add(pole);
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 1.15, 1.15),
        new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }),
      );
      rim.position.y = 2.62;
      group.add(rim);
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.92, 0.92),
        new THREE.MeshLambertMaterial({ color: 0xc81e1e }),
      );
      face.position.y = 2.62;
      group.add(face);
      return group as unknown as THREE.Mesh;
    }

    case 'yield_sign': {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 2.5, 8),
        new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
      );
      pole.position.y = 1.25;
      group.add(pole);
      const board = new THREE.Mesh(
        new THREE.ConeGeometry(0.7, 1.15, 3),
        new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }),
      );
      board.position.y = 2.55;
      board.rotation.z = Math.PI;
      group.add(board);
      const inner = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.7, 3),
        new THREE.MeshLambertMaterial({ color: 0xc81e1e }),
      );
      inner.position.y = 2.5;
      inner.rotation.z = Math.PI;
      group.add(inner);
      return group as unknown as THREE.Mesh;
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
  clearFurnitureVisuals();
  for (const mesh of staticCityMeshes) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  staticCityMeshes = [];
  poleInstanced = null;
  poleEntityIds = [];
  signMeshes.clear();
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
      new THREE.ConeGeometry(1.05, 4.2, 7),
      new THREE.MeshLambertMaterial({ color: 0x228b22 }),
      trees.length
    );
    trees.forEach((t, i) => {
      dummy.position.set(t.transform.position.x, 1, -t.transform.position.y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.transform.position.x, 3.6, -t.transform.position.y);
      dummy.updateMatrix();
      foliage.setMatrixAt(i, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    scene.add(trunks);
    scene.add(foliage);
    staticCityMeshes.push(trunks, foliage);
  }

  poleInstanced = null;
  poleEntityIds = [];
  signMeshes.clear();
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
    poleInstanced = mesh;
    poleEntityIds = poles.map(p => p.id);
  }

  const signs = statics.filter(e => e.classType === 'stop_sign' || e.classType === 'yield_sign');
  for (const sign of signs) {
    const mesh = createEntityMesh(sign.classType) as THREE.Mesh;
    mesh.position.set(sign.transform.position.x, 0, -sign.transform.position.y);
    mesh.rotation.y = meshYawForHeading(sign.transform.rotation);
    mesh.userData.entityId = sign.id;
    scene.add(mesh);
    staticCityMeshes.push(mesh);
    signMeshes.set(sign.id, mesh);
  }

  const stopLines: Array<{ x: number; y: number; z: number; ry?: number }> = [];
  for (const inter of simulation.getState().worldMap.controlledIntersections) {
    if (inter.control === 'none') continue;
    for (const heading of inter.signedHeadings) {
      const fx = Math.cos(heading);
      const fy = Math.sin(heading);
      stopLines.push({
        x: inter.center.x - fx * inter.stopLineDist,
        y: 0.035,
        z: -(inter.center.y - fy * inter.stopLineDist),
        ry: heading,
      });
    }
  }
  if (stopLines.length > 0) {
    const lineMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
    const dummyLine = new THREE.Object3D();
    const lines = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.03, 3.4), lineMat, stopLines.length);
    stopLines.forEach((p, i) => {
      dummyLine.position.set(p.x, p.y, p.z);
      dummyLine.rotation.set(0, -(p.ry ?? 0), 0);
      dummyLine.scale.set(1, 1, 1);
      dummyLine.updateMatrix();
      lines.setMatrixAt(i, dummyLine.matrix);
    });
    lines.instanceMatrix.needsUpdate = true;
    scene.add(lines);
    staticCityMeshes.push(lines);
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
    const face = entity.transform.rotation;
    const tumbling = entity.classType === 'pedestrian' && 'state' in entity
      && (entity as { state?: string }).state === 'tumbling';
    if (isVehicle) mesh.rotation.y = meshYawForHeading(face);
    else if (entity.classType === 'pedestrian') {
      // Body faces along the sidewalk. The step cycle is applied below so the feet
      // move in that same direction (not a moonwalk toward the camera).
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = Math.atan2(-Math.cos(face), Math.sin(face));
      if (tumbling) {
        const ped = entity as {
          tumbleHeight?: number; tumblePitch?: number; tumbleRoll?: number;
        };
        mesh.position.y = ped.tumbleHeight ?? 0.12;
        mesh.rotation.x = ped.tumblePitch ?? 0;
        mesh.rotation.z = ped.tumbleRoll ?? 0;
      } else {
        mesh.rotation.x = 0;
        mesh.rotation.z = 0;
      }
    } else mesh.rotation.y = -face;
    const walk = mesh.userData.walk as {
      leftLeg: THREE.Group; rightLeg: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group;
    } | undefined;
    if (walk) {
      if (tumbling) {
        const t = simulation.getState().timestamp / 1000;
        const flap = Math.sin(t * 14) * 0.85;
        walk.leftLeg.rotation.x = flap;
        walk.rightLeg.rotation.x = -flap;
        walk.leftArm.rotation.x = -flap * 1.1;
        walk.rightArm.rotation.x = flap * 1.1;
      } else {
        const spd = Math.hypot(entity.velocity.x, entity.velocity.y);
        const phase = spd > 0.15 ? (entity.transform.position.x + entity.transform.position.y) * 2.4 : 0;
        const swing = Math.sin(phase) * Math.min(0.65, 0.25 + spd * 0.28);
        // Positive X rotation steps the foot toward local -Z, which is behind the facing.
        // Negate it so a pedestrian walking away steps away, not back toward the camera.
        walk.leftLeg.rotation.x = -swing;
        walk.rightLeg.rotation.x = swing;
        walk.leftArm.rotation.x = swing * 0.85;
        walk.rightArm.rotation.x = -swing * 0.85;
      }
    }
  }
  updateFurnitureVisuals();
}

function clearFurnitureVisuals() {
  for (const mesh of furnitureVisuals.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }
  furnitureVisuals.clear();
}

function updateFurnitureVisuals() {
  const broken = simulation.getState().brokenFurniture;
  const live = new Set(broken.map(b => b.id));
  for (const [id, mesh] of furnitureVisuals) {
    if (live.has(id)) continue;
    scene.remove(mesh);
    disposeObject(mesh);
    furnitureVisuals.delete(id);
  }

  if (poleInstanced) {
    for (let i = 0; i < poleEntityIds.length; i++) {
      const id = poleEntityIds[i]!;
      const po = simulation.getState().worldMap.staticEntities.find(e => e.id === id);
      if (!po) continue;
      const snapped = broken.find(b => b.id === id);
      poleDummy.position.set(po.transform.position.x, 4, -po.transform.position.y);
      poleDummy.rotation.set(0, 0, 0);
      poleDummy.scale.set(snapped ? 0 : 1, snapped ? 0 : 1, snapped ? 0 : 1);
      poleDummy.updateMatrix();
      poleInstanced.setMatrixAt(i, poleDummy.matrix);
    }
    poleInstanced.instanceMatrix.needsUpdate = true;
  }

  for (const b of broken) {
    if (b.classType === 'stop_sign' || b.classType === 'yield_sign') {
      const mesh = signMeshes.get(b.id);
      if (mesh) {
        const t = Math.min(1, b.fallAngle / (Math.PI / 2));
        const along = 1.35 * t;
        mesh.position.set(b.x + b.fallDirX * along, 0.02, -(b.y + b.fallDirY * along));
        mesh.rotation.order = 'YXZ';
        mesh.rotation.y = meshYawForHeading(b.yaw);
        mesh.rotation.x = b.fallDirY * b.fallAngle;
        mesh.rotation.z = -b.fallDirX * b.fallAngle;
      }
      continue;
    }
    let mesh = furnitureVisuals.get(b.id);
    if (!mesh) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0x6d6d6d }),
      );
      pole.castShadow = true;
      mesh = pole;
      scene.add(mesh);
      furnitureVisuals.set(b.id, mesh);
    }
    const upright = new THREE.Vector3(0, 1, 0);
    const fallen = new THREE.Vector3(b.fallDirX || 0, 0, -(b.fallDirY || 1)).normalize();
    const dir = upright.clone().lerp(fallen, Math.min(1, b.fallAngle / (Math.PI / 2))).normalize();
    mesh.quaternion.setFromUnitVectors(upright, dir);
    const lift = 4 * Math.cos(b.fallAngle) + 0.13 * Math.sin(b.fallAngle);
    const along = 4 * Math.sin(b.fallAngle);
    mesh.position.set(
      b.x + (b.fallDirX || 0) * along,
      Math.max(0.13, lift),
      -(b.y + (b.fallDirY || 1) * along),
    );
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
  stop_sign: 0xff3333,
  yield_sign: 0xffcc33,
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
  if (photoMode || collisionShotHold) return;

  const state = simulation.getState();
  const detections = state.perceptionTracks.filter(t => t.missedFrames === 0 && t.confidence >= 0.4);
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
  currEgoRoll = ego.bodyRoll ?? 0;
  currEgoPitch = ego.bodyPitch ?? 0;
  currSteer = ego.steering;
  currWheelSpin = ego.wheelSpin ?? 0;
}

function resetCameraRig() {
  orbitYaw = cameraMode === 'orbit' ? 0.6 : 0;
  orbitPitch = cameraMode === 'orbit' ? 0.42 : 0.22;
  orbitDist = cameraMode === 'orbit' ? ORBIT_DIST_DEFAULT : CHASE_DIST_DEFAULT;
  lastMouseCamMs = -1e9;
  rmbOrbiting = false;
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
    roll: prevEgoRoll + (currEgoRoll - prevEgoRoll) * alpha,
    pitch: prevEgoPitch + (currEgoPitch - prevEgoPitch) * alpha,
  };
}

function carLocalToWorld(
  lx: number, ly: number, lz: number,
  egoX: number, egoY: number, yaw: number
) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tx = lx * c + lz * s;
  const tz = -lx * s + lz * c;
  const simY = egoY - tz;
  return { x: egoX + tx, simY, y: AXLE_HEIGHT + ly, z: -simY };
}

let hoodLookWorldY = 1.15;

function followHeading(_egoX: number, _egoY: number, egoYaw: number): number {
  const state = simulation.getState().ego;
  const vx = state.velocity.x;
  const vy = state.velocity.y;
  const speed = Math.hypot(vx, vy);
  // Stay behind the nose. Do not swing onto the velocity vector (that reads as a slide)
  // and do not flip around when reversing.
  if (speed > 1.8 && (state.bodyVx ?? 0) > 1.2) {
    const velYaw = Math.atan2(vy, vx);
    let d = velYaw - egoYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.9) return egoYaw;
    const blend = clamp((speed - 1.8) / 8, 0, 0.25);
    return egoYaw + d * blend;
  }
  return egoYaw;
}

function updateCamera(dt: number, egoX: number, egoY: number, egoYaw: number) {
  if (isTripMenuOpen()) {
    menuOrbitYaw += dt * MENU_ORBIT_SPEED;
    const pitch = 0.38;
    const dist = 46;
    const lookX = egoX;
    const lookY = egoY;
    const posX = lookX + Math.sin(menuOrbitYaw) * Math.cos(pitch) * dist;
    const posY = Math.sin(pitch) * dist + 7;
    const posZ = -lookY + Math.cos(menuOrbitYaw) * Math.cos(pitch) * dist;
    applyCameraLayers(camera, false);
    camera.fov = 58;
    camera.near = 0.2;
    camera.updateProjectionMatrix();
    camera.position.set(posX, posY, posZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(lookX, 1.2, -lookY);
    return;
  }
  if (debugHeroCam) {
    const eye = carLocalToWorld(debugHeroCam.x, debugHeroCam.y, debugHeroCam.z, egoX, egoY, egoYaw);
    const look = carLocalToWorld(debugHeroCam.lookX, debugHeroCam.lookY, debugHeroCam.lookZ, egoX, egoY, egoYaw);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(look.x, look.y, look.z);
    return;
  }
  if (debugSideCam) {
    const rightX = Math.cos(egoYaw - Math.PI / 2);
    const rightY = Math.sin(egoYaw - Math.PI / 2);
    camera.position.set(
      egoX + rightX * debugSideCam.side,
      debugSideCam.height,
      -(egoY + rightY * debugSideCam.side)
    );
    camera.lookAt(egoX, debugSideCam.lookY, -egoY);
    return;
  }
  if (collisionCam) {
    camera.position.set(collisionCam.x, collisionCam.y, collisionCam.z);
    camera.lookAt(collisionCam.lookX, collisionCam.lookY, collisionCam.lookZ);
    return;
  }
  if (cameraMode === 'chase' && !rmbOrbiting && lastMouseCamMs > 0
    && (performance.now() - lastMouseCamMs) > CHASE_RETURN_DELAY * 1000) {
    orbitYaw = dampAngle(orbitYaw, 0, dt, 0.38);
    orbitPitch = damp(orbitPitch, 0.22, dt, 0.38);
  }

  let targetYaw = egoYaw;
  let targetLookX = egoX;
  let targetLookY = egoY;
  let targetPosX = egoX;
  let targetPosY = 8;
  let targetPosZ = -egoY;
  const tau = cameraMode === 'hood' ? 0.06 : CAMERA_LAG;

  if (cameraMode === 'chase') {
    const follow = followHeading(egoX, egoY, egoYaw);
    targetYaw = follow + Math.PI + orbitYaw;
    const dist = orbitDist;
    const height = Math.max(0.36, 2.15 + orbitPitch * 6.5);
    targetPosX = egoX + Math.cos(targetYaw) * dist;
    targetPosY = height;
    targetPosZ = -(egoY + Math.sin(targetYaw) * dist);
    targetLookX = egoX;
    targetLookY = egoY;
  } else if (cameraMode === 'hood') {
    // Locked later (no chase lag). Place a fallback target so other modes can ease out.
    if (egoEyeAnchor) {
      egoEyeAnchor.updateWorldMatrix(true, false);
      const p = new THREE.Vector3().setFromMatrixPosition(egoEyeAnchor.matrixWorld);
      targetPosX = p.x;
      targetPosY = p.y;
      targetPosZ = p.z;
    } else {
      const eye = carLocalToWorld(COCKPIT.eye.x, COCKPIT.eye.y, COCKPIT.eye.z, egoX, egoY, egoYaw);
      targetPosX = eye.x;
      targetPosY = eye.y;
      targetPosZ = eye.z;
    }
    const look = carLocalToWorld(COCKPIT.look.x, COCKPIT.look.y, COCKPIT.look.z, egoX, egoY, egoYaw);
    targetLookX = look.x;
    targetLookY = look.simY;
    hoodLookWorldY = look.y;
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
    camPosY = Math.max(0.36, 2.15 + orbitPitch * 6.5);
    camPosZ = -(camLookY + Math.sin(camYaw) * orbitDist);
  }

  const wantFov = shotFov ?? (cameraMode === 'hood' ? COCKPIT.fovDeg : 60);
  const wantNear = cameraMode === 'hood' ? 0.04 : 0.1;
  if (Math.abs(camera.fov - wantFov) > 0.1 || camera.near !== wantNear) {
    camera.fov = wantFov;
    camera.near = wantNear;
    camera.updateProjectionMatrix();
  }

  if (cameraMode === 'hood' && !debugHeroCam && !debugSideCam) {
    applyCameraLayers(camera, true);
    if (egoEyeAnchor && egoLookAnchor) {
      egoEyeAnchor.updateWorldMatrix(true, false);
      egoLookAnchor.updateWorldMatrix(true, false);
      camera.position.setFromMatrixPosition(egoEyeAnchor.matrixWorld);
      const look = new THREE.Vector3().setFromMatrixPosition(egoLookAnchor.matrixWorld);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      camPosX = camera.position.x;
      camPosY = camera.position.y;
      camPosZ = camera.position.z;
      return;
    }
    camera.position.set(targetPosX, targetPosY, targetPosZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(targetLookX, hoodLookWorldY, -targetLookY);
    camPosX = targetPosX;
    camPosY = targetPosY;
    camPosZ = targetPosZ;
    return;
  }

  applyCameraLayers(camera, false);
  camera.position.set(camPosX, camPosY, camPosZ);
  const lookZ = cameraMode === 'bev' ? 0 : Math.max(0.4, Math.min(1.15, camPosY * 0.4));
  camera.lookAt(camLookX, lookZ, -camLookY);
}

function isManual(): boolean {
  return simulation.getState().controlSource === 'human';
}

function syncDriveBadge() {
  const badge = document.getElementById('drive-badge');
  const control = document.getElementById('control-source');
  const manual = isManual();
  const arrived = simulation.hasArrived();
  const label = arrived && !manual ? 'ARRIVED' : manual ? 'MANUAL' : 'AUTOPILOT';
  if (badge) {
    badge.textContent = label;
    badge.classList.toggle('manual', manual);
  }
  document.getElementById('takeover-btn')?.classList.toggle('hidden', !gameStarted || manual);
  if (control) {
    control.textContent = label;
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
  applyCameraLayers(camera, mode === 'hood');
  document.querySelectorAll('#camera-seg button').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset['camera'] === mode);
  });
  updateViewExplainer();
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
  clearFurnitureVisuals();
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
  syncDestinationMarker();
  captureEgoPose();
  prevEgoX = currEgoX;
  prevEgoY = currEgoY;
  prevEgoYaw = currEgoYaw;
  prevEgoRoll = currEgoRoll;
  prevEgoPitch = currEgoPitch;
  applyQuality(qualityLevel);
  resetCameraRig();
  setPaused(false);
  gameStarted = false;
  const spawn = simulation.getState().ego.transform.position;
  tripMenu = createTripMenu({ x: spawn.x, y: spawn.y }, { stack: currentStack, camera: cameraMode === 'hood' ? 'hood' : 'chase' });
  syncTripMenuDom();
  syncDriveBadge();
}

function anyDriveHeld(): boolean {
  return inputState.forward || inputState.backward || inputState.left || inputState.right || inputState.brake;
}

function humanInputFromKeys() {
  return {
    throttle: inputState.forward ? 1 : 0,
    // Positive steer is a left turn (+yaw). A curves left, D curves right.
    steering: inputState.left ? 1 : inputState.right ? -1 : 0,
    brake: inputState.backward ? 1 : 0,
    handbrake: inputState.brake ? 1 : 0,
    gtaReverse: true,
  };
}

function persistPanels() {
  try { localStorage.setItem(PANEL_STORAGE_KEY, serializePanelStates(panelStates)); } catch { /* ignore */ }
}

function applyPanelDom() {
  const stack = document.getElementById('top-right-stack');
  stack?.classList.toggle('panels-hidden', panelsHidden);
  for (const id of PANEL_IDS) {
    const el = document.getElementById(PANEL_EL[id]);
    if (!el) continue;
    const st = panelStates[id]!;
    el.classList.toggle('closed', st.closed);
    el.classList.toggle('collapsed', st.collapsed);
    if (st.x !== null && st.y !== null) {
      const placed = avoidReserved(
        { id, x: st.x, y: st.y, w: el.offsetWidth || 320, h: el.offsetHeight || 80 },
        reservedHudRects(window.innerWidth, window.innerHeight),
        window.innerWidth,
        window.innerHeight,
      );
      el.classList.add('floating');
      el.style.left = `${placed.x}px`;
      el.style.top = `${placed.y}px`;
    } else {
      el.classList.remove('floating');
      el.style.left = '';
      el.style.top = '';
    }
  }
  showInfoCard = !panelStates.info.closed;
  if (!panelStates['ai-view'].closed && !panelsHidden) {
    /* keep showAIView as the 3D overlay preference */
  }
}

function setPanelClosed(id: PanelId, closed: boolean) {
  panelStates[id] = { ...panelStates[id]!, closed };
  if (id === 'ai-view') {
    showAIView = !closed;
    perceptionViz?.setEnabled(showAIView && cameraMode !== 'hood');
    try { localStorage.setItem('autonomy-ai-view', showAIView ? '1' : '0'); } catch { /* ignore */ }
  }
  if (id === 'info') showInfoCard = !closed;
  applyPanelDom();
  persistPanels();
}

function bindHudPanels() {
  let drag: { id: PanelId; dx: number; dy: number } | null = null;
  document.querySelectorAll('.hud-panel-min').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = (btn as HTMLElement).dataset['panel'] as PanelId;
      if (!id) return;
      panelStates[id] = { ...panelStates[id]!, collapsed: !panelStates[id]!.collapsed };
      applyPanelDom();
      persistPanels();
    });
  });
  document.querySelectorAll('.hud-panel-close').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = (btn as HTMLElement).dataset['panel'] as PanelId;
      if (!id) return;
      setPanelClosed(id, true);
    });
  });
  document.querySelectorAll('.hud-panel-head').forEach((head) => {
    (head as HTMLElement).addEventListener('pointerdown', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('button')) return;
      const panel = (head as HTMLElement).closest('.hud-panel') as HTMLElement | null;
      const id = panel?.dataset['panel'] as PanelId | undefined;
      if (!panel || !id) return;
      const rect = panel.getBoundingClientRect();
      drag = { id, dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
      panel.setPointerCapture?.(ev.pointerId);
    });
  });
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    panelStates[drag.id] = {
      ...panelStates[drag.id]!,
      x: ev.clientX - drag.dx,
      y: ev.clientY - drag.dy,
    };
    applyPanelDom();
  });
  window.addEventListener('pointerup', () => {
    if (drag) persistPanels();
    drag = null;
  });
}

function takeManual(auto = false) {
  if (!isManual()) {
    simulation.takeover('other');
    if (!auto) showDriveHintOnce();
  }
  syncDriveBadge();
}

function engageAutopilot() {
  if (!gameStarted) return;
  reengageIgnoreDrive = anyDriveHeld();
  const result = simulation.reengageAutopilot();
  autopilotBannerUntil = performance.now() + 2200;
  const banner = document.getElementById('decision-banner');
  if (banner) {
    banner.textContent = result.mode === 'trip' ? 'Autopilot engaged' : 'Autopilot engaged — cruising';
    banner.classList.add('visible');
    banner.classList.remove('slow', 'brake');
  }
  syncDriveBadge();
}

function setAutopilot(on: boolean) {
  if (on) engageAutopilot();
  else takeManual();
  syncDriveBadge();
}

function updateHUD() {
  const state = simulation.getState();
  const speed = vec3Length(state.ego.velocity) * 3.6;

  document.getElementById('speed-value')!.textContent = `${Math.round(speed)} km/h`;
  document.getElementById('stopping-dist')!.textContent = `${Math.round(state.ego.stoppingDistance)} m`;
  const signs = state.worldMap.staticEntities.filter(e => e.classType === 'stop_sign' || e.classType === 'yield_sign');
  if (currentStack === 'tesla') {
    latestVisionDetections = detectVisibleAgents(state.ego, [...state.trafficVehicles, ...state.pedestrians, ...signs]);
  }
  document.getElementById('detection-count')!.textContent =
    String(hudDetectionCount(currentStack, latestVisionDetections, state.perceptionTracks));
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
  updatePhysDebug();
  egoUpdateScreen?.({
    speedKmh: speed,
    autopilot: state.controlSource !== 'human',
    heading: state.ego.transform.rotation,
    x: state.ego.transform.position.x,
    y: state.ego.transform.position.y,
    banner: performance.now() < autopilotBannerUntil ? 'Autopilot engaged' : lastDecision.text,
  });
}

function updatePhysDebug() {
  const panel = document.getElementById('phys-debug');
  if (!panel) return;
  panel.classList.toggle('visible', showPhysDebug);
  if (!showPhysDebug) return;
  const ego = simulation.getState().ego;
  const speed = vec3Length(ego.velocity) * 3.6;
  const steerDeg = (ego.steering * 180) / Math.PI;
  const slipDeg = ((ego.slipAngle ?? 0) * 180) / Math.PI;
  const thrPct = Math.round(Math.abs(ego.throttleFiltered ?? ego.throttle) * 100);
  panel.innerHTML = [
    `<div>SPD  ${speed.toFixed(1)} km/h</div>`,
    `<div>GEAR ${formatGear(ego)}</div>`,
    `<div>RPM  ${Math.round(ego.rpm ?? 0)}</div>`,
    `<div>THR  ${thrPct}%</div>`,
    `<div>STR  ${steerDeg.toFixed(1)}°</div>`,
    `<div>SLIP ${slipDeg.toFixed(1)}°</div>`,
  ].join('');
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

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function syncCompareChrome() {
  document.getElementById('view-explainer')?.classList.toggle('hidden', compareMode);
  document.getElementById('bev-overlay')?.classList.toggle('visible', bevOverlayEnabled && !compareMode);
  document.getElementById('left-hud-stack')?.classList.toggle('hidden', compareMode);
  document.getElementById('drive-badge')?.classList.toggle('hidden', compareMode);
  document.getElementById('drive-hint')?.classList.toggle('visible', false);
  document.getElementById('decision-banner')?.classList.toggle('visible', showAIView && !compareMode);
  document.getElementById('minimap')?.classList.toggle('hidden', compareMode);
  applyPanelDom();
}

function updateViewExplainer(profile: StackProfile = currentStack) {
  const stack = STACK_VIEW_COPY[profile];
  const cam = CAMERA_VIEW_COPY[cameraMode];
  setText('view-explainer-title', stack.title);
  setText('view-explainer-uses', stack.uses);
  setText('view-explainer-diff', stack.diff);
  setText('camera-explainer-title', cam.title);
  setText('camera-explainer-uses', cam.uses);
  setText('camera-explainer-diff', cam.diff);
  setText('ai-view-header', `${aiViewTitle(profile)}  ·  V hide · G ground truth`);
  setText('ai-view-raw-label', `${stack.rawLabel} — click for 1st person`);
  setText('ai-view-perc-label', stack.percLabel);
  syncCompareChrome();
}

function fillCompareExplainer(side: 'left' | 'right', profile: StackProfile) {
  const copy = STACK_VIEW_COPY[profile];
  setText(`compare-${side}-ex-title`, copy.title);
  setText(`compare-${side}-uses`, copy.uses);
  setText(`compare-${side}-diff`, copy.diff);
}

function updateAIViewExplainer(profile: StackProfile = currentStack) {
  updateViewExplainer(profile);
}

function updateOverlaysForStack(profile: StackProfile) {
  bevOverlayEnabled = profile === 'waabi';
  const bevHud = document.getElementById('bev-overlay');
  if (bevHud) bevHud.classList.toggle('visible', bevOverlayEnabled);
  updateViewExplainer(profile);
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
  applyCameraLayers(compareCamera, false);
  
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
  fillCompareExplainer('left', currentStack);
  fillCompareExplainer('right', compareStack);
}

// GTA-style radar: roads drawn, map rotated so the car's forward is up.
function updateMinimap() {
  const canvas = document.getElementById('minimap') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const state = simulation.getState();
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a2a22';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 14);
  ctx.clip();

  const scale = minimapScale;
  const egoX = state.ego.transform.position.x;
  const egoY = state.ego.transform.position.y;
  const yaw = state.ego.transform.rotation;

  const toMap = (wx: number, wy: number) =>
    projectToMinimap(wx, wy, egoX, egoY, yaw, cx, cy, scale);

  const grid = 6;
  const block = 100;
  const half = (grid * block) / 2;
  const roadW = 14;

  const fillWorldRect = (x0: number, y0: number, x1: number, y1: number) => {
    const a = toMap(x0, y0);
    const b = toMap(x1, y0);
    const c = toMap(x1, y1);
    const d = toMap(x0, y1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  };

  ctx.fillStyle = '#d5d8dc';
  for (let i = 0; i <= grid; i++) {
    const pos = -half + i * block;
    fillWorldRect(pos - roadW / 2, -half, pos + roadW / 2, half);
    fillWorldRect(-half, pos - roadW / 2, half, pos + roadW / 2);
  }

  ctx.fillStyle = '#2c332c';
  for (const bld of state.worldMap.staticEntities) {
    if (bld.classType !== 'building') continue;
    const hw = bld.boundingBox.size.x / 2;
    const hd = bld.boundingBox.size.y / 2;
    fillWorldRect(bld.transform.position.x - hw, bld.transform.position.y - hd,
      bld.transform.position.x + hw, bld.transform.position.y + hd);
  }

  const routePts = autopilotRouteOnMinimap(
    state.controlSource,
    state.route,
    { x: egoX, y: egoY, yaw },
    { w, h },
    scale,
  );
  if (routePts) {
    const stroke = (width: number, color: string) => {
      ctx.beginPath();
      ctx.moveTo(routePts[0]!.x, routePts[0]!.y);
      for (let i = 1; i < routePts.length; i++) ctx.lineTo(routePts[i]!.x, routePts[i]!.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    const { halo, core } = routeStrokeWidths(scale);
    stroke(halo, ROUTE_HALO);
    stroke(core, ROUTE_CORE);
  }

  for (const inter of state.worldMap.controlledIntersections) {
    const p = toMap(inter.center.x, inter.center.y);
    if (p.x < -10 || p.y < -10 || p.x > w + 10 || p.y > h + 10) continue;
    if (inter.control === 'stop') {
      ctx.fillStyle = '#d12626';
      ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
    } else if (inter.control === 'yield') {
      ctx.fillStyle = '#f0d24b';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 4);
      ctx.lineTo(p.x + 4, p.y - 3);
      ctx.lineTo(p.x - 4, p.y - 3);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#8a8f96';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = '#f2c14e';
  for (const car of state.trafficVehicles) {
    const p = toMap(car.transform.position.x, car.transform.position.y);
    if (p.x < -8 || p.y < -8 || p.x > w + 8 || p.y > h + 8) continue;
    ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
  }
  ctx.fillStyle = '#ff66cc';
  for (const ped of state.pedestrians) {
    const p = toMap(ped.transform.position.x, ped.transform.position.y);
    if (p.x < -8 || p.y < -8 || p.x > w + 8 || p.y > h + 8) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const dest = simulation.getTripDestination();
  const destMark = dest
    ? destinationPinWorld(dest, simulation.getTripHeading())
    : null;
  const destPt = destinationOnMinimap(
    destMark,
    { x: egoX, y: egoY, yaw },
    { w, h },
    scale,
  );
  if (destPt && destPt.x > -16 && destPt.y > -16 && destPt.x < w + 16 && destPt.y < h + 16) {
    paintDestPin(ctx, destPt, scale);
  }

  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx - 6, cy + 7);
  ctx.lineTo(cx + 6, cy + 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.stroke();
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
    if (!down && !anyDriveHeld()) reengageIgnoreDrive = false;
    if (down && !isPaused && !reengageIgnoreDrive) {
      if (!isManual()) takeManual(true);
    }
  }
  return used;
}

let lastOrbitClientX = 0;
let lastOrbitClientY = 0;

function applyOrbitDrag(dx: number, dy: number) {
  orbitYaw -= dx * 0.0048;
  orbitPitch = clamp(orbitPitch + dy * 0.0032, -0.28, 1.15);
  lastMouseCamMs = performance.now();
}

function endOrbitDrag() {
  rmbOrbiting = false;
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

function setupInput() {
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (isPaused) return;
    if (e.button !== 2) return;
    if (cameraMode !== 'chase' && cameraMode !== 'orbit') return;
    e.preventDefault();
    rmbOrbiting = true;
    lastOrbitClientX = e.clientX;
    lastOrbitClientY = e.clientY;
    lastMouseCamMs = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    canvas.requestPointerLock?.().catch(() => { /* movementX / client delta still work */ });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!rmbOrbiting) return;
    let dx = e.movementX;
    let dy = e.movementY;
    if (dx === 0 && dy === 0) {
      dx = e.clientX - lastOrbitClientX;
      dy = e.clientY - lastOrbitClientY;
    }
    lastOrbitClientX = e.clientX;
    lastOrbitClientY = e.clientY;
    if (dx === 0 && dy === 0) return;
    applyOrbitDrag(dx, dy);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 2) endOrbitDrag();
  });
  canvas.addEventListener('pointercancel', () => endOrbitDrag());
  canvas.addEventListener('wheel', (e) => {
    if (cameraMode !== 'chase' && cameraMode !== 'orbit') return;
    e.preventDefault();
    const min = cameraMode === 'chase' ? 5.5 : 6;
    const max = cameraMode === 'chase' ? 20 : 70;
    orbitDist = clamp(orbitDist + e.deltaY * 0.02, min, max);
  }, { passive: false });

  const minimap = document.getElementById('minimap');
  minimap?.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Scroll down zooms out (more of the city). Scroll up zooms in.
    minimapScale = clamp(minimapScale * (e.deltaY > 0 ? 0.88 : 1.14), 0.4, 4.5);
    updateMinimap();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.repeat && (e.key === 'Escape' || e.key === 't' || e.key === 'T')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (isTripMenuOpen()) {
        if (tripMenu.phase === 'arrived') {
          tripMenu = dismissTripMenu(tripMenu);
          syncTripMenuDom();
        }
        return;
      }
      if (!gameStarted) return;
      togglePause();
      return;
    }
    if (isTripMenuOpen()) {
      if (e.key === 'Enter') {
        e.preventDefault();
        beginGame('autopilot');
      }
      if (e.key === 'F1') { e.preventDefault(); chooseMenuStack('tesla'); }
      if (e.key === 'F2') { e.preventDefault(); chooseMenuStack('waymo'); }
      if (e.key === 'F3') { e.preventDefault(); chooseMenuStack('waabi'); }
      return;
    }
    if (!gameStarted) return;
    if (isPaused) {
      if (e.key === 'Backspace') { e.preventDefault(); restartSim(); }
      return;
    }
    if (bindDriveKey(e, true)) return;

    switch (e.key.toLowerCase()) {
      case 't':
        setAutopilot(isManual());
        break;
      case 'p':
        e.preventDefault();
        {
          const next = panelsKeyAction(panelStates, panelsHidden);
          panelStates = next.states;
          panelsHidden = next.hidden;
          if (!panelStates['ai-view'].closed && !panelsHidden) showAIView = true;
          applyPanelDom();
          persistPanels();
        }
        break;
      case 'c': {
        const modes: CameraMode[] = ['chase', 'hood', 'bev', 'orbit'];
        setCameraMode(modes[(modes.indexOf(cameraMode) + 1) % modes.length]!);
        break;
      }
      case 'v':
        setPanelClosed('ai-view', !panelStates['ai-view'].closed);
        document.getElementById('decision-banner')!.classList.toggle('visible', showAIView);
        break;
      case 'g':
        showGroundTruth = !showGroundTruth;
        break;
      case 'i':
        setPanelClosed('info', !panelStates.info.closed);
        if (!panelStates.info.closed) updateInfoCard();
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
          fillCompareExplainer('left', currentStack);
          fillCompareExplainer('right', compareStack);
        }
        updateViewExplainer();
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
  document.getElementById('gear-btn')?.addEventListener('click', () => {
    if (!gameStarted || isTripMenuOpen()) return;
    togglePause();
  });
  document.querySelectorAll('#quality-seg button').forEach(btn => {
    btn.addEventListener('click', () => applyQuality((btn as HTMLElement).dataset['quality'] as QualityLevel));
  });
  document.querySelectorAll('#camera-seg button').forEach(btn => {
    btn.addEventListener('click', () => setCameraMode((btn as HTMLElement).dataset['camera'] as CameraMode));
  });
  document.getElementById('pause-reset-camera')?.addEventListener('click', () => resetCameraRig());
  document.getElementById('shadow-toggle')?.addEventListener('change', (ev) => {
    shadowMode = (ev.target as HTMLInputElement).checked;
    document.body.dataset['shadowMode'] = shadowMode ? 'on' : 'off';
  });
  document.getElementById('perception-model')?.addEventListener('change', () => {
    /* heuristic vs v1 is displayed in the pause menu; ONNX path uses the same HUD */
  });
  document.getElementById('phys-debug-toggle')?.addEventListener('change', (ev) => {
    showPhysDebug = (ev.target as HTMLInputElement).checked;
    updatePhysDebug();
  });
  document.getElementById('decision-banner')?.addEventListener('click', () => {
    if (!gameStarted || isPaused || isTripMenuOpen()) return;
    setAutopilot(isManual());
  });
  bindHudPanels();

  const startMap = document.getElementById('start-map') as HTMLCanvasElement | null;
  startMap?.addEventListener('click', (ev) => {
    const rect = startMap.getBoundingClientRect();
    const sx = (ev.clientX - rect.left) * (startMap.width / rect.width);
    const sy = (ev.clientY - rect.top) * (startMap.height / rect.height);
    const world = startMapToWorld(sx, sy, startMap.width, startMap.height);
    tripMenu = pickTripDestination(tripMenu, world.x, world.y);
    syncTripMenuDom();
  });
  document.getElementById('start-manual')?.addEventListener('click', () => beginGame('manual'));
  document.getElementById('start-auto')?.addEventListener('click', () => beginGame('autopilot'));
  document.getElementById('start-random')?.addEventListener('click', () => {
    tripMenu = pickRandomDestination(tripMenu);
    syncTripMenuDom();
  });
  document.querySelectorAll('.stack-card').forEach(btn => {
    btn.addEventListener('click', () => {
      chooseMenuStack((btn as HTMLElement).dataset['profile'] as StackProfile);
    });
  });
  document.querySelectorAll('#start-camera-seg button').forEach(btn => {
    btn.addEventListener('click', () => {
      const cam = (btn as HTMLElement).dataset['camera'] as 'chase' | 'hood';
      tripMenu = setTripCamera(tripMenu, cam);
      syncTripMenuDom();
    });
  });
  document.getElementById('takeover-btn')?.addEventListener('click', () => takeManual());
  document.getElementById('raw-camera-canvas')?.addEventListener('click', () => {
    if (!gameStarted || isTripMenuOpen()) return;
    setCameraMode(cameraMode === 'hood' ? 'chase' : 'hood');
  });
  syncTripMenuDom();
}

function chooseMenuStack(profile: StackProfile) {
  tripMenu = setTripStack(tripMenu, profile);
  switchStack(profile);
  syncTripMenuDom();
}

function syncTripMenuDom() {
  const open = isTripMenuOpen();
  document.body.classList.toggle('trip-menu-open', open);
  document.getElementById('start-menu')?.classList.toggle('hidden', !open);
  const banner = document.getElementById('start-arrived-banner');
  if (banner) {
    const text = menuBanner(tripMenu);
    banner.textContent = text ?? 'Arrived — choose next destination';
    banner.classList.toggle('visible', !!text);
  }
  const title = document.getElementById('start-title');
  if (title) title.textContent = menuTitle(tripMenu);
  const lead = document.getElementById('start-lead');
  if (lead) lead.textContent = menuLead(tripMenu);
  const status = document.getElementById('start-status');
  if (status) status.textContent = menuStatus(tripMenu);
  document.querySelectorAll('.stack-card').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset['profile'] === tripMenu.stack);
  });
  document.querySelectorAll('#start-camera-seg button').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset['camera'] === tripMenu.camera);
  });
  const auto = document.getElementById('start-auto') as HTMLButtonElement | null;
  if (auto) {
    auto.disabled = !canStart(tripMenu);
    auto.textContent = tripMenu.phase === 'arrived' ? 'Continue' : 'Start';
  }
  const manual = document.getElementById('start-manual') as HTMLButtonElement | null;
  if (manual) manual.textContent = 'Just drive';
  drawStartMap();
}

function drawStartMap() {
  const canvas = document.getElementById('start-map') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const buildings = simulation
    ? simulation.getState().worldMap.staticEntities
      .filter(e => e.classType === 'building')
      .map(b => ({
        x: b.transform.position.x,
        y: b.transform.position.y,
        hx: b.boundingBox.size.x / 2,
        hy: b.boundingBox.size.y / 2,
      }))
    : [];
  const route = tripMenu.destination
    ? tripRoute(
      { x: tripMenu.start.x, y: tripMenu.start.y, z: 0 },
      { x: tripMenu.destination.x, y: tripMenu.destination.y, z: 0 },
    )
    : undefined;
  const heading = simulation?.getState().ego.transform.rotation;
  drawStartCityMap(ctx, canvas.width, canvas.height, {
    start: tripMenu.start,
    startHeading: heading,
    destination: tripMenu.destination,
    buildings,
    route,
  });
}

function armMenuTrip(start: { x: number; y: number }, end: { x: number; y: number }) {
  tripMenu = pickTripDestination(createTripMenu(start, {
    stack: tripMenu.stack,
    camera: tripMenu.camera,
  }), end.x, end.y);
}

function beginGame(mode: 'manual' | 'autopilot') {
  if (mode === 'autopilot') {
    if (!canStart(tripMenu) || !tripMenu.destination) return;
    simulation.beginTrip(
      { x: tripMenu.start.x, y: tripMenu.start.y, z: 0 },
      { x: tripMenu.destination.x, y: tripMenu.destination.y, z: 0 },
      'policy',
    );
    tripMenu = startTrip(tripMenu);
  } else if (tripMenu.destination) {
    simulation.beginTrip(
      { x: tripMenu.start.x, y: tripMenu.start.y, z: 0 },
      { x: tripMenu.destination.x, y: tripMenu.destination.y, z: 0 },
      'human',
    );
    tripMenu = startTrip(tripMenu);
  } else {
    simulation.beginParked({ x: tripMenu.start.x, y: tripMenu.start.y, z: 0 }, simulation.getState().ego.transform.rotation);
    tripMenu = justDrive(tripMenu);
  }
  gameStarted = true;
  switchStack(tripMenu.stack);
  setCameraMode(tripMenu.camera);
  inputState.forward = false;
  inputState.backward = false;
  inputState.left = false;
  inputState.right = false;
  inputState.brake = false;
  captureEgoPose();
  prevEgoX = currEgoX;
  prevEgoY = currEgoY;
  prevEgoYaw = currEgoYaw;
  prevEgoRoll = currEgoRoll;
  prevEgoPitch = currEgoPitch;
  syncTripMenuDom();
  syncDriveBadge();
  if (mode === 'manual') showDriveHintOnce();
}

function hideChrome() {
  photoMode = true;
  showAIView = false;
  showGroundTruth = false;
  document.body.dataset['shot'] = 'on';
  document.getElementById('status-panel')?.classList.add('hidden');
  document.getElementById('left-hud-stack')?.classList.add('hidden');
  document.getElementById('drive-badge')?.classList.add('hidden');
  document.getElementById('ai-view-panel')?.classList.remove('visible');
  document.getElementById('decision-banner')?.classList.remove('visible');
  document.getElementById('view-explainer')?.classList.add('hidden');
  document.getElementById('drive-hint')?.classList.remove('visible');
  document.getElementById('bev-overlay')?.classList.remove('visible');
  document.getElementById('minimap')?.classList.add('hidden');
  document.getElementById('start-menu')?.classList.add('hidden');
  document.getElementById('view-switcher')?.classList.add('hidden');
  document.getElementById('controls-hint')?.classList.add('hidden');
  document.getElementById('top-right-stack')?.classList.add('hidden');
  document.getElementById('gear-btn')?.classList.add('hidden');
  document.querySelector('.disclaimer')?.classList.add('hidden');
  perceptionViz?.setEnabled(false);
}

/** Screenshot / demo rigs: ?shot=cabin|cabin-a|cabin-d|cabin-wide|exterior|exterior-hood|side|wheel */
function applyShot(kind: string) {
  suppressArrivedMenu = true;
  beginGame('manual');
  hideChrome();
  takeManual(true);
  inputState.left = false;
  inputState.right = false;
  debugSideCam = null;
  debugHeroCam = null;
  shotHandDeg = null;
  shotFov = null;
  if (kind === 'cabin' || kind === 'cabin-a' || kind === 'cabin-d' || kind === 'cabin-wide') {
    setCameraMode('hood');
    if (kind === 'cabin-a') {
      inputState.left = true;
      shotHandDeg = HAND_LOCK_DEG;
    }
    if (kind === 'cabin-d') {
      inputState.right = true;
      shotHandDeg = -HAND_LOCK_DEG;
    }
    if (kind === 'cabin-wide') {
      shotFov = COCKPIT.wideFovDeg;
    }
  } else if (kind === 'exterior') {
    setCameraMode('orbit');
    debugHeroCam = { x: 4.6, y: 1.4, z: -3.4, lookX: 0.15, lookY: 0.58, lookZ: 0.0 };
  } else if (kind === 'exterior-hood') {
    setCameraMode('orbit');
    debugHeroCam = { x: 2.4, y: 5.4, z: 0.05, lookX: 0.9, lookY: 0.62, lookZ: 0.0 };
  } else if (kind === 'side') {
    debugSideCam = { height: 0.55, side: 6.2, lookY: 0.62 };
  } else if (kind === 'wheel') {
    setCameraMode('orbit');
    debugHeroCam = { x: 1.22, y: 0.32, z: -1.55, lookX: 1.22, lookY: 0.22, lookZ: -0.52 };
  }
}

/** Demos: ?demo=lane|left|right|stop|yield|mix|queue|arrive|arrive-opp, plus hit-car|hit-pole|hit-sign|hit-ped */
function applyDemo(kind: string) {
  suppressArrivedMenu = true;
  showAIView = true;
  document.getElementById('ai-view-panel')?.classList.add('visible');
  document.getElementById('decision-banner')?.classList.add('visible');
  perceptionViz?.setEnabled(true);

  if (kind === 'arrive') {
    armMenuTrip({ x: 0, y: 50 }, { x: 0, y: 78 });
    beginGame('autopilot');
    simulation.getState().trafficVehicles = [];
    simulation.getState().pedestrians = [];
    setCameraMode('orbit');
    orbitYaw = 0.2;
    orbitPitch = 0.34;
    orbitDist = 20;
    camFollowReady = true;
    return;
  }
  if (kind === 'arrive-opp') {
    armMenuTrip({ x: 0, y: 55 }, { x: -5, y: 78 });
    beginGame('autopilot');
    simulation.getState().trafficVehicles = [];
    simulation.getState().pedestrians = [];
    setCameraMode('orbit');
    orbitYaw = 0.15;
    orbitPitch = 0.38;
    orbitDist = 22;
    camFollowReady = true;
    return;
  }
  if (kind === 'lane') {
    armMenuTrip({ x: 0, y: -90 }, { x: 0, y: 160 });
    beginGame('autopilot');
    setCameraMode('orbit');
    orbitYaw = -0.7;
    orbitPitch = 0.32;
    orbitDist = 16;
    camFollowReady = true;
    return;
  }
  if (kind === 'left') {
    armMenuTrip({ x: 0, y: -90 }, { x: -160, y: 0 });
    beginGame('autopilot');
    setCameraMode('orbit');
    orbitYaw = 0.35;
    orbitPitch = 0.38;
    orbitDist = 18;
    camFollowReady = true;
    return;
  }
  if (kind === 'right') {
    armMenuTrip({ x: 0, y: -90 }, { x: 160, y: 0 });
    beginGame('autopilot');
    setCameraMode('orbit');
    orbitYaw = -1.2;
    orbitPitch = 0.38;
    orbitDist = 18;
    camFollowReady = true;
    return;
  }
  if (kind === 'stop') {
    simulation.getState().pedestrians = [];
    armMenuTrip({ x: 0, y: -20 }, { x: 0, y: 80 });
    beginGame('autopilot');
    setCameraMode('orbit');
    orbitYaw = -0.85;
    orbitPitch = 0.22;
    orbitDist = 14;
    camFollowReady = true;
    return;
  }
  if (kind === 'yield') {
    simulation.getState().pedestrians = [];
    beginGame('manual');
    simulation.beginParked({ x: -109, y: -3.5, z: 0 }, 0);
    setCameraMode('orbit');
    orbitYaw = -0.95;
    orbitPitch = 0.2;
    orbitDist = 13;
    camFollowReady = true;
    return;
  }
  if (kind === 'mix') {
    beginGame('manual');
    setCameraMode('bev');
    minimapScale = 0.42;
    return;
  }
  if (kind === 'queue') {
    beginGame('manual');
    const state = simulation.getState();
    const yawAt = (x: number, y: number, yaw: number, id: number) => ({
      id,
      classType: 'car' as const,
      transform: { position: { x, y, z: 0.8 }, rotation: yaw },
      boundingBox: { center: { x, y, z: 0.8 }, size: { x: 4.5, y: 1.8, z: 1.5 }, yaw },
      velocity: { x: 0, y: 0, z: 0 },
      isStatic: false,
      occlusionLevel: 0 as const,
      laneId: 0,
      laneProgress: 0.4,
      targetSpeed: 0,
    });
    state.pedestrians = [];
    state.trafficVehicles = [
      yawAt(3.5, -12, Math.PI / 2, 501),
      yawAt(12, 3.5, Math.PI, 502),
      yawAt(-3.5, 12, -Math.PI / 2, 503),
      yawAt(-12, -3.5, 0, 504),
    ];
    simulation.beginParked({ x: 22, y: -22, z: 0 }, (3 * Math.PI) / 4);
    setCameraMode('orbit');
    orbitYaw = 0.95;
    orbitPitch = 0.42;
    orbitDist = 32;
    camFollowReady = true;
    return;
  }
  if (kind === 'hit-car' || kind === 'hit-pole' || kind === 'hit-sign' || kind === 'hit-ped') {
    const hit = kind === 'hit-car' ? 'car'
      : kind === 'hit-pole' ? 'pole'
        : kind === 'hit-sign' ? 'sign'
          : 'pedestrian';
    beginGame('manual');
    simulation.setupHitDemo(hit);
    if (hit === 'pole' || hit === 'sign') rebuildStaticCity();
    collisionShotHold = true;
    collisionShotAt = 0;
    showAIView = false;
    showGroundTruth = false;
    document.getElementById('ai-view-panel')?.classList.remove('visible');
    document.getElementById('view-explainer')?.classList.add('hidden');
    document.getElementById('info-card')?.classList.add('hidden');
    document.getElementById('top-right-stack')?.classList.add('hidden');
    for (const id of ['ai-view-panel', 'view-explainer', 'info-card', 'top-right-stack']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    perceptionViz?.setEnabled(false);
    setCameraMode('orbit');
    orbitYaw = -2.35;
    orbitPitch = 0.42;
    orbitDist = 9;
    camFollowReady = true;
  }
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

  if (gameStarted && !isPaused && !isTripMenuOpen()) {
    const humanInput = isManual() ? humanInputFromKeys() : undefined;
    simAccumulator += frameDt;
    if (simAccumulator > 0.25) simAccumulator = 0.25;
    while (simAccumulator >= SIM_DT) {
      prevEgoX = currEgoX;
      prevEgoY = currEgoY;
      prevEgoYaw = currEgoYaw;
      prevEgoRoll = currEgoRoll;
      prevEgoPitch = currEgoPitch;
      simulation.step(SIM_DT, humanInput);
      captureEgoPose();
      updateEntityMeshes();
      updateDetectionMeshes();
      simAccumulator -= SIM_DT;
      if (
        !suppressArrivedMenu
        && tripMenu.phase === 'driving'
        && simulation.hasArrived()
      ) {
        const pos = simulation.getState().ego.transform.position;
        tripMenu = onArrived(tripMenu, { x: pos.x, y: pos.y });
        if (isPaused) setPaused(false);
        syncTripMenuDom();
        break;
      }
      if (collisionShotHold && simulation.getState().collisionCount > 0 && collisionShotAt === 0) {
        collisionShotAt = time;
        const st = simulation.getState();
        let lookX = st.ego.transform.position.x;
        let lookY = st.ego.transform.position.y;
        const ev = st.lastCollision;
        if (ev) {
          const other = [...st.trafficVehicles, ...st.pedestrians, ...st.worldMap.staticEntities]
            .find(e => e.id === ev.otherId);
          if (other) {
            lookX = (lookX + other.transform.position.x) * 0.5;
            lookY = (lookY + other.transform.position.y) * 0.5;
          }
        }
        collisionCam = {
          x: lookX + 6.4,
          y: 4.6,
          z: -(lookY - 5.6),
          lookX,
          lookY: 0.55,
          lookZ: -lookY,
        };
        syncDriveBadge();
      }
    }
  }

  if (collisionShotHold && collisionShotAt > 0 && time - collisionShotAt > 700 && !isPaused) {
    isPaused = true;
    syncDriveBadge();
    updateHUD();
  }

  const alpha = isPaused ? 1 : simAccumulator / SIM_DT;
  const ego = interpolatedEgo(alpha);
  egoMesh.position.set(ego.x, 0, -ego.y);
  egoMesh.rotation.set(0, meshYawForHeading(ego.yaw), 0);
  if (egoBodyPivot) {
    const att = clampCosmeticAttitude(ego.roll, ego.pitch);
    egoBodyPivot.rotation.order = 'YXZ';
    egoBodyPivot.rotation.x = att.pitch;
    egoBodyPivot.rotation.z = -att.roll;
  }
  for (const wheel of egoWheels) {
    wheel.pivot.rotation.y = wheel.front ? currSteer : 0;
    if (wheel.spinAxis === 'x') wheel.mesh.rotation.x = currWheelSpin;
    else wheel.mesh.rotation.y = currWheelSpin;
  }
  if (egoSteerWheel) {
    // A is +steer (left). The hand wheel turns farther than the road wheels.
    egoSteerWheel.rotation.x = shotHandDeg !== null
      ? -(shotHandDeg * Math.PI) / 180
      : handWheelRotation(currSteer);
  }
  updateCamera(frameDt, ego.x, ego.y, ego.yaw);
  syncDestinationMarker();

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

  if (perceptionViz) {
    perceptionViz.group.visible = showAIView && cameraMode !== 'hood' && !compareMode;
  }
  if (!compareMode) renderer.render(scene, camera);
}

function updateAIView(drawRawScene: boolean) {
  const banner = document.getElementById('decision-banner');
  const state = simulation.getState();
  const signs = state.worldMap.staticEntities.filter(e => e.classType === 'stop_sign' || e.classType === 'yield_sign');
  const agents = [...state.trafficVehicles, ...state.pedestrians, ...signs];
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
    controlSource: state.controlSource,
    rule: state.lastRule,
  };

  if (perceptionViz) {
    perceptionViz.setEnabled(showAIView && cameraMode !== 'hood');
    lastDecision = perceptionViz.update(input);
  } else {
    lastDecision = { text: 'Cruising: lane clear', severity: 'go' };
  }

  if (banner) {
    const engaged = performance.now() < autopilotBannerUntil;
    banner.textContent = engaged ? 'Autopilot engaged' : lastDecision.text;
    banner.classList.toggle('visible', !compareMode);
    banner.classList.toggle('slow', !engaged && lastDecision.severity === 'slow');
    banner.classList.toggle('brake', !engaged && lastDecision.severity === 'brake');
  }

  if (!showAIView) return;

  updateAIViewExplainer(currentStack);

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

async function createEgoVehicle(): Promise<THREE.Group> {
  const visual = await loadEgoVisual();
  egoBodyPivot = visual.bodyPivot;
  egoSteerWheel = visual.steerWheel;
  egoWheels = visual.wheels;
  egoEyeAnchor = visual.eyeAnchor;
  egoLookAnchor = visual.lookAnchor;
  egoUpdateScreen = visual.updateScreen;
  return visual.group;
}

async function init() {
  console.log('Initializing AUTONOMY CITY...');
  const kernels = await loadWasmKernels();
  console.log(`[autonomy-sim] kernels available=${kernels.available} (castRays=${typeof getWasmKernels().castRays})`);

  initThreeJS();

  const seedParam = Number(new URLSearchParams(window.location.search).get('seed'));
  simulation = new Simulation({
    seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 3,
    profile: 'baseline_lidar',
    environment: { timeOfDay: 'day', weather: 'clear', visibility: 1 },
    useOracle: false,
    maxDuration: 3600,
  });
  {
    const spawn = simulation.getState().ego.transform.position;
    tripMenu = createTripMenu({ x: spawn.x, y: spawn.y });
  }

  scene.remove(egoMesh);
  const egoGroup = await createEgoVehicle();
  scene.add(egoGroup);
  egoMesh = egoGroup as unknown as THREE.Mesh;

  perceptionViz = new PerceptionVisualizer(scene);
  try {
    const stored = localStorage.getItem('autonomy-ai-view');
    if (stored === '0') showAIView = false;
    panelStates = parsePanelStates(localStorage.getItem(PANEL_STORAGE_KEY));
    if (!showAIView) panelStates['ai-view'] = { ...panelStates['ai-view']!, closed: true };
  } catch { /* ignore */ }
  applyPanelDom();
  document.getElementById('decision-banner')?.classList.toggle('visible', true);
  perceptionViz.setEnabled(showAIView && cameraMode !== 'hood');
  updateAIViewExplainer(currentStack);

  const rawCanvas = document.getElementById('raw-camera-canvas') as HTMLCanvasElement | null;
  if (rawCanvas) {
    rawCameraRenderer = new THREE.WebGLRenderer({ canvas: rawCanvas, antialias: false, alpha: false });
    rawCameraRenderer.setSize(320, 180, false);
    rawCameraRenderer.setPixelRatio(1);
    rawCamera = new THREE.PerspectiveCamera(70, 320 / 180, 0.2, 200);
    applyCameraLayers(rawCamera, false);
  }

  applyQuality('med');
  rebuildStaticCity();
  destinationMarker = createDestinationMarker();
  scene.add(destinationMarker);
  syncDestinationMarker();
  captureEgoPose();
  prevEgoX = currEgoX;
  prevEgoY = currEgoY;
  prevEgoYaw = currEgoYaw;
  prevEgoRoll = currEgoRoll;
  prevEgoPitch = currEgoPitch;
  setupInput();
  syncDriveBadge();

  document.getElementById('loading')!.classList.add('hidden');
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (shot) applyShot(shot);
  const demo = params.get('demo');
  if (demo) applyDemo(demo);
  if (params.get('pause') === '1') isPaused = true;
  lastTime = performance.now();
  requestAnimationFrame(animate);
  (window as unknown as { __autonomyDebug: Record<string, unknown> }).__autonomyDebug = {
    setOrbit(yaw: number, pitch: number, dist: number) {
      debugSideCam = null;
      cameraMode = 'orbit';
      orbitYaw = yaw;
      orbitPitch = pitch;
      orbitDist = dist;
      camFollowReady = true;
      updateViewExplainer();
    },
    setLowSideCam() {
      debugSideCam = { height: 0.28, side: 5.8, lookY: 0.36 };
    },
    freezeSim() {
      isPaused = true;
    },
    unfreezeSim() {
      isPaused = false;
    },
    setPhotoHud() {
      photoMode = true;
      showPhysDebug = true;
      showAIView = false;
      showGroundTruth = false;
      const box = document.getElementById('phys-debug-toggle') as HTMLInputElement | null;
      if (box) box.checked = true;
      document.getElementById('phys-debug')?.classList.add('visible');
      document.getElementById('ai-view-panel')?.classList.remove('visible');
      document.getElementById('view-explainer')?.classList.add('hidden');
      document.getElementById('bev-overlay')?.classList.remove('visible');
      document.getElementById('decision-banner')?.classList.remove('visible');
      document.getElementById('drive-hint')?.classList.remove('visible');
      perceptionViz?.setEnabled(false);
    },
    enablePhysDebug() {
      showPhysDebug = true;
      const box = document.getElementById('phys-debug-toggle') as HTMLInputElement | null;
      if (box) box.checked = true;
    },
    applyShot,
    setCameraMode,
    switchStack,
    getTripDestination: () => simulation.getTripDestination(),
    hasArrived: () => simulation.hasArrived(),
    getTripMenu: () => ({ ...tripMenu }),
    pickMenuDestination(x: number, y: number) {
      tripMenu = pickTripDestination(tripMenu, x, y);
      syncTripMenuDom();
    },
    startFromMenu() {
      beginGame('autopilot');
    },
    forceArrivedMenu() {
      const pos = simulation.getState().ego.transform.position;
      tripMenu = onArrived(tripMenu, { x: pos.x, y: pos.y });
      syncTripMenuDom();
    },
    clearAgents() {
      simulation.getState().trafficVehicles = [];
      simulation.getState().pedestrians = [];
    },
    getTripHeading: () => simulation.getTripHeading(),
    getEgo: () => {
      const e = simulation.getState().ego;
      return {
        x: e.transform.position.x,
        y: e.transform.position.y,
        yaw: e.transform.rotation,
        speed: Math.hypot(e.velocity.x, e.velocity.y),
      };
    },
    setMinimapScale(s: number) {
      minimapScale = clamp(s, 0.4, 4.5);
    },
    getFps: () => displayFps,
    f3Work: () => ({ ...f3WorkStats }),
    holdSteer(dir: 'left' | 'right' | 'none') {
      inputState.left = dir === 'left';
      inputState.right = dir === 'right';
    },
  };
  console.log('AUTONOMY CITY started!');
}

init();
