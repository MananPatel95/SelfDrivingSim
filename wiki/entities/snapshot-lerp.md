---
tags: [entity]
updated: 2026-10-15
sources: [37]
---

# `snapshotLerp.ts`

Pure helpers for display-side interpolation of 10 Hz perception snapshots. Used by `PerceptionVisualizer` and tests. Does not call lidar, occupancy splat, or the planner.

- `snapshotAlpha` — 0 at the last tick, 1 when the next 100 ms tick is due.
- `interpolatePoses` / `lerpAngle` — match tracks/detections by id; yaw takes the short way.
- `lidarSweepAge` / `lidarDecayAlpha` / `lidarSweepCrossed` — visible lidar rotation (1 rev/s) and ~0.28 s exponential decay (shader drops points after ~1.05× that). Hits bake into world only when the beam crosses their azimuth.
- `lidarLocalToWorldThree` / `lidarAzimuthFromWorldThree` — ego-local scan hits → world Three.js coords at the *live* ego pose when the beam passes, then they stay on the road.
- `boxPopScale` — smoothstep over 0.22 s for new boxes.
- `lerpOccupancy` — per-cell mix of two occupancy grids.

## Key files

- `game/src/render/snapshotLerp.ts`
- `game/src/render/snapshotLerp.test.ts`
- `game/src/render/perceptionViz.ts`
