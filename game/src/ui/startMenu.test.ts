import { describe, it, expect } from 'vitest';
import { Simulation } from '../sim/simulation';
import { vec3 } from '../sim/math';
import { PULL_OVER_OFFSET, roadsideDestination } from '../sim/rightLane';
import {
  approachHeading,
  canStart,
  createTripMenu,
  dismissTripMenu,
  justDrive,
  menuTitle,
  onArrived,
  pickRandomDestination,
  pickTripDestination,
  setTripCamera,
  setTripStack,
  snapMenuDestination,
  startMapToWorld,
  startTrip,
  menuBanner,
  worldToStartMap,
} from './startMenu';

describe('start menu state flow', () => {
  it('starts closed to driving, reopens on arrival, then starts a new trip', () => {
    const spawn = { x: 3.5, y: -22 };
    let menu = createTripMenu(spawn);

    expect(menu.phase).toBe('start');
    expect(menu.open).toBe(true);
    expect(menu.stack).toBe('tesla');
    expect(menu.camera).toBe('chase');
    expect(menu.destination).toBeNull();
    expect(canStart(menu)).toBe(false);
    expect(menuTitle(menu)).toBe('AUTONOMY CITY: How Machines See');
    expect(menuBanner(menu)).toBeNull();

    menu = setTripStack(menu, 'waymo');
    menu = setTripCamera(menu, 'hood');
    menu = pickTripDestination(menu, 8, 80);

    expect(menu.stack).toBe('waymo');
    expect(menu.camera).toBe('hood');
    expect(menu.destination).not.toBeNull();
    expect(canStart(menu)).toBe(true);
    expect(menu.destination!.x).toBeCloseTo(PULL_OVER_OFFSET, 0);

    menu = startTrip(menu);
    expect(menu.phase).toBe('driving');
    expect(menu.open).toBe(false);
    expect(canStart(menu)).toBe(false);

    const parked = { x: PULL_OVER_OFFSET, y: 78 };
    menu = onArrived(menu, parked);
    expect(menu.phase).toBe('arrived');
    expect(menu.open).toBe(true);
    expect(menu.start.x).toBeCloseTo(parked.x);
    expect(menu.start.y).toBeCloseTo(parked.y);
    expect(menu.destination).toBeNull();
    expect(menu.stack).toBe('waymo');
    expect(menu.camera).toBe('hood');
    expect(menuTitle(menu)).toBe('AUTONOMY CITY: How Machines See');
    expect(menuBanner(menu)).toBe('Arrived — choose next destination');
    expect(canStart(menu)).toBe(false);

    menu = pickTripDestination(menu, 160, 4);
    expect(canStart(menu)).toBe(true);
    expect(menu.destination).not.toBeNull();

    menu = startTrip(menu);
    expect(menu.phase).toBe('driving');
    expect(menu.open).toBe(false);
    expect(menu.destination).not.toBeNull();
  });

  it('snaps a map click to the nearest right-hand curb pad', () => {
    const start = { x: 3.5, y: -22 };
    const dest = snapMenuDestination(start, 12, 80);
    const heading = approachHeading(start, { x: 0, y: 80 });
    const expected = roadsideDestination(vec3(0, 80, 0), heading);
    expect(dest.x).toBeCloseTo(expected.x, 5);
    expect(dest.y).toBeCloseTo(expected.y, 5);
    expect(dest.x).toBeCloseTo(PULL_OVER_OFFSET, 0);
  });

  it('picks a random destination on a curb, away from the start', () => {
    const start = { x: 3.5, y: -22 };
    let seed = 7;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const menu = pickRandomDestination(createTripMenu(start), rng);
    expect(menu.destination).not.toBeNull();
    expect(Math.hypot(menu.destination!.x - start.x, menu.destination!.y - start.y)).toBeGreaterThan(40);
    const onNS = Math.abs(menu.destination!.x) < 8 || Math.abs(Math.abs(menu.destination!.x) - 100) < 8
      || Math.abs(Math.abs(menu.destination!.x) - 200) < 8 || Math.abs(Math.abs(menu.destination!.x) - 300) < 8;
    const onEW = Math.abs(menu.destination!.y) < 8 || Math.abs(Math.abs(menu.destination!.y) - 100) < 8
      || Math.abs(Math.abs(menu.destination!.y) - 200) < 8 || Math.abs(Math.abs(menu.destination!.y) - 300) < 8;
    expect(onNS || onEW).toBe(true);
  });

  it('Esc dismisses the arrived menu without starting a new trip', () => {
    let menu = onArrived(startTrip(pickTripDestination(createTripMenu({ x: 0, y: 0 }), 0, 80)), { x: 5.4, y: 78 });
    menu = dismissTripMenu(menu);
    expect(menu.phase).toBe('arrived');
    expect(menu.open).toBe(false);
    expect(dismissTripMenu(createTripMenu({ x: 0, y: 0 })).open).toBe(true);
  });

  it('Just drive leaves the menu without a destination', () => {
    const menu = justDrive(pickTripDestination(createTripMenu({ x: 3.5, y: -22 }), 0, 80));
    expect(menu.phase).toBe('driving');
    expect(menu.open).toBe(false);
    expect(menu.destination).toBeNull();
  });

  it('round-trips start-map world coordinates so pins stay aligned', () => {
    const w = 560;
    const h = 420;
    const pts = [
      { x: 3.5, y: -22 },
      { x: 5.4, y: 78 },
      { x: -200, y: 100 },
    ];
    for (const p of pts) {
      const screen = worldToStartMap(p.x, p.y, w, h);
      const back = startMapToWorld(screen.x, screen.y, w, h);
      expect(back.x).toBeCloseTo(p.x, 5);
      expect(back.y).toBeCloseTo(p.y, 5);
      expect(screen.x).toBeGreaterThan(8);
      expect(screen.x).toBeLessThan(w - 8);
      expect(screen.y).toBeGreaterThan(8);
      expect(screen.y).toBeLessThan(h - 8);
    }
  });

  it('a second beginTrip after arrival uses the parked pose as the new start', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(0, 50, 0), vec3(0, 78, 0), 'policy');
    const parked = { x: PULL_OVER_OFFSET, y: 78 };
    let menu = onArrived(createTripMenu({ x: 0, y: 50 }, { phase: 'driving', open: false }), parked);
    menu = pickTripDestination(menu, 100, 4);
    expect(canStart(menu)).toBe(true);
    menu = startTrip(menu);
    sim.beginTrip(vec3(menu.start.x, menu.start.y, 0), vec3(menu.destination!.x, menu.destination!.y, 0), 'policy');
    expect(sim.hasArrived()).toBe(false);
    expect(sim.getState().controlSource).toBe('policy');
    expect(sim.getTripDestination()).not.toBeNull();
    expect(sim.getState().route.length).toBeGreaterThan(2);
    const ego = sim.getState().ego.transform.position;
    expect(Math.hypot(ego.x - parked.x, ego.y - parked.y)).toBeLessThan(12);
  });
});
