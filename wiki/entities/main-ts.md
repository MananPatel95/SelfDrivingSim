---
tags: [entity]
updated: 2026-10-14
sources: [3, 19, 20, 25, 28, 29, 30, 31]
---

# `main.ts`

Browser entry: Three.js scene, HUD, start / arrived menu, cameras, AI View, input, and the fixed-step loop that calls `Simulation.step`. The trip overlay lives in `startMenu.ts`; `main.ts` draws the city map, orbits the backdrop while the menu is open, and calls `beginTrip` / `beginParked`. The sim step is skipped while that overlay is open. After `hasArrived()` it reopens the overlay with the current pose as the new start.

F3 BEV heatmaps are painted in `renderBEVHeatmaps` via `runWaabiStack` (the extracted `bevOverlay.ts` path from [[pr-26]] is gone).

After [[pr-20]] it builds 3D stop/yield signs and stop-line quads, paints junction marks on the minimap, counts Tesla HUD detections from vision, and reads `?seed=` (default 3) plus `?demo=lane|left|right|stop|yield|mix|queue|arrive`. Collision shots use `?demo=hit-car|hit-pole|hit-sign|hit-ped`. Fallen poles/signs and tumbling pedestrians are posed from `brokenFurniture` / ped tumble fields. A trip paints a pink 8.4×2.4 m pad; the pin sits at the pad's front-right and hides after `hasArrived()`. The same colour marks the minimap.

[[pr-25]] locks the hood camera to cockpit eye anchors, stacks/drags the right-side HUD panels, and wires T + the centre banner to `reengageAutopilot`.

## Key files

- `game/src/main.ts`
- `game/index.html`
- `game/src/ui/startMenu.ts`
