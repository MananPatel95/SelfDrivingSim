---
tags: [system]
updated: 2026-10-12
sources: [4, 11, 17, 22, 25]
---

# Camera system

Modes: chase, hood (first person), BEV, orbit. `C` or the front-camera inset toggles hood. Chase lags the car (`CAMERA_LAG`). Right-mouse drag orbits; scroll zooms chase/orbit.

Hood is **locked** to left-seat eye/look anchors on the body pivot (~1.2 m, 70° FOV, **~7° down**) with no chase lag ([[pr-25]]). A 36 cm wheel sits **0.6 m** ahead, lower-left (~35% from the left); the full rim is visible between the dash line and the bottom edge; it turns ~450° with A/D and recentres. Thin dash shelf (top ~55% down the frame so the road fills the windshield), ambient strip, slim A-pillars, thin roof header, landscape tablet on the dash. The Kenney body (`LAYER_EXTERIOR`) and perception debug rays are hidden. This **supersedes** the staged `?shot=cabin` stills from [[pr-22]] and the first [[pr-25]] dash-wall / giant-hub pass.

The mesh yaw must match the nose ([[pr-11]], `meshYawForHeading`). An old +4 m orbit offset made wheel-height shots impossible; that is gone ([[pr-4]]).

Demo shots: `?shot=cabin|cabin-a|cabin-d|cabin-wide|exterior|exterior-hood|side|wheel`.

## Key files

- `game/src/main.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/src/sim/egoMesh.ts`
