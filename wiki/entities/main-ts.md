---
tags: [entity]
updated: 2026-10-13
sources: [3, 19, 20, 25, 28, 29]
---

# `main.ts`

Browser entry: Three.js scene, HUD, start menu, cameras, AI View, input, and the fixed-step loop that calls `Simulation.step`.

F3 BEV heatmaps are painted in `renderBEVHeatmaps` via `runWaabiStack` (the extracted `bevOverlay.ts` path from [[pr-26]] is gone).

After [[pr-20]] it builds 3D stop/yield signs and stop-line quads, paints junction marks on the minimap, counts Tesla HUD detections from vision, and reads `?seed=` (default 3) plus `?demo=lane|left|right|stop|yield|mix|queue`. Collision shots use `?demo=hit-car|hit-pole|hit-sign|hit-ped`. Fallen poles/signs and tumbling pedestrians are posed from `brokenFurniture` / ped tumble fields.

[[pr-25]] locks the hood camera to cockpit eye anchors, stacks/drags the right-side HUD panels, and wires T + the centre banner to `reengageAutopilot`.

## Key files

- `game/src/main.ts`
- `game/index.html`
