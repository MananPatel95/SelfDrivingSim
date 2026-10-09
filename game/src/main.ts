/**
 * Main game entry point
 * Browser-based 3D visualization with Three.js
 */

import * as THREE from 'three';
import { Simulation, ZoneType } from './sim/simulation';
import { vec3Length } from './sim/math';
import type { TakeoverReason } from './sim/types';
import { WAYMO_INFO_CARD } from './stacks/waymo';
import { 
  WAABI_INFO_CARD, WaabiStackState, runWaabiStack, 
  BEVOccupancy, AdversarialVariant 
} from './stacks/waabi';
import { TESLA_INFO_CARD } from './stacks/tesla';
import { AURORA_INFO_CARD, TruckingState } from './stacks/aurora';
import { RAIL_INFO_CARD, RailState, calculateRailBrakingDistance } from './stacks/rail';
import { 
  MARITIME_INFO_CARD, MaritimeState,
  calculateCPATCPA, determineCOLREGSRule
} from './stacks/maritime';
import { generateHighwayMap, generateRailMap } from './sim/world';

// Waabi stack state
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

// Maritime stack state
let maritimeState: MaritimeState = {
  tracks: [],
  aisTargets: [
    { mmsi: 123456789, name: 'CARGO STAR', position: { x: -80, y: 100, z: 0 }, courseOverGround: Math.PI / 4, speedOverGround: 5, heading: Math.PI / 4, vesselType: 'cargo', length: 150, beam: 25 },
    { mmsi: 234567890, name: 'TANKER PRIME', position: { x: 60, y: -80, z: 0 }, courseOverGround: -Math.PI / 3, speedOverGround: 4, heading: -Math.PI / 3, vesselType: 'tanker', length: 200, beam: 30 },
    { mmsi: 345678901, name: 'FERRY SWIFT', position: { x: 100, y: 150, z: 0 }, courseOverGround: Math.PI, speedOverGround: 8, heading: Math.PI, vesselType: 'passenger', length: 100, beam: 20 },
  ],
  colregsActions: new Map(),
  ownHeading: 0,
  ownSpeed: 5,
  rudderAngle: 0,
  engineThrottle: 0.5,
};

// Rail stack state
let railState: RailState = {
  tracks: [],
  currentSignal: { id: 1, position: { x: 200, y: 0, z: 0 }, state: 'stop', distanceToStop: 200 },
  nextSignals: [],
  currentSpeed: 0,
  targetSpeed: 0,
  brakingDistance: 500,
  emergencyBraking: false,
  gradeCrossings: [{ id: 1, position: { x: 150, y: 0, z: 0 }, state: 'active', hasObstruction: true }],
};

// Trucking stack state (for future use in highway perception)
const _truckingState: TruckingState = {
  tracks: [],
  currentLane: 1,
  targetLane: 1,
  laneChangeProgress: 0,
  brakingDelay: 0.3,
  blindSpotOccupied: { left: false, right: false },
};
void _truckingState; // Silence unused warning

// Stack types available (F1-F6 per spec)
type StackProfile = 'tesla' | 'waymo' | 'waabi' | 'aurora' | 'rail' | 'maritime';

// Info card data for each stack
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
  aurora: AURORA_INFO_CARD,
  rail: RAIL_INFO_CARD,
  maritime: MARITIME_INFO_CARD,
};

// Game state
let simulation: Simulation;
let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let cameraMode: 'chase' | 'topdown' | 'cockpit' = 'chase';
let isRecording = false;
let showGroundTruth = false;
let showAIView = false;
let showInfoCard = false;
let isPaused = false;
let currentStack: StackProfile = 'tesla';
let compareMode = false;

// Compare mode state
let compareRenderer: THREE.WebGLRenderer | null = null;
let leftRenderer: THREE.WebGLRenderer | null = null;
let compareCamera: THREE.PerspectiveCamera | null = null;
let compareStack: StackProfile = 'waymo';

// Detection timing tracking for compare mode
interface DetectionTiming {
  entityId: number;
  classType: string;
  firstDetectedByLeft: number | null;
  firstDetectedByRight: number | null;
}
const detectionTimings: Map<number, DetectionTiming> = new Map();
let compareStartTime = 0;

// Human input state
const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
};

// 3D meshes
let egoMesh: THREE.Mesh;
const entityMeshes = new Map<number, THREE.Mesh>();
const detectionMeshes: THREE.Mesh[] = [];
let groundMesh: THREE.Mesh;

// Zone-specific objects
let currentZone: ZoneType = 'city';
let waterMesh: THREE.Mesh | null = null;
let trackMeshes: THREE.Line[] = [];
let buoyMeshes: THREE.Mesh[] = [];
let aisOverlayEnabled = false;
let bevOverlayEnabled = false;
let simWorldOverlay: THREE.Group | null = null;

// Initialize Three.js
function initThreeJS() {
  const container = document.getElementById('canvas-container')!;
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky blue
  scene.fog = new THREE.Fog(0x87ceeb, 100, 500);
  
  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, -10, 8);
  camera.lookAt(0, 0, 0);
  
  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);
  
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.position.set(100, 100, 100);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 500;
  sunLight.shadow.camera.left = -200;
  sunLight.shadow.camera.right = 200;
  sunLight.shadow.camera.top = 200;
  sunLight.shadow.camera.bottom = -200;
  scene.add(sunLight);
  
  // Ground - grass/terrain base
  const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x2d5a27, // Grass green
    roughness: 0.95,
  });
  groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  
  // Build proper city roads, sidewalks, crosswalks
  buildCityRoads();
  
  // Ego vehicle
  const egoGeometry = new THREE.BoxGeometry(4.5, 1.8, 1.5);
  const egoMaterial = new THREE.MeshStandardMaterial({ color: 0x0066cc });
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

// Build proper city roads with lanes, sidewalks, crosswalks
function buildCityRoads() {
  // Clear any existing road meshes
  for (const mesh of cityRoadMeshes) {
    scene.remove(mesh);
  }
  cityRoadMeshes = [];
  
  const gridSize = 6;
  const blockSize = 100;
  const roadWidth = 14; // Total road width (2 lanes each direction + markings)
  const sidewalkWidth = 3;
  const laneWidth = 3.5;
  const halfSize = (gridSize * blockSize) / 2;
  
  // Materials
  const asphaltMat = new THREE.MeshStandardMaterial({ 
    color: 0x1a1a1a, // Dark asphalt
    roughness: 0.9,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({ 
    color: 0x999999, // Concrete gray
    roughness: 0.8,
  });
  const curbMat = new THREE.MeshStandardMaterial({ 
    color: 0x888888,
    roughness: 0.7,
  });
  const laneMarkingMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffcc, // Yellow center line
    roughness: 0.5,
  });
  const whiteMarkingMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffff, // White lane lines
    roughness: 0.5,
  });
  const crosswalkMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffff,
    roughness: 0.6,
  });
  
  // Create road segments for the grid
  for (let i = 0; i <= gridSize; i++) {
    const pos = -halfSize + i * blockSize;
    
    // North-South roads
    const nsRoadGeo = new THREE.PlaneGeometry(roadWidth, gridSize * blockSize);
    const nsRoad = new THREE.Mesh(nsRoadGeo, asphaltMat);
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.set(pos, 0.01, 0);
    nsRoad.receiveShadow = true;
    scene.add(nsRoad);
    cityRoadMeshes.push(nsRoad);
    
    // East-West roads  
    const ewRoadGeo = new THREE.PlaneGeometry(gridSize * blockSize, roadWidth);
    const ewRoad = new THREE.Mesh(ewRoadGeo, asphaltMat);
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.position.set(0, 0.01, -pos);
    ewRoad.receiveShadow = true;
    scene.add(ewRoad);
    cityRoadMeshes.push(ewRoad);
    
    // Center line markings (yellow dashed)
    for (let j = 0; j < gridSize; j++) {
      const segmentStart = -halfSize + j * blockSize + 10;
      const segmentLength = blockSize - 20;
      
      // NS road center line
      for (let k = 0; k < segmentLength; k += 6) {
        const markGeo = new THREE.PlaneGeometry(0.15, 4);
        const mark = new THREE.Mesh(markGeo, laneMarkingMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(pos, 0.02, -(segmentStart + k));
        scene.add(mark);
        cityRoadMeshes.push(mark);
      }
      
      // EW road center line
      for (let k = 0; k < segmentLength; k += 6) {
        const markGeo = new THREE.PlaneGeometry(4, 0.15);
        const mark = new THREE.Mesh(markGeo, laneMarkingMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(segmentStart + k, 0.02, -pos);
        scene.add(mark);
        cityRoadMeshes.push(mark);
      }
    }
    
    // White lane lines (between lanes)
    for (let lane = 1; lane < 2; lane++) {
      const offset = lane * laneWidth;
      
      // NS road white lines
      for (let j = 0; j < gridSize; j++) {
        const segmentStart = -halfSize + j * blockSize + 10;
        for (let k = 0; k < blockSize - 20; k += 8) {
          const markGeo = new THREE.PlaneGeometry(0.1, 3);
          const markL = new THREE.Mesh(markGeo, whiteMarkingMat);
          markL.rotation.x = -Math.PI / 2;
          markL.position.set(pos - offset, 0.02, -(segmentStart + k));
          scene.add(markL);
          cityRoadMeshes.push(markL);
          
          const markR = new THREE.Mesh(markGeo, whiteMarkingMat);
          markR.rotation.x = -Math.PI / 2;
          markR.position.set(pos + offset, 0.02, -(segmentStart + k));
          scene.add(markR);
          cityRoadMeshes.push(markR);
        }
      }
    }
    
    // Sidewalks along roads
    // Left sidewalk (NS roads)
    const swLeftGeo = new THREE.BoxGeometry(sidewalkWidth, 0.15, gridSize * blockSize);
    const swLeft = new THREE.Mesh(swLeftGeo, sidewalkMat);
    swLeft.position.set(pos - roadWidth / 2 - sidewalkWidth / 2, 0.075, 0);
    swLeft.receiveShadow = true;
    scene.add(swLeft);
    cityRoadMeshes.push(swLeft);
    
    // Right sidewalk
    const swRight = new THREE.Mesh(swLeftGeo, sidewalkMat);
    swRight.position.set(pos + roadWidth / 2 + sidewalkWidth / 2, 0.075, 0);
    swRight.receiveShadow = true;
    scene.add(swRight);
    cityRoadMeshes.push(swRight);
    
    // Curbs
    const curbGeo = new THREE.BoxGeometry(0.2, 0.2, gridSize * blockSize);
    const curbL = new THREE.Mesh(curbGeo, curbMat);
    curbL.position.set(pos - roadWidth / 2, 0.1, 0);
    scene.add(curbL);
    cityRoadMeshes.push(curbL);
    
    const curbR = new THREE.Mesh(curbGeo, curbMat);
    curbR.position.set(pos + roadWidth / 2, 0.1, 0);
    scene.add(curbR);
    cityRoadMeshes.push(curbR);
  }
  
  // Crosswalks at intersections
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const x = -halfSize + i * blockSize;
      const z = -(-halfSize + j * blockSize);
      
      // Draw crosswalk stripes
      const numStripes = 8;
      const stripeWidth = 0.5;
      const stripeLength = roadWidth - 2;
      const stripeGap = 0.4;
      
      // NS crosswalk (crosses EW road)
      for (let s = 0; s < numStripes; s++) {
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(stripeWidth, stripeLength),
          crosswalkMat
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(x - (numStripes / 2) * (stripeWidth + stripeGap) + s * (stripeWidth + stripeGap), 0.025, z + roadWidth / 2 + 2);
        scene.add(stripe);
        cityRoadMeshes.push(stripe);
        
        const stripe2 = stripe.clone();
        stripe2.position.z = z - roadWidth / 2 - 2;
        scene.add(stripe2);
        cityRoadMeshes.push(stripe2);
      }
      
      // EW crosswalk (crosses NS road)
      for (let s = 0; s < numStripes; s++) {
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(stripeLength, stripeWidth),
          crosswalkMat
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(x + roadWidth / 2 + 2, 0.025, z - (numStripes / 2) * (stripeWidth + stripeGap) + s * (stripeWidth + stripeGap));
        scene.add(stripe);
        cityRoadMeshes.push(stripe);
        
        const stripe2 = stripe.clone();
        stripe2.position.x = x - roadWidth / 2 - 2;
        scene.add(stripe2);
        cityRoadMeshes.push(stripe2);
      }
    }
  }
  
  // Street lights at intersections
  const lightPoleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
  const lightGlowMat = new THREE.MeshStandardMaterial({ 
    color: 0xffffaa, 
    emissive: 0xffffaa, 
    emissiveIntensity: 0.5 
  });
  
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const x = -halfSize + i * blockSize;
      const z = -(-halfSize + j * blockSize);
      
      // Four corners of intersection
      const corners: Array<[number, number]> = [
        [roadWidth / 2 + 2, roadWidth / 2 + 2],
        [roadWidth / 2 + 2, -roadWidth / 2 - 2],
        [-roadWidth / 2 - 2, roadWidth / 2 + 2],
        [-roadWidth / 2 - 2, -roadWidth / 2 - 2],
      ];
      
      corners.forEach(([dx, dz]: [number, number]) => {
        // Pole
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.15, 6, 8),
          lightPoleMat
        );
        pole.position.set(x + dx, 3, z + dz);
        pole.castShadow = true;
        scene.add(pole);
        cityRoadMeshes.push(pole);
        
        // Light fixture
        const fixture = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.15, 0.4),
          lightGlowMat
        );
        fixture.position.set(x + dx, 6, z + dz);
        scene.add(fixture);
        cityRoadMeshes.push(fixture);
      });
    }
  }
  
  // Traffic light posts at major intersections
  const trafficLightMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  for (let i = 1; i < gridSize; i++) {
    for (let j = 1; j < gridSize; j++) {
      const x = -halfSize + i * blockSize;
      const z = -(-halfSize + j * blockSize);
      
      // Traffic light on each corner
      const positions = [
        { x: x + roadWidth / 2 + 1, z: z + roadWidth / 2 + 1, rotY: -Math.PI / 4 },
        { x: x - roadWidth / 2 - 1, z: z - roadWidth / 2 - 1, rotY: Math.PI * 3 / 4 },
      ];
      
      positions.forEach(pos => {
        const tlGroup = new THREE.Group();
        
        // Post
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 4, 8),
          trafficLightMat
        );
        post.position.y = 2;
        tlGroup.add(post);
        
        // Light box
        const lightBox = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.8, 0.2),
          trafficLightMat
        );
        lightBox.position.y = 4.2;
        tlGroup.add(lightBox);
        
        // Red light
        const redLight = new THREE.Mesh(
          new THREE.CircleGeometry(0.08, 16),
          new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.3 })
        );
        redLight.position.set(0, 4.45, 0.11);
        tlGroup.add(redLight);
        
        // Yellow light  
        const yellowLight = new THREE.Mesh(
          new THREE.CircleGeometry(0.08, 16),
          new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0x444400, emissiveIntensity: 0.1 })
        );
        yellowLight.position.set(0, 4.2, 0.11);
        tlGroup.add(yellowLight);
        
        // Green light
        const greenLight = new THREE.Mesh(
          new THREE.CircleGeometry(0.08, 16),
          new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.3 })
        );
        greenLight.position.set(0, 3.95, 0.11);
        tlGroup.add(greenLight);
        
        tlGroup.position.set(pos.x, 0, pos.z);
        tlGroup.rotation.y = pos.rotY;
        scene.add(tlGroup);
        cityRoadMeshes.push(tlGroup);
      });
    }
  }
  
  console.log(`Built city roads: ${cityRoadMeshes.length} meshes`);
}

// Create mesh for entity with proper styling
function createEntityMesh(classType: string, entity?: { boundingBox: { size: { x: number; y: number; z: number } } }): THREE.Mesh | THREE.Group {
  switch (classType) {
    case 'car': {
      // Create a more detailed car mesh
      const group = new THREE.Group();
      
      // Body
      const bodyGeo = new THREE.BoxGeometry(4.2, 1.2, 1.6);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, metalness: 0.6, roughness: 0.4 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.6;
      body.castShadow = true;
      group.add(body);
      
      // Cabin
      const cabinGeo = new THREE.BoxGeometry(2.2, 0.8, 1.4);
      const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.2, roughness: 0.5 });
      const cabin = new THREE.Mesh(cabinGeo, cabinMat);
      cabin.position.set(-0.3, 1.3, 0);
      cabin.castShadow = true;
      group.add(cabin);
      
      // Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
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
      const cabMat = new THREE.MeshStandardMaterial({ color: 0xcc6633, metalness: 0.4, roughness: 0.5 });
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(2.5, 1.3, 0);
      cab.castShadow = true;
      group.add(cab);
      
      // Trailer
      const trailerGeo = new THREE.BoxGeometry(7, 2.8, 2.4);
      const trailerMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
      const trailer = new THREE.Mesh(trailerGeo, trailerMat);
      trailer.position.set(-1.5, 1.6, 0);
      trailer.castShadow = true;
      group.add(trailer);
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'pedestrian': {
      const group = new THREE.Group();
      
      // Body
      const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.8, 4, 8);
      const colors = [0xff6600, 0x00cc66, 0x6600cc, 0xcc0066];
      const bodyMat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)] });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.8;
      body.castShadow = true;
      group.add(body);
      
      // Head
      const headGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const headMat = new THREE.MeshStandardMaterial({ color: 0xffcc99 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.45;
      group.add(head);
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'building': {
      const group = new THREE.Group();
      const size = entity?.boundingBox.size ?? { x: 20, y: 20, z: 30 };
      
      // Main building body
      const buildingGeo = new THREE.BoxGeometry(size.x, size.z, size.y);
      const buildingColors = [0x606070, 0x707080, 0x556065, 0x4a5560, 0x505a60];
      const buildingMat = new THREE.MeshStandardMaterial({ 
        color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
        roughness: 0.8 
      });
      const building = new THREE.Mesh(buildingGeo, buildingMat);
      building.position.y = size.z / 2;
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);
      
      // Windows (grid pattern)
      const windowMat = new THREE.MeshStandardMaterial({ color: 0x88bbff, emissive: 0x223344, emissiveIntensity: 0.3 });
      const windowHeight = 2;
      const windowWidth = 1.5;
      const floors = Math.floor(size.z / 4);
      const windowsPerSide = Math.floor(size.x / 3);
      
      for (let floor = 1; floor < floors; floor++) {
        for (let w = 0; w < windowsPerSide; w++) {
          const windowGeo = new THREE.PlaneGeometry(windowWidth, windowHeight);
          
          // Front face
          const windowFront = new THREE.Mesh(windowGeo, windowMat);
          windowFront.position.set(
            (w - windowsPerSide / 2 + 0.5) * 3,
            floor * 4,
            size.y / 2 + 0.01
          );
          group.add(windowFront);
          
          // Back face
          const windowBack = new THREE.Mesh(windowGeo, windowMat);
          windowBack.position.set(
            (w - windowsPerSide / 2 + 0.5) * 3,
            floor * 4,
            -size.y / 2 - 0.01
          );
          windowBack.rotation.y = Math.PI;
          group.add(windowBack);
        }
      }
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'tree': {
      const group = new THREE.Group();
      
      // Trunk
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 8);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1;
      trunk.castShadow = true;
      group.add(trunk);
      
      // Foliage
      const foliageGeo = new THREE.ConeGeometry(2, 5, 8);
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x228b22 });
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.y = 4.5;
      foliage.castShadow = true;
      group.add(foliage);
      
      return group as unknown as THREE.Mesh;
    }
    
    case 'pole': {
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 8, 8);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4;
      pole.castShadow = true;
      return pole;
    }
    
    default: {
      const geometry = new THREE.BoxGeometry(2, 2, 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x999999 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      return mesh;
    }
  }
}

// Create road network visualization
function createRoads(worldMap: { lanes: Array<{ points: Array<{ position: { x: number; y: number }; width: number }> }> }) {
  const roadGroup = new THREE.Group();
  
  // Road material
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
  const laneMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
  
  // Create road segments from lanes
  const processedRoads = new Set<string>();
  
  for (const lane of worldMap.lanes) {
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

// Update entity meshes from simulation state
function updateEntityMeshes() {
  const state = simulation.getState();
  const allEntities = [
    ...state.worldMap.staticEntities,
    ...state.trafficVehicles,
    ...state.pedestrians,
  ];
  
  // Track which entities are still present
  const presentIds = new Set(allEntities.map(e => e.id));
  
  // Remove meshes for entities that no longer exist
  for (const [id, mesh] of entityMeshes) {
    if (!presentIds.has(id)) {
      scene.remove(mesh);
      entityMeshes.delete(id);
    }
  }
  
  // Update or create meshes
  for (const entity of allEntities) {
    let mesh = entityMeshes.get(entity.id);
    
    if (!mesh) {
      mesh = createEntityMesh(entity.classType, entity) as THREE.Mesh;
      scene.add(mesh);
      entityMeshes.set(entity.id, mesh);
    }
    
    // Convert simulation coords (X=east, Y=north, Z=up) to Three.js (X=east, Y=up, Z=south)
    // For buildings, transform.position.z is already at height/2, don't add more
    const yOffset = entity.classType === 'building' ? 0 : 
                    entity.classType === 'tree' ? 0 :
                    entity.classType === 'pole' ? 0 : 0;
    
    mesh.position.set(
      entity.transform.position.x,
      yOffset,
      -entity.transform.position.y
    );
    // Add Math.PI for vehicles so they face their direction of travel
    const isVehicle = entity.classType === 'car' || entity.classType === 'truck' || 
                      entity.classType === 'bus' || entity.classType === 'motorcycle';
    mesh.rotation.y = -entity.transform.rotation + (isVehicle ? Math.PI : 0);
  }
}

// Detection box colors by class
const DETECTION_COLORS: Record<string, number> = {
  car: 0x00ff00,       // Green
  truck: 0x00cc00,     // Dark green
  bus: 0x00aa00,       // Darker green  
  pedestrian: 0xff00ff, // Magenta
  cyclist: 0x00ffff,   // Cyan
  motorcycle: 0xffff00, // Yellow
  default: 0x00ff00,   // Green fallback
};

// Update detection visualization
function updateDetectionMeshes() {
  // Clear old detection meshes
  for (const mesh of detectionMeshes) {
    scene.remove(mesh);
  }
  detectionMeshes.length = 0;
  
  const state = simulation.getState();
  
  // Get perception detections - ALWAYS show these
  const detections = state.perceptionTracks.filter(t => t.missedFrames === 0);
  
  // Get ground truth for matching (used for GT overlay mode)
  const groundTruth = [
    ...state.trafficVehicles,
    ...state.pedestrians,
  ];
  
  // Always render detection boxes (color-coded by class)
  for (const det of detections) {
    const boxColor = DETECTION_COLORS[det.classType] ?? DETECTION_COLORS.default;
    
    const geometry = new THREE.BoxGeometry(
      det.box.size.x,
      det.box.size.z,
      det.box.size.y
    );
    const material = new THREE.MeshBasicMaterial({
      color: boxColor,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      det.box.center.x,
      det.box.center.z + det.box.size.z / 2,
      -det.box.center.y
    );
    mesh.rotation.y = -det.box.yaw;
    scene.add(mesh);
    detectionMeshes.push(mesh);
  }
  
  // In Ground Truth mode (G key), also show false negatives in red
  if (showGroundTruth) {
    for (const gt of groundTruth) {
      let detected = false;
      for (const det of detections) {
        const dx = det.box.center.x - gt.boundingBox.center.x;
        const dy = det.box.center.y - gt.boundingBox.center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 2) {
          detected = true;
          break;
        }
      }
      
      if (!detected) {
        const geometry = new THREE.BoxGeometry(
          gt.boundingBox.size.x,
          gt.boundingBox.size.z,
          gt.boundingBox.size.y
        );
        const material = new THREE.MeshBasicMaterial({
          color: 0xff0000, // Red = false negative (missed by perception)
          wireframe: true,
          transparent: true,
          opacity: 0.8,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
          gt.boundingBox.center.x,
          gt.boundingBox.center.z + gt.boundingBox.size.z / 2,
          -gt.boundingBox.center.y
        );
        mesh.rotation.y = -gt.boundingBox.yaw;
        scene.add(mesh);
        detectionMeshes.push(mesh);
      }
    }
  }
}

// Update camera based on mode
function updateCamera() {
  const state = simulation.getState();
  const egoPos = state.ego.transform.position;
  const egoYaw = state.ego.transform.rotation;
  
  switch (cameraMode) {
    case 'chase':
      const chaseOffset = {
        x: -Math.cos(egoYaw) * 12,
        y: -Math.sin(egoYaw) * 12,
        z: 6,
      };
      camera.position.set(
        egoPos.x + chaseOffset.x,
        chaseOffset.z,
        -(egoPos.y + chaseOffset.y)
      );
      camera.lookAt(egoPos.x, 1, -egoPos.y);
      break;
      
    case 'topdown':
      camera.position.set(egoPos.x, 100, -egoPos.y);
      camera.lookAt(egoPos.x, 0, -egoPos.y);
      break;
      
    case 'cockpit':
      const cockpitOffset = {
        x: Math.cos(egoYaw) * 1.5,
        y: Math.sin(egoYaw) * 1.5,
      };
      camera.position.set(
        egoPos.x + cockpitOffset.x,
        1.2,
        -(egoPos.y + cockpitOffset.y)
      );
      const lookAhead = {
        x: egoPos.x + Math.cos(egoYaw) * 20,
        y: egoPos.y + Math.sin(egoYaw) * 20,
      };
      camera.lookAt(lookAhead.x, 1, -lookAhead.y);
      break;
  }
}

// Update HUD
function updateHUD() {
  const state = simulation.getState();
  const speed = vec3Length(state.ego.velocity) * 3.6; // m/s to km/h
  
  document.getElementById('speed-value')!.textContent = `${Math.round(speed)} km/h`;
  document.getElementById('stopping-dist')!.textContent = `${Math.round(state.ego.stoppingDistance)} m`;
  document.getElementById('control-source')!.textContent = 
    state.controlSource === 'human' ? 'Manual' : 
    state.controlSource === 'oracle' ? 'Oracle' : 'Policy';
  document.getElementById('detection-count')!.textContent = 
    String(state.perceptionTracks.filter(t => t.missedFrames === 0).length);
  
  // Update weather status
  const weatherText = state.environment.weather.charAt(0).toUpperCase() + 
    state.environment.weather.slice(1) + 
    (state.environment.timeOfDay === 'night' ? ' (Night)' : '');
  document.getElementById('weather-status')!.textContent = weatherText;
  
  // Update weather styling
  const weatherEl = document.getElementById('weather-status')!;
  weatherEl.className = 'status-value';
  if (state.environment.weather !== 'clear') {
    weatherEl.classList.add('status-warning');
  }
  
  // Update control source styling
  const controlEl = document.getElementById('control-source')!;
  controlEl.className = 'status-value';
  if (state.controlSource === 'human') {
    controlEl.classList.add('status-warning');
  }
  
  // Update specialized HUDs based on current stack
  if (currentStack === 'maritime') {
    updateMaritimeHUD();
  } else if (currentStack === 'rail') {
    updateRailHUD();
  } else if (currentStack === 'aurora') {
    updateFMCWHUD();
  }
}

// Update Maritime COLREGs HUD with live values
function updateMaritimeHUD() {
  const state = simulation.getState();
  const egoPos = state.ego.transform.position;
  const egoVel = state.ego.velocity;
  const egoHeading = state.ego.transform.rotation;
  
  // Update ship positions based on simulation time
  maritimeState.aisTargets.forEach(target => {
    target.position.x += Math.cos(target.courseOverGround) * target.speedOverGround * 0.016;
    target.position.y += Math.sin(target.courseOverGround) * target.speedOverGround * 0.016;
  });
  
  // Calculate CPA/TCPA for each target
  interface TargetInfo { name: string; cpa: number; tcpa: number; rule: string }
  let closestTarget: TargetInfo | undefined;
  let minTcpa = Infinity;
  
  const targetListEl = document.getElementById('ais-targets');
  if (targetListEl) targetListEl.innerHTML = '';
  
  for (const target of maritimeState.aisTargets) {
    const { cpa, tcpa } = calculateCPATCPA(
      egoPos,
      egoVel,
      target.position,
      { x: Math.cos(target.courseOverGround) * target.speedOverGround, 
        y: Math.sin(target.courseOverGround) * target.speedOverGround, z: 0 }
    );
    
    const rule = determineCOLREGSRule(egoPos, egoHeading, target.position, target.heading);
    
    // Format TCPA as minutes:seconds
    const tcpaMin = Math.floor(tcpa / 60);
    const tcpaSec = Math.floor(tcpa % 60);
    const tcpaStr = tcpa < 0 ? 'passed' : `${tcpaMin}:${tcpaSec.toString().padStart(2, '0')}`;
    
    if (targetListEl) {
      const div = document.createElement('div');
      const isRisk = cpa < 200 && tcpa > 0 && tcpa < 600;
      div.style.color = isRisk ? '#ff4444' : '#ccc';
      div.textContent = `${target.name} - CPA: ${Math.round(cpa)}m, TCPA: ${tcpaStr}`;
      targetListEl.appendChild(div);
    }
    
    if (tcpa > 0 && tcpa < minTcpa && cpa < 500) {
      minTcpa = tcpa;
      closestTarget = { name: target.name, cpa, tcpa, rule };
    }
  }
  
  // Update situation display
  const situationEl = document.getElementById('colregs-situation');
  const ruleEl = document.getElementById('colregs-rule');
  const actionEl = document.getElementById('colregs-action');
  
  if (closestTarget && situationEl && ruleEl && actionEl) {
    const ruleNames: Record<string, string> = {
      'head_on': 'Head-on situation',
      'crossing': 'Crossing situation',
      'overtaking': 'Overtaking situation',
      'stand_on': 'Stand-on vessel',
      'give_way': 'Give-way situation',
    };
    
    const ruleDescriptions: Record<string, string> = {
      'head_on': 'Rule 14: Head-on - Both vessels alter to starboard',
      'crossing': 'Rule 15: Crossing - Give-way vessel alters to starboard',
      'overtaking': 'Rule 13: Overtaking - Keep clear of vessel being overtaken',
      'stand_on': 'Rule 17: Stand-on - Maintain course and speed',
      'give_way': 'Rule 16: Give-way - Take early and substantial action',
    };
    
    const actions: Record<string, string> = {
      'head_on': `ACTION: Alter course 20° to starboard`,
      'crossing': `ACTION: Alter course to pass astern`,
      'overtaking': `ACTION: Maintain safe passing distance`,
      'stand_on': `ACTION: Maintain course and speed`,
      'give_way': `ACTION: Alter course to starboard`,
    };
    
    situationEl.textContent = `${ruleNames[closestTarget.rule] || 'Encounter'} with ${closestTarget.name}`;
    ruleEl.textContent = ruleDescriptions[closestTarget.rule] || `COLREGS: ${closestTarget.rule}`;
    actionEl.textContent = actions[closestTarget.rule] || 'Monitor situation';
  }
}

// Update Rail HUD with live values
function updateRailHUD() {
  const state = simulation.getState();
  const speed = vec3Length(state.ego.velocity) * 3.6; // km/h
  
  // Calculate braking distance (trains are heavy!)
  const trainMass = 500000; // 500 tons
  const brakingDist = calculateRailBrakingDistance(
    vec3Length(state.ego.velocity),
    trainMass,
    0 // level track
  );
  railState.brakingDistance = brakingDist;
  
  // Find nearest signal and crossing
  const egoX = state.ego.transform.position.x;
  
  // Update signal distance
  const signalDist = Math.max(0, 200 - egoX); // Signal at x=200
  const crossingDist = Math.max(0, 150 - egoX); // Crossing at x=150
  
  // Determine permitted speed based on signal and obstacles
  let permittedSpeed = 80; // km/h default
  let signalState: 'clear' | 'approach' | 'stop' = 'clear';
  
  if (railState.gradeCrossings[0]?.hasObstruction && crossingDist < 300) {
    permittedSpeed = 0;
    signalState = 'stop';
    railState.emergencyBraking = true;
  } else if (crossingDist < 500) {
    permittedSpeed = 40;
    signalState = 'approach';
  }
  
  // Update HUD elements
  const modeEl = document.getElementById('rail-mode');
  const signalEl = document.getElementById('rail-signal');
  const speedEl = document.getElementById('rail-speed');
  const distanceEl = document.getElementById('rail-distance');
  const crossingEl = document.getElementById('rail-crossing');
  
  if (modeEl) modeEl.textContent = 'Mode: Moving Block';
  
  if (signalEl) {
    const color = signalState === 'stop' ? '#ff4444' : signalState === 'approach' ? '#ffaa00' : '#00ff00';
    signalEl.innerHTML = `<span style="color: ${color};">●</span> Signal: ${signalState.toUpperCase()}`;
  }
  
  if (speedEl) {
    speedEl.textContent = `Permitted: ${permittedSpeed} km/h | Current: ${Math.round(speed)} km/h`;
    speedEl.style.color = speed > permittedSpeed ? '#ff4444' : '#00ff88';
  }
  
  if (distanceEl) {
    distanceEl.textContent = `Distance to signal: ${Math.round(signalDist)}m | Braking: ${Math.round(brakingDist)}m`;
  }
  
  if (crossingEl) {
    if (railState.gradeCrossings[0]?.hasObstruction) {
      crossingEl.innerHTML = `
        <div style="color: #ff6600; font-size: 12px;">⚠ LEVEL CROSSING BLOCKED</div>
        <div style="color: #888; font-size: 11px; margin-top: 4px;">Stalled vehicle detected at ${Math.round(crossingDist)}m</div>
      `;
    } else {
      crossingEl.innerHTML = `
        <div style="color: #00ff00; font-size: 12px;">✓ Level crossing clear</div>
        <div style="color: #888; font-size: 11px; margin-top: 4px;">Distance: ${Math.round(crossingDist)}m</div>
      `;
    }
  }
}

// Update FMCW HUD with live values
function updateFMCWHUD() {
  const state = simulation.getState();
  const speed = vec3Length(state.ego.velocity); // m/s
  const speedKmh = speed * 3.6;
  
  // Calculate braking distance for truck (longer than car due to air brakes)
  // Truck braking distance: approx speed^2 / (2 * decel) + reaction distance
  const airBrakeDelay = 0.4; // seconds
  const decel = 4.5; // m/s^2 for loaded truck
  const reactionDist = speed * airBrakeDelay;
  const brakingDist = reactionDist + (speed * speed) / (2 * decel);
  
  // Detection range from FMCW radar (long range)
  const detectionRange = 250; // meters
  
  // Find closest vehicle ahead
  let closestDist = detectionRange;
  for (const track of state.perceptionTracks) {
    if (track.missedFrames === 0) {
      const dx = track.box.center.x - state.ego.transform.position.x;
      const dy = track.box.center.y - state.ego.transform.position.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < closestDist && dx > 0) { // Ahead of ego
        closestDist = dist;
      }
    }
  }
  
  // Update brake/detect bars
  const brakeBar = document.getElementById('brake-bar');
  const detectBar = document.getElementById('detect-bar');
  
  if (brakeBar && detectBar) {
    const brakePercent = Math.min(100, (brakingDist / detectionRange) * 100);
    const detectPercent = Math.min(100, (closestDist / detectionRange) * 100);
    
    brakeBar.style.width = `${brakePercent}%`;
    detectBar.style.width = `${detectPercent}%`;
  }
  
  // Update text labels
  const fmcwBraking = document.getElementById('fmcw-braking');
  if (fmcwBraking) {
    const isSafe = closestDist > brakingDist;
    const safetyDiv = fmcwBraking.querySelector('div:last-child');
    if (safetyDiv) {
      if (isSafe) {
        safetyDiv.innerHTML = `<div style="padding: 8px; background: #0a2a0a; border-radius: 3px; color: #00ff00; font-size: 12px;">
          ✓ Safe: Detection (${Math.round(closestDist)}m) > Braking (${Math.round(brakingDist)}m)
        </div>`;
      } else {
        safetyDiv.innerHTML = `<div style="padding: 8px; background: #2a0a0a; border-radius: 3px; color: #ff4444; font-size: 12px;">
          ⚠ WARNING: Braking distance exceeds safe margin!
        </div>`;
      }
    }
    
    // Update distance labels
    const labelDiv = fmcwBraking.querySelector('div:nth-child(3)');
    if (labelDiv) {
      labelDiv.innerHTML = `
        <span>Brake: ${Math.round(brakingDist)}m</span>
        <span>Target: ${Math.round(closestDist)}m</span>
        <span>Speed: ${Math.round(speedKmh)} km/h</span>
      `;
    }
  }
  
  // Draw FMCW radar visualization
  renderFMCWCanvas();
}

// Render FMCW radar canvas with velocity-colored returns
function renderFMCWCanvas() {
  const canvas = document.getElementById('fmcw-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d')!;
  const state = simulation.getState();
  const egoVel = vec3Length(state.ego.velocity);
  
  ctx.fillStyle = '#0a0a15';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw radar returns
  const maxRange = 250;
  const egoPos = state.ego.transform.position;
  const egoHeading = state.ego.transform.rotation;
  
  for (const track of state.perceptionTracks) {
    if (track.missedFrames > 0) continue;
    
    const dx = track.box.center.x - egoPos.x;
    const dy = track.box.center.y - egoPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > maxRange) continue;
    
    // Calculate relative velocity (positive = approaching, negative = receding)
    const relVel = track.velocity 
      ? (track.velocity.x * Math.cos(egoHeading) + track.velocity.y * Math.sin(egoHeading)) - egoVel
      : 0;
    
    // Color based on relative velocity
    let color: string;
    if (relVel < -2) {
      color = '#00ff00'; // Green: approaching
    } else if (relVel > 2) {
      color = '#ff0000'; // Red: receding
    } else {
      color = '#888888'; // Gray: static
    }
    
    // Position on canvas
    const angle = Math.atan2(dy, dx) - egoHeading;
    const normDist = dist / maxRange;
    const canvasX = canvas.width / 2 + Math.sin(angle) * normDist * canvas.width / 2;
    const canvasY = canvas.height - normDist * canvas.height;
    
    // Draw return
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw velocity line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvasX, canvasY);
    ctx.lineTo(canvasX, canvasY + relVel * 2);
    ctx.stroke();
  }
}

// Update info card for current stack
function updateInfoCard() {
  const card = INFO_CARDS[currentStack];
  document.getElementById('info-title')!.textContent = card.name;
  document.getElementById('info-sensors')!.textContent = card.sensors;
  document.getElementById('info-internals')!.textContent = card.internals;
  document.getElementById('info-strengths')!.textContent = card.strengths;
  document.getElementById('info-weaknesses')!.textContent = card.weaknesses;
  document.getElementById('info-example')!.textContent = card.example;
}

// Switch to a different stack profile
function switchStack(profile: StackProfile) {
  if (profile === currentStack) return;
  
  currentStack = profile;
  
  // Update view switcher buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    const btnProfile = (btn as HTMLElement).dataset['profile'] as StackProfile;
    btn.classList.toggle('active', btnProfile === profile);
  });
  
  // Update info card if visible
  if (showInfoCard) {
    updateInfoCard();
  }
  
  // Determine target zone based on profile
  const zoneMap: Record<StackProfile, ZoneType> = {
    tesla: 'city',
    waymo: 'city',
    waabi: 'city',
    aurora: 'highway',
    rail: 'rail',
    maritime: 'harbour',
  };
  
  const targetZone = zoneMap[profile];
  if (targetZone !== currentZone) {
    // Reinitialize simulation with new zone
    simulation = new Simulation({
      seed: Date.now(),
      profile: profile,
      environment: simulation.getState().environment,
      useOracle: false,
      maxDuration: 3600,
      zone: targetZone,
    });
    
    rebuildZone(targetZone, profile);
  } else {
    // Same zone, just update overlays
    updateOverlaysForStack(profile);
  }
  
  console.log(`Switched to stack: ${profile} (zone: ${targetZone})`);
}

// Rebuild scene for a different zone
function rebuildZone(zone: ZoneType, profile: StackProfile) {
  currentZone = zone;
  
  // Clear existing zone-specific objects
  clearZoneObjects();
  
  // Update ground/water
  if (zone === 'harbour') {
    setupHarbourZone();
  } else if (zone === 'rail') {
    setupRailZone();
  } else if (zone === 'highway') {
    setupHighwayZone();
  } else {
    setupCityZone();
  }
  
  // Update ego vehicle based on profile
  updateEgoVehicle(profile);
  
  // Update overlays
  updateOverlaysForStack(profile);
}

// Clear zone-specific objects
function clearZoneObjects() {
  if (waterMesh) {
    scene.remove(waterMesh);
    waterMesh = null;
  }
  trackMeshes.forEach(m => scene.remove(m));
  trackMeshes = [];
  buoyMeshes.forEach(m => scene.remove(m));
  buoyMeshes = [];
  if (simWorldOverlay) {
    scene.remove(simWorldOverlay);
    simWorldOverlay = null;
  }
  
  // Clear entity meshes for the zone
  entityMeshes.forEach(mesh => scene.remove(mesh));
  entityMeshes.clear();
}

// Setup harbour zone with water, buoys, ships
function setupHarbourZone() {
  // Hide city ground, use water instead
  groundMesh.visible = false;
  
  // Water surface - large ocean-like area
  const waterGeo = new THREE.PlaneGeometry(2000, 2000);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a5276,
    roughness: 0.2,
    metalness: 0.4,
    transparent: true,
    opacity: 0.95,
  });
  waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(0, -1, 0);
  scene.add(waterMesh);
  
  // Add buoys closer to origin for visibility (scale down positions)
  const buoyPositions = [
    { x: -30, z: -50, type: 'port' as const },
    { x: 30, z: -50, type: 'starboard' as const },
    { x: -30, z: 50, type: 'port' as const },
    { x: 30, z: 50, type: 'starboard' as const },
    { x: 0, z: 0, type: 'fairway' as const },
  ];
  
  buoyPositions.forEach(buoy => {
    const buoyGeo = new THREE.ConeGeometry(2, 6, 8);
    const buoyMat = new THREE.MeshStandardMaterial({
      color: buoy.type === 'port' ? 0xff0000 : (buoy.type === 'starboard' ? 0x00ff00 : 0xffff00),
      emissive: buoy.type === 'port' ? 0x330000 : (buoy.type === 'starboard' ? 0x003300 : 0x333300),
    });
    const buoyMeshObj = new THREE.Mesh(buoyGeo, buoyMat);
    buoyMeshObj.position.set(buoy.x, 2, buoy.z);
    buoyMeshObj.castShadow = true;
    scene.add(buoyMeshObj);
    buoyMeshes.push(buoyMeshObj);
  });
  
  // Add other ships (scaled down for visibility)
  const shipPositions = [
    { x: -80, z: 100, heading: Math.PI / 4, name: 'CARGO STAR' },
    { x: 60, z: -80, heading: -Math.PI / 3, name: 'TANKER PRIME' },
    { x: 100, z: 150, heading: Math.PI, name: 'FERRY SWIFT' },
  ];
  
  shipPositions.forEach((target, i) => {
    const shipGroup = createShipMesh();
    shipGroup.scale.set(0.1, 0.1, 0.1); // Scale down to 10%
    shipGroup.position.set(target.x, 1, target.z);
    shipGroup.rotation.y = -target.heading + Math.PI / 2;
    scene.add(shipGroup);
    entityMeshes.set(5000 + i, shipGroup as unknown as THREE.Mesh);
  });
  
  // Sky and fog for maritime
  scene.background = new THREE.Color(0x6699cc);
  scene.fog = new THREE.Fog(0x6699cc, 100, 800);
}

// Create ship mesh
function createShipMesh(): THREE.Group {
  const group = new THREE.Group();
  
  // Hull
  const hullGeo = new THREE.BoxGeometry(150, 15, 25);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 5;
  hull.castShadow = true;
  group.add(hull);
  
  // Superstructure
  const superGeo = new THREE.BoxGeometry(40, 20, 20);
  const superMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  const superstructure = new THREE.Mesh(superGeo, superMat);
  superstructure.position.set(-30, 20, 0);
  superstructure.castShadow = true;
  group.add(superstructure);
  
  // Bridge
  const bridgeGeo = new THREE.BoxGeometry(20, 8, 15);
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x2222aa });
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridge.position.set(-30, 35, 0);
  bridge.castShadow = true;
  group.add(bridge);
  
  // Containers on deck
  const containerColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff];
  for (let i = 0; i < 5; i++) {
    const contGeo = new THREE.BoxGeometry(12, 8, 8);
    const contMat = new THREE.MeshStandardMaterial({ color: containerColors[i % 5] });
    const container = new THREE.Mesh(contGeo, contMat);
    container.position.set(20 + i * 15, 17, 0);
    container.castShadow = true;
    group.add(container);
  }
  
  return group;
}

// Setup rail zone with tracks, signals, platforms
function setupRailZone() {
  const railMap = generateRailMap(Date.now());
  
  // Update ground to look like rail bed
  (groundMesh.material as THREE.MeshStandardMaterial).color.setHex(0x4a4a4a);
  groundMesh.position.x = 0;
  
  // Draw tracks
  railMap.tracks.forEach(track => {
    const points = track.points.map(p => new THREE.Vector3(p.position.x, 0.1, p.position.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x888888, linewidth: 3 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    trackMeshes.push(line);
    
    // Rail ties
    for (let i = 0; i < points.length - 1; i += 3) {
      const tieGeo = new THREE.BoxGeometry(3, 0.2, 0.3);
      const tieMat = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
      const tie = new THREE.Mesh(tieGeo, tieMat);
      tie.position.copy(points[i]!);
      tie.position.y = 0.05;
      scene.add(tie);
    }
  });
  
  // Add signals
  railMap.signals.forEach(signal => {
    const signalGroup = new THREE.Group();
    
    // Post
    const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 2.5;
    signalGroup.add(post);
    
    // Signal head
    const headGeo = new THREE.BoxGeometry(0.8, 1.5, 0.3);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 5;
    signalGroup.add(head);
    
    // Signal light
    const lightColor = signal.state === 'clear' ? 0x00ff00 : (signal.state === 'caution' ? 0xffff00 : 0xff0000);
    const lightGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const lightMat = new THREE.MeshBasicMaterial({ color: lightColor });
    const light = new THREE.Mesh(lightGeo, lightMat);
    light.position.y = 5;
    light.position.z = 0.2;
    signalGroup.add(light);
    
    signalGroup.position.set(signal.position.x, 0, signal.position.y);
    scene.add(signalGroup);
  });
  
  // Add platforms
  railMap.platforms.forEach(platform => {
    const platGeo = new THREE.BoxGeometry(8, 1, 100);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.set(platform.position.x, 0.5, platform.position.y);
    plat.castShadow = true;
    scene.add(plat);
    
    // Platform sign
    const signGeo = new THREE.PlaneGeometry(5, 2);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000066';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(platform.name, 128, 80);
    const signTex = new THREE.CanvasTexture(canvas);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(platform.position.x + 6, 4, platform.position.y);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
  });
  
  // Add level crossing with stalled car
  const crossing = railMap.levelCrossings[0];
  if (crossing) {
    // Crossing road
    const roadGeo = new THREE.BoxGeometry(30, 0.1, 10);
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.set(crossing.position.x, 0.05, crossing.position.y);
    scene.add(road);
    
    // Stalled car on crossing
    if (crossing.stalledCar) {
      const carMesh = createEntityMesh('car');
      carMesh.position.set(crossing.stalledCar.transform.position.x, 0.8, crossing.stalledCar.transform.position.y);
      scene.add(carMesh);
      entityMeshes.set(crossing.stalledCar.id, carMesh as THREE.Mesh);
    }
    
    // Crossing barriers
    const barrierGeo = new THREE.BoxGeometry(0.2, 3, 0.2);
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    [-1, 1].forEach(side => {
      const barrier = new THREE.Mesh(barrierGeo, barrierMat);
      barrier.position.set(crossing.position.x + side * 8, 1.5, crossing.position.y - 5);
      scene.add(barrier);
    });
  }
  
  scene.fog = new THREE.Fog(0x87ceeb, 100, 2000);
}

// Setup highway zone for trucking
function setupHighwayZone() {
  const highwayMap = generateHighwayMap(Date.now());
  
  // Update ground to highway asphalt
  groundMesh.visible = true;
  (groundMesh.material as THREE.MeshStandardMaterial).color.setHex(0x2a2a2a);
  groundMesh.position.set(0, 0, 0);
  
  // Draw highway lanes with markings
  const laneWidth = 3.7;
  const numLanes = 3;
  
  // White lane markings
  for (let l = 0; l <= numLanes; l++) {
    const x = (l - numLanes / 2) * laneWidth + laneWidth * numLanes / 2;
    const markingGeo = new THREE.PlaneGeometry(0.15, 2000);
    const markingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const marking = new THREE.Mesh(markingGeo, markingMat);
    marking.rotation.x = -Math.PI / 2;
    marking.position.set(x, 0.02, 0);
    scene.add(marking);
  }
  
  // Center median (yellow)
  const medianGeo = new THREE.PlaneGeometry(0.3, 2000);
  const medianMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
  const median = new THREE.Mesh(medianGeo, medianMat);
  median.rotation.x = -Math.PI / 2;
  median.position.set(-2.5, 0.02, 0);
  scene.add(median);
  
  // Highway barriers
  highwayMap.staticEntities.filter(e => e.classType === 'barrier').forEach(barrier => {
    const barrierGeo = new THREE.BoxGeometry(0.5, 1, 30);
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const mesh = new THREE.Mesh(barrierGeo, barrierMat);
    mesh.position.set(barrier.transform.position.x, 0.5, barrier.transform.position.y);
    mesh.castShadow = true;
    scene.add(mesh);
  });
  
  // Bridge overpass at y=0
  const bridgeGeo = new THREE.BoxGeometry(80, 2, 120);
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridge.position.set(0, 10, 0);
  bridge.castShadow = true;
  scene.add(bridge);
  
  // Bridge supports
  [-35, 35].forEach(x => {
    const supportGeo = new THREE.BoxGeometry(3, 10, 3);
    const supportMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const support = new THREE.Mesh(supportGeo, supportMat);
    support.position.set(x, 5, 0);
    support.castShadow = true;
    scene.add(support);
  });
  
  scene.fog = new THREE.Fog(0x87ceeb, 100, 1500);
}

// Setup city zone (default)
function setupCityZone() {
  groundMesh.visible = true;
  (groundMesh.material as THREE.MeshStandardMaterial).color.setHex(0x333333);
  groundMesh.position.set(0, 0, 0);
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 100, 500);
}

// Update ego vehicle based on stack profile
function updateEgoVehicle(profile: StackProfile) {
  // Remove old ego
  scene.remove(egoMesh);
  
  switch (profile) {
    case 'aurora':
      egoMesh = createTruckMesh() as unknown as THREE.Mesh;
      // Position on highway
      egoMesh.position.set(5, 0, 0);
      break;
    case 'rail':
      egoMesh = createTrainMesh() as unknown as THREE.Mesh;
      // Position on rail
      egoMesh.position.set(0, 0, 0);
      break;
    case 'maritime':
      egoMesh = createOwnShipMesh() as unknown as THREE.Mesh;
      // Position in harbour - scale down for visibility
      egoMesh.scale.set(0.1, 0.1, 0.1);
      egoMesh.position.set(0, 1, 0);
      break;
    default:
      // Car for tesla, waymo, waabi
      const carGroup = createEgoVehicle();
      egoMesh = carGroup as unknown as THREE.Mesh;
      break;
  }
  
  scene.add(egoMesh);
  
  // Update camera to view the new ego vehicle
  if (profile === 'maritime') {
    camera.position.set(0, 50, 100);
    camera.lookAt(0, 0, 0);
  } else if (profile === 'rail') {
    camera.position.set(0, 20, 50);
    camera.lookAt(0, 0, -50);
  } else if (profile === 'aurora') {
    camera.position.set(5, 15, 30);
    camera.lookAt(5, 0, -50);
  }
}

// Create truck mesh for Aurora FMCW
function createTruckMesh(): THREE.Group {
  const group = new THREE.Group();
  
  // Cab
  const cabGeo = new THREE.BoxGeometry(4, 3.5, 2.8);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, metalness: 0.5, roughness: 0.4 });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(5, 2, 0);
  cab.castShadow = true;
  group.add(cab);
  
  // Cab windows
  const windowGeo = new THREE.BoxGeometry(0.1, 1.5, 2.2);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x222244, metalness: 0.3 });
  const frontWindow = new THREE.Mesh(windowGeo, windowMat);
  frontWindow.position.set(7, 2.5, 0);
  group.add(frontWindow);
  
  // Trailer
  const trailerGeo = new THREE.BoxGeometry(12, 4, 2.6);
  const trailerMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  const trailer = new THREE.Mesh(trailerGeo, trailerMat);
  trailer.position.set(-3, 2.2, 0);
  trailer.castShadow = true;
  group.add(trailer);
  
  // Wheels (18 wheeler)
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wheelPositions: [number, number, number][] = [
    [6, 0.55, 1.2], [6, 0.55, -1.2],
    [3, 0.55, 1.2], [3, 0.55, -1.2],
    [-3, 0.55, 1.2], [-3, 0.55, -1.2],
    [-5, 0.55, 1.2], [-5, 0.55, -1.2],
    [-7, 0.55, 1.2], [-7, 0.55, -1.2],
  ];
  wheelPositions.forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    wheel.rotation.x = Math.PI / 2;
    group.add(wheel);
  });
  
  // FMCW radar dome on top
  const radarGeo = new THREE.SphereGeometry(0.4, 16, 16);
  const radarMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const radar = new THREE.Mesh(radarGeo, radarMat);
  radar.position.set(5, 4, 0);
  group.add(radar);
  
  return group;
}

// Create train mesh
function createTrainMesh(): THREE.Group {
  const group = new THREE.Group();
  
  // Locomotive body
  const bodyGeo = new THREE.BoxGeometry(18, 4, 3);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0055aa, metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 2.5, 0);
  body.castShadow = true;
  group.add(body);
  
  // Cab
  const cabGeo = new THREE.BoxGeometry(5, 3, 2.8);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x003388 });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(5, 4.5, 0);
  cab.castShadow = true;
  group.add(cab);
  
  // Windows
  const windowGeo = new THREE.BoxGeometry(0.1, 1.5, 2);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x222244, metalness: 0.3 });
  const window = new THREE.Mesh(windowGeo, windowMat);
  window.position.set(7.5, 4.5, 0);
  group.add(window);
  
  // Headlight
  const lightGeo = new THREE.CircleGeometry(0.3, 16);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  const headlight = new THREE.Mesh(lightGeo, lightMat);
  headlight.position.set(9, 3, 0);
  headlight.rotation.y = Math.PI / 2;
  group.add(headlight);
  
  // Wheels/bogies
  const bogieGeo = new THREE.BoxGeometry(3, 0.8, 2.5);
  const bogieMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  [-5, 5].forEach(x => {
    const bogie = new THREE.Mesh(bogieGeo, bogieMat);
    bogie.position.set(x, 0.4, 0);
    group.add(bogie);
    
    // Wheels on bogie
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    [-1, 1].forEach(wx => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x + wx, 0.5, 1.3);
      wheel.rotation.x = Math.PI / 2;
      group.add(wheel);
      const wheel2 = wheel.clone();
      wheel2.position.z = -1.3;
      group.add(wheel2);
    });
  });
  
  return group;
}

// Create own ship mesh for maritime
function createOwnShipMesh(): THREE.Group {
  const group = new THREE.Group();
  
  // Hull - larger container ship
  const hullGeo = new THREE.BoxGeometry(200, 18, 35);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a3a5c });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 5;
  hull.castShadow = true;
  group.add(hull);
  
  // Bow shape
  const bowGeo = new THREE.ConeGeometry(17.5, 30, 4);
  const bowMat = new THREE.MeshStandardMaterial({ color: 0x1a3a5c });
  const bow = new THREE.Mesh(bowGeo, bowMat);
  bow.position.set(115, 5, 0);
  bow.rotation.z = -Math.PI / 2;
  group.add(bow);
  
  // Superstructure
  const superGeo = new THREE.BoxGeometry(50, 25, 30);
  const superMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  const superstructure = new THREE.Mesh(superGeo, superMat);
  superstructure.position.set(-50, 25, 0);
  superstructure.castShadow = true;
  group.add(superstructure);
  
  // Bridge
  const bridgeGeo = new THREE.BoxGeometry(25, 10, 25);
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridge.position.set(-50, 45, 0);
  bridge.castShadow = true;
  group.add(bridge);
  
  // Bridge windows
  const bridgeWindowGeo = new THREE.BoxGeometry(0.2, 5, 20);
  const bridgeWindowMat = new THREE.MeshStandardMaterial({ color: 0x224466 });
  const bridgeWindow = new THREE.Mesh(bridgeWindowGeo, bridgeWindowMat);
  bridgeWindow.position.set(-37.5, 45, 0);
  group.add(bridgeWindow);
  
  // Funnel/stack
  const funnelGeo = new THREE.CylinderGeometry(3, 4, 15, 16);
  const funnelMat = new THREE.MeshStandardMaterial({ color: 0xcc3333 });
  const funnel = new THREE.Mesh(funnelGeo, funnelMat);
  funnel.position.set(-70, 35, 0);
  funnel.castShadow = true;
  group.add(funnel);
  
  // Containers on deck
  const containerColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) {
      const contGeo = new THREE.BoxGeometry(12, 8.5, 8);
      const contMat = new THREE.MeshStandardMaterial({ color: containerColors[(row + col) % 6] });
      const container = new THREE.Mesh(contGeo, contMat);
      container.position.set(30 + row * 15, 18 + col * 9, 0);
      container.castShadow = true;
      group.add(container);
    }
  }
  
  // Radar mast
  const mastGeo = new THREE.CylinderGeometry(0.3, 0.3, 8, 8);
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
  const mast = new THREE.Mesh(mastGeo, mastMat);
  mast.position.set(-50, 55, 0);
  group.add(mast);
  
  // Radar scanner
  const scannerGeo = new THREE.BoxGeometry(6, 0.5, 1);
  const scannerMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const scanner = new THREE.Mesh(scannerGeo, scannerMat);
  scanner.position.set(-50, 60, 0);
  group.add(scanner);
  
  return group;
}

// Update overlays for the current stack
function updateOverlaysForStack(profile: StackProfile) {
  // Toggle BEV overlay for Waabi
  bevOverlayEnabled = profile === 'waabi';
  
  // Toggle AIS overlay for maritime
  aisOverlayEnabled = profile === 'maritime';
  
  // Update HUD visibility
  const bevHud = document.getElementById('bev-overlay');
  const aisHud = document.getElementById('ais-overlay');
  const colregsHud = document.getElementById('colregs-display');
  const railHud = document.getElementById('rail-display');
  const fmcwHud = document.getElementById('fmcw-display');
  
  if (bevHud) bevHud.style.display = bevOverlayEnabled ? 'block' : 'none';
  if (aisHud) aisHud.style.display = aisOverlayEnabled ? 'block' : 'none';
  if (colregsHud) colregsHud.style.display = profile === 'maritime' ? 'block' : 'none';
  if (railHud) railHud.style.display = profile === 'rail' ? 'block' : 'none';
  if (fmcwHud) fmcwHud.style.display = profile === 'aurora' ? 'block' : 'none';
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
    
    // Render occupancy grid
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
        ctx.fillRect(x + gx * cellW, y + (gridSize - gy - 1) * cellH, cellW + 0.5, cellH + 0.5);
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
  
  // Get detections from both stacks
  const leftDetections = state.perceptionTracks.filter(t => t.missedFrames === 0);
  
  // Simulate right stack with different detection characteristics
  // (In a real implementation, would run full second stack)
  const rightDetections = simulateAlternateStackDetections(state, compareStack);
  
  // Track detection timing for ground truth entities
  const groundTruth = [...state.trafficVehicles, ...state.pedestrians];
  
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
    
    // Check if left stack detected it
    if (timing.firstDetectedByLeft === null) {
      const matched = leftDetections.find(d => {
        const dx = d.box.center.x - gt.boundingBox.center.x;
        const dy = d.box.center.y - gt.boundingBox.center.y;
        return Math.sqrt(dx*dx + dy*dy) < 2;
      });
      if (matched) {
        timing.firstDetectedByLeft = currentTime;
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
  updateTeslaVoxelVisualization(leftDetections, state.ego);
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
function updateTeslaVoxelVisualization(detections: { box: { center: { x: number; y: number; z: number }; size: { x: number; y: number; z: number }; yaw: number }; confidence: number }[], egoState: { transform: { position: { x: number; y: number; z: number } } }) {
  if (!teslaVoxelGroup) {
    teslaVoxelGroup = new THREE.Group();
    scene.add(teslaVoxelGroup);
  }
  
  const voxelGroup = teslaVoxelGroup;
  
  // Clear previous voxels
  while (voxelGroup.children.length > 0) {
    voxelGroup.remove(voxelGroup.children[0]!);
  }
  
  // Create voxel representation for each detection
  detections.forEach(det => {
    const voxelSize = 0.5;
    const boxSize = det.box.size;
    
    const voxelsX = Math.ceil(boxSize.x / voxelSize);
    const voxelsY = Math.ceil(boxSize.y / voxelSize);
    const voxelsZ = Math.ceil(boxSize.z / voxelSize);
    
    const geometry = new THREE.BoxGeometry(voxelSize * 0.9, voxelSize * 0.9, voxelSize * 0.9);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6 * det.confidence,
    });
    
    // Add depth jitter (Tesla vision-based depth estimation has noise)
    const depthJitter = (1 - det.confidence) * 2; // More jitter for lower confidence
    
    for (let vx = 0; vx < voxelsX; vx++) {
      for (let vy = 0; vy < voxelsY; vy++) {
        for (let vz = 0; vz < Math.min(voxelsZ, 3); vz++) { // Limit vertical voxels for performance
          const voxel = new THREE.Mesh(geometry, material);
          
          const localX = (vx - voxelsX / 2 + 0.5) * voxelSize;
          const localY = (vy - voxelsY / 2 + 0.5) * voxelSize;
          const localZ = (vz + 0.5) * voxelSize;
          
          // Add depth jitter based on distance from ego
          const dx = det.box.center.x - egoState.transform.position.x;
          const dy = det.box.center.y - egoState.transform.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const jitter = (Math.random() - 0.5) * depthJitter * (dist / 30);
          
          voxel.position.set(
            det.box.center.x + localX + jitter,
            localZ,
            -det.box.center.y + localY + jitter
          );
          
          voxelGroup.add(voxel);
        }
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
    tesla: { pedestrian: 0.85, car: 0.95 },  // Vision-based, struggles with pedestrians
    waymo: { pedestrian: 0.95, car: 0.98 },  // Multi-sensor fusion, best overall
    waabi: { pedestrian: 0.90, car: 0.96 },  // Simulation-trained
    aurora: { pedestrian: 0.88, car: 0.97 }, // FMCW radar helps
    rail: { pedestrian: 0.70, car: 0.95 },   // Fixed path, less need for pedestrians
    maritime: { pedestrian: 0.60, car: 0.50 }, // Ships don't encounter cars/pedestrians
  };
  
  const distanceThreshold = {
    tesla: 60,  // Cameras have good range
    waymo: 80,  // Lidar + cameras
    waabi: 70,  // BEV representation
    aurora: 100, // FMCW radar long range
    rail: 200,   // Long straight tracks
    maritime: 500, // Long range radar
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
    aurora: 'F4: Aurora FMCW',
    rail: 'F5: Train',
    maritime: 'F6: Ship',
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

// Handle keyboard input
function setupInput() {
  document.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w': inputState.forward = true; break;
      case 's': inputState.backward = true; break;
      case 'a': inputState.left = true; break;
      case 'd': inputState.right = true; break;
      case ' ': inputState.brake = true; break;
      
      case 't':
        // Toggle takeover
        if (simulation.getState().controlSource === 'policy') {
          document.getElementById('takeover-menu')!.classList.add('visible');
        } else {
          simulation.releaseControl();
        }
        break;
        
      case 'c':
        // Cycle camera mode
        const modes: Array<typeof cameraMode> = ['chase', 'topdown', 'cockpit'];
        const idx = modes.indexOf(cameraMode);
        cameraMode = modes[(idx + 1) % modes.length]!;
        break;
        
      case 'v':
        // Toggle AI view
        showAIView = !showAIView;
        document.getElementById('ai-view-panel')!.classList.toggle('visible', showAIView);
        break;
        
      case 'g':
        // Toggle ground truth overlay
        showGroundTruth = !showGroundTruth;
        break;
        
      case 'i':
        // Toggle info card
        showInfoCard = !showInfoCard;
        if (showInfoCard) {
          updateInfoCard();
        }
        document.getElementById('info-card')!.classList.toggle('visible', showInfoCard);
        break;
        
      case 'm':
        // Toggle compare mode
        compareMode = !compareMode;
        document.getElementById('compare-container')!.classList.toggle('visible', compareMode);
        document.getElementById('canvas-container')!.style.display = compareMode ? 'none' : 'block';
        
        if (compareMode) {
          // Set compare stack to next different stack
          const stacks: StackProfile[] = ['tesla', 'waymo', 'waabi', 'aurora', 'rail', 'maritime'];
          const currentIdx = stacks.indexOf(currentStack);
          compareStack = stacks[(currentIdx + 1) % stacks.length]!;
          initCompareMode();
        }
        console.log(`Compare mode: ${compareMode ? 'ON' : 'OFF'}`);
        break;
        
      case 'r':
        // Toggle recording
        isRecording = !isRecording;
        document.getElementById('recording-indicator')!.classList.toggle('visible', isRecording);
        break;
        
      case 'n':
        // Toggle day/night
        const state = simulation.getState();
        const newTimeOfDay = state.environment.timeOfDay === 'day' ? 'night' : 'day';
        state.environment.timeOfDay = newTimeOfDay;
        
        // Update scene lighting
        if (newTimeOfDay === 'night') {
          scene.background = new THREE.Color(0x0a0a1a);
          scene.fog = new THREE.Fog(0x0a0a1a, 50, 200);
        } else {
          scene.background = new THREE.Color(0x87ceeb);
          scene.fog = new THREE.Fog(0x87ceeb, 100, 500);
        }
        break;
        
      // Scenario injection
      case '1':
        simulation.injectScenario({ type: 'jaywalker', params: {} });
        break;
      case '2':
        simulation.injectScenario({ type: 'occluded_pedestrian', params: {} });
        break;
      case '3':
        simulation.injectScenario({ type: 'vehicle_cutin', params: {} });
        break;
      case '4':
        // Toggle rain/fog weather (scenario 4 per spec)
        const weatherState = simulation.getState();
        weatherState.environment.weather = 
          weatherState.environment.weather === 'clear' ? 'rain' : 
          weatherState.environment.weather === 'rain' ? 'fog' : 'clear';
        weatherState.environment.visibility = 
          weatherState.environment.weather === 'clear' ? 1.0 :
          weatherState.environment.weather === 'rain' ? 0.6 : 0.3;
        break;
      case '5':
        // Context-dependent obstacle (scenario 5 per spec)
        // Stalled car in lane for city, car on crossing for rail, boat for ship
        simulation.injectScenario({ type: 'stalled_vehicle', params: {} });
        break;
        
      case 'p':
        isPaused = !isPaused;
        break;
    }
    
    // Function keys for stack switching (F1-F6 per spec)
    if (e.key === 'F1') { e.preventDefault(); switchStack('tesla'); }
    if (e.key === 'F2') { e.preventDefault(); switchStack('waymo'); }
    if (e.key === 'F3') { e.preventDefault(); switchStack('waabi'); }
    if (e.key === 'F4') { e.preventDefault(); switchStack('aurora'); }
    if (e.key === 'F5') { e.preventDefault(); switchStack('rail'); }
    if (e.key === 'F6') { e.preventDefault(); switchStack('maritime'); }
  });
  
  document.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w': inputState.forward = false; break;
      case 's': inputState.backward = false; break;
      case 'a': inputState.left = false; break;
      case 'd': inputState.right = false; break;
      case ' ': inputState.brake = false; break;
    }
  });
  
  // Takeover reason buttons
  document.querySelectorAll('.takeover-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const reason = (e.target as HTMLElement).dataset['reason'] as TakeoverReason;
      simulation.takeover(reason);
      document.getElementById('takeover-menu')!.classList.remove('visible');
    });
  });
  
  // Ride request buttons
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
  
  // View switcher buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const profile = (btn as HTMLElement).dataset['profile'] as StackProfile;
      switchStack(profile);
    });
  });
}

// Animation loop
let lastTime = 0;
function animate(time: number) {
  requestAnimationFrame(animate);
  
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  
  if (!isPaused) {
    // Get human input if in manual control
    const state = simulation.getState();
    let humanInput = undefined;
    
    if (state.controlSource === 'human') {
      humanInput = {
        throttle: inputState.forward ? 1 : inputState.backward ? -0.5 : 0,
        steering: inputState.left ? -1 : inputState.right ? 1 : 0,
        brake: inputState.brake ? 1 : 0,
      };
    }
    
    // Step simulation
    simulation.step(dt, humanInput);
    
    // Update ego mesh
    // Add Math.PI to flip the car so we see its rear (not headlights) from chase camera
    const egoPos = state.ego.transform.position;
    egoMesh.position.set(egoPos.x, 0.75, -egoPos.y);
    egoMesh.rotation.y = -state.ego.transform.rotation + Math.PI;
    
    // Update other meshes
    updateEntityMeshes();
    updateDetectionMeshes();
  }
  
  // Update camera
  updateCamera();
  
  // Update HUD
  updateHUD();
  updateMinimap();
  
  // Update Waabi BEV display if enabled
  if (bevOverlayEnabled && !isPaused) {
    renderBEVHeatmaps();
  }
  
  // Update compare mode if active
  if (compareMode) {
    updateCompareMode();
  }
  
  // Render (only if not in compare mode, which has its own rendering)
  if (!compareMode) {
    renderer.render(scene, camera);
  }
  // Compare mode rendering is handled by updateCompareMode()
}

// Create a more detailed ego vehicle mesh
function createEgoVehicle(): THREE.Group {
  const group = new THREE.Group();
  
  // Main body
  const bodyGeo = new THREE.BoxGeometry(4.2, 1.2, 1.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0066cc, metalness: 0.7, roughness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);
  
  // Cabin with windows
  const cabinGeo = new THREE.BoxGeometry(2.4, 0.9, 1.6);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111122, metalness: 0.3, roughness: 0.4 });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(-0.2, 1.35, 0);
  cabin.castShadow = true;
  group.add(cabin);
  
  // Roof sensor dome (lidar)
  const lidarGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.15, 16);
  const lidarMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const lidar = new THREE.Mesh(lidarGeo, lidarMat);
  lidar.position.set(0, 1.9, 0);
  group.add(lidar);
  
  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const egoWheelPositions: [number, number, number][] = [[1.3, 0.35, 0.9], [1.3, 0.35, -0.9], [-1.3, 0.35, 0.9], [-1.3, 0.35, -0.9]];
  for (const [wx, wy, wz] of egoWheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    wheel.rotation.x = Math.PI / 2;
    group.add(wheel);
  }
  
  // Headlights
  const lightGeo = new THREE.CircleGeometry(0.15, 8);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 0.5 });
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

// Initialize and start
async function init() {
  console.log('Initializing AUTONOMY CITY...');
  
  // Initialize Three.js
  initThreeJS();
  
  // Create simulation
  simulation = new Simulation({
    seed: Date.now(),
    profile: 'baseline_lidar',
    environment: { timeOfDay: 'day', weather: 'clear', visibility: 1 },
    useOracle: false,
    maxDuration: 3600, // 1 hour
  });
  
  // Replace the basic ego mesh with a detailed one
  scene.remove(egoMesh);
  const egoGroup = createEgoVehicle();
  scene.add(egoGroup);
  egoMesh = egoGroup as unknown as THREE.Mesh;
  
  // Add road network
  const state = simulation.getState();
  const roads = createRoads(state.worldMap);
  scene.add(roads);
  
  // Setup input handlers
  setupInput();
  
  // Hide loading screen
  document.getElementById('loading')!.classList.add('hidden');
  
  // Start animation loop
  lastTime = performance.now();
  requestAnimationFrame(animate);
  
  console.log('AUTONOMY CITY started!');
}

init();
