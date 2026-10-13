---
tags: [entity]
updated: 2026-10-13
sources: [4, 6, 7, 27, 29]
---

# `vehicle.ts`

Bicycle model, tyre lateral force, gears, reverse gate, ABS-limited service brake. `brakePedalForDecel` / `vehicleInputFromAccel` map planner accel onto the same pedal. `applyCollisionMotion` writes post-impulse world velocity and yaw rate without replacing `updateVehicle`. See [[vehicle-physics]].

## Key files

- `game/src/sim/vehicle.ts`
