import { describe, it, expect } from 'vitest';
import {
  CAMERA_VIEW_COPY,
  STACK_VIEW_COPY,
  aiViewTitle,
  panelHelpCopy,
  type StackProfile,
} from './viewCopy';

const STACKS: StackProfile[] = ['tesla', 'waymo', 'waabi'];

describe('view copy', () => {
  it('keeps each stack summary to one line', () => {
    for (const id of STACKS) {
      const summary = STACK_VIEW_COPY[id].summary!;
      expect(summary.length).toBeGreaterThan(12);
      expect(summary).not.toMatch(/\n/);
      expect(summary.length).toBeLessThan(80);
    }
    expect(STACK_VIEW_COPY.waabi.summary).toMatch(/occupancy grid \+ 1–3 s forecast/);
    expect(STACK_VIEW_COPY.tesla.uses).toMatch(/occupancy network/i);
    expect(STACK_VIEW_COPY.tesla.uses).toMatch(/No lidar/);
    expect(STACK_VIEW_COPY.waymo.uses).toMatch(/lidar/i);
    expect(STACK_VIEW_COPY.waymo.uses).toMatch(/radar/i);
    expect(STACK_VIEW_COPY.waymo.uses).toMatch(/HD map/);
    expect(STACK_VIEW_COPY.waabi.uses).toMatch(/occupancy/);
    expect(STACK_VIEW_COPY.waabi.uses).toMatch(/trajector/);
  });

  it('shortens the AI View header', () => {
    expect(aiViewTitle('tesla')).toBe('AI View · F1');
    expect(aiViewTitle('waymo')).toBe('AI View · F2');
    expect(aiViewTitle('waabi')).toBe('AI View · F3');
  });

  it('moves long uses/diff/camera copy into ? popovers', () => {
    for (const id of STACKS) {
      const help = panelHelpCopy('explainer', id, 'chase');
      expect(help.body).toContain(STACK_VIEW_COPY[id].uses);
      expect(help.body).toContain(STACK_VIEW_COPY[id].diff);
      expect(help.body).toContain(CAMERA_VIEW_COPY.chase.uses);
      expect(help.body).toMatch(/Unlike the others/);
    }
    const bev = panelHelpCopy('bev', 'waabi', 'chase');
    expect(bev.body).toMatch(/\+1s/);
    expect(bev.body).toMatch(/TTC/);
    expect(bev.body).toMatch(/blue/);
    const ai = panelHelpCopy('ai-view', 'tesla', 'hood');
    expect(ai.body).toMatch(/magenta/);
    expect(ai.body).toMatch(/voxels/);
  });
});
