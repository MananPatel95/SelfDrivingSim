---
tags: [system, perception]
updated: 2026-10-12
sources: [2, 3, 14]
---

# Perception F1 — Tesla-style

Cameras only. `detectVisibleAgents` keeps agents that fall in one of **eight** camera FOVs (forward, corners, sides, rear) after [[pr-14]]. Heavily occluded pedestrians are weaker, not dropped.

AI View for F1 draws vision boxes and camera-derived voxels, not lidar tracks. The HUD detection count on Tesla should match those vision boxes (see [[ai-view]]).

There is no HD map and no radar on this stack.

## Key files

- `game/src/stacks/tesla.ts`
- `game/src/stacks/tesla.test.ts`
- `game/src/render/perceptionViz.ts`
