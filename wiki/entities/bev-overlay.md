---
tags: [entity, render, perf]
updated: 2026-10-12
sources: []
---

# `bevOverlay.ts`

F3 Waabi BEV HUD extracted from `main.ts`. `tickWaabiBevOverlay` throttles occupancy + trajectory scoring to 10 Hz, paints four heatmaps with one `putImageData` (`writeOccupancyRgba`), and rewrites the Sim World table only when the variant set changes.

`getDisplayedOccupancy` lerps the current grid between predicts for the 3D occupancy voxels and the AI View inset.

Does not call `runWaabiStack`, `simulateLidarScan`, or `simHotPath.ts`. Does not replace `createBEVOccupancyFromAgents`.

## Key files

- `game/src/render/bevOverlay.ts`
- `game/src/render/occupancyPaint.ts`
- `game/src/stacks/waabi.ts`
- `game/src/main.ts`
