---
tags: [entity]
updated: 2026-10-12
sources: [4, 6, 7]
---

# `vehicle.ts`

Bicycle model, tyre lateral force, gears, reverse gate. `applyCollisionMotion` writes post-impulse world velocity and yaw rate without replacing `updateVehicle`. See [[vehicle-physics]].

## Key files

- `game/src/sim/vehicle.ts`
