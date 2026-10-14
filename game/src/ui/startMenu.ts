/**
 * Start / arrived trip menu: view cards, city-map destination, camera, Start.
 * Destination snaps go through the existing roadside-pad API — not the planner.
 */

import { nearestGridLine, snapToRoad } from '../sim/world';
import { manhattanCorners, roadsideDestination } from '../sim/rightLane';
import { vec3 } from '../sim/math';
import {
  ROUTE_CORE,
  ROUTE_DEST,
  ROUTE_HALO,
  paintDestPin,
  routeStrokeWidths,
  type MapPoint,
} from './minimapRoute';
import { STACK_VIEW_COPY, type StackProfile } from './viewCopy';

export type TripPhase = 'start' | 'driving' | 'arrived';
export type TripCamera = 'chase' | 'hood';

export interface TripPoint {
  x: number;
  y: number;
}

export interface TripMenuState {
  phase: TripPhase;
  open: boolean;
  stack: StackProfile;
  camera: TripCamera;
  start: TripPoint;
  destination: TripPoint | null;
}

export const START_MAP_HALF = 300;
export const START_MAP_SPAN = 600;
export const START_MAP_INSET = 16;
export const MIN_TRIP_SEPARATION = 48;

export function stackBlurb(profile: StackProfile): string {
  return STACK_VIEW_COPY[profile].blurb;
}

export function createTripMenu(start: TripPoint, extras?: Partial<TripMenuState>): TripMenuState {
  return {
    phase: 'start',
    open: true,
    stack: 'tesla',
    camera: 'chase',
    start: { x: start.x, y: start.y },
    destination: null,
    ...extras,
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

/** Snap a map click onto the nearest right-hand curb pad. */
export function snapMenuDestination(start: TripPoint, clickX: number, clickY: number): TripPoint {
  const road = snapToRoad(clickX, clickY);
  const heading = approachHeading(start, road);
  const pad = roadsideDestination(road, heading);
  return { x: pad.x, y: pad.y };
}

export function pickTripDestination(state: TripMenuState, clickX: number, clickY: number): TripMenuState {
  return { ...state, destination: snapMenuDestination(state.start, clickX, clickY) };
}

export function pickRandomDestination(
  state: TripMenuState,
  rng: () => number = Math.random,
): TripMenuState {
  const dest = randomMenuDestination(state.start, rng);
  return { ...state, destination: dest };
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

export function canStart(state: TripMenuState): boolean {
  return state.open && state.destination !== null;
}

export function startTrip(state: TripMenuState): TripMenuState {
  if (!canStart(state)) return state;
  return { ...state, phase: 'driving', open: false };
}

export function justDrive(state: TripMenuState): TripMenuState {
  return { ...state, phase: 'driving', open: false, destination: null };
}

export function onArrived(state: TripMenuState, current: TripPoint): TripMenuState {
  return {
    ...state,
    phase: 'arrived',
    open: true,
    start: { x: current.x, y: current.y },
    destination: null,
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
    return 'The car is parked on the pink pad. Pick a view, drop a new destination, and continue.';
  }
  return 'Watch how three public-style stacks see the same street. Choose a view, click a destination, then Start.';
}

export function menuStatus(state: TripMenuState): string {
  if (!state.destination) {
    return state.phase === 'arrived'
      ? 'Click the map for the next destination, or pick a random one.'
      : 'Click the map to choose a destination, or pick a random one.';
  }
  return 'Destination set. Press Start or Enter to drive there on autopilot.';
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
