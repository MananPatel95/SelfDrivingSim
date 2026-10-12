import { describe, it, expect } from 'vitest';
import { generateCityMap, updateTrafficVehicle, entityToRoadUser, type TrafficVehicle } from './world';
import {
  type ControlledIntersection,
  type RoadUser,
  type StopBook,
  approachingIntersection,
  buildControlledIntersection,
  decideIntersection,
  distToStopLine,
} from './intersectionRules';
import { vec3 } from './math';

function car(id: number, x: number, y: number, yaw: number, speed: number): RoadUser {
  return { id, x, y, yaw, speed };
}

function stepUsers(
  users: RoadUser[],
  inter: ControlledIntersection,
  book: StopBook,
  dt: number,
  now: number,
): void {
  for (const u of users) {
    const d = decideIntersection(u, users, [], [inter], book, now);
    if (d.mustStop || u.speed > d.maxSpeed) {
      u.speed = Math.max(0, u.speed - 5 * dt);
    } else {
      const cap = d.maxSpeed > 80 ? 7 : d.maxSpeed;
      u.speed = Math.min(cap, u.speed + 2.2 * dt);
    }
    u.x += Math.cos(u.yaw) * u.speed * dt;
    u.y += Math.sin(u.yaw) * u.speed * dt;
  }
}

function overlap(a: RoadUser, b: RoadUser): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 3.2;
}

describe('several traffic cars at an all-way stop', () => {
  it('each comes to a full stop and they enter in arrival order without colliding', () => {
    const inter = buildControlledIntersection(1, 0, 0, vec3(0, 0, 0), 0);
    expect(inter.control).toBe('stop');
    const book: StopBook = { arrivals: new Map() };
    const users: RoadUser[] = [
      car(1, 3.5, -22, Math.PI / 2, 7),
      car(2, 26, 3.5, Math.PI, 7),
      car(3, -3.5, 30, -Math.PI / 2, 7),
      car(4, -34, -3.5, 0, 7),
    ];

    const firstStop = new Map<number, number>();
    const firstEnter = new Map<number, number>();
    let crashed = false;
    const dt = 1 / 30;
    let now = 0;

    for (let i = 0; i < 30 * 40; i++) {
      now += dt;
      stepUsers(users, inter, book, dt, now);
      for (let a = 0; a < users.length; a++) {
        for (let b = a + 1; b < users.length; b++) {
          if (overlap(users[a]!, users[b]!)) crashed = true;
        }
      }
      for (const u of users) {
        const line = distToStopLine(u, inter);
        if (u.speed < 0.25 && line < 5 && line > -2.5 && !firstStop.has(u.id)) {
          firstStop.set(u.id, now);
        }
        const d = Math.hypot(u.x, u.y);
        if (d < 6.5 && !firstEnter.has(u.id)) firstEnter.set(u.id, now);
      }
      if (firstEnter.size === 4) break;
    }

    expect(crashed).toBe(false);
    expect(firstStop.size).toBe(4);
    expect(firstEnter.size).toBe(4);
    const stopOrder = [...firstStop.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const enterOrder = [...firstEnter.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(enterOrder).toEqual(stopOrder);
    expect(stopOrder[0]).toBe(1);
  });

  it('lane-following traffic on four approaches of a stop intersection all halt and do not collide', () => {
    const map = generateCityMap(3, CITY);
    const inter = map.controlledIntersections.find(c => Math.abs(c.center.x) < 1 && Math.abs(c.center.y) < 1);
    expect(inter).toBeDefined();
    expect(inter!.control).toBe('stop');

    const lanes = map.lanes;
    const north = lanes.find(l => l.points[10] && Math.abs(l.points[10]!.position.x - 3.5) < 0.2 && l.points[10]!.direction > 1)!;
    const south = lanes.find(l => l.points[10] && Math.abs(l.points[10]!.position.x + 3.5) < 0.2 && l.points[10]!.direction < -1)!;
    const east = lanes.find(l => l.points[10] && Math.abs(l.points[10]!.position.y + 3.5) < 0.2 && Math.abs(l.points[10]!.direction) < 0.2)!;
    const west = lanes.find(l => l.points[10] && Math.abs(l.points[10]!.position.y - 3.5) < 0.2 && Math.abs(l.points[10]!.direction) > 2.5)!;

    const mk = (id: number, x: number, y: number, yaw: number, laneId: number, progress: number): TrafficVehicle => ({
      id,
      classType: 'car',
      transform: { position: vec3(x, y, 0.8), rotation: yaw },
      boundingBox: { center: vec3(x, y, 0.8), size: vec3(4.5, 1.8, 1.5), yaw },
      velocity: vec3(Math.cos(yaw) * 6, Math.sin(yaw) * 6, 0),
      isStatic: false,
      occlusionLevel: 0,
      laneId,
      laneProgress: progress,
      targetSpeed: 8,
    });

    const progressAt = (lane: typeof north, x: number, y: number) => {
      let best = 0.4;
      let bestD = Infinity;
      for (let i = 0; i < lane.points.length; i++) {
        const p = lane.points[i]!;
        const d = (p.position.x - x) ** 2 + (p.position.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i / (lane.points.length - 1);
        }
      }
      return best;
    };

    let cars: TrafficVehicle[] = [
      mk(101, 3.5, -24, Math.PI / 2, north.id, progressAt(north, 3.5, -24)),
      mk(102, 28, -3.5, Math.PI, west.id, progressAt(west, 28, -3.5)),
      mk(103, -3.5, 32, -Math.PI / 2, south.id, progressAt(south, -3.5, 32)),
      mk(104, -36, 3.5, 0, east.id, progressAt(east, -36, 3.5)),
    ];

    const book: StopBook = { arrivals: new Map() };
    const halted = new Set<number>();
    const entered: number[] = [];
    let crashed = false;
    for (let i = 0; i < 30 * 25; i++) {
      const others = cars.map(entityToRoadUser);
      cars = cars.map(c => updateTrafficVehicle(c, map.lanes, [], cars, 1 / 30, [], {
        intersections: [inter!],
        book,
        now: i / 30,
        others,
      }));
      for (let a = 0; a < cars.length; a++) {
        for (let b = a + 1; b < cars.length; b++) {
          const dx = cars[a]!.transform.position.x - cars[b]!.transform.position.x;
          const dy = cars[a]!.transform.position.y - cars[b]!.transform.position.y;
          if (dx * dx + dy * dy < 4.2 * 4.2) crashed = true;
        }
      }
      for (const c of cars) {
        const self = entityToRoadUser(c);
        const hit = approachingIntersection(self, [inter!]);
        if (hit && self.speed < 0.25 && hit.distToLine < 5) halted.add(c.id);
        const d = Math.hypot(c.transform.position.x, c.transform.position.y);
        if (d < 6.5 && !entered.includes(c.id)) entered.push(c.id);
      }
      if (halted.size === 4 && entered.length === 4) break;
    }

    expect(crashed).toBe(false);
    expect(halted.size).toBe(4);
    expect(entered.length).toBeGreaterThanOrEqual(1);
  });

  it('updateTrafficVehicle obeys a stop sign on its own approach', () => {
    const map = generateCityMap(3, CITY);
    const inter = map.controlledIntersections.find(c => Math.abs(c.center.x) < 1 && Math.abs(c.center.y) < 1)!;
    const lane = map.lanes.find(l => {
      const p = l.points[20];
      return p && Math.abs(p.position.x - 3.5) < 0.2 && p.direction > 1;
    })!;
    let vehicle: TrafficVehicle = {
      id: 7,
      classType: 'car',
      transform: { position: vec3(3.5, -28, 0.8), rotation: Math.PI / 2 },
      boundingBox: { center: vec3(3.5, -28, 0.8), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2 },
      velocity: vec3(0, 7, 0),
      isStatic: false,
      occlusionLevel: 0,
      laneId: lane.id,
      laneProgress: 0.36,
      targetSpeed: 10,
    };
    const book: StopBook = { arrivals: new Map() };
    let sawStop = false;
    for (let i = 0; i < 200; i++) {
      vehicle = updateTrafficVehicle(vehicle, map.lanes, [], [vehicle], 1 / 30, [], {
        intersections: [inter],
        book,
        now: i / 30,
        others: [entityToRoadUser(vehicle)],
      });
      const speed = Math.hypot(vehicle.velocity.x, vehicle.velocity.y);
      const d = Math.hypot(vehicle.transform.position.x, vehicle.transform.position.y);
      if (speed < 0.2 && d > 6 && d < 14) sawStop = true;
      if (sawStop && vehicle.transform.position.y > 4) break;
    }
    expect(sawStop).toBe(true);
  });
});

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };
