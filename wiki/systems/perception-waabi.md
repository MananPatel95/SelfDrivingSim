---
tags: [system, perception, perf]
updated: 2026-10-12
sources: [2, 3, 26]
---

# Perception F3 — Waabi-style

BEV occupancy now and at +1/+2/+3 s from `createBEVOccupancyFromAgents` (TypeScript Gaussian splat, not WASM). Grid is **32×32** (`WAABI_BEV_RESOLUTION` 1.5 m, `WAABI_BEV_EXTENT` 24 m). Sim World holds a compact replay ring of dynamic actors and adversarial variants.

The F3 overlay does **not** run a second roof-lidar scan. Occupancy is filled from traffic + pedestrians only. Prediction is **10 Hz** (`tickWaabiView` / `tickWaabiBevOverlay`) into pooled `Float32Array` grids; between ticks the displayed current grid is linearly interpolated. See [[bev-overlay]] and [[ai-view]].

`runWaabiStack` still exists for the headless/API path and still calls `simulateLidarScan` (`f3WorkStats.lidarScans++`). The live F3 view uses `tickWaabiView` instead. `npm run bench:views` reports both.

## Key files

- `game/src/stacks/waabi.ts`
- `game/src/stacks/waabi.test.ts`
- `game/src/render/bevOverlay.ts`
- `game/src/render/occupancyPaint.ts`
- `game/src/render/f3Perf.test.ts`
