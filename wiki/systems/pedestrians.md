---
tags: [system]
updated: 2026-10-12
sources: [5, 7, 8]
---

# Pedestrians

`updatePedestrian` binds a sidewalk (offset ~8.8 m from the road axis), walks along it, and at junctions either turns the corner or waits/crosses. They wait if `approachingCrosswalk` sees a closing car.

Bodies face the walk direction ([[pr-7]]). The walk cycle steps **forward** along that heading ([[pr-8]] superseded the moonwalk).

## Key files

- `game/src/sim/world.ts`
- `game/src/sim/cityLife.test.ts`
