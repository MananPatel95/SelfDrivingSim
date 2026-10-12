---
tags: [system, perception]
updated: 2026-10-12
sources: [2, 3, 14, 20]
---

# Perception F1 — Tesla-style

Cameras only. `detectVisibleAgents` keeps agents that fall in one of **eight** camera FOVs (forward, corners, sides, rear) after [[pr-14]]. Heavily occluded pedestrians are weaker, not dropped.

After [[pr-20]] the same FOV test also boxes nearby `stop_sign` and `yield_sign` entities. AI View draws those vision boxes (red / yellow class colours). The HUD detection count on Tesla must match that list (`hudDetectionCount`), not lidar tracks ([[ai-view]]).

There is no HD map and no radar on this stack.

## Key files

- `game/src/stacks/tesla.ts`
- `game/src/stacks/tesla.test.ts`
- `game/src/render/perceptionViz.ts`
