---
tags: [entity]
updated: 2026-10-12
sources: [3, 13, 19, 20, 24, 25]
---

# `simulation.ts`

Owns world map, ego, traffic, pedestrians, lidar/perception, planner, collisions, and recording. `beginTrip` / `beginParked` are the start-menu hooks.

After [[pr-20]] it holds a shared `StopBook`, calls `decideIntersection` each step (stored as `lastRule`), passes `rule` into the planner, and feeds the same `TrafficRuleContext` into every `updateTrafficVehicle`. `beginTrip` places the car with `rightLaneRoute` / `placeInRightLane` and remembers the destination. `reengageAutopilot()` ([[pr-25]]) rebuilds a right-lane route from the current pose to that destination (or cruises if `beginParked` left none). Nearby stop/yield signs are merged into planner detections.

Traffic spawn is a grid random walk (`spawnGraphTraffic`), not a random point on a full-map lane. The ego is inserted as `egoAsTraffic` so NPCs follow it. After each step, cars that have been slow and are not queued are nudged, replanned, or respawned off-screen.

After `updateVehicle`, `resolveWorldCollisions` runs the impulse solver (spatial hash + swept thin props). New contacts increment `collisionCount` / `collisionLog` and call `takeover('collision')`. Traffic cars with `impactCooldown` slide instead of following the graph. `setupHitDemo('car'|'pole'|'sign'|'pedestrian')` is the screenshot / unit-test rig.

## Key files

- `game/src/sim/simulation.ts`
- `game/src/sim/world.ts`
- `game/src/sim/intersectionRules.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/trafficFlow.ts`
