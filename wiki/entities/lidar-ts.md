---
tags: [entity]
updated: 2026-10-14
sources: [2, 3]
---

# `lidar.ts`

Configures beam patterns (`LIDAR_CONFIGS`) and `simulateLidarScan`. Browser uses a lite config every N frames; headless uses a denser roof lidar. Cached local-frame directions and pooled WASM `dirs`/`boxes` buffers avoid per-scan allocation.

## Key files

- `game/src/sensors/lidar.ts`
- `game/src/sim/wasm.ts`
