---
tags: [entity]
updated: 2026-10-12
sources: [3, 19, 20]
---

# `main.ts`

Browser entry: Three.js scene, HUD, start menu, cameras, AI View, input, and the fixed-step loop that calls `Simulation.step`.

After [[pr-20]] it builds 3D stop/yield signs and stop-line quads, paints junction marks on the minimap, counts Tesla HUD detections from vision, and reads `?seed=` (default 3) plus `?demo=lane|stop|yield|mix|queue`.

[[pr-25]] locks the hood camera to cockpit eye anchors, stacks/drags the right-side HUD panels, and wires T + the centre banner to `reengageAutopilot`.

## Key files

- `game/src/main.ts`
- `game/index.html`
