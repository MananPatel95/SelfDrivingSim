---
tags: [system]
updated: 2026-10-12
sources: [4, 11, 17]
---

# Camera system

Modes: chase, hood (first person), BEV, orbit. `C` or the front-camera inset toggles hood. Chase lags the car (`CAMERA_LAG`). Right-mouse drag orbits; scroll zooms chase/orbit. Hood uses `COCKPIT` eye height and a steering wheel that rotates with A/D ([[pr-17]]).

The mesh yaw must match the nose ([[pr-11]], `meshYawForHeading`). An old +4 m orbit offset made wheel-height shots impossible; that is gone ([[pr-4]]).

## Key files

- `game/src/main.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
