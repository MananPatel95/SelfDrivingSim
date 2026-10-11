/**
 * World generation - procedural city
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

/** Asphalt half-width matches the rendered 14 m roads (laneWidth * 2). */
export function roadHalfWidth(config: { laneWidth: number }): number {
  return config.laneWidth * 2;
}

export function distToNearestRoadAxis(v: number, halfSize: number, blockSize: number): number {
  const rel = v + halfSize;
  const mod = ((rel % blockSize) + blockSize) % blockSize;
  return Math.min(mod, blockSize - mod);
}

export function nearestRoadLine(v: number, halfSize: number, blockSize: number, gridSize: number): number {
  const i = Math.max(0, Math.min(gridSize, Math.round((v + halfSize) / blockSize)));
  return -halfSize + i * blockSize;
}

/** True when a point sits on asphalt (or within `margin` metres of it). */
export function pointOnRoad(
  x: number,
  y: number,
  config: { laneWidth: number; gridSize: number; blockSize: number },
  margin = 0
): boolean {
  const half = (config.gridSize * config.blockSize) / 2;
  const limit = roadHalfWidth(config) + margin;
  return distToNearestRoadAxis(x, half, config.blockSize) < limit
    || distToNearestRoadAxis(y, half, config.blockSize) < limit;
}

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
  
  // Trees sit on the sidewalk, clear of the asphalt. Trunk box is what cars hit.
  const sidewalkInset = config.laneWidth * 2 + config.sidewalkWidth * 0.7;
  for (let i = 0; i < config.gridSize; i++) {
    for (let j = 0; j < config.gridSize; j++) {
      const x0 = -halfSize + i * config.blockSize;
      const y0 = -halfSize + j * config.blockSize;
      for (let t = 18; t < config.blockSize - 16; t += 22) {
        const spots: Array<[number, number]> = [
          [x0 + t, y0 + sidewalkInset],
          [x0 + t, y0 + config.blockSize - sidewalkInset],
          [x0 + sidewalkInset, y0 + t],
          [x0 + config.blockSize - sidewalkInset, y0 + t],
        ];
        for (const [x, y] of spots) {
          if (rng.next() > 0.42) continue;
          if (pointOnRoad(x, y, config, 1.2)) continue;
          staticEntities.push({
            id: entityId++,
            classType: 'tree',
            transform: { position: vec3(x, y, 3), rotation: 0 },
            boundingBox: {
              center: vec3(x, y, 1.2),
              size: vec3(0.75, 0.75, 2.4),
              yaw: 0,
            },
            velocity: vec3(0, 0, 0),
            isStatic: true,
            occlusionLevel: 0,
          });
        }
      }
    }
  }

  // Poles at intersections
  for (let i = 0; i <= config.gridSize; i++) {
    for (let j = 0; j <= config.gridSize; j++) {
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

  // Curb volumes along mid-block sidewalks (gaps at intersections so cars can turn)
  const roadHalf = config.laneWidth * 2;
  const curbThick = 0.4;
  for (let i = 0; i <= config.gridSize; i++) {
    const pos = -halfSize + i * config.blockSize;
    for (let j = 0; j < config.gridSize; j++) {
      const a = -halfSize + j * config.blockSize + roadHalf + 1.2;
      const b = -halfSize + (j + 1) * config.blockSize - roadHalf - 1.2;
      const mid = (a + b) / 2;
      const len = b - a;
      if (len < 2) continue;
      for (const side of [-1, 1]) {
        staticEntities.push({
          id: entityId++,
          classType: 'barrier',
          transform: { position: vec3(pos + side * (roadHalf + curbThick / 2), mid, 0.15), rotation: 0 },
          boundingBox: {
            center: vec3(pos + side * (roadHalf + curbThick / 2), mid, 0.15),
            size: vec3(curbThick, len, 0.3),
            yaw: 0,
          },
          velocity: vec3(0, 0, 0),
          isStatic: true,
          occlusionLevel: 0,
        });
        staticEntities.push({
          id: entityId++,
          classType: 'barrier',
          transform: { position: vec3(mid, pos + side * (roadHalf + curbThick / 2), 0.15), rotation: 0 },
          boundingBox: {
            center: vec3(mid, pos + side * (roadHalf + curbThick / 2), 0.15),
            size: vec3(len, curbThick, 0.3),
            yaw: 0,
          },
          velocity: vec3(0, 0, 0),
          isStatic: true,
          occlusionLevel: 0,
        });
      }
    }
  }
  
  // Spawn at the center intersection so the first view is a real street
  // Face an intersection so crosswalks and sidewalks are in the first shot
  spawnPoints.push(vec3(config.laneWidth, -22, 0));
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
  dt: number,
  pedestrians: Pedestrian[] = []
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
  
  // IDM follow + yield: treat the closest in-lane actor (NPC or implied gap) as leader
  let leadGap = 40;
  let leadSpeed = vehicle.targetSpeed;
  const yaw = vehicle.transform.rotation;
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  for (const other of allVehicles) {
    if (other.id === vehicle.id) continue;
    const dx = other.transform.position.x - vehicle.transform.position.x;
    const dy = other.transform.position.y - vehicle.transform.position.y;
    const ahead = dx * fx + dy * fy;
    const lat = Math.abs(-dx * fy + dy * fx);
    if (ahead > 0.5 && ahead < leadGap && lat < 2.4) {
      leadGap = ahead;
      leadSpeed = Math.sqrt(other.velocity.x ** 2 + other.velocity.y ** 2);
    }
  }

  let speed = Math.sqrt(vehicle.velocity.x ** 2 + vehicle.velocity.y ** 2);
  const v0 = vehicle.targetSpeed;
  const s0 = 6;
  const T = 1.4;
  const aMax = 1.6;
  const bDecel = 3.2;
  const dv = speed - leadSpeed;
  const sStar = s0 + Math.max(0, speed * T + (speed * dv) / (2 * Math.sqrt(aMax * bDecel)));
  let accel = aMax * (1 - (speed / Math.max(0.5, v0)) ** 4 - (sStar / Math.max(1, leadGap - 4.5)) ** 2);
  const yieldPed = shouldYieldToPedestrian(
    vehicle.transform.position.x,
    vehicle.transform.position.y,
    yaw,
    pedestrians
  );
  if (yieldPed) shouldStop = true;
  if (shouldStop) accel = Math.min(accel, yieldPed ? -6.5 : -3.5);
  speed = Math.max(0, Math.min(v0, speed + accel * dt));
  
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

// Pedestrian AI — sidewalk walking, crosswalk crossings, yield to cars.
const PED_CITY = { laneWidth: 3.5, gridSize: 6, blockSize: 100 };
const PED_HALF = (PED_CITY.gridSize * PED_CITY.blockSize) / 2;
const SIDEWALK = 8.8;
const WALK_SPEED = 1.35;

export interface Pedestrian extends Entity {
  targetPosition: Vec3;
  state: 'walking' | 'waiting' | 'crossing';
  waitTime: number;
  roadAxis?: 'x' | 'y';
  roadLine?: number;
  sideSign?: number;
  crossCooldown?: number;
  walkDir?: number;
}

export interface RoadActor {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function approachingCrosswalk(cx: number, cy: number, actors: RoadActor[]): boolean {
  for (const actor of actors) {
    const dx = cx - actor.x;
    const dy = cy - actor.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 24 || dist < 2.5) continue;
    const speed = Math.hypot(actor.vx, actor.vy);
    if (speed < 0.7) continue;
    const closing = (actor.vx * dx + actor.vy * dy) / dist;
    if (closing > 1.1) return true;
  }
  return false;
}

export function shouldYieldToPedestrian(
  x: number,
  y: number,
  yaw: number,
  peds: Array<Pick<Pedestrian, 'transform' | 'state'>>
): boolean {
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  for (const ped of peds) {
    const px = ped.transform.position.x;
    const py = ped.transform.position.y;
    const dx = px - x;
    const dy = py - y;
    const ahead = dx * fx + dy * fy;
    const lat = Math.abs(-dx * fy + dy * fx);
    if (ahead < 0.5 || ahead > 16 || lat > 3.6) continue;
    const onAsphalt = pointOnRoad(px, py, PED_CITY, 0.15);
    if (ped.state === 'crossing' || ped.state === 'waiting' || onAsphalt) return true;
  }
  return false;
}

function movedPed(
  ped: Pedestrian,
  x: number,
  y: number,
  rotation: number,
  vx: number,
  vy: number,
  state: Pedestrian['state'],
  extra: Partial<Pedestrian> = {}
): Pedestrian {
  return {
    ...ped,
    ...extra,
    state,
    transform: { position: vec3(x, y, 0.9), rotation },
    boundingBox: { ...ped.boundingBox, center: vec3(x, y, 0.9), yaw: rotation },
    velocity: vec3(vx, vy, 0),
  };
}

function bindSidewalk(ped: Pedestrian): { axis: 'x' | 'y'; roadLine: number; sideSign: number } {
  if (ped.roadAxis && ped.roadLine !== undefined && ped.sideSign) {
    return { axis: ped.roadAxis, roadLine: ped.roadLine, sideSign: ped.sideSign };
  }
  const x = ped.transform.position.x;
  const y = ped.transform.position.y;
  const dx = distToNearestRoadAxis(x, PED_HALF, PED_CITY.blockSize);
  const dy = distToNearestRoadAxis(y, PED_HALF, PED_CITY.blockSize);
  if (dx <= dy) {
    const roadLine = nearestRoadLine(x, PED_HALF, PED_CITY.blockSize, PED_CITY.gridSize);
    return { axis: 'y', roadLine, sideSign: Math.sign(x - roadLine) || 1 };
  }
  const roadLine = nearestRoadLine(y, PED_HALF, PED_CITY.blockSize, PED_CITY.gridSize);
  return { axis: 'x', roadLine, sideSign: Math.sign(y - roadLine) || 1 };
}

export function updatePedestrian(
  ped: Pedestrian,
  _trafficLights: TrafficLight[],
  dt: number,
  rng: SeededRandom,
  actors: RoadActor[] = []
): Pedestrian {
  const x = ped.transform.position.x;
  const y = ped.transform.position.y;

  if (ped.state === 'crossing') {
    const dx = ped.targetPosition.x - x;
    const dy = ped.targetPosition.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.4) {
      const dir = ped.walkDir ?? Math.PI / 2;
      return movedPed(ped, ped.targetPosition.x, ped.targetPosition.y, dir,
        Math.cos(dir) * WALK_SPEED, Math.sin(dir) * WALK_SPEED, 'walking', {
          waitTime: 0,
          crossCooldown: 5,
          state: 'walking',
        });
    }
    const vx = (dx / dist) * 1.55;
    const vy = (dy / dist) * 1.55;
    return movedPed(ped, x + vx * dt, y + vy * dt, Math.atan2(vy, vx), vx, vy, 'crossing');
  }

  if (ped.state === 'waiting') {
    const mx = (x + ped.targetPosition.x) / 2;
    const my = (y + ped.targetPosition.y) / 2;
    const threatened = approachingCrosswalk(mx, my, actors);
    if (!threatened || ped.waitTime > 5) {
      const dx = ped.targetPosition.x - x;
      const dy = ped.targetPosition.y - y;
      return movedPed(ped, x, y, Math.atan2(dy, dx), 0, 0, 'crossing', { waitTime: 0 });
    }
    return movedPed(ped, x, y, ped.transform.rotation, 0, 0, 'waiting', { waitTime: ped.waitTime + dt });
  }

  const bind = bindSidewalk(ped);
  const heading = ped.transform.rotation;
  let sx = x;
  let sy = y;
  let dir: number;
  if (bind.axis === 'y') {
    sx = bind.roadLine + bind.sideSign * SIDEWALK;
    const sense = Math.sin(heading) >= 0 ? 1 : -1;
    dir = sense > 0 ? Math.PI / 2 : -Math.PI / 2;
    sy = y + sense * WALK_SPEED * dt;
  } else {
    sy = bind.roadLine + bind.sideSign * SIDEWALK;
    const sense = Math.cos(heading) >= 0 ? 1 : -1;
    dir = sense > 0 ? 0 : Math.PI;
    sx = x + sense * WALK_SPEED * dt;
  }

  const cooldown = (ped.crossCooldown ?? 0) - dt;
  const along = bind.axis === 'y' ? sy : sx;
  const nearJunction = distToNearestRoadAxis(along, PED_HALF, PED_CITY.blockSize) < roadHalfWidth(PED_CITY) + 1.2;
  if (nearJunction && (cooldown > 0 || rng.next() >= 0.7)) {
    const ix = bind.axis === 'y'
      ? bind.roadLine
      : nearestRoadLine(sx, PED_HALF, PED_CITY.blockSize, PED_CITY.gridSize);
    const iy = bind.axis === 'y'
      ? nearestRoadLine(sy, PED_HALF, PED_CITY.blockSize, PED_CITY.gridSize)
      : bind.roadLine;
    const approach = bind.axis === 'y' ? Math.sign(sy - iy || 1) : Math.sign(sx - ix || 1);
    const cornerX = bind.axis === 'y' ? bind.roadLine + bind.sideSign * SIDEWALK : ix + approach * (roadHalfWidth(PED_CITY) + 1.8);
    const cornerY = bind.axis === 'y' ? iy + approach * (roadHalfWidth(PED_CITY) + 1.8) : bind.roadLine + bind.sideSign * SIDEWALK;
    const newAxis: 'x' | 'y' = bind.axis === 'y' ? 'x' : 'y';
    const newDir = newAxis === 'x'
      ? (bind.sideSign > 0 ? 0 : Math.PI)
      : (bind.sideSign > 0 ? Math.PI / 2 : -Math.PI / 2);
    return movedPed(ped, cornerX, cornerY, newDir, Math.cos(newDir) * WALK_SPEED, Math.sin(newDir) * WALK_SPEED, 'walking', {
      roadAxis: newAxis,
      roadLine: newAxis === 'x' ? iy : ix,
      sideSign: approach,
      crossCooldown: 2.5,
      waitTime: 0,
      walkDir: newDir,
    });
  }
  if (nearJunction && cooldown <= 0) {
    const ix = bind.axis === 'y'
      ? bind.roadLine
      : nearestRoadLine(sx, PED_HALF, PED_CITY.blockSize, PED_CITY.gridSize);
    const iy = bind.axis === 'y'
      ? nearestRoadLine(sy, PED_HALF, PED_CITY.blockSize, PED_CITY.gridSize)
      : bind.roadLine;
    const far = -bind.sideSign;
    const tx = bind.axis === 'y' ? bind.roadLine + far * SIDEWALK : sx;
    const ty = bind.axis === 'y' ? sy : bind.roadLine + far * SIDEWALK;
    const standX = bind.axis === 'y' ? sx : ix + Math.sign(sx - ix || 1) * (roadHalfWidth(PED_CITY) + 1.4);
    const standY = bind.axis === 'y' ? iy + Math.sign(sy - iy || 1) * (roadHalfWidth(PED_CITY) + 1.4) : sy;
    const threatened = approachingCrosswalk(ix, iy, actors);
    if (threatened) {
      return movedPed(ped, standX, standY, dir, 0, 0, 'waiting', {
        targetPosition: vec3(tx, ty, 0),
        waitTime: dt,
        roadAxis: bind.axis,
        roadLine: bind.roadLine,
        sideSign: bind.sideSign,
        walkDir: dir,
        crossCooldown: 0,
      });
    }
    return movedPed(ped, standX, standY, Math.atan2(ty - standY, tx - standX), 0, 0, 'crossing', {
      targetPosition: vec3(tx, ty, 0),
      waitTime: 0,
      roadAxis: bind.axis,
      roadLine: bind.roadLine,
      sideSign: far,
      walkDir: dir,
      crossCooldown: 0,
    });
  }

  return movedPed(ped, sx, sy, dir, Math.cos(dir) * WALK_SPEED, Math.sin(dir) * WALK_SPEED, 'walking', {
    roadAxis: bind.axis,
    roadLine: bind.roadLine,
    sideSign: bind.sideSign,
    crossCooldown: Math.max(0, cooldown),
    waitTime: 0,
    walkDir: dir,
  });
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

