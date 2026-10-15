/**
 * Start / arrived trip menu: view cards, city-map destination, camera, Start.
 * Destination snaps go through the existing roadside-pad API — not the planner.
 */

import { nearestGridLine, snapTripEnd } from '../sim/world';
import { headingAlongRoadPoint, manhattanCorners, resolveTripDestination, snapTripStart } from '../sim/rightLane';
import { vec3 } from '../sim/math';
import {
  ROUTE_CORE,
  ROUTE_DEST,
  ROUTE_HALO,
  paintDestPin,
  paintStartPin,
  routeStrokeWidths,
  type MapPoint,
} from './minimapRoute';
import { STACK_VIEW_COPY, type StackProfile } from './viewCopy';

export type TripPhase = 'start' | 'driving' | 'arrived';
export type TripCamera = 'chase' | 'hood';
export type TripMode = 'ab' | 'random';

export interface TripPoint {
  x: number;
  y: number;
}

export interface TripMenuState {
  phase: TripPhase;
  open: boolean;
  stack: StackProfile;
  camera: TripCamera;
  mode: TripMode;
  start: TripPoint;
  startLocked: boolean;
  startHeading: number;
  destination: TripPoint | null;
  parkedStart: TripPoint | null;
}

export const START_MAP_HALF = 300;
export const START_MAP_SPAN = 600;
export const START_MAP_INSET = 16;
export const MIN_TRIP_SEPARATION = 48;

export function stackBlurb(profile: StackProfile): string {
  return STACK_VIEW_COPY[profile].blurb;
}

export function snapMenuStart(clickX: number, clickY: number, heading?: number): TripPoint {
  const pos = snapTripStart(clickX, clickY, heading);
  return { x: pos.x, y: pos.y };
}

export function createTripMenu(start: TripPoint, extras?: Partial<TripMenuState>): TripMenuState {
  const snapped = snapMenuStart(start.x, start.y);
  const heading = headingAlongRoadPoint(snapped.x, snapped.y);
  return {
    phase: 'start',
    open: true,
    stack: 'tesla',
    camera: 'chase',
    mode: 'ab',
    start: snapped,
    startLocked: false,
    startHeading: heading,
    destination: null,
    parkedStart: null,
    ...extras,
    start: extras?.start ? snapMenuStart(extras.start.x, extras.start.y, extras.startHeading) : snapped,
  };
}

export function setTripStack(state: TripMenuState, stack: StackProfile): TripMenuState {
  return { ...state, stack };
}

export function setTripCamera(state: TripMenuState, camera: TripCamera): TripMenuState {
  return { ...state, camera };
}

export function headingAlongRoad(p: TripPoint): number {
  const onNS = Math.abs(p.x - nearestGridLine(p.x)) <= Math.abs(p.y - nearestGridLine(p.y));
  return onNS ? Math.PI / 2 : 0;
}

/** Last Manhattan segment heading from start toward the clicked road point. */
export function approachHeading(start: TripPoint, end: TripPoint): number {
  const corners = manhattanCorners(vec3(start.x, start.y, 0), vec3(end.x, end.y, 0));
  if (corners.length >= 2) {
    const a = corners[corners.length - 2]!;
    const b = corners[corners.length - 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx * dx + dy * dy > 1e-6) return Math.atan2(dy, dx);
  }
  return headingAlongRoad(end);
}

/**
 * Snap a map click with #33's destination API: keep the clicked curb side
 * (`snapTripEnd`), then `resolveTripDestination` places the arrival-side pad
 * (opposite-side clicks U-turn so that curb is on the right).
 */
export function snapMenuDestination(start: TripPoint, clickX: number, clickY: number): TripPoint {
  const from = vec3(start.x, start.y, 0);
  const end = snapTripEnd(from, clickX, clickY);
  const resolved = resolveTripDestination(from, end);
  return { x: resolved.pad.x, y: resolved.pad.y };
}

export function pickTripDestination(state: TripMenuState, clickX: number, clickY: number): TripMenuState {
  return { ...state, destination: snapMenuDestination(state.start, clickX, clickY) };
}

/** Map click for the live overlay: A→B is start then end; a third click resets. */
export function clickTripMap(state: TripMenuState, clickX: number, clickY: number): TripMenuState {
  if (state.mode === 'random') {
    return pickTripDestination(state, clickX, clickY);
  }
  if (state.startLocked && state.destination) {
    const parked = state.parkedStart;
    return {
      ...state,
      start: parked ?? state.start,
      startLocked: !!parked,
      startHeading: parked ? headingAlongRoadPoint(parked.x, parked.y) : state.startHeading,
      destination: null,
    };
  }
  if (!state.startLocked) {
    const start = snapMenuStart(clickX, clickY);
    return {
      ...state,
      start,
      startLocked: true,
      startHeading: headingAlongRoadPoint(start.x, start.y),
    };
  }
  return pickTripDestination(state, clickX, clickY);
}

export function resetTripPoints(state: TripMenuState): TripMenuState {
  const parked = state.parkedStart;
  if (parked) {
    return {
      ...state,
      start: parked,
      startLocked: true,
      startHeading: headingAlongRoadPoint(parked.x, parked.y),
      destination: null,
    };
  }
  return { ...state, startLocked: false, destination: null };
}

export function setTripMode(
  state: TripMenuState,
  mode: TripMode,
  rng: () => number = Math.random,
): TripMenuState {
  if (mode === state.mode) return state;
  if (mode === 'random') return rollRandomTrip({ ...state, mode }, rng);
  return { ...state, mode };
}

export function pickRandomDestination(
  state: TripMenuState,
  rng: () => number = Math.random,
): TripMenuState {
  return rollRandomTrip(state, rng);
}

export function randomMenuDestination(start: TripPoint, rng: () => number = Math.random): TripPoint {
  const roads = [-300, -200, -100, 0, 100, 200, 300];
  for (let attempt = 0; attempt < 24; attempt++) {
    const along = roads[Math.floor(rng() * roads.length)]!;
    const t = (rng() * 2 - 1) * 260;
    const ns = rng() < 0.5;
    const click = ns ? { x: along, y: t } : { x: t, y: along };
    const dest = snapMenuDestination(start, click.x, click.y);
    if (Math.hypot(dest.x - start.x, dest.y - start.y) >= MIN_TRIP_SEPARATION) return dest;
  }
  return snapMenuDestination(start, start.x + 120, start.y + 180);
}

export function randomMenuStart(rng: () => number = Math.random): TripPoint {
  const roads = [-200, -100, 0, 100, 200];
  const along = roads[Math.floor(rng() * roads.length)]!;
  const t = (rng() * 2 - 1) * 160;
  const ns = rng() < 0.5;
  const click = ns ? { x: along, y: t } : { x: t, y: along };
  return snapMenuStart(click.x, click.y);
}

export function rollRandomTrip(
  state: TripMenuState,
  rng: () => number = Math.random,
): TripMenuState {
  let start = randomMenuStart(rng);
  if (state.phase === 'arrived' && state.parkedStart && rng() < 0.35) {
    start = state.parkedStart;
  }
  const dest = randomMenuDestination(start, rng);
  return {
    ...state,
    mode: 'random',
    start,
    startLocked: true,
    startHeading: headingAlongRoadPoint(start.x, start.y),
    destination: dest,
  };
}

export function canStart(state: TripMenuState): boolean {
  return state.open && state.startLocked && state.destination !== null;
}

export function startTrip(state: TripMenuState): TripMenuState {
  if (!canStart(state)) return state;
  return { ...state, phase: 'driving', open: false };
}

export function justDrive(state: TripMenuState): TripMenuState {
  return { ...state, phase: 'driving', open: false, destination: null };
}

export function onArrived(state: TripMenuState, current: TripPoint): TripMenuState {
  const start = snapMenuStart(current.x, current.y);
  return {
    ...state,
    phase: 'arrived',
    open: true,
    mode: 'ab',
    start,
    startLocked: true,
    startHeading: headingAlongRoadPoint(start.x, start.y),
    destination: null,
    parkedStart: start,
  };
}

/** Esc on the arrived overlay: hide it, stay parked. First-launch menu stays open. */
export function dismissTripMenu(state: TripMenuState): TripMenuState {
  if (state.phase !== 'arrived' || !state.open) return state;
  return { ...state, open: false };
}

export function reopenArrivedMenu(state: TripMenuState): TripMenuState {
  if (state.phase !== 'arrived') return state;
  return { ...state, open: true };
}

export function menuTitle(_state: TripMenuState): string {
  return 'AUTONOMY CITY: How Machines See';
}

export function menuBanner(state: TripMenuState): string | null {
  return state.phase === 'arrived' ? 'Arrived — choose next destination' : null;
}

export function menuLead(state: TripMenuState): string {
  if (state.phase === 'arrived') {
    return 'The car is parked on the pink pad. Pick A → B or Random, then continue.';
  }
  return 'Watch how three public-style stacks see the same street. Choose a view, A → B or Random, then Start.';
}

export function menuStatus(state: TripMenuState): string {
  if (state.mode === 'random') {
    return state.destination
      ? 'Random path set. Press Start or Enter, or Reroll for another pair.'
      : 'Reroll to pick a random start and destination.';
  }
  if (!state.startLocked) {
    return 'Click the map to set the start (green pin), then the destination (pink pad).';
  }
  if (!state.destination) {
    return state.phase === 'arrived'
      ? 'Start is the parked car. Click the map for the next destination, or Reset to move the start.'
      : 'Start set. Click the map for the destination (pink pad).';
  }
  return 'Start and destination set. Press Start or Enter. Click again or Reset to clear.';
}

export function worldToStartMap(
  x: number,
  y: number,
  w: number,
  h: number,
  half = START_MAP_HALF,
  inset = START_MAP_INSET,
): MapPoint {
  const span = half * 2;
  const innerW = w - inset * 2;
  const innerH = h - inset * 2;
  return {
    x: inset + ((x + half) / span) * innerW,
    y: inset + ((half - y) / span) * innerH,
  };
}

export function startMapToWorld(
  canvasX: number,
  canvasY: number,
  w: number,
  h: number,
  half = START_MAP_HALF,
  inset = START_MAP_INSET,
): TripPoint {
  const span = half * 2;
  const innerW = w - inset * 2;
  const innerH = h - inset * 2;
  const u = (canvasX - inset) / innerW;
  const v = (canvasY - inset) / innerH;
  return {
    x: -half + u * span,
    y: half - v * span,
  };
}

export interface StartMapDrawOpts {
  start: TripPoint;
  startHeading?: number;
  startLocked?: boolean;
  destination: TripPoint | null;
  buildings?: ReadonlyArray<{ x: number; y: number; hx: number; hy: number }>;
  route?: ReadonlyArray<TripPoint>;
}

export function drawStartCityMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: StartMapDrawOpts,
): void {
  const half = START_MAP_HALF;
  const span = START_MAP_SPAN;
  const to = (x: number, y: number) => worldToStartMap(x, y, w, h, half);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a2a22';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(3, 3, w - 6, h - 6, 12);
  else ctx.rect(3, 3, w - 6, h - 6);
  ctx.clip();

  const fillWorldRect = (x0: number, y0: number, x1: number, y1: number) => {
    const a = to(x0, y0);
    const b = to(x1, y0);
    const c = to(x1, y1);
    const d = to(x0, y1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  };

  ctx.fillStyle = '#d5d8dc';
  const roadW = 14;
  for (let i = 0; i <= 6; i++) {
    const pos = -half + i * 100;
    fillWorldRect(pos - roadW / 2, -half, pos + roadW / 2, half);
    fillWorldRect(-half, pos - roadW / 2, half, pos + roadW / 2);
  }

  ctx.fillStyle = '#2c332c';
  for (const bld of opts.buildings ?? []) {
    fillWorldRect(bld.x - bld.hx, bld.y - bld.hy, bld.x + bld.hx, bld.y + bld.hy);
  }

  if (opts.route && opts.route.length >= 2) {
    const scale = (w - START_MAP_INSET * 2) / span;
    const { halo, core } = routeStrokeWidths(scale * 14);
    const stroke = (width: number, color: string) => {
      ctx.beginPath();
      const first = to(opts.route![0]!.x, opts.route![0]!.y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < opts.route!.length; i++) {
        const p = to(opts.route![i]!.x, opts.route![i]!.y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    stroke(Math.max(5, halo * 0.35), ROUTE_HALO);
    stroke(Math.max(2.2, core * 0.35), ROUTE_CORE);
  }

  if (opts.startLocked !== false) {
    const pin = to(opts.start.x, opts.start.y);
    const scale = Math.max(1.1, (w / 210) * 0.55);
    paintStartPin(ctx, pin, scale);
  }

  if (opts.destination) {
    const pin = to(opts.destination.x, opts.destination.y);
    const scale = Math.max(1.1, (w / 210) * 0.55);
    paintDestPin(ctx, pin, scale);
  }

  const start = to(opts.start.x, opts.start.y);
  const yaw = opts.startHeading ?? headingAlongRoad(opts.start);
  // North-up map: +Y is up on the canvas, heading 0 is +X (right), π/2 is +Y (up).
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(-yaw + Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(-6, 7);
  ctx.lineTo(6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  ctx.strokeStyle = '#0c0c0c';
  ctx.lineWidth = 3;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, w - 3, h - 3, 14);
    ctx.stroke();
  }
}

export { ROUTE_DEST };
