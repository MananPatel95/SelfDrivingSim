---
tags: [entity]
updated: 2026-10-15
sources: [3, 13, 19, 20, 24, 25, 27, 28, 29, 30, 31, 33, 39]
---

# `simulation.ts`

Owns world map, ego, traffic, pedestrians, lidar/perception, planner, collisions, and recording. `beginTrip` / `beginParked` / `previewSpawn` / `getTripDestination` / `hasArrived` are the start-menu hooks. `beginTrip` snaps the start with `placeTripStart` (right-hand lane, off the junction) and builds `buildStackRoute` to the #33 pad, keeping the first `ResolvedDestination` so re-engage cannot flip a left into a U-turn. `setPlannerStack` switches Tesla vision+nav / Waymo HD lane graph / Waabi occupancy. The overlay does not edit the planner. Autopilot and oracle map accel through `vehicleInputFromAccel` so they share the ego ABS brake. `recovery.ts` can GTA-reverse then `reengageAutopilot()` when the ego is off-path or stuck at a clear stop.

After [[pr-20]] it holds a shared `StopBook`, calls `decideIntersection` each step (stored as `lastRule`), passes `rule` into the planner, and feeds the same `TrafficRuleContext` into every `updateTrafficVehicle`. `beginTrip` places the car with `tripRoute` / `placeInRightLane` and stores the **roadside pad** as `tripDestination`. On the pad `arrived` holds the brakes and forces `lastRule` to **Arrived** (heading must match). If the stack is cruising at a standstill with the pad still far, `maybeReplanStuck` calls `reengageAutopilot()`. `reengageAutopilot()` ([[pr-25]]) rebuilds the active stack's route from the current pose to that pad (or cruises if `beginParked` left none), using the stored resolve so a same-street opposite pad still U-turns and a cross-street left does not. Tesla planner detections are camera-FOV only; Waymo/Waabi still merge nearby stop/yield signs.

Traffic spawn is a grid random walk (`spawnGraphTraffic`), not a random point on a full-map lane. The ego is inserted as `egoAsTraffic` so NPCs follow it. After each step, cars that have been slow and are not queued are nudged, replanned, or respawned off-screen.

After `updateVehicle`, `resolveWorldCollisions` runs the impulse solver (spatial hash + swept thin props). New contacts increment `collisionCount` / `collisionLog` and call `takeover('collision')`. Traffic cars with `impactCooldown` slide instead of following the graph. `setupHitDemo('car'|'pole'|'sign'|'pedestrian')` is the screenshot / unit-test rig. The hazard path uses `obstacleAhead`, which skips roadside statics so poles do not full-brake a turn ([[pr-28]]); contact still collides.

## Key files

- `game/src/sim/simulation.ts`
- `game/src/sim/world.ts`
- `game/src/sim/intersectionRules.ts`
- `game/src/sim/rightLane.ts`
- `game/src/planning/stackPlan.ts`
- `game/src/sim/trafficFlow.ts`
- `game/src/sim/recovery.ts`
