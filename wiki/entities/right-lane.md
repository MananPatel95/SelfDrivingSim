---
tags: [entity]
updated: 2026-10-13
sources: [20]
---

# `rightLane.ts`

Right-hand traffic geometry. Heading θ: right is `(sin θ, −cos θ)`. Eastbound right is −Y; northbound right is +X. `LANE_OFFSET` is 3.5 m (`LANE_INNER` 1.6 … `LANE_OUTER` 5.8). `PULL_OVER_OFFSET` is 5.8 m (right of the driving lane, still on the 14 m asphalt).

`rightLaneRoute` builds a Manhattan trip in that lane: right turns cut the near corner; left turns go wide into the far right lane. `tripRoute` / `beginTrip` append a pull-over onto `roadsideDestination` (slid off junctions). Same-road corners are start→end only — they do not bounce through the next crossing. `mergeIntoLaneRoute` still cruises without a pad when there is no trip goal.

## Key files

- `game/src/sim/rightLane.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/destination.test.ts`
