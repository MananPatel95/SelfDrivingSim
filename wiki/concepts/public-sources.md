---
tags: [concept]
updated: 2026-10-15
sources: [2, 3, 14, 26, 39]
---

# Public sources vs this sim

AUTONOMY CITY is an educational model of **publicly described** stacks, not a product of Tesla, Waymo, or Waabi. Live F1 / F2 / F3 planning now follows those descriptions; the named companies' actual weights, maps, and closed-loop code are not in this repo.

## Tesla (F1) — public

Public Tesla FSD / AI Day material describes:

- cameras only (radar removed; no lidar)
- end-to-end network from pixels to a trajectory / controls
- a consumer navigation route, **not** an HD prior map

**This sim:** `detectVisibleAgents` camera FOVs feed `planForStack('tesla')`, which pursues the Manhattan nav polyline from `mergeIntoLaneRoute`. There is **no trained net**. Occupancy voxels stay HUD-only.

## Waymo (F2) — public

Public Waymo Driver / safety-report material describes:

- a prior HD map of lane centerlines, stop lines, crosswalks, lights
- routing on that lane graph inside a geofence
- lidar + radar + camera fusion and lidar-to-map localization

**This sim:** `laneGraphRoute` walks procedural HD driving lanes (`createHDMap`). `connections[]` is empty, so a hop is “heading-matched start lane → crossing → dest lane.” Live detections stay lidar/radar. Localization / geofence flags exist on the profile; the city is one mapped grid.

## Waabi (F3) — public

Public Waabi blogs / papers describe:

- lidar + camera + radar fused into a BEV
- interpretable mid-level reps, including **future occupancy** (1–3 s)
- scoring a fan of candidate trajectories
- closed-loop training in Waabi World

**This sim:** `planWaabiAlongRoute` scores a steering fan plus a dest-route candidate against `predictFutureOccupancyFromAgents` (agent-splat, not a learned predictor). Route attraction keeps a legal left cheaper than a U-turn. `createBEVOccupancyFromAgents` is unchanged. `tickWaabiView` remains the 10 Hz HUD.

## Shared dest rule (ours)

`resolveTripDestination` is **this project's** traffic rule, not a vendor API: opposite-side U-turn only on the same grid road. Every stack uses that first resolve so a dest one left away stays one left.

## Key files

- `game/src/planning/stackPlan.ts`
- `game/src/planning/laneGraph.ts`
- `game/src/stacks/tesla.ts`
- `game/src/stacks/waymo.ts`
- `game/src/stacks/waabi.ts`
- `wiki/systems/stack-planning.md`
