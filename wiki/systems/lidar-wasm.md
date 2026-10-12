---
tags: [system]
updated: 2026-10-12
sources: [2, 3]
---

# Lidar and Rust/WASM

Browser lidar is a thinned `simulateLidarScan`. When WASM loads, `cast_rays` in `game/crates/autonomy-sim` traces rays against yaw-aligned AABBs and returns `(t, entity_index)` pairs. The F3 overlay does **not** recast rays; occupancy is agent-splat in TypeScript ([[perception-waabi]]).

`make wasm` runs `wasm-pack` into `game/crates/autonomy-sim/pkg/` (committed so `npm run dev` works without Rust).

Not in Rust: `updateVehicle`, `removeGround`, `createBEVOccupancyFromAgents`. `simHotPath.ts` is unused. See [[decisions]].

## Key files

- `game/crates/autonomy-sim/src/lib.rs`
- `game/src/sim/wasm.ts`
- `game/src/sensors/lidar.ts`
- `game/src/workers/simHotPath.ts`
- `Makefile`
