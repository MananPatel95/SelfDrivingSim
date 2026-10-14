---
tags: [system]
updated: 2026-10-14
sources: [4, 11, 17, 22, 25, 31]
---

# Camera system

Modes: chase, hood (first person), BEV, orbit. `C` or the front-camera inset toggles hood. Chase lags the car (`CAMERA_LAG`). Right-mouse drag orbits; scroll zooms chase/orbit.

Hood is **locked** to left-seat eye/look anchors on the body pivot (~1.2 m, **88° FOV**, **~11° down**) with no chase lag ([[pr-25]]). A 36 cm wheel sits **0.6 m** ahead, lower-left (~35% from the left); the rim top sits just above the dash line; it turns ~450° with A/D and recentres. A **solid dark dash** fills the frame edge to edge from **~70% down to the bottom** (bevelled top, full-width orange strip); a landscape tablet is **inset to the right of the wheel**. **No A-pillars and no roof header.** The Kenney body (`LAYER_EXTERIOR`) and perception debug rays are hidden. This **supersedes** the staged `?shot=cabin` stills from [[pr-22]] and the earlier [[pr-25]] dash-wall / floating-shelf / framed-cabin passes.

The mesh yaw must match the nose ([[pr-11]], `meshYawForHeading`). An old +4 m orbit offset made wheel-height shots impossible; that is gone ([[pr-4]]).

Demo shots: `?shot=cabin|cabin-a|cabin-d|cabin-wide|exterior|exterior-hood|side|wheel`.

## Key files

- `game/src/main.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/src/sim/egoMesh.ts`
