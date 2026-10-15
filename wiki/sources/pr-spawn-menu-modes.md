---
tags: [source]
updated: 2026-10-15
sources: []
---

# PR (draft) — Lane spawn, stop-sign recovery, A→B / Random menu

## What changed

Default and menu starts snap with `snapTripStart` / `placeTripStart` onto the right-hand driving lane (`LANE_OFFSET` 3.5 m), at least `SPAWN_INTERSECTION_CLEAR` (24 m) from a grid crossing. `beginTrip` places the car there and builds `mergeIntoLaneRoute` to the #33 pad (`resolveTripDestination`). The car no longer spawns on the sidewalk next to a stop sign.

Autopilot recovery (`recovery.ts`): if the ego is off its lane or path, or held at a clear stop longer than `STOP_STUCK_RECOVER` (2.4 s), it brakes, GTA-reverses, then `reengageAutopilot()` so the next approach can full-stop and leave. NPC stop/yield rules are unchanged.

Start / arrived overlay modes: **A → B** (first click = green-pin lane start, second = pink pad; third click or **Reset** clears) and **Random** (both ends, **Reroll**). Start / Continue stays disabled until both points are set. Arrived A→B defaults the start to the parked pose (changeable via Reset).

Planner / `updateVehicle` / `removeGround` / `createBEVOccupancyFromAgents` / WASM `cast_rays` were not replaced. City look / textures / buildings / grass / pedestrians were not edited.

## Why

Launch spawn sat at `(laneWidth, −22)` facing the origin stop, so the sedan started half on the curb and could sit on **Stopping: stop sign** forever (`maybeReplanStuck` ignored `mustStop`). The menu only set a dest from a fixed start.

## Pages touched

hud, planning, traffic-rules, simulation-ts, right-lane, testing, overview, decisions

## Claims superseded

Supersedes the “dest-only” start overlay from [[pr-31]] (current pose was always the start). Supersedes world spawn at `y = −22` next to the origin junction.

## Key files

- `game/src/sim/recovery.ts`
- `game/src/sim/recovery.test.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/world.ts`
- `game/src/ui/startMenu.ts`
- `game/src/ui/startMenu.test.ts`
- `game/src/main.ts`
- `game/index.html`
