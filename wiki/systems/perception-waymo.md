---
tags: [system, perception]
updated: 2026-10-15
sources: [2, 3, 20, 34, 37]
---

# Perception F2 — Waymo-style

Lidar clustering + tracking (`runPerception`) fused with radar-like returns (`fuseSensors`). Compare mode shows this stack on the right. Geofence / HD map flags exist on the profile; the live city still uses the same procedural grid as F1.

[[pr-20]] added `stop_sign` / `yield_sign` size priors in `CLASS_SIZE_RANGES` so clustered lidar can label those classes. Tesla HUD still does **not** use these tracks (see [[perception-tesla]]).

The 3D overlay is a single preallocated `Points` cloud plus `InstancedMesh` boxes. Perception and buffer uploads stay at **10 Hz** ([[pr-34]]). Browser lidar keeps `cast_rays` in WASM, a **fixed beam** (no per-frame jitter), and reused direction/box arrays. Planner input still comes from `Simulation.step` (not this overlay).

[[pr-37]] animates the display between ticks: a visible spinning lidar sweep, **world-anchored** points that appear as the beam passes and decay over ~0.3 s (they stay on the road as the car moves), expanding radar pings, fused boxes with velocity arrows and short motion trails, and HD-map lane dashes flowing ahead. Sweep/decay is a shader uniform, not a new lidar cast.

## Public sources (educational stand-in)

This view is **not** the Waymo Driver. It follows public 6th-gen + mapping write-ups:

- Sensors: **13 cameras, 4 lidars, 6 radars**, overlapping 360° out to ~500 m ([Waymo, Aug 2024](https://waymo.com/blog/2024/08/meet-the-6th-generation-waymo-driver); [fully autonomous 6th-gen ops, 2026](https://www.waymo.com/blog/2026/02/ro-on-6th-gen-waymo-driver/)). Imaging radar tracks range/velocity in rain and night.
- HD maps: custom prior of lanes, signs, signals, curbs, crosswalks, used with live sensors for localization ([Waymo Driver Handbook: mapping, 2020](https://waymo.com/blog/2020/09/the-waymo-driver-handbook-mapping)).
- The sim draws one roof lidar sweep + radar rings + camera context + fused boxes on procedural lanes — a readable stand-in, not 13+4+6 sensors.

## Key files

- `game/src/stacks/waymo.ts`
- `game/src/stacks/perception.ts`
- `game/src/sensors/lidar.ts`
- `game/src/render/perceptionViz.ts`
- `game/src/render/snapshotLerp.ts`
- `game/src/render/perceptionShaders.ts`
