---
tags: [source]
updated: 2026-10-14
sources: []
---

# HUD panel cleanup — shared 300px column and ? popovers

## What changed

Right-side HUD cards (stack explainer, AI View, info, F3 Waabi BEV + Sim World) share one width (`min(300px, 100vw − 24px)`) and one right edge, stacked with an 8px gap. Collapse, close, drag, and **P** toggle/reset are unchanged.

The view-info card is essentials only: stack name, a one-line “what this stack uses”, and the current camera mode. The long USES / UNLIKE THE OTHERS / camera paragraphs moved into **?** popovers on every panel header (F1 / F2 / F3). Popovers close on click-outside or Esc, have no full-screen backdrop, and do not swallow WASD. Esc closes help before it pauses.

`hudPanels.ts` uses one `PANEL_WIDTH` for layout math (including the BEV card). DOM tests in `hudPanelDom.test.ts` cover equal widths and the `?` open/close path.

Did not replace `updateVehicle` / `removeGround` / `createBEVOccupancyFromAgents`. No `simHotPath.ts`. `cast_rays` stays in Rust/WASM.

## Why

The live F3 column used three different widths (360 / 440 / 420) and a long explainer that overflowed the viewport.

## Pages touched

hud, ai-view, testing, main-ts, overview

## Claims superseded

Supersedes the mixed-width right column and the long on-card USES / UNLIKE copy from [[pr-25]] / [[pr-4]].

## Key files

- `game/src/ui/hudPanels.ts`
- `game/src/ui/panelHelp.ts`
- `game/src/ui/viewCopy.ts`
- `game/src/ui/hudPanelDom.test.ts`
- `game/index.html`
- `game/src/main.ts`
