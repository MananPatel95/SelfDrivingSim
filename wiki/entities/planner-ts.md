---
tags: [entity]
updated: 2026-10-13
sources: [18, 20, 27, 28]
---

# `planner.ts`

Rule-based trajectory + steering. See [[planning]]. `PlannerInput.rule` (from `decideIntersection`) caps desired speed and forces a stop when `mustStop`. Default comfort decel is 3 m/s²; emergency is 9 m/s². `findClosestObstacleAhead` skips buildings, trees, and poles so a corner pole is not a planner hazard ([[pr-28]]).

## Key files

- `game/src/planning/planner.ts`
