---
tags: [system, perception]
updated: 2026-10-15
sources: [2, 3, 26, 28, 34, 37]
---

# Perception F3 — Waabi-style

BEV occupancy now and at +1/+2/+3 s from `createBEVOccupancyFromAgents` (TypeScript Gaussian splat, not WASM). Grid is **32×32** (`WAABI_BEV_RESOLUTION` 1.5 m, `WAABI_BEV_EXTENT` 24 m). Sim World holds a compact replay ring of dynamic actors and adversarial variants.

The live F3 HUD is `tickWaabiBevOverlay` at **10 Hz** (`bevOverlay.ts`). Occupancy, the trajectory fan, and Sim World run from traffic + pedestrians into pooled grids. That **supersedes** the [[pr-28]] live `runWaabiStack` extra roof-lidar (and restores the cheap overlay from [[pr-26]] without touching planner / `obstacleAhead`). Occupancy is still the agent splat; `createBEVOccupancyFromAgents` is unchanged except for an optional reuse buffer. `runWaabiStack` remains the headless/API path and still casts lidar. See [[ai-view]] and [[bev-overlay]].

[[pr-37]] interpolates displayed occupancy between those 10 Hz ticks (3D voxels and the BEV canvas). Future occupancy at +1s/+2s/+3s is drawn as ghosted extruded blobs that slide forward; the trajectory fan sweeps with the selected candidate highlighted. `paintDisplayedBev` redraws the mini-panel at ~20 Hz from the lerped grids — it does not call `tickWaabiView` again.

## Key files

- `game/src/stacks/waabi.ts`
- `game/src/stacks/waabi.test.ts`
- `game/src/render/bevOverlay.ts`
- `game/src/render/occupancyPaint.ts`
- `game/src/render/perceptionViz.ts`
- `game/src/render/snapshotLerp.ts`
- `game/src/main.ts`
