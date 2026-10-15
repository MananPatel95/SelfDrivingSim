---
tags: [system]
updated: 2026-10-15
sources: [14, 26, 39]
---

# Stack-faithful planning

F1 / F2 / F3 used to share one `planTrajectory` on one `state.route` (HUD-only difference). After [[pr-39]] each view has its own live planner. The dest pad rule is still shared (`resolveTripDestination` + stored `tripResolved`). What is public vs approximated lives on [[public-sources]].

## Tesla — vision follows the nav route

`buildStackRoute('tesla')` is `mergeIntoLaneRoute` (Manhattan nav, no HD map). `Simulation.step` feeds camera-FOV detections (`teslaVisionPlannerDetections`) and does **not** inject the lidar-style `obstacleAhead` hazard. Control is still pure-pursuit on that polyline.

## Waymo — HD-map lane graph

`buildStackRoute('waymo')` is `laneGraphRoute` on `createHDMap` driving lanes. Follow the heading-matched start lane to the dest-lane crossing, then the dest lane to the pad. Same-street opposite still uses `intersectionUTurn`. Detections stay lidar + nearby signs + `obstacleAhead`.

## Waabi — occupancy-forecast scoring

`buildStackRoute('waabi')` uses the nav polyline as the dest attraction. Each step `planWaabiAlongRoute` builds 1–3 s occupancy from traffic + pedestrians (`predictFutureOccupancyFromAgents`), scores a steering fan plus a route-follow candidate in **ego** frame, and takes that steering. Accel / stop / arrival still come from `planTrajectory`. `tickWaabiView` is unchanged HUD.

`Simulation.setPlannerStack` (F1 / F2 / F3, start-menu stack, `?stack=`) rebuilds the current trip on the new style.

## Key files

- `game/src/planning/stackPlan.ts`
- `game/src/planning/laneGraph.ts`
- `game/src/planning/stackPlan.test.ts`
- `game/src/planning/laneGraph.test.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/stackLeftTurn.test.ts`
- `game/src/planning/planner.ts`
