---
tags: [entity]
updated: 2026-10-15
sources: [20, 30, 33, 39]
---

# `rightLane.ts`

Right-hand traffic geometry. Heading θ: right is `(sin θ, −cos θ)`. Eastbound right is −Y; northbound right is +X. `LANE_OFFSET` is 3.5 m (`LANE_INNER` 1.6 … `LANE_OUTER` 5.8). `PULL_OVER_OFFSET` is `ROAD_HALF − CURB_CLEARANCE − SEDAN_HALF_WIDTH` = 5.775 m, so a 1.85 m sedan parks with its right edge at 6.7 m (~0.3 m off the curb face at 7 m). The pink bay is `PAD_ALONG` 8.4 m along-road × `PAD_WIDTH` 2.45 m lateral, centered on the parked pose so the outer edge sits flush on the curb. `appendPullOver` eases laterally then adds a `PULL_OVER_STRAIGHT` (10 m) road-parallel tail.

`rightLaneRoute` builds a Manhattan trip in that lane: right turns cut the near corner; left turns go wide into the far right lane. `resolveTripDestination` puts the pad on the right curb of the arrival heading. `opposite` is **same-street only**: `sameGridRoad(start, end)` and a click left of `OPPOSITE_SIDE_LAT` (−1.2 m). Cross-street dests keep the last Manhattan heading (no flip) so a one-corner left is just `rightLaneRoute` + pull-over. `slideOffIntersection(..., keepClickSide)` leaves a cross-street pad on the dest's arm of the box instead of dragging it backward through the corner, and pushes the pad center to `DEST_PAD_ALONG_CLEAR` (`ROAD_HALF` + `PAD_JUNCTION_GAP` 12 m + `PAD_ALONG`/2 = 23.2 m) so the 8.4 m bay sits on the curb lane past poles, stop/yield signs, and painted crosswalks (~9–10 m off the crossing). Same-street clicks still use `DEST_INTERSECTION_CLEAR` 16 m and slide *backward* — a #33 opposite dest at y=78 is not pulled forward. Same-street opposite still inserts `intersectionUTurn` at `nextIntersectionAhead`. `mergeIntoLaneRoute` can take the already-resolved dest so `beginTrip` / re-engage do not re-classify a pad. Tesla and Waabi still build that nav polyline; Waymo walks HD lanes instead (`laneGraphRoute`). `snapTripStart` / `placeTripStart` put a menu or `beginTrip` start in the driving lane, slid `SPAWN_INTERSECTION_CLEAR` (24 m) off any junction. Same-road corners are start→end only — they do not bounce through the next crossing. `mergeIntoLaneRoute` still cruises without a pad when there is no trip goal. Parked-pose checks use `onArrivalAsphalt` (the arrival heading's road only) and `distanceToRightCurb` — not `pointOnAsphalt` / `|x| < 7`, which only match N–S streets.

## Key files

- `game/src/sim/rightLane.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/destination.test.ts`
