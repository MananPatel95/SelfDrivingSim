---
tags: [system]
updated: 2026-10-12
sources: [13, 18, 20]
---

# Planning and autopilot

`planTrajectory` is a rule-based pure-pursuit follower. It aims a short look-ahead along `route`, slows before a sharp bend (`nextCorner`), and stays at ~3.8 m/s until the nose matches the new segment so the car does not cut grass ([[pr-18]]). Comfort decel is ~3 m/s²; emergency / oracle is ~9 m/s². Both go through `vehicleInputFromAccel` onto the sedan ABS brake in `updateVehicle` — not a separate integrator.

Map clicks still snap to the road axis (`snapToRoad`, [[pr-13]]). Ego trips then follow `rightLaneRoute` so the polyline stays in the right-hand lane: right turns cut the near corner, left turns go wide ([[pr-20]], which **supersedes** driving the centerline `roadRoute` for `beginTrip`). The last metres drop desired speed to 0 so the trip ends parked.

`input.rule` from `decideIntersection` caps `desiredSpeed` and forces a stop when `mustStop` ([[traffic-rules]]).

`oracleSupervisor` can take over for imminent VRU collisions when `useOracle` is on (headless).

## Key files

- `game/src/planning/planner.ts`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/world.ts`
