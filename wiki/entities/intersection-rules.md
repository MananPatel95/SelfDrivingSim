---
tags: [entity]
updated: 2026-10-12
sources: [20, 24]
---

# `intersectionRules.ts`

Seeded intersection mix and the shared right-of-way function. See [[traffic-rules]].

`pickControl` / `buildControlledIntersection` assign stop, yield, or uncontrolled from grid index + seed. `decideIntersection` returns a `RuleDecision` (`maxSpeed`, `mustStop`, `reason`, `severity`) for one `RoadUser`. `StopBook` records who has completed a full stop at which junction, plus `goHold` hysteresis and `waitSince` for the 3 s deadlock breaker. A car already inside `INTERSECTION_BOX` always gets a clearing go. `signPose` places the 3D sign on the right of an approach (`yaw = heading + π` so the blade faces oncoming traffic). Mesh look lives in `trafficSigns.ts`, not here.

Ego (`simulation.ts`) and every NPC (`updateTrafficVehicle`) call the same function. See [[traffic-rules]] and [[traffic-flow]].

## Key files

- `game/src/sim/intersectionRules.ts`
- `game/src/sim/intersectionRules.test.ts`
- `game/src/sim/trafficStop.test.ts`
