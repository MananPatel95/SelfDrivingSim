import { describe, it, expect } from 'vitest';
import {
  defaultStates,
  layoutPanels,
  overlappingPairs,
  overlapsReserved,
  parsePanelStates,
  panelsKeyAction,
  panelWidthForViewport,
  PANEL_IDS,
  PANEL_SIZE,
  PANEL_WIDTH,
  type PanelId,
  type PanelState,
} from './hudPanels';

const SIZES = [
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
];

function allOpen(): Record<PanelId, PanelState> {
  const s = defaultStates();
  for (const id of PANEL_IDS) {
    s[id] = { ...s[id]!, closed: false, collapsed: false, x: null, y: null };
  }
  return s;
}

describe('HUD panel layout', () => {
  for (const { w, h } of SIZES) {
    it(`stacks open panels without overlap at ${w}×${h}`, () => {
      const rects = layoutPanels(allOpen(), w, h, { open: [...PANEL_IDS] });
      expect(rects).toHaveLength(PANEL_IDS.length);
      expect(overlappingPairs(rects)).toEqual([]);
      expect(overlapsReserved(rects, w, h)).toEqual([]);
    });

    it(`gives docked panels one width and one right edge at ${w}×${h}`, () => {
      const f1 = layoutPanels(allOpen(), w, h, { open: ['explainer', 'ai-view'] });
      const f3 = layoutPanels(allOpen(), w, h, { open: ['explainer', 'ai-view', 'bev'] });
      for (const rects of [f1, f3]) {
        expect(new Set(rects.map((r) => r.w)).size).toBe(1);
        expect(new Set(rects.map((r) => r.x + r.w)).size).toBe(1);
        expect(rects[0]!.w).toBe(panelWidthForViewport(w));
        expect(rects[0]!.w).toBeLessThanOrEqual(PANEL_WIDTH);
        expect(rects[0]!.x + rects[0]!.w).toBe(w - 10);
      }
    });

    it(`keeps a collapsed panel in the column at ${w}×${h}`, () => {
      const states = allOpen();
      states['ai-view'] = { ...states['ai-view']!, collapsed: true };
      const rects = layoutPanels(states, w, h, { open: [...PANEL_IDS] });
      const ai = rects.find((r) => r.id === 'ai-view')!;
      expect(ai.h).toBeLessThan(50);
      expect(overlappingPairs(rects)).toEqual([]);
      expect(overlapsReserved(rects, w, h)).toEqual([]);
    });

    it(`keeps a dragged panel off the minimap and banner at ${w}×${h}`, () => {
      const states = allOpen();
      states.explainer = { ...states.explainer, x: 12, y: 60 };
      const rects = layoutPanels(states, w, h, { open: [...PANEL_IDS] });
      expect(overlappingPairs(rects)).toEqual([]);
      expect(overlapsReserved(rects, w, h)).toEqual([]);
      const expl = rects.find((r) => r.id === 'explainer')!;
      expect(expl.x).toBeGreaterThan(220);
    });
  }

  it('uses one 300px width for every panel size', () => {
    const widths = new Set(PANEL_IDS.map((id) => PANEL_SIZE[id].w));
    expect(widths).toEqual(new Set([PANEL_WIDTH]));
    expect(panelWidthForViewport(1920)).toBe(300);
    expect(panelWidthForViewport(320)).toBe(296);
  });

  it('round-trips localStorage JSON', () => {
    const raw = JSON.stringify({
      explainer: { closed: false, collapsed: true, x: 40, y: 80 },
      'ai-view': { closed: true, collapsed: false, x: null, y: null },
    });
    const parsed = parsePanelStates(raw);
    expect(parsed.explainer.collapsed).toBe(true);
    expect(parsed.explainer.x).toBe(40);
    expect(parsed['ai-view'].closed).toBe(true);
    expect(parsed.info.closed).toBe(true);
  });

  it('P resets a customised layout, then hides, then restores', () => {
    const custom = allOpen();
    custom.info = { ...custom.info, x: 100, y: 100, closed: false };
    const reset = panelsKeyAction(custom, false);
    expect(reset.hidden).toBe(false);
    expect(reset.states.info.x).toBeNull();
    const hide = panelsKeyAction(reset.states, false);
    expect(hide.hidden).toBe(true);
    const show = panelsKeyAction(hide.states, true);
    expect(show.hidden).toBe(false);
  });
});
