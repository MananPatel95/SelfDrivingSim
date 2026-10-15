---
tags: [system, perception]
updated: 2026-10-15
sources: [2, 3, 20, 39]
---

# Perception F2 — Waymo-style

Lidar clustering + tracking (`runPerception`) fused with radar-like returns (`fuseSensors`). Compare mode shows this stack on the right. Geofence / HD map flags exist on the profile; the live city still uses the same procedural grid as F1. After [[pr-39]] F2 **routes** on those HD driving lanes (`laneGraphRoute`), not only draws them ([[stack-planning]], [[public-sources]]).

[[pr-20]] added `stop_sign` / `yield_sign` size priors in `CLASS_SIZE_RANGES` so clustered lidar can label those classes. Tesla HUD still does **not** use these tracks (see [[perception-tesla]]).

The 3D overlay is a single preallocated `Points` cloud plus `InstancedMesh` boxes, updated at **10 Hz** with the rest of perception viz. Compare-mode Waymo points/boxes reuse the same buffers. Browser lidar keeps `cast_rays` in WASM and reuses direction/box arrays. Planner input still comes from `Simulation.step` (not this overlay).

## Key files

- `game/src/stacks/waymo.ts`
- `game/src/planning/laneGraph.ts`
- `game/src/stacks/perception.ts`
- `game/src/sensors/lidar.ts`
- `game/src/render/perceptionViz.ts`
