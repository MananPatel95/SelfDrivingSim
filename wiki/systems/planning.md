---
tags: [system]
updated: 2026-10-12
sources: [13, 18]
---

# Planning and autopilot

`planTrajectory` is a rule-based pure-pursuit follower. It aims a short look-ahead along `route`, slows before a sharp bend (`nextCorner`), and stays at ~3.8 m/s until the nose matches the new segment so the car does not cut grass ([[pr-18]]).

Routes are Manhattan grid polylines from `roadRoute` / `snapToRoad` ([[pr-13]]). The last metres drop desired speed to 0 so the trip ends parked.

`oracleSupervisor` can take over for imminent VRU collisions when `useOracle` is on (headless).

## Key files

- `game/src/planning/planner.ts`
- `game/src/planning/planner.test.ts`
- `game/src/sim/world.ts`
