---
tags: [entity]
updated: 2026-10-14
sources: [20, 30, 33]
---

# `rightLane.ts`

Right-hand traffic geometry. Heading θ: right is `(sin θ, −cos θ)`. Eastbound right is −Y; northbound right is +X. `LANE_OFFSET` is 3.5 m (`LANE_INNER` 1.6 … `LANE_OUTER` 5.8). `PULL_OVER_OFFSET` is 5.4 m so a 1.85 m sedan parks with its right edge ~6.3 m, inside the curb at 7 m. `appendPullOver` eases laterally then adds a `PULL_OVER_STRAIGHT` (10 m) road-parallel tail.

`rightLaneRoute` builds a Manhattan trip in that lane: right turns cut the near corner; left turns go wide into the far right lane. `resolveTripDestination` puts the pad on the right curb of the arrival heading; a left-of-approach click sets `opposite` and `tripRoute` / `mergeIntoLaneRoute` insert `intersectionUTurn` at `nextIntersectionAhead`. Same-road corners are start→end only — they do not bounce through the next crossing. `mergeIntoLaneRoute` still cruises without a pad when there is no trip goal. `sedanCorners` / `pointOnAsphalt` are the parked-pose overlap checks.

## Key files

- `game/src/sim/rightLane.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/destination.test.ts`
