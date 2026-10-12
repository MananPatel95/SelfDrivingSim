---
tags: [entity]
updated: 2026-10-12
sources: [3, 19, 20]
---

# `main.ts`

Browser entry: Three.js scene, HUD, start menu, cameras, AI View, input, and the fixed-step loop that calls `Simulation.step`.

F3 BEV heatmaps are not inlined here anymore — `renderBEVHeatmaps` calls [[bev-overlay]]. `?stack=tesla|waymo|waabi` selects a view after `?demo=` / `?shot=`.

After [[pr-20]] it builds 3D stop/yield signs and stop-line quads, paints junction marks on the minimap, counts Tesla HUD detections from vision, and reads `?seed=` (default 3) plus `?demo=lane|stop|yield|mix|queue`.

## Key files

- `game/src/main.ts`
- `game/index.html`
