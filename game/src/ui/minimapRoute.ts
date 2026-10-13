/**
 * Autopilot route drawn on the top-left radar.
 * Manual driving hides it. Policy and the safety oracle keep the purple highlight.
 */

export const ROUTE_HALO = 'rgba(156, 70, 255, 0.55)';
export const ROUTE_CORE = '#c45cff';
/** Roadside arrival pad — hot pink, distinct from ped `#ff66cc`. */
export const ROUTE_DEST = '#ff2d8a';
export const ROUTE_DEST_RING = '#ffffff';
export const DEST_PIN_COLOR = 0xff2d8a;

export interface MapPoint {
  x: number;
  y: number;
}

type ControlSource = 'policy' | 'human' | 'oracle';

/** Ego-centered radar: heading is up, screen-right is the car's right. */
export function projectToMinimap(
  wx: number,
  wy: number,
  egoX: number,
  egoY: number,
  yaw: number,
  cx: number,
  cy: number,
  scale: number,
): MapPoint {
  const dx = wx - egoX;
  const dy = wy - egoY;
  const forward = dx * Math.cos(yaw) + dy * Math.sin(yaw);
  const right = dx * Math.sin(yaw) + dy * -Math.cos(yaw);
  return { x: cx + right * scale, y: cy - forward * scale };
}

/** Halo sits on the asphalt; the core is the bright purple line inside it. */
export function routeStrokeWidths(scale: number, roadWidthM = 14): { halo: number; core: number } {
  const roadPx = roadWidthM * scale;
  return {
    halo: Math.max(9, roadPx * 0.92),
    core: Math.max(3.5, roadPx * 0.4),
  };
}

/**
 * Route still ahead of the car, plus one sample behind so the line meets the blip.
 * Returns null in manual, or when there is no trip to draw.
 */
export function autopilotRouteOnMinimap(
  controlSource: ControlSource,
  route: ReadonlyArray<{ x: number; y: number }>,
  ego: { x: number; y: number; yaw: number },
  canvas: { w: number; h: number },
  scale: number,
): MapPoint[] | null {
  if (controlSource === 'human' || route.length < 2) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const p = route[i]!;
    const d = (p.x - ego.x) ** 2 + (p.y - ego.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const from = Math.max(0, best - 1);
  const cx = canvas.w / 2;
  const cy = canvas.h / 2;
  const pts: MapPoint[] = [];
  for (let i = from; i < route.length; i++) {
    const p = route[i]!;
    pts.push(projectToMinimap(p.x, p.y, ego.x, ego.y, ego.yaw, cx, cy, scale));
  }
  return pts.length >= 2 ? pts : null;
}

/** Pink destination pin, shown whenever a trip pad exists (including manual). */
export function destinationOnMinimap(
  dest: { x: number; y: number } | null | undefined,
  ego: { x: number; y: number; yaw: number },
  canvas: { w: number; h: number },
  scale: number,
): MapPoint | null {
  if (!dest) return null;
  return projectToMinimap(dest.x, dest.y, ego.x, ego.y, ego.yaw, canvas.w / 2, canvas.h / 2, scale);
}

export function destPinRadius(scale: number): number {
  return Math.max(6.5, scale * 2.4);
}
