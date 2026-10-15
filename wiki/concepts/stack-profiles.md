---
tags: [concept]
updated: 2026-10-15
sources: [3, 37]
---

# Stack profiles

F1 / F2 / F3 are view modes over the same city and the same `Simulation`. They change sensors drawn and the AI View canvas, not the road network. F4–F6 are gone ([[decisions]]). Educational stand-ins of **public** stack descriptions — not the companies’ software. See each perception page for links.

| View | Public stack | What this sim draws |
| --- | --- | --- |
| F1 Tesla | Tesla Vision / Occupancy Network (cameras only) | Eight camera frustums, vision boxes, occupancy voxels. **No lidar.** |
| F2 Waymo | 6th-gen Waymo Driver (13 cam / 4 lidar / 6 radar) + HD map | Spinning lidar sweep, world-anchored points, radar pings, fused boxes, lane dashes |
| F3 Waabi | UnO / DIO occupancy forecast + DeTra-style trajectories | Lidar sweep as input, BEV occupancy now/+1s/+2s/+3s, candidate trajectory fan |

## Key files

- `game/src/stacks/tesla.ts`
- `game/src/stacks/waymo.ts`
- `game/src/stacks/waabi.ts`
- `game/src/ui/viewCopy.ts`
