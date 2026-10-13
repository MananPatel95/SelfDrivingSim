---
tags: [system]
updated: 2026-10-12
sources: [3, 5, 12, 28]
---

# Collisions

Ego vs world uses 2D OBBs (`boxToOBB`, `firstHit`, `resolveEgoCollision`). A contact id set counts one collision per overlapping object, not one per frame.

Colliders: traffic, pedestrians, buildings, poles, trees, parked cars. **Curbs are paint** ([[pr-12]]): the barrier volumes along mid-block sidewalks are not in the ego hit list, so you can leave and re-enter the asphalt. Trees are on the sidewalk and do stop the car ([[pr-5]]).

`obstacleAhead` (the autopilot hazard brake) skips roadside statics — poles, trees, buildings, signs. A corner pole ~7 m ahead is not an in-lane obstacle. Contact with a pole still collides. The planner already skipped those classes in `findClosestObstacleAhead`; the sim hazard path now matches.

Traffic cars are separated from the ego and each other with `separateEntities`.

## Key files

- `game/src/sim/collision.ts`
- `game/src/sim/collision.test.ts`
- `game/src/sim/simulation.ts`
