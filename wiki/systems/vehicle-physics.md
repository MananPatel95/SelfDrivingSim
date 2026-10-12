---
tags: [system, physics]
updated: 2026-10-12
sources: [4, 6, 7, 11, 27]
---

# Vehicle physics and tyre model

The ego sedan is a dynamic bicycle model in TypeScript (`updateVehicle`). W is throttle, S is brake until speed is ~0 then reverse, Space is handbrake, A is left (positive steer), D is right.

Asphalt grip is `μ · g`. Lateral tyre force (`tireLateralForce`) pulls sideslip out in tens of milliseconds unless the handbrake is held, so S+A does not crab at 45° ([[pr-6]], [[pr-7]]). W drives along the **nose** (body +X), not the camera ([[pr-11]]). Cosmetic roll/pitch are clamped so the mesh stays on the road ([[pr-4]]).

Full pedal on dry asphalt is ABS-limited around peak μ (~1.0 g) ([[pr-27]]). Brake pressure rises in ~0.12 s. A panic stop from 100 km/h is about 36–40 m; from 50 km/h about 10–12 m. Straight-line braking does not add sideslip. Engine overrun gives a modest coast-down when the throttle is released. At rest the car holds (no creep). GTA reverse still needs S held for a short dwell after stopping; Space still lets the rear slide. Autopilot uses the same pedal (`brakePedalForDecel` / `vehicleInputFromAccel`): comfort ~3 m/s², emergency ~9 m/s². The Stopping Dist HUD uses that ABS peak plus the pressure-rise delay, not a separate constant.

F5/F6 rail and ship integrators were removed; the comment in `vehicle.ts` says city vehicles stay on this bicycle model. See [[decisions]].

## Key files

- `game/src/sim/vehicle.ts`
- `game/src/sim/vehicle.test.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/src/planning/planner.ts`
- `game/src/sim/simulation.ts`
