---
tags: [system]
updated: 2026-10-12
sources: [3, 5]
---

# Traffic rules and intersections

On `main` (through PR #19) intersections are **traffic lights** on a 30 s NS/EW cycle (`updateTrafficLights`). NPC cars stop for a non-green light within ~15 m and follow IDM on their lane.

Cars (ego and traffic) also **yield to pedestrians** in or waiting at the crossing (`shouldYieldToPedestrian`). There is no seeded stop/yield/uncontrolled mix and no 3D stop/yield signs on this branch.

## Key files

- `game/src/sim/world.ts`
- `game/src/sim/simulation.ts`
