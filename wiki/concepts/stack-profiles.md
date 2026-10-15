---
tags: [concept]
updated: 2026-10-15
sources: [3, 37, 39]
---

# Stack profiles

F1 / F2 / F3 share the city and one `Simulation`, but they are **not** HUD-only after [[pr-39]]. Each view has its own live planner (vision+nav / HD lane graph / occupancy forecast). They still share `resolveTripDestination`. Sensors drawn and the AI View canvas also change. F4–F6 are gone ([[decisions]]). Educational stand-ins of **public** stack descriptions — not the companies’ software. Public-vs-approx notes: [[public-sources]], [[stack-planning]].

| View | Public stack | What this sim draws |
| --- | --- | --- |
| F1 Tesla | Tesla Vision / Occupancy Network (cameras only) | Eight camera frustums, vision boxes, occupancy voxels. **No lidar.** Live planner: camera-FOV detections + nav polyline. |
| F2 Waymo | 6th-gen Waymo Driver (13 cam / 4 lidar / 6 radar) + HD map | Spinning lidar sweep, beam-gated world points, radar pings, fused boxes, lane dashes. Live planner: HD lane-graph route. |
| F3 Waabi | UnO / DIO occupancy forecast + DeTra-style trajectories | Same lidar sweep as input, BEV occupancy now/+1s/+2s/+3s, candidate trajectory fan. Live planner: occupancy-forecast scoring. |

## Key files

- `game/src/stacks/tesla.ts`
- `game/src/stacks/waymo.ts`
- `game/src/stacks/waabi.ts`
- `game/src/planning/stackPlan.ts`
- `game/src/ui/viewCopy.ts`
