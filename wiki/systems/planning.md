---
tags: [system]
updated: 2026-10-12
sources: [13, 18, 20]
---

# Planning and autopilot

`planTrajectory` is a rule-based pure-pursuit follower. It aims a short look-ahead along `route`, slows before a sharp bend (`nextCorner`), and stays at ~3.8 m/s until the nose matches the new segment so the car does not cut grass ([[pr-18]]).

Map clicks still snap to the road axis (`snapToRoad`, [[pr-13]]). Ego trips then follow `rightLaneRoute` so the polyline stays in the right-hand lane: right turns cut the near corner, left turns go wide ([[pr-20]], which **supersedes** driving the centerline `roadRoute` for `beginTrip`). The last metres drop desired speed to 0 so the trip ends parked.

`input.rule` from `decideIntersection` caps `desiredSpeed` and forces a stop when `mustStop` ([[traffic-rules]]).

`oracleSupervisor` can take over for imminent VRU collisions when `useOracle` is on (headless).

After a human takeover, **T** / the Manual banner calls `Simulation.reengageAutopilot()` ([[pr-tesla-fp]]). That rebuilds `mergeIntoLaneRoute` from the current pose and heading: ease into the right-hand lane, then a Manhattan right-lane path to the stored trip destination, or a cruise-ahead path if there was no trip. `plannerState` resets; stop/yield still apply on the next step. Held WASD does not immediately steal control.

## Key files

- `game/src/planning/planner.ts`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/world.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/reengage.test.ts`
