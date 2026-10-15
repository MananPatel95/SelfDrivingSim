---
tags: [entity]
updated: 2026-10-14
sources: []
---

# `bevOverlay.ts`

F3 BEV HUD: 10 Hz `tickWaabiView` into pooled occupancy grids, one RGBA `putImageData` for the four heatmaps, cached Sim World table. Interpolates displayed occupancy between ticks for the 3D voxels / AI View inset.

Does **not** call `runWaabiStack` and does **not** recast lidar. Planner / driving do not read this path.

## Key files

- `game/src/render/bevOverlay.ts`
- `game/src/render/occupancyPaint.ts`
- `game/src/stacks/waabi.ts`
