import { describe, it, expect } from 'vitest';
import { generateCityMap, updateTrafficVehicle, entityToRoadUser, spawnGraphTraffic, type TrafficVehicle } from './world';
import {
  DEADLOCK_WAIT,
  INTERSECTION_BOX,
  type StopBook,
  buildControlledIntersection,
  distToCenter,
} from './intersectionRules';
import {
  DEFAULT_CITY,
  neighborNodes,
  pickRandomExit,
  turnName,
  sameNode,
} from './trafficFlow';
import { SeededRandom, vec3, normalizeAngle } from './math';

const CITY = { gridSize: 6, blockSize: 100, laneWidth: 3.5, sidewalkWidth: 2 };

function graphBook(): StopBook {
  return { arrivals: new Map() };
}

describe('traffic graph random walk', () => {
  it('never U-turns when another exit exists', () => {
    const rng = new SeededRandom(9);
    const from = { i: 3, j: 2 };
    const via = { i: 3, j: 3 };
    for (let n = 0; n < 80; n++) {
      const to = pickRandomExit(from, via, 6, rng);
      expect(turnName(from, via, to)).not.toBe('uturn');
      expect(sameNode(to, from)).toBe(false);
    }
  });

  it('only U-turns at a true dead end', () => {
    const rng = new SeededRandom(1);
    const from = { i: 1, j: 0 };
    const via = { i: 0, j: 0 };
    const opts = neighborNodes(via, 6);
    expect(opts.length).toBe(2);
    const to = pickRandomExit(from, via, 6, rng);
    expect(turnName(from, via, to)).not.toBe('uturn');
  });

  it('turns into the right-hand lane at an intersection instead of U-turning', () => {
    const map = generateCityMap(3, CITY);
    const rng = new SeededRandom(11);
    const book: StopBook = graphBook();
    let car = spawnGraphTraffic(1, rng, 50, DEFAULT_CITY)[0]!;
    car.fromNode = { i: 3, j: 2 };
    car.toNode = { i: 3, j: 3 };
    car.nextNode = { i: 4, j: 3 };
    car.path = [
      vec3(3.5, -40, 0),
      vec3(3.5, -3.5, 0),
      vec3(40, -3.5, 0),
    ];
    car.pathS = 0;
    car.transform = { position: vec3(3.5, -40, 0.8), rotation: Math.PI / 2 };
    car.boundingBox = { ...car.boundingBox, center: vec3(3.5, -40, 0.8), yaw: Math.PI / 2 };
    car.velocity = vec3(0, 6, 0);
    car.targetSpeed = 8;
    const startYaw = car.transform.rotation;
    for (let i = 0; i < 15 * 20; i++) {
      car = updateTrafficVehicle(car, map.lanes, [], [car], 1 / 15, [], {
        intersections: map.controlledIntersections,
        book,
        now: i / 15,
        others: [entityToRoadUser(car)],
        rng,
        city: DEFAULT_CITY,
      });
    }
    const dYaw = Math.abs(normalizeAngle(car.transform.rotation - startYaw));
    expect(dYaw).toBeGreaterThan(0.6);
    expect(dYaw).toBeLessThan(2.2);
    expect(car.transform.position.x).toBeGreaterThan(8);
  });

  it('southbound and westbound lanes span the full map instead of ending at the origin', () => {
    const map = generateCityMap(3, CITY);
    const south = map.lanes.filter(l => l.points[0] && l.points[0]!.direction < -1);
    expect(south.length).toBeGreaterThan(0);
    for (const lane of south) {
      const ys = lane.points.map(p => p.position.y);
      expect(Math.max(...ys)).toBeGreaterThan(250);
      expect(Math.min(...ys)).toBeLessThan(-250);
    }
    const west = map.lanes.filter(l => l.points[0] && Math.abs(l.points[0]!.direction) > 2.5);
    expect(west.length).toBeGreaterThan(0);
    for (const lane of west) {
      const xs = lane.points.map(p => p.position.x);
      expect(Math.max(...xs)).toBeGreaterThan(250);
      expect(Math.min(...xs)).toBeLessThan(-250);
    }
  });
});

describe('graph traffic at an all-way stop', () => {
  it('four cars arriving together all full-stop, then clear without colliding or camping the box', () => {
    const inter = buildControlledIntersection(1, 0, 0, vec3(0, 0, 0), 0);
    expect(inter.control).toBe('stop');
    const map = generateCityMap(0, CITY);
    const rng = new SeededRandom(4);
    const book: StopBook = graphBook();

    const mk = (id: number, x: number, y: number, yaw: number, from: { i: number; j: number }, to: { i: number; j: number }, next: { i: number; j: number }): TrafficVehicle => {
      const cars = spawnGraphTraffic(1, new SeededRandom(id + 20), id, DEFAULT_CITY);
      const car = cars[0]!;
      car.id = id;
      car.transform = { position: vec3(x, y, 0.8), rotation: yaw };
      car.boundingBox = { ...car.boundingBox, center: vec3(x, y, 0.8), yaw };
      car.velocity = vec3(Math.cos(yaw) * 5.5, Math.sin(yaw) * 5.5, 0);
      car.targetSpeed = 8;
      car.fromNode = from;
      car.toNode = to;
      car.nextNode = next;
      car.path = [
        vec3(x, y, 0),
        vec3(x + Math.cos(yaw) * 40, y + Math.sin(yaw) * 40, 0),
      ];
      car.pathS = 0;
      car.stuckTime = 0;
      car.intersectionsCleared = 0;
      return car;
    };

    let cars: TrafficVehicle[] = [
      mk(1, 3.5, -18, Math.PI / 2, { i: 3, j: 2 }, { i: 3, j: 3 }, { i: 3, j: 4 }),
      mk(2, 18, 3.5, Math.PI, { i: 4, j: 3 }, { i: 3, j: 3 }, { i: 2, j: 3 }),
      mk(3, -3.5, 18, -Math.PI / 2, { i: 3, j: 4 }, { i: 3, j: 3 }, { i: 3, j: 2 }),
      mk(4, -18, -3.5, 0, { i: 2, j: 3 }, { i: 3, j: 3 }, { i: 4, j: 3 }),
    ];

    const firstStop = new Map<number, number>();
    const entered = new Set<number>();
    const leftBox = new Set<number>();
    const boxTime = new Map<number, number>();
    let crashed = false;
    const dt = 1 / 20;
    let now = 0;
    for (let i = 0; i < 20 * 40; i++) {
      now += dt;
      const others = cars.map(entityToRoadUser);
      cars = cars.map(c => updateTrafficVehicle(c, map.lanes, [], cars, dt, [], {
        intersections: [inter],
        book,
        now,
        others,
        rng,
        city: DEFAULT_CITY,
      }));
      for (let a = 0; a < cars.length; a++) {
        for (let b = a + 1; b < cars.length; b++) {
          const dx = cars[a]!.transform.position.x - cars[b]!.transform.position.x;
          const dy = cars[a]!.transform.position.y - cars[b]!.transform.position.y;
          if (dx * dx + dy * dy < 3.0 * 3.0) crashed = true;
        }
      }
      for (const c of cars) {
        const self = entityToRoadUser(c);
        const d = distToCenter(self, inter);
        if (self.speed < 0.25 && d > INTERSECTION_BOX && d < 14 && !firstStop.has(c.id)) {
          firstStop.set(c.id, now);
        }
        if (d < INTERSECTION_BOX) entered.add(c.id);
        if (d < INTERSECTION_BOX && self.speed < 0.3) {
          boxTime.set(c.id, (boxTime.get(c.id) ?? 0) + dt);
        }
        if (entered.has(c.id) && d > INTERSECTION_BOX + 5) leftBox.add(c.id);
      }
      if (leftBox.size === 4) break;
    }

    expect(crashed).toBe(false);
    expect(firstStop.size).toBe(4);
    expect(leftBox.size).toBe(4);
    for (const t of boxTime.values()) expect(t).toBeLessThanOrEqual(2);
    const stops = [...firstStop.values()];
    expect(Math.max(...stops) - Math.min(...stops)).toBeLessThan(DEADLOCK_WAIT + 1.5);
  });
});

describe('headless traffic soak', () => {
  it('N cars make forward progress for 2+ minutes with no deadlock, reverse, or box camping', () => {
    const map = generateCityMap(3, CITY);
    const rng = new SeededRandom(3);
    const book: StopBook = graphBook();
    const N = 12;
    let cars = spawnGraphTraffic(N, rng, 100, DEFAULT_CITY);
    const dt = 1 / 15;
    const duration = 130;
    const steps = Math.round(duration / dt);
    const K = 3;

    const dist = new Map<number, number>();
    const boxSlow = new Map<number, number>();
    const lastPos = new Map<number, { x: number; y: number }>();
    let reversed = false;
    let maxBoxSlow = 0;

    for (let i = 0; i < steps; i++) {
      const now = i * dt;
      const others = cars.map(entityToRoadUser);
      cars = cars.map(c => updateTrafficVehicle(c, map.lanes, [], cars, dt, [], {
        intersections: map.controlledIntersections,
        book,
        now,
        others,
        rng,
        city: DEFAULT_CITY,
      }));
      for (const c of cars) {
        const x = c.transform.position.x;
        const y = c.transform.position.y;
        const prev = lastPos.get(c.id);
        if (prev) {
          const step = Math.hypot(x - prev.x, y - prev.y);
          dist.set(c.id, (dist.get(c.id) ?? 0) + step);
          if (step > 0.12) {
            const yaw = c.transform.rotation;
            const forward = (x - prev.x) * Math.cos(yaw) + (y - prev.y) * Math.sin(yaw);
            if (forward < -0.08) reversed = true;
            const turn = Math.abs(normalizeAngle(Math.atan2(y - prev.y, x - prev.x) - yaw));
            if (turn > 2.5) reversed = true;
          }
        }
        lastPos.set(c.id, { x, y });
        const speed = Math.hypot(c.velocity.x, c.velocity.y);
        const inBox = map.controlledIntersections.some(inter =>
          Math.hypot(x - inter.center.x, y - inter.center.y) < INTERSECTION_BOX);
        if (inBox && speed < 0.3) {
          const t = (boxSlow.get(c.id) ?? 0) + dt;
          boxSlow.set(c.id, t);
          if (t > maxBoxSlow) maxBoxSlow = t;
        } else if (!inBox) {
          boxSlow.set(c.id, 0);
        }
      }
    }

    expect(reversed).toBe(false);
    expect(maxBoxSlow).toBeLessThanOrEqual(2);
    expect(cars.length).toBe(N);
    for (const c of cars) {
      const travelled = dist.get(c.id) ?? 0;
      const crossed = c.intersectionsCleared ?? 0;
      expect(travelled).toBeGreaterThan(80);
      expect(crossed).toBeGreaterThanOrEqual(K);
    }
  });
});
