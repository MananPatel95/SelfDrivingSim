import { describe, it, expect } from 'vitest';
import {
  DRAW_WORLD_LABEL_SPRITES,
  LABEL_MAX_PX,
  labelOpacityForDistance,
  labelWorldHeight,
} from './perceptionViz';
import { hudColumnLeft, spriteHitsReservedHud } from '../ui/hudPanels';

describe('perception world labels', () => {
  it('caps screen height and fades with distance', () => {
    const near = labelWorldHeight(6, 720, 60);
    const far = labelWorldHeight(40, 720, 60);
    expect(DRAW_WORLD_LABEL_SPRITES).toBe(true);
    expect(near).toBeLessThan(far);
    expect(near).toBeLessThan(1.2);
    const vFov = (60 * Math.PI) / 180;
    const worldPerPx = (2 * 6 * Math.tan(vFov / 2)) / 720;
    expect(near / worldPerPx).toBeLessThanOrEqual(LABEL_MAX_PX);
    expect(labelOpacityForDistance(2)).toBe(0);
    expect(labelOpacityForDistance(20)).toBeGreaterThan(0.7);
    expect(labelOpacityForDistance(60)).toBeLessThan(0.5);
    expect(labelOpacityForDistance(100)).toBe(0);
  });

  it('hides labels under the HUD column, minimap, and speed stack', () => {
    expect(spriteHitsReservedHud(hudColumnLeft(1280) + 20, 80, 1280, 720)).toBe(true);
    expect(spriteHitsReservedHud(80, 120, 1280, 720)).toBe(true);
    expect(spriteHitsReservedHud(80, 600, 1280, 720)).toBe(true);
    expect(spriteHitsReservedHud(640, 24, 1280, 720)).toBe(true);
    expect(spriteHitsReservedHud(400, 360, 1280, 720)).toBe(false);
  });
});
