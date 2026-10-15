---
tags: [decisions]
updated: 2026-10-15
sources: [3, 6, 12, 20, 24, 29, 31, 33, 34, 35, 36, 37]
---

# Decisions

Durable choices. When a PR reverses one, update this page and the old `pr-NNN` source.

## City-only stacks (F4 / F5 / F6 removed)

[[pr-3]] deleted Aurora (F4), rail (F5), and maritime (F6) zones, HUD, keys, and COLREGs tests. [[pr-2]] had just added harbour roads and COLREGs — that harbour work is superseded. The live stacks are F1 / F2 / F3 only.

## Rust / WASM scope

The crate `game/crates/autonomy-sim` exposes **`cast_rays`** to JavaScript. That is the only kernel wired through `game/src/sim/wasm.ts`.

These stay in TypeScript:

- `updateVehicle` in `game/src/sim/vehicle.ts` (comment in that file: F5/F6 helpers removed; city vehicles stay on this bicycle model)
- `removeGround` in `game/src/stacks/perception.ts`
- `createBEVOccupancyFromAgents` in `game/src/stacks/waabi.ts`

`game/src/workers/simHotPath.ts` describes worker messages for cast / occupancy / step / filter but **nothing imports it**. Treat it as unused.

The live F3 HUD is a 10 Hz `tickWaabiView` overlay (`bevOverlay.ts`) that does **not** recast lidar. `runWaabiStack` remains the headless/API path. Planner / `obstacleAhead` / `updateVehicle` stay on the sim step. This restores the cheap overlay from [[pr-26]] after [[pr-28]] reverted it for a pole-hazard stall (fixed in #28, not by the overlay).

City look textures are procedural CC0 (`cityTextures.ts`). **Look High** is bloom + LUT only; **Quality High** is the tight-frustum PCF sun. Pixel ratio is capped at 1.5. Browser lidar display uses a fixed beam (no per-frame jitter). Overlay *motion* is a display-side sweep/decay + 10 Hz snapshot lerp (`snapshotLerp.ts`, shader `uTime` / `uSweep`); it must not reintroduce beam jitter or per-frame `simulateLidarScan`.

World collision response is also TypeScript (`collision.ts`): SAT / capsule overlap, spatial hash, and a 2D impulse. It runs after `updateVehicle` and does not go through WASM.

## Curb walls are paint only

[[pr-12]] made mid-block curb OBBs non-colliding so a car can leave the asphalt and return without a collision spam. Buildings, poles, trees, and other vehicles still collide.

## Start flow

- [[pr-10]]: parked start + pick a compass direction.
- [[pr-13]]: map start/end; both buttons required a full trip. **Supersedes** the compass UI.
- [[pr-19]]: **Just drive** with no trip; autopilot still needs both map points. **Supersedes** the “manual requires a route” rule from #13.
- [[pr-25]]: **T** / the Manual banner re-engages from the current pose (replan to the trip destination, or cruise with no trip). WASD still takes over on a new press. **Supersedes** “once you take over there is no Auto”.
- Start / arrived overlay: **A → B** (start then dest) or **Random**. Starts snap to a right-hand lane off the junction; dests still use `snapTripEnd` + `resolveTripDestination`. Arrival reopens the overlay with the parked pose as the default A → B start. **Just drive** remains. This **supersedes** the dest-only overlay from [[pr-31]] and the older two-click map from [[pr-13]] / [[pr-19]]. The menu calls `beginTrip` / `beginParked` / `previewSpawn`.

## Right-hand traffic and stop/yield mix

[[pr-20]] made North-American right-hand lanes (`LANE_OFFSET` 3.5 m) and a seeded ~1/3 mix of all-way stop / minor-road yield / uncontrolled the live intersection control. Ego and every AI traffic car share `decideIntersection`. That **supersedes** cycling traffic lights as what actually governs junctions (the 30 s `updateTrafficLights` helper remains but `generateCityMap` no longer creates lights). Pedestrian yield from [[pr-5]] stays.

AI traffic now random-walks the grid (`trafficFlow.ts`) instead of riding one full-map lane until `laneProgress >= 1` froze it. Reverse-direction lanes also span the whole map (`y → -y`) rather than ending at the origin. Deadlock breaker, go hysteresis, and “never stop in the box” live in `decideIntersection`. `updateVehicle`, `removeGround`, and `createBEVOccupancyFromAgents` stay in TypeScript; `simHotPath.ts` is still unused.

## Key files

- `game/src/sim/vehicle.ts`
- `game/src/sim/wasm.ts`
- `game/crates/autonomy-sim/src/lib.rs`
- `game/src/workers/simHotPath.ts`
- `game/src/stacks/perception.ts`
- `game/src/stacks/waabi.ts`
- `game/src/sim/intersectionRules.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/trafficFlow.ts`
