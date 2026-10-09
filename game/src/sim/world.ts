/**
 * World generation - procedural city, highway, rail, harbor
 * Renderer-independent
 */

import type {
  Entity, Vec3, Lane, Intersection, TrafficLight, RideRequest
} from './types';
import { vec3, SeededRandom } from './math';

export interface CityConfig {
  gridSize: number; // Number of blocks per side
  blockSize: number; // Size of each block in meters
  laneWidth: number;
  sidewalkWidth: number;
}

export interface WorldMap {
  lanes: Lane[];
  intersections: Intersection[];
  trafficLights: TrafficLight[];
  staticEntities: Entity[];
  spawnPoints: Vec3[];
  pickupPoints: Vec3[];
}

// Passenger name generator
const FIRST_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Skyler', 'Jamie', 'Drew', 'Reese', 'Cameron', 'Parker', 'Blair'
];

const LAST_NAMES = [
  'Chen', 'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin'
];

export function generatePassengerName(rng: SeededRandom): string {
  const firstName = FIRST_NAMES[rng.nextInt(0, FIRST_NAMES.length - 1)]!;
  const lastName = LAST_NAMES[rng.nextInt(0, LAST_NAMES.length - 1)]!;
  return `${firstName} ${lastName}`;
}

export function generateCityMap(seed: number, config: CityConfig): WorldMap {
  const rng = new SeededRandom(seed);
  const lanes: Lane[] = [];
  const intersections: Intersection[] = [];
  const trafficLights: TrafficLight[] = [];
  const staticEntities: Entity[] = [];
  const spawnPoints: Vec3[] = [];
  const pickupPoints: Vec3[] = [];
  
  let laneId = 0;
  let entityId = 1000;
  let lightId = 0;
  let intersectionId = 0;
  
  const totalSize = config.gridSize * config.blockSize;
  const halfSize = totalSize / 2;
  
  // Generate grid roads
  for (let i = 0; i <= config.gridSize; i++) {
    const pos = -halfSize + i * config.blockSize;
    
    // North-South roads (2 lanes each direction)
    for (let dir = 0; dir < 2; dir++) {
      const offset = dir === 0 ? -config.laneWidth : config.laneWidth;
      const points = [];
      for (let j = 0; j <= config.gridSize * 10; j++) {
        const y = -halfSize + (j / 10) * config.blockSize;
        points.push({
          position: vec3(pos + offset, dir === 0 ? y : totalSize - y - halfSize, 0),
          direction: dir === 0 ? Math.PI / 2 : -Math.PI / 2,
          width: config.laneWidth,
          speedLimit: 13.4, // 30 mph
        });
      }
      lanes.push({
        id: laneId++,
        points,
        type: 'driving',
        connections: [],
      });
    }
    
    // East-West roads
    for (let dir = 0; dir < 2; dir++) {
      const offset = dir === 0 ? -config.laneWidth : config.laneWidth;
      const points = [];
      for (let j = 0; j <= config.gridSize * 10; j++) {
        const x = -halfSize + (j / 10) * config.blockSize;
        points.push({
          position: vec3(dir === 0 ? x : totalSize - x - halfSize, pos + offset, 0),
          direction: dir === 0 ? 0 : Math.PI,
          width: config.laneWidth,
          speedLimit: 13.4,
        });
      }
      lanes.push({
        id: laneId++,
        points,
        type: 'driving',
        connections: [],
      });
    }
  }
  
  // Generate intersections with traffic lights
  for (let i = 0; i <= config.gridSize; i++) {
    for (let j = 0; j <= config.gridSize; j++) {
      const x = -halfSize + i * config.blockSize;
      const y = -halfSize + j * config.blockSize;
      
      const intersection: Intersection = {
        id: intersectionId++,
        center: vec3(x, y, 0),
        radius: config.laneWidth * 3,
        incomingLanes: [],
        outgoingLanes: [],
        trafficLightIds: [],
      };
      
      // Add traffic lights at major intersections (not edges)
      if (i > 0 && i < config.gridSize && j > 0 && j < config.gridSize) {
        for (let dir = 0; dir < 4; dir++) {
          const angle = (dir * Math.PI) / 2;
          const lightPos = vec3(
            x + Math.cos(angle) * config.laneWidth * 2,
            y + Math.sin(angle) * config.laneWidth * 2,
            4
          );
          
          const light: TrafficLight = {
            id: lightId++,
            position: lightPos,
            state: dir % 2 === 0 ? 'green' : 'red',
            forLaneIds: [],
          };
          trafficLights.push(light);
          intersection.trafficLightIds.push(light.id);
        }
      }
      
      intersections.push(intersection);
    }
  }
  
  // Generate buildings
  for (let i = 0; i < config.gridSize; i++) {
    for (let j = 0; j < config.gridSize; j++) {
      const blockCenterX = -halfSize + (i + 0.5) * config.blockSize;
      const blockCenterY = -halfSize + (j + 0.5) * config.blockSize;
      
      const buildingMargin = config.laneWidth * 2 + config.sidewalkWidth;
      const buildingAreaSize = config.blockSize - buildingMargin * 2;
      
      // Place 1-4 buildings per block
      const numBuildings = rng.nextInt(1, 4);
      for (let b = 0; b < numBuildings; b++) {
        const bx = blockCenterX + rng.nextFloat(-buildingAreaSize / 3, buildingAreaSize / 3);
        const by = blockCenterY + rng.nextFloat(-buildingAreaSize / 3, buildingAreaSize / 3);
        const height = rng.nextFloat(10, 50);
        const width = rng.nextFloat(15, 30);
        const depth = rng.nextFloat(15, 30);
        
        staticEntities.push({
          id: entityId++,
          classType: 'building',
          transform: { position: vec3(bx, by, height / 2), rotation: 0 },
          boundingBox: {
            center: vec3(bx, by, height / 2),
            size: vec3(width, depth, height),
            yaw: 0,
          },
          velocity: vec3(0, 0, 0),
          isStatic: true,
          occlusionLevel: 0,
        });
      }
      
      // Add pickup points on sidewalks
      const pickupX = blockCenterX + buildingAreaSize / 2 + config.sidewalkWidth / 2;
      const pickupY = blockCenterY + rng.nextFloat(-buildingAreaSize / 4, buildingAreaSize / 4);
      pickupPoints.push(vec3(pickupX, pickupY, 0));
    }
  }
  
  // Generate parked cars along some streets
  for (let i = 0; i < config.gridSize; i++) {
    for (let j = 0; j < config.gridSize; j++) {
      if (rng.next() < 0.3) {
        const x = -halfSize + i * config.blockSize + config.laneWidth * 3;
        const y = -halfSize + j * config.blockSize + rng.nextFloat(10, config.blockSize - 10);
        
        staticEntities.push({
          id: entityId++,
          classType: 'car',
          transform: { position: vec3(x, y, 0.8), rotation: Math.PI / 2 },
          boundingBox: {
            center: vec3(x, y, 0.8),
            size: vec3(4.5, 1.8, 1.5),
            yaw: Math.PI / 2,
          },
          velocity: vec3(0, 0, 0),
          isStatic: true,
          occlusionLevel: 0,
        });
      }
    }
  }
  
  // Generate trees and poles
  for (let i = 0; i <= config.gridSize; i++) {
    for (let j = 0; j <= config.gridSize; j++) {
      if (rng.next() < 0.4) {
        const x = -halfSize + i * config.blockSize + rng.nextFloat(-5, 5);
        const y = -halfSize + j * config.blockSize + config.laneWidth * 2.5 + config.sidewalkWidth;
        
        staticEntities.push({
          id: entityId++,
          classType: 'tree',
          transform: { position: vec3(x, y, 3), rotation: 0 },
          boundingBox: {
            center: vec3(x, y, 3),
            size: vec3(4, 4, 6),
            yaw: 0,
          },
          velocity: vec3(0, 0, 0),
          isStatic: true,
          occlusionLevel: 0,
        });
      }
      
      // Poles at intersections
      if (i < config.gridSize && j < config.gridSize) {
        const px = -halfSize + i * config.blockSize + config.laneWidth * 2.5;
        const py = -halfSize + j * config.blockSize + config.laneWidth * 2.5;
        
        staticEntities.push({
          id: entityId++,
          classType: 'pole',
          transform: { position: vec3(px, py, 4), rotation: 0 },
          boundingBox: {
            center: vec3(px, py, 4),
            size: vec3(0.3, 0.3, 8),
            yaw: 0,
          },
          velocity: vec3(0, 0, 0),
          isStatic: true,
          occlusionLevel: 0,
        });
      }
    }
  }
  
  // Spawn points
  for (let i = 1; i < config.gridSize; i++) {
    spawnPoints.push(vec3(-halfSize + i * config.blockSize + config.laneWidth, -halfSize + 10, 0));
  }
  
  return { lanes, intersections, trafficLights, staticEntities, spawnPoints, pickupPoints };
}

// Traffic AI - simple lane following with traffic light obedience
export interface TrafficVehicle extends Entity {
  laneId: number;
  laneProgress: number;
  targetSpeed: number;
}

export function updateTrafficVehicle(
  vehicle: TrafficVehicle,
  lanes: Lane[],
  trafficLights: TrafficLight[],
  allVehicles: TrafficVehicle[],
  dt: number
): TrafficVehicle {
  const lane = lanes.find(l => l.id === vehicle.laneId);
  if (!lane || lane.points.length < 2) return vehicle;
  
  // Check traffic lights ahead
  let shouldStop = false;
  for (const light of trafficLights) {
    const distToLight = Math.sqrt(
      (light.position.x - vehicle.transform.position.x) ** 2 +
      (light.position.y - vehicle.transform.position.y) ** 2
    );
    if (distToLight < 15 && distToLight > 2 && light.state !== 'green') {
      shouldStop = true;
      break;
    }
  }
  
  // Check for vehicles ahead
  const lookAhead = 20;
  for (const other of allVehicles) {
    if (other.id === vehicle.id) continue;
    const dist = Math.sqrt(
      (other.transform.position.x - vehicle.transform.position.x) ** 2 +
      (other.transform.position.y - vehicle.transform.position.y) ** 2
    );
    
    // Simple direction check
    const dx = other.transform.position.x - vehicle.transform.position.x;
    const dy = other.transform.position.y - vehicle.transform.position.y;
    const ahead = dx * Math.cos(vehicle.transform.rotation) + dy * Math.sin(vehicle.transform.rotation);
    
    if (dist < lookAhead && ahead > 0) {
      shouldStop = true;
      break;
    }
  }
  
  // Update speed
  let speed = Math.sqrt(vehicle.velocity.x ** 2 + vehicle.velocity.y ** 2);
  if (shouldStop) {
    speed = Math.max(0, speed - 4 * dt);
  } else {
    speed = Math.min(vehicle.targetSpeed, speed + 2 * dt);
  }
  
  // Move along lane
  const progress = vehicle.laneProgress + (speed * dt) / (lane.points.length * 2);
  
  if (progress >= 1) {
    // End of lane - could connect to next lane
    return {
      ...vehicle,
      laneProgress: 0.99,
      velocity: vec3(0, 0, 0),
    };
  }
  
  // Interpolate position
  const t = progress * (lane.points.length - 1);
  const idx = Math.floor(t);
  const frac = t - idx;
  const p1 = lane.points[Math.min(idx, lane.points.length - 1)]!;
  const p2 = lane.points[Math.min(idx + 1, lane.points.length - 1)]!;
  
  const newPos: Vec3 = {
    x: p1.position.x + (p2.position.x - p1.position.x) * frac,
    y: p1.position.y + (p2.position.y - p1.position.y) * frac,
    z: 0.8,
  };
  
  const direction = Math.atan2(
    p2.position.y - p1.position.y,
    p2.position.x - p1.position.x
  );
  
  return {
    ...vehicle,
    transform: { position: newPos, rotation: direction },
    boundingBox: { ...vehicle.boundingBox, center: newPos, yaw: direction },
    velocity: vec3(speed * Math.cos(direction), speed * Math.sin(direction), 0),
    laneProgress: progress,
  };
}

// Pedestrian AI
export interface Pedestrian extends Entity {
  targetPosition: Vec3;
  state: 'walking' | 'waiting' | 'crossing';
  waitTime: number;
}

export function updatePedestrian(
  ped: Pedestrian,
  trafficLights: TrafficLight[],
  dt: number,
  rng: SeededRandom
): Pedestrian {
  const dx = ped.targetPosition.x - ped.transform.position.x;
  const dy = ped.targetPosition.y - ped.transform.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist < 1) {
    // Reached target, pick new one
    return {
      ...ped,
      targetPosition: vec3(
        ped.transform.position.x + rng.nextFloat(-30, 30),
        ped.transform.position.y + rng.nextFloat(-30, 30),
        0
      ),
      state: 'walking',
    };
  }
  
  // Check if near a crosswalk and need to wait
  let shouldWait = false;
  for (const light of trafficLights) {
    const distToLight = Math.sqrt(
      (light.position.x - ped.transform.position.x) ** 2 +
      (light.position.y - ped.transform.position.y) ** 2
    );
    if (distToLight < 10 && light.state !== 'red') {
      // Pedestrians cross when cars have red
      shouldWait = true;
      break;
    }
  }
  
  if (shouldWait && ped.state !== 'crossing') {
    return {
      ...ped,
      state: 'waiting',
      velocity: vec3(0, 0, 0),
      waitTime: ped.waitTime + dt,
    };
  }
  
  // Walk towards target
  const speed = 1.2; // m/s walking speed
  const direction = Math.atan2(dy, dx);
  const vx = speed * Math.cos(direction);
  const vy = speed * Math.sin(direction);
  
  return {
    ...ped,
    transform: {
      position: vec3(
        ped.transform.position.x + vx * dt,
        ped.transform.position.y + vy * dt,
        0.9
      ),
      rotation: direction,
    },
    boundingBox: {
      ...ped.boundingBox,
      center: vec3(
        ped.transform.position.x + vx * dt,
        ped.transform.position.y + vy * dt,
        0.9
      ),
    },
    velocity: vec3(vx, vy, 0),
    state: 'walking',
    waitTime: 0,
  };
}

// Generate a ride request
export function generateRideRequest(
  pickupPoints: Vec3[],
  rng: SeededRandom,
  nextId: number
): RideRequest {
  const pickupIdx = rng.nextInt(0, pickupPoints.length - 1);
  let dropoffIdx = rng.nextInt(0, pickupPoints.length - 1);
  while (dropoffIdx === pickupIdx) {
    dropoffIdx = rng.nextInt(0, pickupPoints.length - 1);
  }
  
  const pickup = pickupPoints[pickupIdx]!;
  const dropoff = pickupPoints[dropoffIdx]!;
  const distance = Math.sqrt(
    (dropoff.x - pickup.x) ** 2 + (dropoff.y - pickup.y) ** 2
  );
  
  // $2.50 base + $1.50 per km
  const fare = 2.50 + (distance / 1000) * 1.50;
  
  return {
    id: nextId,
    passengerName: generatePassengerName(rng),
    pickup,
    dropoff,
    fare: Math.round(fare * 100) / 100,
    status: 'pending',
  };
}

// Update traffic light timing
export function updateTrafficLights(
  lights: TrafficLight[],
  timestamp: number,
  cycleDuration: number = 30000 // 30 seconds
): TrafficLight[] {
  const phase = (timestamp % cycleDuration) / cycleDuration;
  
  return lights.map((light, idx) => {
    // Alternate NS/EW timing
    const isNS = idx % 4 < 2;
    const offset = isNS ? 0 : 0.5;
    const adjustedPhase = (phase + offset) % 1;
    
    let state: 'red' | 'yellow' | 'green';
    if (adjustedPhase < 0.4) {
      state = 'green';
    } else if (adjustedPhase < 0.45) {
      state = 'yellow';
    } else {
      state = 'red';
    }
    
    return { ...light, state };
  });
}
