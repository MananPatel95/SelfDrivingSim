---
tags: [entity]
updated: 2026-10-12
sources: [20]
---

# `rightLane.ts`

Right-hand traffic geometry. Heading θ: right is `(sin θ, −cos θ)`. Eastbound right is −Y; northbound right is +X. `LANE_OFFSET` is 3.5 m (`LANE_INNER` 1.6 … `LANE_OUTER` 5.8).

`rightLaneRoute` builds a Manhattan trip in that lane: right turns cut the near corner; left turns go wide into the far right lane. `beginTrip` uses this instead of centerline `roadRoute` ([[pr-13]], superseded for ego trips by [[pr-20]]).

## Key files

- `game/src/sim/rightLane.ts`
- `game/src/sim/rightLane.test.ts`
