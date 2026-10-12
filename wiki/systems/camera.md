---
tags: [system]
updated: 2026-10-12
sources: [4, 11, 17, 22]
---

# Camera system

Modes: chase, hood (first person), BEV, orbit. `C` or the front-camera inset toggles hood. Chase lags the car (`CAMERA_LAG`). Right-mouse drag orbits; scroll zooms chase/orbit.

Hood is a left-of-frame seat at ~1.2 m (`COCKPIT` in [[ego-mesh]]). A 36 cm wheel sits in the lower third and turns ~450° with A/D, then recentres ([[pr-17]], [[pr-22]]). Full-width dash covering the bottom ~28%, hood/cowl sliver, A-pillars into a roof header, landscape centre tablet; no roof tint. The Kenney body is hidden in first person (`LAYER_EXTERIOR` off).

The mesh yaw must match the nose ([[pr-11]], `meshYawForHeading`). An old +4 m orbit offset made wheel-height shots impossible; that is gone ([[pr-4]]).

Demo shots: `?shot=cabin|cabin-a|cabin-d|cabin-wide|exterior|exterior-hood|side|wheel`.

## Key files

- `game/src/main.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/src/sim/egoMesh.ts`
