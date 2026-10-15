---
tags: [entity]
updated: 2026-10-15
sources: [37]
---

# `snapshotLerp.ts`

Pure helpers for display-side interpolation of 10 Hz perception snapshots. Used by `PerceptionVisualizer` and tests. Does not call lidar, occupancy splat, or the planner.

- `snapshotAlpha` — 0 at the last tick, 1 when the next 100 ms tick is due.
- `interpolatePoses` / `lerpAngle` — match tracks/detections by id; yaw takes the short way.
- `lidarSweepAge` / `lidarDecayAlpha` — visible lidar rotation (~0.4 s/rev) and ~0.3 s point decay.
- `boxPopScale` — smoothstep over 0.22 s for new boxes.
- `lerpOccupancy` — per-cell mix of two occupancy grids.

## Key files

- `game/src/render/snapshotLerp.ts`
- `game/src/render/snapshotLerp.test.ts`
- `game/src/render/perceptionViz.ts`
