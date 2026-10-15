---
tags: [system]
updated: 2026-10-15
sources: [5, 7, 8, 20, 24, 35]
---

# Pedestrians

`updatePedestrian` binds a sidewalk (offset ~8.8 m from the road axis), walks along it, and at junctions either turns the corner or waits/crosses. They wait if `approachingCrosswalk` sees a closing car.

Bodies face the walk direction ([[pr-7]]). The walk cycle steps **forward** along that heading ([[pr-8]] superseded the moonwalk). The mesh’s native forward is local **+Z** (shoes); Three.js yaw is `heading + π/2` (`pedestrianMeshYaw`) so that axis matches `atan2(vy, vx)`. Visual yaw is damped. Idle uses the last walk heading. `pedestrianVisual.test.ts` asserts heading stays within **10°** of velocity while walking.

Cars still yield via `shouldYieldToPedestrian` ([[pr-5]]) to anyone **crossing or on the asphalt**, not to sidewalk waiters. Tumbling pedestrians are ignored by yield. `decideIntersection` only stops for a pedestrian inside the ~7.4 m roadway (reason `Yielding to pedestrian`). That **supersedes** the 12 m box from [[pr-20]], which froze junctions because waiters stand at ~8.8 m.

A car hit calls `knockPedestrian`: the body is thrown along the contact normal, `state` becomes `tumbling`, and the mesh pitches/rolls onto the road with a short limb flail. The hit is appended to `collisionLog` and counted on the HUD.

## Key files

- `game/src/sim/world.ts`
- `game/src/sim/pedestrianVisual.ts`
- `game/src/sim/pedestrianVisual.test.ts`
- `game/src/sim/cityLife.test.ts`
- `game/src/sim/intersectionRules.ts`
