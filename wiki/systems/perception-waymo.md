---
tags: [system, perception]
updated: 2026-10-12
sources: [2, 3]
---

# Perception F2 — Waymo-style

Lidar clustering + tracking (`runPerception`) fused with radar-like returns (`fuseSensors`). Compare mode shows this stack on the right. Geofence / HD map flags exist on the profile; the live city still uses the same procedural grid as F1.

## Key files

- `game/src/stacks/waymo.ts`
- `game/src/stacks/perception.ts`
- `game/src/sensors/lidar.ts`
