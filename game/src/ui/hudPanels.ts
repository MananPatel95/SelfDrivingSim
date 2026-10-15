/**
 * Right-side HUD panels: stacked column, collapse / close / drag, localStorage.
 * Layout math is DOM-free so Vitest can check overlaps at common resolutions.
 */

export type PanelId = 'explainer' | 'ai-view' | 'info' | 'bev';

export interface PanelState {
  id: PanelId;
  closed: boolean;
  collapsed: boolean;
  /** null = docked in the top-right stack */
  x: number | null;
  y: number | null;
}

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PANEL_STORAGE_KEY = 'autonomy-hud-panels';
export const PANEL_IDS: readonly PanelId[] = ['explainer', 'ai-view', 'info', 'bev'];

/** Shared docked/floating width. Shrinks only when the viewport cannot fit 300px + gutter. */
export const PANEL_WIDTH = 300;
export const PANEL_GUTTER = 24;

export function panelWidthForViewport(vw: number): number {
  return Math.min(PANEL_WIDTH, Math.max(160, vw - PANEL_GUTTER));
}

/** Left edge of the docked right-side column (STACK_RIGHT = 10). */
export function hudColumnLeft(vw: number): number {
  return vw - 10 - panelWidthForViewport(vw);
}

/** True when a world label would be sliced by the right-side HUD column. */
export function spriteHitsHudColumn(screenX: number, vw: number, halfPx = 90): boolean {
  return screenX + halfPx > hudColumnLeft(vw) - 8;
}

export const PANEL_SIZE: Record<PanelId, { w: number; h: number; collapsedH: number }> = {
  explainer: { w: PANEL_WIDTH, h: 108, collapsedH: 36 },
  'ai-view': { w: PANEL_WIDTH, h: 196, collapsedH: 36 },
  info: { w: PANEL_WIDTH, h: 320, collapsedH: 36 },
  bev: { w: PANEL_WIDTH, h: 280, collapsedH: 36 },
};

const GEAR = { size: 36, top: 10, right: 10, gap: 8 };
const STACK_TOP = GEAR.top + GEAR.size + GEAR.gap;
const STACK_RIGHT = 10;
const STACK_GAP = 8;
const STACK_MAX_FRAC = 0.72;

export function defaultPanelState(id: PanelId): PanelState {
  return { id, closed: id === 'info', collapsed: false, x: null, y: null };
}

export function defaultStates(): Record<PanelId, PanelState> {
  return {
    explainer: defaultPanelState('explainer'),
    'ai-view': defaultPanelState('ai-view'),
    info: defaultPanelState('info'),
    bev: defaultPanelState('bev'),
  };
}

export function parsePanelStates(raw: string | null): Record<PanelId, PanelState> {
  const base = defaultStates();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<PanelId, Partial<PanelState>>>;
    for (const id of PANEL_IDS) {
      const row = parsed[id];
      if (!row) continue;
      base[id] = {
        id,
        closed: Boolean(row.closed),
        collapsed: Boolean(row.collapsed),
        x: typeof row.x === 'number' ? row.x : null,
        y: typeof row.y === 'number' ? row.y : null,
      };
    }
  } catch {
    /* ignore bad JSON */
  }
  return base;
}

export function serializePanelStates(states: Record<PanelId, PanelState>): string {
  return JSON.stringify(states);
}

export function reservedHudRects(vw: number, vh: number): Rect[] {
  return [
    { id: 'minimap', x: 10, y: 56, w: 210, h: 210 },
    { id: 'status', x: 10, y: vh - 250, w: 230, h: 200 },
    { id: 'banner', x: vw / 2 - 210, y: vh - 130, w: 420, h: 52 },
    { id: 'switcher', x: vw / 2 - 230, y: 8, w: 460, h: 48 },
  ];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function rectsOverlap(a: Rect, b: Rect, slack = 0): boolean {
  return a.x + slack < b.x + b.w
    && a.x + a.w > b.x + slack
    && a.y + slack < b.y + b.h
    && a.y + a.h > b.y + slack;
}

/** Push a floating panel off reserved HUD (minimap, speed, banner, switcher). */
export function avoidReserved(rect: Rect, reserved: Rect[], vw: number, vh: number): Rect {
  let x = clamp(rect.x, 8, Math.max(8, vw - rect.w - 8));
  let y = clamp(rect.y, 8, Math.max(8, vh - rect.h - 8));
  const out = { ...rect, x, y };
  for (let pass = 0; pass < 6; pass++) {
    let hit = false;
    for (const r of reserved) {
      if (!rectsOverlap(out, r, 4)) continue;
      hit = true;
      const right = r.x + r.w + 10;
      const left = r.x - out.w - 10;
      const below = r.y + r.h + 10;
      const above = r.y - out.h - 10;
      const options = [
        { x: right, y: out.y },
        { x: left, y: out.y },
        { x: out.x, y: below },
        { x: out.x, y: above },
      ];
      let best = options[0]!;
      let bestPen = Infinity;
      for (const o of options) {
        const nx = clamp(o.x, 8, Math.max(8, vw - out.w - 8));
        const ny = clamp(o.y, 8, Math.max(8, vh - out.h - 8));
        const cand = { ...out, x: nx, y: ny };
        let pen = 0;
        for (const rr of reserved) {
          if (rectsOverlap(cand, rr, 4)) pen += 1;
        }
        if (pen < bestPen) {
          bestPen = pen;
          best = { x: nx, y: ny };
        }
      }
      out.x = best.x;
      out.y = best.y;
    }
    if (!hit) break;
  }
  return out;
}

export interface LayoutOptions {
  /** Force these ids open (tests / "all panels"). */
  open?: PanelId[];
  hidden?: boolean;
}

export function layoutPanels(
  states: Record<PanelId, PanelState>,
  vw: number,
  vh: number,
  opts: LayoutOptions = {},
): Rect[] {
  if (opts.hidden) return [];
  const reserved = reservedHudRects(vw, vh);
  const openFilter = opts.open;
  const visible = PANEL_IDS.filter((id) => {
    if (openFilter) return openFilter.includes(id);
    return !states[id]!.closed;
  });

  const stackBudget = vh * STACK_MAX_FRAC - STACK_TOP;
  const docked = visible.filter((id) => states[id]!.x === null || states[id]!.y === null);
  const floating = visible.filter((id) => states[id]!.x !== null && states[id]!.y !== null);

  const natural = docked.map((id) => {
    const st = states[id]!;
    const size = PANEL_SIZE[id];
    return st.collapsed ? size.collapsedH : size.h;
  });
  const naturalSum = natural.reduce((a, b) => a + b, 0) + Math.max(0, docked.length - 1) * STACK_GAP;
  const scale = naturalSum > stackBudget && naturalSum > 0 ? stackBudget / naturalSum : 1;

  const rects: Rect[] = [];
  let y = STACK_TOP;
  for (let i = 0; i < docked.length; i++) {
    const id = docked[i]!;
    const size = PANEL_SIZE[id];
    const h = Math.max(32, natural[i]! * scale);
    const w = panelWidthForViewport(vw);
    rects.push({
      id,
      x: vw - STACK_RIGHT - w,
      y,
      w,
      h,
    });
    y += h + STACK_GAP;
  }

  for (const id of floating) {
    const st = states[id]!;
    const size = PANEL_SIZE[id];
    const h = st.collapsed ? size.collapsedH : size.h;
    const w = panelWidthForViewport(vw);
    const raw = {
      id,
      x: st.x ?? vw - STACK_RIGHT - w,
      y: st.y ?? STACK_TOP,
      w,
      h,
    };
    rects.push(avoidReserved(raw, reserved, vw, vh));
  }
  return rects;
}

export function overlappingPairs(rects: Rect[], slack = 1): Array<[string, string]> {
  const hits: Array<[string, string]> = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i]!, rects[j]!, slack)) {
        hits.push([rects[i]!.id, rects[j]!.id]);
      }
    }
  }
  return hits;
}

export function overlapsReserved(panelRects: Rect[], vw: number, vh: number, slack = 2): Array<[string, string]> {
  const reserved = reservedHudRects(vw, vh);
  const hits: Array<[string, string]> = [];
  for (const p of panelRects) {
    for (const r of reserved) {
      if (rectsOverlap(p, r, slack)) hits.push([p.id, r.id]);
    }
  }
  return hits;
}

export function statesAreDefault(states: Record<PanelId, PanelState>): boolean {
  const def = defaultStates();
  return PANEL_IDS.every((id) => {
    const a = states[id]!;
    const b = def[id]!;
    return a.closed === b.closed
      && a.collapsed === b.collapsed
      && a.x === null
      && a.y === null;
  });
}

/** P key: reset customised layout, else toggle visibility of the column. */
export function panelsKeyAction(
  states: Record<PanelId, PanelState>,
  hidden: boolean,
): { states: Record<PanelId, PanelState>; hidden: boolean } {
  if (hidden) return { states: defaultStates(), hidden: false };
  if (!statesAreDefault(states)) return { states: defaultStates(), hidden: false };
  return { states, hidden: true };
}
