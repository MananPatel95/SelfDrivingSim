import { describe, it, expect } from 'vitest';
import { buildEgoVisual, EGO_DRAW_CALL_BUDGET } from './egoMesh';
import { COCKPIT } from './cabinView';
import { BODY_HALF_WIDTH, VISUAL_WHEEL_HALF_WIDTH, WHEEL_PLAN_OFFSETS } from './vehicleVisual';

describe('modern EV sedan mesh', () => {
  it('merges the shell so draw calls stay low', () => {
    const visual = buildEgoVisual();
    expect(visual.drawCalls).toBeLessThanOrEqual(EGO_DRAW_CALL_BUDGET);
    expect(visual.wheels).toHaveLength(4);
    expect(visual.steerWheel.children.length).toBeGreaterThanOrEqual(3);
  });

  it('places road wheels inside the body half-width', () => {
    const visual = buildEgoVisual();
    for (const wheel of visual.wheels) {
      const outer = Math.abs(wheel.pivot.position.z) + VISUAL_WHEEL_HALF_WIDTH;
      expect(outer).toBeLessThan(BODY_HALF_WIDTH);
    }
    for (const spec of WHEEL_PLAN_OFFSETS) {
      expect(Math.abs(spec.z) + VISUAL_WHEEL_HALF_WIDTH).toBeLessThan(BODY_HALF_WIDTH);
    }
  });

  it('mounts the hand wheel on the left in front of the driver', () => {
    const visual = buildEgoVisual();
    expect(visual.steerWheel.position.z).toBeCloseTo(COCKPIT.wheel.z, 5);
    expect(visual.steerWheel.position.x).toBeGreaterThan(COCKPIT.eye.x);
    expect(visual.steerWheel.position.y).toBeLessThan(COCKPIT.eye.y);
  });
});
