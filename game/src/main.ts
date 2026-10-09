/**
 * Main game entry point
 * Browser-based 3D visualization with Three.js
 */

import * as THREE from 'three';
import { Simulation } from './sim/simulation';
import { vec3Length } from './sim/math';
import type { TakeoverReason } from './sim/types';
import { BASELINE_INFO_CARD } from './stacks/perception';
import { WAYMO_INFO_CARD } from './stacks/waymo';
import { WAABI_INFO_CARD } from './stacks/waabi';
import { TESLA_INFO_CARD } from './stacks/tesla';

// Stack types available
type StackProfile = 'baseline_lidar' | 'tesla' | 'waymo' | 'waabi' | 'aurora' | 'rail' | 'maritime';

// Info card data for each stack
const INFO_CARDS: Record<StackProfile, {
  name: string;
  sensors: string;
  internals: string;
  strengths: string;
  weaknesses: string;
  example: string;
}> = {
  baseline_lidar: BASELINE_INFO_CARD,
  tesla: TESLA_INFO_CARD,
  waymo: WAYMO_INFO_CARD,
  waabi: WAABI_INFO_CARD,
  aurora: {
    name: 'Aurora-style: Trucking First',
    sensors: 'Publicly described: long-range lidar, cameras, radar optimized for highway',
    internals: 'Highway-focused perception, longer prediction horizons for trucking speeds, map-based routing',
    strengths: 'Optimized for highway driving, longer range detection for high-speed operations',
    weaknesses: 'Less focus on dense urban environments, requires detailed highway maps',
    example: 'Aurora focuses on autonomous trucking with the Aurora Driver, emphasizing highway safety.',
  },
  rail: {
    name: 'Rail: Fixed-path Autonomy',
    sensors: 'Forward-facing lidar/radar, track circuit sensors, wayside signals',
    internals: 'Fixed-path motion, signal-based control, track occupancy detection',
    strengths: 'Simplified path planning (fixed track), centralized control possible',
    weaknesses: 'Cannot avoid obstacles laterally, long stopping distances',
    example: 'Rail autonomy uses fixed infrastructure and signaling for safe operations.',
  },
  maritime: {
    name: 'Maritime: Open Water Autonomy',
    sensors: 'Marine radar, AIS transponders, cameras, sonar',
    internals: 'Long-range detection, collision regulations (COLREGS), sea clutter filtering',
    strengths: 'More time to react due to slow speeds, existing maritime regulations',
    weaknesses: 'Sea clutter, weather dependency, limited maneuverability of large vessels',
    example: 'Maritime autonomy follows COLREGS collision avoidance rules on open water.',
  },
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
let currentStack: StackProfile = 'baseline_lidar';
let compareMode = false;

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
  
  // Ground
  const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x333333,
    roughness: 0.9,
  });
  groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  
  // Grid helper for roads
  const gridHelper = new THREE.GridHelper(600, 60, 0x444444, 0x333333);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);
  
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

// Create mesh for entity
function createEntityMesh(classType: string): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  let color: number;
  
  switch (classType) {
    case 'car':
      geometry = new THREE.BoxGeometry(4.5, 1.8, 1.5);
      color = 0x888888;
      break;
    case 'truck':
      geometry = new THREE.BoxGeometry(10, 2.5, 3);
      color = 0x996633;
      break;
    case 'pedestrian':
      geometry = new THREE.CapsuleGeometry(0.25, 1.2, 4, 8);
      color = 0xff6600;
      break;
    case 'building':
      geometry = new THREE.BoxGeometry(20, 20, 30);
      color = 0x666666;
      break;
    case 'tree':
      geometry = new THREE.ConeGeometry(2, 6, 8);
      color = 0x228b22;
      break;
    case 'pole':
      geometry = new THREE.CylinderGeometry(0.15, 0.15, 8, 8);
      color = 0x444444;
      break;
    default:
      geometry = new THREE.BoxGeometry(2, 2, 2);
      color = 0x999999;
  }
  
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
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
      mesh = createEntityMesh(entity.classType);
      scene.add(mesh);
      entityMeshes.set(entity.id, mesh);
    }
    
    // Update position and rotation
    mesh.position.set(
      entity.transform.position.x,
      entity.transform.position.z + entity.boundingBox.size.z / 2,
      -entity.transform.position.y
    );
    mesh.rotation.y = -entity.transform.rotation;
    
    // Scale for buildings (variable size)
    if (entity.classType === 'building') {
      mesh.scale.set(
        entity.boundingBox.size.x / 20,
        entity.boundingBox.size.z / 30,
        entity.boundingBox.size.y / 20
      );
    }
  }
}

// Update detection visualization
function updateDetectionMeshes() {
  // Clear old detection meshes
  for (const mesh of detectionMeshes) {
    scene.remove(mesh);
  }
  detectionMeshes.length = 0;
  
  if (!showGroundTruth) return;
  
  const state = simulation.getState();
  
  // Get perception detections
  const detections = state.perceptionTracks.filter(t => t.missedFrames === 0);
  
  // Get ground truth
  const groundTruth = [
    ...state.trafficVehicles,
    ...state.pedestrians,
  ];
  
  // Match detections to ground truth
  for (const det of detections) {
    // Find matching ground truth
    let matched = false;
    for (const gt of groundTruth) {
      const dx = det.box.center.x - gt.boundingBox.center.x;
      const dy = det.box.center.y - gt.boundingBox.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 2) {
        matched = true;
        break;
      }
    }
    
    // Create visualization box
    const geometry = new THREE.BoxGeometry(
      det.box.size.x,
      det.box.size.z,
      det.box.size.y
    );
    const material = new THREE.MeshBasicMaterial({
      color: matched ? 0x00ff00 : 0xff8800, // Green = matched, Orange = false positive
      wireframe: true,
      transparent: true,
      opacity: 0.8,
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
  
  // Show false negatives (ground truth not detected)
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
        color: 0xff0000, // Red = false negative
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
  
  // Update control source styling
  const controlEl = document.getElementById('control-source')!;
  controlEl.className = 'status-value';
  if (state.controlSource === 'human') {
    controlEl.classList.add('status-warning');
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
  
  // Note: actual stack switching would require restarting simulation
  // For now we just update the visual indicators
  console.log(`Switched to stack: ${profile}`);
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
        const weatherState = simulation.getState();
        weatherState.environment.weather = 
          weatherState.environment.weather === 'clear' ? 'rain' : 
          weatherState.environment.weather === 'rain' ? 'fog' : 'clear';
        break;
      case '5':
        simulation.injectScenario({ type: 'stalled_vehicle', params: {} });
        break;
        
      case 'p':
        isPaused = !isPaused;
        break;
    }
    
    // Function keys for stack switching
    if (e.key === 'F1') { e.preventDefault(); switchStack('baseline_lidar'); }
    if (e.key === 'F2') { e.preventDefault(); switchStack('tesla'); }
    if (e.key === 'F3') { e.preventDefault(); switchStack('waymo'); }
    if (e.key === 'F4') { e.preventDefault(); switchStack('waabi'); }
    if (e.key === 'F5') { e.preventDefault(); switchStack('aurora'); }
    if (e.key === 'F6') { e.preventDefault(); switchStack('rail'); }
    if (e.key === 'F7') { e.preventDefault(); switchStack('maritime'); }
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
    const egoPos = state.ego.transform.position;
    egoMesh.position.set(egoPos.x, 0.75, -egoPos.y);
    egoMesh.rotation.y = -state.ego.transform.rotation;
    
    // Update other meshes
    updateEntityMeshes();
    updateDetectionMeshes();
  }
  
  // Update camera
  updateCamera();
  
  // Update HUD
  updateHUD();
  updateMinimap();
  
  // Render
  renderer.render(scene, camera);
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
