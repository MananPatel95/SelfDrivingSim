import { describe, it, expect } from 'vitest';
import {
  ROUTE_CORE,
  ROUTE_DEST,
  autopilotRouteOnMinimap,
  destinationOnMinimap,
  destPinRadius,
  projectToMinimap,
  routeStrokeWidths,
} from './minimapRoute';

const canvas = { w: 210, h: 210 };

describe('autopilot route on the minimap', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 80, y: 0 },
  ];
  const ego = { x: 0, y: 0, yaw: 0 };

  it('hides the route in manual', () => {
    expect(autopilotRouteOnMinimap('human', route, ego, canvas, 1.35)).toBeNull();
  });

  it('highlights the route ahead of the car in autopilot', () => {
    const pts = autopilotRouteOnMinimap('policy', route, ego, canvas, 1.35);
    expect(pts).not.toBeNull();
    expect(pts![0]!.x).toBeCloseTo(105);
    expect(pts![0]!.y).toBeCloseTo(105);
    // Heading +X is up on the radar, so the route climbs the canvas.
    expect(pts![pts!.length - 1]!.y).toBeLessThan(pts![0]!.y - 50);
    expect(Math.abs(pts![pts!.length - 1]!.x - 105)).toBeLessThan(1);
    expect(ROUTE_CORE.toLowerCase()).toBe('#c45cff');
    const { halo, core } = routeStrokeWidths(1.35);
    expect(halo).toBeGreaterThan(core);
    expect(halo).toBeGreaterThan(14);
  });

  it('keeps the highlight when the safety oracle has the wheel', () => {
    expect(autopilotRouteOnMinimap('oracle', route, ego, canvas, 1)).not.toBeNull();
  });

  it('draws nothing when autopilot has no trip', () => {
    expect(autopilotRouteOnMinimap('policy', [], ego, canvas, 1)).toBeNull();
    expect(autopilotRouteOnMinimap('policy', [{ x: 0, y: 0 }], ego, canvas, 1)).toBeNull();
  });

  it('starts the highlight at the car instead of the already driven path', () => {
    const long = [0, 20, 40, 60, 80, 100].map(x => ({ x, y: 0 }));
    const pts = autopilotRouteOnMinimap('policy', long, { x: 40, y: 0, yaw: 0 }, canvas, 1);
    expect(pts).not.toBeNull();
    const start = projectToMinimap(0, 0, 40, 0, 0, 105, 105, 1);
    const kept = projectToMinimap(20, 0, 40, 0, 0, 105, 105, 1);
    expect(pts![0]!.y).toBeCloseTo(kept.y);
    expect(pts![0]!.y).not.toBeCloseTo(start.y);
    expect(pts![pts!.length - 1]!.y).toBeCloseTo(projectToMinimap(100, 0, 40, 0, 0, 105, 105, 1).y);
  });

  it('paints the destination as a hot-pink pin even in manual', () => {
    expect(ROUTE_DEST.toLowerCase()).toBe('#ff2d8a');
    expect(destPinRadius(1.35)).toBeGreaterThan(5);
    const dest = destinationOnMinimap({ x: 80, y: 0 }, ego, canvas, 1.35);
    expect(dest).not.toBeNull();
    expect(dest!.y).toBeLessThan(105);
    expect(destinationOnMinimap(null, ego, canvas, 1)).toBeNull();
    const whileManual = destinationOnMinimap({ x: 40, y: 0 }, ego, canvas, 1);
    expect(whileManual).not.toBeNull();
  });
});
