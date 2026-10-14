---
tags: [system]
updated: 2026-10-14
sources: [2, 3]
---

# Lidar and Rust/WASM

Browser lidar is a thinned `simulateLidarScan`. When WASM loads, `cast_rays` in `game/crates/autonomy-sim` traces rays against yaw-aligned AABBs and returns `(t, entity_index)` pairs. Occupancy is a TypeScript agent splat ([[perception-waabi]]). The live F3 HUD does **not** recast lidar (`tickWaabiView`); `cast_rays` stays the Rust kernel and sphere-culls boxes outside `max_range`. Browser scans reuse cached local-frame directions and pooled `dirs`/`boxes` buffers.

`make wasm` runs `wasm-pack` into `game/crates/autonomy-sim/pkg/` (committed so `npm run dev` works without Rust).

Not in Rust: `updateVehicle`, `removeGround`, `createBEVOccupancyFromAgents`. `simHotPath.ts` is unused. See [[decisions]].

## Key files

- `game/crates/autonomy-sim/src/lib.rs`
- `game/src/sim/wasm.ts`
- `game/src/sensors/lidar.ts`
- `game/src/workers/simHotPath.ts`
- `Makefile`
