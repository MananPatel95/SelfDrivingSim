import { describe, it, expect } from 'vitest';
import { COCKPIT, handWheelRotation, wheelViewOffset } from './cabinView';
import { BODY_CENTER_LOCAL_Y, BODY_HALF_HEIGHT } from './vehicleVisual';

describe('first-person cabin framing', () => {
  it('puts the steering wheel in the lower part of the view, ahead of the driver', () => {
    const view = wheelViewOffset();
    expect(view.depth).toBeGreaterThan(0.25);
    expect(view.depth).toBeLessThan(0.7);
    expect(view.ndcY).toBeLessThan(-0.15);
    expect(view.ndcY).toBeGreaterThan(-0.75);
    expect(Math.abs(view.ndcX)).toBeLessThan(0.55);
    expect(view.radiusNdc).toBeGreaterThan(0.22);
    expect(view.radiusNdc).toBeLessThan(0.55);
    expect(Math.abs(view.ndcY) + view.radiusNdc * 0.45).toBeLessThan(1);
  });

  it('keeps the driver’s eyes inside the greenhouse, under the roof', () => {
    const rockerTop = BODY_CENTER_LOCAL_Y + BODY_HALF_HEIGHT;
    expect(COCKPIT.eye.y).toBeGreaterThan(rockerTop + 0.15);
    expect(COCKPIT.eye.y).toBeLessThan(1.05);
    expect(COCKPIT.eye.x).toBeLessThan(COCKPIT.wheel.x);
    expect(COCKPIT.look.x).toBeGreaterThan(COCKPIT.wheel.x);
  });

  it('turns the hand wheel left for A and right for D', () => {
    expect(handWheelRotation(0.4)).toBeLessThan(-1);
    expect(handWheelRotation(-0.4)).toBeGreaterThan(1);
    expect(handWheelRotation(0)).toBeCloseTo(0);
  });
});