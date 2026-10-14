---
tags: [entity]
updated: 2026-10-14
sources: [3, 19, 20, 25, 28, 29, 30, 32]
---

# `main.ts`

Browser entry: Three.js scene, HUD, start menu, cameras, AI View, input, and the fixed-step loop that calls `Simulation.step`.

F3 BEV heatmaps are painted in `renderBEVHeatmaps` via `runWaabiStack` (the extracted `bevOverlay.ts` path from [[pr-26]] is gone).

After [[pr-20]] it builds 3D stop/yield signs and stop-line quads, paints junction marks on the minimap, counts Tesla HUD detections from vision, and reads `?seed=` (default 3) plus `?demo=lane|left|right|stop|yield|mix|queue|arrive`. Collision shots use `?demo=hit-car|hit-pole|hit-sign|hit-ped`. Fallen poles/signs and tumbling pedestrians are posed from `brokenFurniture` / ped tumble fields. A trip paints a pink 8.4×2.4 m pad; the pin sits at the pad's front-right and hides after `hasArrived()`. The same colour marks the minimap.

[[pr-25]] locks the hood camera to cockpit eye anchors, stacks/drags the right-side HUD panels, and wires T + the centre banner to `reengageAutopilot`. The view-info card is now a one-line summary plus camera mode; longer copy lives in `panelHelp.ts` popovers. Esc closes an open help popover before it toggles pause.

## Key files

- `game/src/main.ts`
- `game/index.html`
