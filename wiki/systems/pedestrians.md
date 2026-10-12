---
tags: [system]
updated: 2026-10-12
sources: [5, 7, 8, 20]
---

# Pedestrians

`updatePedestrian` binds a sidewalk (offset ~8.8 m from the road axis), walks along it, and at junctions either turns the corner or waits/crosses. They wait if `approachingCrosswalk` sees a closing car.

Bodies face the walk direction ([[pr-7]]). The walk cycle steps **forward** along that heading ([[pr-8]] superseded the moonwalk).

Cars still yield via `shouldYieldToPedestrian` ([[pr-5]]). [[pr-20]] also stops anyone approaching a junction with a pedestrian inside a 12 m box (`decideIntersection` reason `Yielding to pedestrian`).

## Key files

- `game/src/sim/world.ts`
- `game/src/sim/cityLife.test.ts`
- `game/src/sim/intersectionRules.ts`
