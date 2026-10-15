---
tags: [entity]
updated: 2026-10-15
sources: [3, 19, 20, 25, 28, 29, 30, 31, 32, 33, 34, 39]
---

# `main.ts`

Browser entry: Three.js scene, HUD, start / arrived menu, cameras, AI View, input, and the fixed-step loop that calls `Simulation.step`. The trip overlay lives in `startMenu.ts`; `main.ts` draws the city map, orbits the backdrop while the menu is open, and calls `beginTrip` / `beginParked`. The sim step is skipped while that overlay is open. After `hasArrived()` it reopens the overlay with the current pose as the new start.

`switchStack` / the start-menu stack call `Simulation.setPlannerStack` so F1 / F2 / F3 change live planning, not only HUD. F3 BEV heatmaps are painted in `renderBEVHeatmaps` via `tickWaabiBevOverlay` at 10 Hz (no extra lidar). Detection boxes and AI View perception also tick at 10 Hz. Compare-mode Tesla voxels and Waymo points/boxes use `InstancedMesh` / a pooled `Points` cloud. The city look (sky, sun follow, textured roads/buildings, optional bloom) lives in `cityLook.ts` / `postFx.ts`.

After [[pr-20]] it builds 3D stop/yield signs and stop-line quads, paints junction marks on the minimap, counts Tesla HUD detections from vision, and reads `?seed=` (default 3) plus `?demo=lane|left|right|stop|yield|mix|queue|arrive|arrive-opp`. Collision shots use `?demo=hit-car|hit-pole|hit-sign|hit-ped`. Fallen poles/signs and tumbling pedestrians are posed from `brokenFurniture` / ped tumble fields. A trip paints a pink 8.4×2.45 m pad (outer edge flush on the curb); the pin sits at the pad's front-right and hides after `hasArrived()`. The same colour marks the minimap. End-map clicks use `snapTripEnd`.

[[pr-25]] locks the hood camera to cockpit eye anchors, stacks/drags the right-side HUD panels, and wires T + the centre banner to `reengageAutopilot`. The view-info card is now a one-line summary plus camera mode; longer copy lives in `panelHelp.ts` popovers. Esc closes an open help popover before it toggles pause.

## Key files

- `game/src/main.ts`
- `game/src/render/cityLook.ts`
- `game/src/render/postFx.ts`
- `game/index.html`
- `game/src/ui/startMenu.ts`
