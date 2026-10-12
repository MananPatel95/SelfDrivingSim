---
tags: [system]
updated: 2026-10-12
sources: [4, 11, 17, 22]
---

# Camera system

Modes: chase, hood (first person), BEV, orbit. `C` or the front-camera inset toggles hood. Chase lags the car (`CAMERA_LAG`). Right-mouse drag orbits; scroll zooms chase/orbit.

Hood is **locked** to left-seat eye/look anchors on the body pivot (~1.2 m, 70° FOV) with no chase lag ([[pr-tesla-fp]]). A ~36 cm two-spoke wheel sits lower-left (~40% of frame width); top of the rim meets the dash; it turns ~450° with A/D and recentres. Dark dash (road / windshield in the upper ~50%), ambient strip, A-pillars into a roof header, landscape centre tablet. The Kenney body (`LAYER_EXTERIOR`) and perception debug rays are hidden. This **supersedes** the staged `?shot=cabin` stills from [[pr-22]] as a description of the live view.

The mesh yaw must match the nose ([[pr-11]], `meshYawForHeading`). An old +4 m orbit offset made wheel-height shots impossible; that is gone ([[pr-4]]).

Demo shots: `?shot=cabin|cabin-a|cabin-d|cabin-wide|exterior|exterior-hood|side|wheel`.

## Key files

- `game/src/main.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/src/sim/egoMesh.ts`
