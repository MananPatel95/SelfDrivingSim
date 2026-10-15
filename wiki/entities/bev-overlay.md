---
tags: [entity]
updated: 2026-10-15
sources: [34, 37]
---

# `bevOverlay.ts`

F3 BEV HUD: 10 Hz `tickWaabiView` into pooled occupancy grids, one RGBA `putImageData` for the four heatmaps, cached Sim World table. Interpolates displayed occupancy between ticks for the 3D voxels / AI View inset. `paintDisplayedBev` redraws the canvas at ~20 Hz from that lerp (trajectory dashes sweep; heat morphs) without another predict. GPU overlay uniforms still update every display frame.

Does **not** call `runWaabiStack` and does **not** recast lidar. Planner / driving do not read this path.

## Key files

- `game/src/render/bevOverlay.ts`
- `game/src/render/occupancyPaint.ts`
- `game/src/stacks/waabi.ts`
- `game/src/render/snapshotLerp.ts`
