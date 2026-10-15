---
tags: [system]
updated: 2026-10-15
sources: [3, 5, 20, 24, 38]
---

# Traffic rules and intersections

After [[pr-20]], live junctions are a seeded mix of **all-way STOP**, **YIELD** (minor road only), and **uncontrolled** — about a third each (`pickControl`). That **supersedes** the 30 s NS/EW traffic-light cycle documented as current through [[pr-19]]. `generateCityMap` leaves `trafficLights` empty; `updateTrafficLights` still runs as a no-op on that list.

AI cars no longer ride one full-map lane until it dies. They **random-walk the grid** ([[traffic-flow]]): at each node they pick a weighted left / straight / right (no U-turn unless it is a dead end), turn into the right-hand lane, and keep going.

**Stop:** signs on all four approaches. Cars must reach ~0 speed at the stop line; `StopBook` then releases first-come/first-served. Arrival-time ties (≤ 0.12 s) yield to the car on the right. Occupied box (`INTERSECTION_BOX` 7 m) holds them only when another car is actually moving through (> 1.2 m/s).

**Yield:** signs on the minor road only. Slow or stop for close major-road traffic; otherwise “Yielding: clear to go”.

**Uncontrolled:** no signs. Yield to the car on the right and to pedestrians **in the roadway** (~7.4 m of centre, crossing), not sidewalk waiters at 8.8 m.

**Once in the box, always clear.** `decideIntersection` will not stop a car with `distToCenter < INTERSECTION_BOX`. Go decisions are held ~0.8 s (`GO_HOLD`) so stop/go does not flicker. Cars never reverse: speed is clamped ≥ 0 and path arc-length only increases.

**Deadlock breaker:** if every waiting car at a junction has waited more than ~3 s (`DEADLOCK_WAIT`), the earliest arrival (then lowest id) goes. That breaks four-way arrive-together cycles (FCFS ties all yield to the right; uncontrolled four-way the same).

**Stuck:** speed < 0.3 m/s for > 6 s while not legitimately queued → replan; > 10 s → respawn off-screen. Occupants crawling in the box are nudged after ~1.6 s. The ego additionally reverse-remerges if it is off-lane / off-path or held at a clear stop longer than 2.4 s (`recovery.ts`); NPC cars still never reverse.

NPC IDM follow is **same-heading only**, and the ego is in the leader set (`egoAsTraffic`), so cross-traffic in the box is not treated as a car to queue behind. Pedestrian yield from [[pr-5]] still applies on the approach, not inside the box.

3D `stop_sign` / `yield_sign` meshes sit on the right of each signed approach (`signPose`); white stop-line quads mark signed approaches. Visuals are North-American MUTCD blades (red octagon **STOP**, inverted-triangle **YIELD**) facing oncoming traffic. Placement and `decideIntersection` did not change.

## Key files

- `game/src/sim/intersectionRules.ts`
- `game/src/sim/trafficFlow.ts`
- `game/src/sim/world.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/trafficStop.test.ts`
- `game/src/sim/trafficFlow.test.ts`
- `game/src/sim/recovery.ts`
- `game/src/render/trafficSigns.ts`
