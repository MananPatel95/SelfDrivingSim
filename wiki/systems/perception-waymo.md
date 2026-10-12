---
tags: [system, perception]
updated: 2026-10-12
sources: [2, 3, 20]
---

# Perception F2 — Waymo-style

Lidar clustering + tracking (`runPerception`) fused with radar-like returns (`fuseSensors`). Compare mode shows this stack on the right. Geofence / HD map flags exist on the profile; the live city still uses the same procedural grid as F1.

[[pr-20]] added `stop_sign` / `yield_sign` size priors in `CLASS_SIZE_RANGES` so clustered lidar can label those classes. Tesla HUD still does **not** use these tracks (see [[perception-tesla]]).

## Key files

- `game/src/stacks/waymo.ts`
- `game/src/stacks/perception.ts`
- `game/src/sensors/lidar.ts`
