---
tags: [system, perception]
updated: 2026-10-12
sources: [2, 3, 26, 28]
---

# Perception F3 — Waabi-style

BEV occupancy now and at +1/+2/+3 s from `createBEVOccupancyFromAgents` (TypeScript Gaussian splat, not WASM). Grid is **32×32** (`WAABI_BEV_RESOLUTION` 1.5 m, `WAABI_BEV_EXTENT` 24 m). Sim World holds a compact replay ring of dynamic actors and adversarial variants.

The live F3 HUD calls `runWaabiStack` from `renderBEVHeatmaps` in `main.ts`, including a roof-lidar scan of statics + traffic + peds. That **supersedes** the [[pr-26]] overlay that used `tickWaabiView` / `bevOverlay.ts` and skipped the second lidar. Occupancy is still the agent splat; the extra lidar is for the trajectory fan / Sim World path, not a change to `createBEVOccupancyFromAgents`. See [[ai-view]].

## Key files

- `game/src/stacks/waabi.ts`
- `game/src/stacks/waabi.test.ts`
- `game/src/main.ts`
