---
tags: [entity]
updated: 2026-10-12
sources: [20]
---

# `trafficFlow.ts`

Grid random-walk for AI traffic. Nodes are the city intersections. At each node `pickRandomExit` chooses a legal left / straight / right (weighted; U-turn only at a dead end). Paths are right-hand-lane polylines from `rightLaneRoute`.

`spawnGraphTraffic` / `updateTrafficVehicle` (when a car has `path`) follow that polyline forward only. Stuck cars are nudged, replanned, or respawned off-screen from `simulation.ts`.

## Key files

- `game/src/sim/trafficFlow.ts`
- `game/src/sim/trafficFlow.test.ts`
- `game/src/sim/world.ts`
