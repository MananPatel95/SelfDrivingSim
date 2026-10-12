---
tags: [decisions]
updated: 2026-10-12
sources: [3, 6, 12, 20]
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

## Curb walls are paint only

[[pr-12]] made mid-block curb OBBs non-colliding so a car can leave the asphalt and return without a collision spam. Buildings, poles, trees, and other vehicles still collide.

## Start flow

- [[pr-10]]: parked start + pick a compass direction.
- [[pr-13]]: map start/end; both buttons required a full trip. **Supersedes** the compass UI.
- [[pr-19]]: **Just drive** with no trip; autopilot still needs both map points. **Supersedes** the “manual requires a route” rule from #13.
- [[pr-tesla-fp]]: **T** / the Manual banner re-engages from the current pose (replan to the trip destination, or cruise with no trip). WASD still takes over on a new press. **Supersedes** “once you take over there is no Auto”.

## Right-hand traffic and stop/yield mix

[[pr-20]] made North-American right-hand lanes (`LANE_OFFSET` 3.5 m) and a seeded ~1/3 mix of all-way stop / minor-road yield / uncontrolled the live intersection control. Ego and every AI traffic car share `decideIntersection`. That **supersedes** cycling traffic lights as what actually governs junctions (the 30 s `updateTrafficLights` helper remains but `generateCityMap` no longer creates lights). Pedestrian yield from [[pr-5]] stays.

## Key files

- `game/src/sim/vehicle.ts`
- `game/src/sim/wasm.ts`
- `game/crates/autonomy-sim/src/lib.rs`
- `game/src/workers/simHotPath.ts`
- `game/src/stacks/perception.ts`
- `game/src/stacks/waabi.ts`
- `game/src/sim/intersectionRules.ts`
- `game/src/sim/rightLane.ts`
