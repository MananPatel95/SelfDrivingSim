---
tags: [concept]
updated: 2026-10-15
sources: [3, 39]
---

# Stack profiles

F1 / F2 / F3 share the city and one `Simulation`, but they are **not** HUD-only after [[pr-39]]. Each view has its own live planner (vision+nav / HD lane graph / occupancy forecast). They still share `resolveTripDestination`. Sensors drawn and the AI View canvas also change. F4–F6 are gone ([[decisions]]). Public-vs-approx notes: [[public-sources]], [[stack-planning]].

## Key files

- `game/src/stacks/tesla.ts`
- `game/src/stacks/waymo.ts`
- `game/src/stacks/waabi.ts`
- `game/src/planning/stackPlan.ts`
- `game/src/ui/viewCopy.ts`
