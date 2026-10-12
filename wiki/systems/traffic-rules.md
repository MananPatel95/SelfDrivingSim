---
tags: [system]
updated: 2026-10-12
sources: [3, 5, 20]
---

# Traffic rules and intersections

After [[pr-20]], live junctions are a seeded mix of **all-way STOP**, **YIELD** (minor road only), and **uncontrolled** — about a third each (`pickControl`). That **supersedes** the 30 s NS/EW traffic-light cycle documented as current through [[pr-19]]. `generateCityMap` leaves `trafficLights` empty; `updateTrafficLights` still runs as a no-op on that list.

**Stop:** signs on all four approaches. Cars must reach ~0 speed at the stop line; `StopBook` then releases first-come/first-served. Arrival-time ties (≤ 0.12 s) yield to the car on the right. Occupied box (`INTERSECTION_BOX` 7 m) also holds them.

**Yield:** signs on the minor road only. Slow or stop for close major-road traffic; otherwise “Yielding: clear to go”.

**Uncontrolled:** no signs. Yield to the car on the right and to pedestrians in the 12 m box.

The same `decideIntersection` output caps ego (`planTrajectory` + hard brake when `mustStop`) and every AI traffic car (`updateTrafficVehicle` via `TrafficRuleContext`). NPC IDM follow and [[pr-5]] `shouldYieldToPedestrian` still apply on top.

3D `stop_sign` / `yield_sign` meshes sit on the right of each signed approach (`signPose`); white stop-line quads mark signed approaches.

## Key files

- `game/src/sim/intersectionRules.ts`
- `game/src/sim/world.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/trafficStop.test.ts`
