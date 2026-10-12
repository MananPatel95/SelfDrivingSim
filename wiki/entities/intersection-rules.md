---
tags: [entity]
updated: 2026-10-12
sources: [20]
---

# `intersectionRules.ts`

Seeded intersection mix and the shared right-of-way function. See [[traffic-rules]].

`pickControl` / `buildControlledIntersection` assign stop, yield, or uncontrolled from grid index + seed. `decideIntersection` returns a `RuleDecision` (`maxSpeed`, `mustStop`, `reason`, `severity`) for one `RoadUser`. `StopBook` records who has completed a full stop at which junction. `signPose` places the 3D sign on the right of an approach.

Ego (`simulation.ts`) and every NPC (`updateTrafficVehicle`) call the same function.

## Key files

- `game/src/sim/intersectionRules.ts`
- `game/src/sim/intersectionRules.test.ts`
- `game/src/sim/trafficStop.test.ts`
