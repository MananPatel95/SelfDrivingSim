---
tags: [entity]
updated: 2026-10-12
sources: [18, 20]
---

# `planner.ts`

Rule-based trajectory + steering. See [[planning]]. `PlannerInput.rule` (from `decideIntersection`) caps desired speed and forces a stop when `mustStop`. Default comfort decel is 3 m/s²; emergency is 9 m/s².

## Key files

- `game/src/planning/planner.ts`
