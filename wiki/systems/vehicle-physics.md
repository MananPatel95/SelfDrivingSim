---
tags: [system, physics]
updated: 2026-10-12
sources: [4, 6, 7, 11]
---

# Vehicle physics and tyre model

The ego sedan is a dynamic bicycle model in TypeScript (`updateVehicle`). W is throttle, S is brake until speed is ~0 then reverse, Space is handbrake, A is left (positive steer), D is right.

Asphalt grip is `μ · g`. Lateral tyre force (`tireLateralForce`) pulls sideslip out in tens of milliseconds unless the handbrake is held, so S+A does not crab at 45° ([[pr-6]], [[pr-7]]). W drives along the **nose** (body +X), not the camera ([[pr-11]]). Cosmetic roll/pitch are clamped so the mesh stays on the road ([[pr-4]]).

F5/F6 rail and ship integrators were removed; the comment in `vehicle.ts` says city vehicles stay on this bicycle model. See [[decisions]].

## Key files

- `game/src/sim/vehicle.ts`
- `game/src/sim/vehicle.test.ts`
- `game/src/sim/vehicleVisual.ts`
