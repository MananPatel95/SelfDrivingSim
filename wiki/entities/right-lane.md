---
tags: [entity]
updated: 2026-10-14
sources: [20, 30, 33]
---

# `rightLane.ts`

Right-hand traffic geometry. Heading θ: right is `(sin θ, −cos θ)`. Eastbound right is −Y; northbound right is +X. `LANE_OFFSET` is 3.5 m (`LANE_INNER` 1.6 … `LANE_OUTER` 5.8). `PULL_OVER_OFFSET` is `ROAD_HALF − CURB_CLEARANCE − SEDAN_HALF_WIDTH` = 5.775 m, so a 1.85 m sedan parks with its right edge at 6.7 m (~0.3 m off the curb face at 7 m). The pink bay is `PAD_ALONG` 8.4 m along-road × `PAD_WIDTH` 2.45 m lateral, centered on the parked pose so the outer edge sits flush on the curb. `appendPullOver` eases laterally then adds a `PULL_OVER_STRAIGHT` (10 m) road-parallel tail.

`rightLaneRoute` builds a Manhattan trip in that lane: right turns cut the near corner; left turns go wide into the far right lane. `resolveTripDestination` puts the pad on the right curb of the arrival heading; a left-of-approach click sets `opposite` and `tripRoute` / `mergeIntoLaneRoute` insert `intersectionUTurn` at `nextIntersectionAhead`. Same-road corners are start→end only — they do not bounce through the next crossing. `mergeIntoLaneRoute` still cruises without a pad when there is no trip goal. Parked-pose checks use `onArrivalAsphalt` (the arrival heading's road only) and `distanceToRightCurb` — not `pointOnAsphalt` / `|x| < 7`, which only match N–S streets.

## Key files

- `game/src/sim/rightLane.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/destination.test.ts`
