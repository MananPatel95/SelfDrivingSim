import { describe, it, expect } from 'vitest';
import { Simulation } from '../sim/simulation';
import { vec3 } from '../sim/math';
import { LANE_OFFSET, PULL_OVER_OFFSET, isValidLaneSpawn, resolveTripDestination } from '../sim/rightLane';
import {
  canStart,
  clickTripMap,
  createTripMenu,
  dismissTripMenu,
  justDrive,
  menuTitle,
  onArrived,
  pickRandomDestination,
  resetTripPoints,
  setTripCamera,
  setTripMode,
  setTripStack,
  snapMenuDestination,
  snapMenuStart,
  startMapToWorld,
  startTrip,
  menuBanner,
  worldToStartMap,
} from './startMenu';

describe('start menu state flow', () => {
  it('A → B is start then dest, then driving, arrived, then a new trip', () => {
    const spawn = { x: 3.5, y: -50 };
    let menu = createTripMenu(spawn);

    expect(menu.phase).toBe('start');
    expect(menu.open).toBe(true);
    expect(menu.mode).toBe('ab');
    expect(menu.startLocked).toBe(false);
    expect(menu.destination).toBeNull();
    expect(canStart(menu)).toBe(false);
    expect(menuTitle(menu)).toBe('AUTONOMY CITY: How Machines See');
    expect(menuBanner(menu)).toBeNull();

    menu = setTripStack(menu, 'waymo');
    menu = setTripCamera(menu, 'hood');
    menu = clickTripMap(menu, 4, -50);
    expect(menu.startLocked).toBe(true);
    expect(menu.start.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(isValidLaneSpawn(menu.start.x, menu.start.y, menu.startHeading)).toBe(true);
    expect(canStart(menu)).toBe(false);

    menu = clickTripMap(menu, 8, 80);
    expect(menu.stack).toBe('waymo');
    expect(menu.camera).toBe('hood');
    expect(menu.destination).not.toBeNull();
    expect(canStart(menu)).toBe(true);
    expect(menu.destination!.x).toBeCloseTo(PULL_OVER_OFFSET, 0);

    menu = clickTripMap(menu, 10, 10);
    expect(menu.startLocked).toBe(false);
    expect(menu.destination).toBeNull();
    expect(canStart(menu)).toBe(false);

    menu = clickTripMap(menu, 4, -50);
    menu = clickTripMap(menu, 8, 80);
    menu = startTrip(menu);
    expect(menu.phase).toBe('driving');
    expect(menu.open).toBe(false);
    expect(canStart(menu)).toBe(false);

    const parked = { x: PULL_OVER_OFFSET, y: 78 };
    menu = onArrived(menu, parked);
    expect(menu.phase).toBe('arrived');
    expect(menu.open).toBe(true);
    expect(menu.mode).toBe('ab');
    expect(menu.startLocked).toBe(true);
    expect(menu.start.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(menu.destination).toBeNull();
    expect(menu.stack).toBe('waymo');
    expect(menu.camera).toBe('hood');
    expect(menuBanner(menu)).toBe('Arrived — choose next destination');
    expect(canStart(menu)).toBe(false);

    menu = clickTripMap(menu, 6, 160);
    expect(canStart(menu)).toBe(true);
    expect(menu.destination).not.toBeNull();

    menu = startTrip(menu);
    expect(menu.phase).toBe('driving');
    expect(menu.open).toBe(false);
  });

  it('Reset clears dest and restores the parked start on the arrived menu', () => {
    let menu = onArrived(createTripMenu({ x: 3.5, y: -50 }, { phase: 'driving', open: false }), { x: 5.775, y: 78 });
    menu = clickTripMap(menu, 6, 160);
    expect(menu.destination).not.toBeNull();
    menu = resetTripPoints(menu);
    expect(menu.destination).toBeNull();
    expect(menu.startLocked).toBe(true);
    expect(menu.start.x).toBeCloseTo(LANE_OFFSET, 5);
  });

  it('Random mode sets both pins and Reroll replaces them', () => {
    const start = { x: 3.5, y: -50 };
    let seed = 7;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let menu = setTripMode(createTripMenu(start), 'random', rng);
    expect(menu.mode).toBe('random');
    expect(menu.startLocked).toBe(true);
    expect(menu.destination).not.toBeNull();
    expect(canStart(menu)).toBe(true);
    expect(isValidLaneSpawn(menu.start.x, menu.start.y, menu.startHeading)).toBe(true);
    expect(Math.hypot(menu.destination!.x - menu.start.x, menu.destination!.y - menu.start.y)).toBeGreaterThan(40);
    const first = { start: { ...menu.start }, dest: { ...menu.destination! } };
    menu = pickRandomDestination(menu, rng);
    expect(menu.start.x !== first.start.x || menu.start.y !== first.start.y
      || menu.destination!.x !== first.dest.x || menu.destination!.y !== first.dest.y).toBe(true);
  });

  it('snaps a map click to the arrival-side curb pad', () => {
    const start = { x: 3.5, y: -50 };
    const dest = snapMenuDestination(start, 12, 80);
    const expected = resolveTripDestination(vec3(start.x, start.y, 0), vec3(12, 80, 0));
    expect(dest.x).toBeCloseTo(expected.pad.x, 5);
    expect(dest.y).toBeCloseTo(expected.pad.y, 5);
    expect(expected.opposite).toBe(false);
    expect(dest.x).toBeCloseTo(PULL_OVER_OFFSET, 0);
  });

  it('snaps an opposite-side click to the arrival-side curb (U-turn pad)', () => {
    const start = { x: 3.5, y: -50 };
    const dest = snapMenuDestination(start, -4.5, 80);
    const expected = resolveTripDestination(vec3(start.x, start.y, 0), vec3(-4.5, 80, 0));
    expect(expected.opposite).toBe(true);
    expect(dest.x).toBeCloseTo(expected.pad.x, 5);
    expect(dest.x).toBeCloseTo(-PULL_OVER_OFFSET, 0);
  });

  it('snaps a start click onto the driving lane', () => {
    const start = snapMenuStart(8, -12);
    expect(start.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(isValidLaneSpawn(start.x, start.y, Math.PI / 2)).toBe(true);
  });

  it('Esc dismisses the arrived menu without starting a new trip', () => {
    let menu = onArrived(startTrip(clickTripMap(clickTripMap(createTripMenu({ x: 0, y: -50 }), 0, -50), 0, 80)), { x: 5.4, y: 78 });
    menu = dismissTripMenu(menu);
    expect(menu.phase).toBe('arrived');
    expect(menu.open).toBe(false);
    expect(dismissTripMenu(createTripMenu({ x: 0, y: 0 })).open).toBe(true);
  });

  it('Just drive leaves the menu without a destination', () => {
    const menu = justDrive(clickTripMap(clickTripMap(createTripMenu({ x: 3.5, y: -50 }), 4, -50), 0, 80));
    expect(menu.phase).toBe('driving');
    expect(menu.open).toBe(false);
    expect(menu.destination).toBeNull();
  });

  it('round-trips start-map world coordinates so pins stay aligned', () => {
    const w = 560;
    const h = 420;
    const pts = [
      { x: 3.5, y: -50 },
      { x: 5.4, y: 78 },
      { x: -200, y: 100 },
    ];
    for (const p of pts) {
      const screen = worldToStartMap(p.x, p.y, w, h);
      const back = startMapToWorld(screen.x, screen.y, w, h);
      expect(back.x).toBeCloseTo(p.x, 5);
      expect(back.y).toBeCloseTo(p.y, 5);
    }
  });

  it('a second beginTrip after arrival uses the parked pose as the new start', () => {
    const sim = new Simulation({ seed: 3 });
    sim.beginTrip(vec3(0, 50, 0), vec3(0, 78, 0), 'policy');
    const parked = { x: PULL_OVER_OFFSET, y: 78 };
    let menu = onArrived(createTripMenu({ x: 0, y: 50 }, { phase: 'driving', open: false }), parked);
    menu = clickTripMap(menu, 6, 160);
    expect(canStart(menu)).toBe(true);
    expect(menu.start.x).toBeCloseTo(LANE_OFFSET, 5);
    menu = startTrip(menu);
    sim.beginTrip(vec3(menu.start.x, menu.start.y, 0), vec3(menu.destination!.x, menu.destination!.y, 0), 'policy');
    expect(sim.hasArrived()).toBe(false);
    expect(sim.getState().controlSource).toBe('policy');
    expect(sim.getTripDestination()).not.toBeNull();
    const ego = sim.getState().ego.transform.position;
    expect(isValidLaneSpawn(ego.x, ego.y, sim.getState().ego.transform.rotation)).toBe(true);
  });
});
