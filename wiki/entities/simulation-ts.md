---
tags: [entity]
updated: 2026-10-14
sources: [3, 13, 19, 20, 24, 25, 27, 28, 29, 30]
---

# `simulation.ts`

Owns world map, ego, traffic, pedestrians, lidar/perception, planner, collisions, and recording. `beginTrip` / `beginParked` are the start-menu hooks. Autopilot and oracle map accel through `vehicleInputFromAccel` so they share the ego ABS brake.

After [[pr-20]] it holds a shared `StopBook`, calls `decideIntersection` each step (stored as `lastRule`), passes `rule` into the planner, and feeds the same `TrafficRuleContext` into every `updateTrafficVehicle`. `beginTrip` places the car with `tripRoute` / `placeInRightLane` and stores the **roadside pad** as `tripDestination`. On the pad `arrived` holds the brakes and forces `lastRule` to **Arrived** (heading must match). If the stack is cruising at a standstill with the pad still far, `maybeReplanStuck` calls `reengageAutopilot()`. `reengageAutopilot()` ([[pr-25]]) rebuilds a right-lane route from the current pose to that pad (or cruises if `beginParked` left none), including a U-turn when the pad is opposite-side. Nearby stop/yield signs are merged into planner detections.

Traffic spawn is a grid random walk (`spawnGraphTraffic`), not a random point on a full-map lane. The ego is inserted as `egoAsTraffic` so NPCs follow it. After each step, cars that have been slow and are not queued are nudged, replanned, or respawned off-screen.

After `updateVehicle`, `resolveWorldCollisions` runs the impulse solver (spatial hash + swept thin props). New contacts increment `collisionCount` / `collisionLog` and call `takeover('collision')`. Traffic cars with `impactCooldown` slide instead of following the graph. `setupHitDemo('car'|'pole'|'sign'|'pedestrian')` is the screenshot / unit-test rig. The hazard path uses `obstacleAhead`, which skips roadside statics so poles do not full-brake a turn ([[pr-28]]); contact still collides.

## Key files

- `game/src/sim/simulation.ts`
- `game/src/sim/world.ts`
- `game/src/sim/intersectionRules.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/trafficFlow.ts`
