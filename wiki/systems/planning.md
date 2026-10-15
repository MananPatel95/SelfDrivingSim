---
tags: [system]
updated: 2026-10-14
sources: [13, 18, 20, 25, 27, 28, 29, 30, 33]
---

# Planning and autopilot

`planTrajectory` is a rule-based pure-pursuit follower. It aims a short look-ahead along `route`, slows before a sharp bend (`nextCorner`), and stays at ~3.8 m/s until the nose matches the new segment so the car does not cut grass ([[pr-18]]). Comfort decel is ~3 m/s²; emergency / oracle is ~9 m/s² ([[pr-27]]). Both go through `vehicleInputFromAccel` onto the sedan ABS brake in `updateVehicle` — not a separate integrator.

Map clicks still snap to the road axis (`snapToRoad`, [[pr-13]]). End clicks use `snapTripEnd` so a junction click stays on the start road and keeps the clicked curb side. Ego trips then follow `tripRoute`: a Manhattan `rightLaneRoute` (right turns cut the near corner; left turns go wide, [[pr-20]], which **supersedes** driving the centerline `roadRoute` for `beginTrip`) plus a lateral ease and a **road-parallel tail** onto a roadside pad at `PULL_OVER_OFFSET` (5.775 m, ~0.3 m tyre-to-curb). The pad is on the **right-hand curb of the arrival heading**. A click left of that approach is an opposite-side dest: the pad stays on that curb and the route does a **legal left U-turn at the next intersection** (never a mid-block median cross), then pulls over. Same-road start/end no longer detour through the next grid crossing. The pad is slid backward if the click sits in a junction. `remainingRouteDistance` creeps in the last 12 m and stops in the last 4 m. On the pad the sim sets `arrived`, holds the brakes, and the banner reads **Arrived** ([[pr-30]]). Standing still in-lane while cruising with the pad still metres away triggers `reengageAutopilot()`. If the ego is off its lane or path, or held at a **clear** stop longer than 2.4 s, `recovery.ts` GTA-reverses then `reengageAutopilot()` so it can full-stop and leave — it does not sit forever at a stop sign. The 3D pin sits at the front-right of the pad and hides once parked so it does not pierce the body.

`input.rule` from `decideIntersection` caps `desiredSpeed` and forces a stop when `mustStop` ([[traffic-rules]]). `obstacleAhead` and `findClosestObstacleAhead` skip roadside statics (poles, trees, signs, buildings), so a corner pole does not full-brake a turn ([[pr-28]]). Contact with those objects still collides ([[collisions]]).

`oracleSupervisor` can take over for imminent VRU collisions when `useOracle` is on (headless).

A counted collision while the stack is on policy/oracle calls `takeover('collision')` and leaves the car in manual. After a human takeover, **T** / the Manual banner calls `Simulation.reengageAutopilot()` ([[pr-25]]). That rebuilds `mergeIntoLaneRoute` from the current pose and heading: ease into the right-hand lane, then a Manhattan right-lane path to the stored trip destination, or a cruise-ahead path if there was no trip. `plannerState` resets; stop/yield still apply on the next step. Held WASD does not immediately steal control.

## Key files

- `game/src/planning/planner.ts`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/world.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/recovery.ts`
- `game/src/sim/recovery.test.ts`
- `game/src/sim/reengage.test.ts`
