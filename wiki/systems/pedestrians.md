---
tags: [system]
updated: 2026-10-12
sources: [5, 7, 8, 20]
---

# Pedestrians

`updatePedestrian` binds a sidewalk (offset ~8.8 m from the road axis), walks along it, and at junctions either turns the corner or waits/crosses. They wait if `approachingCrosswalk` sees a closing car.

Bodies face the walk direction ([[pr-7]]). The walk cycle steps **forward** along that heading ([[pr-8]] superseded the moonwalk).

Cars still yield via `shouldYieldToPedestrian` ([[pr-5]]) to anyone **crossing or on the asphalt**, not to sidewalk waiters. `decideIntersection` only stops for a pedestrian inside the ~7.4 m roadway (reason `Yielding to pedestrian`). That **supersedes** the 12 m box from [[pr-20]], which froze junctions because waiters stand at ~8.8 m.

## Key files

- `game/src/sim/world.ts`
- `game/src/sim/cityLife.test.ts`
- `game/src/sim/intersectionRules.ts`
