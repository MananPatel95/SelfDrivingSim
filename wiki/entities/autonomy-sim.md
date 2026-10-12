---
tags: [entity]
updated: 2026-10-12
sources: [2, 3]
---

# autonomy-sim crate

Rust crate compiled with `wasm-pack --target web`. Public API used by the game is `cast_rays`. Bindings in `pkg/` are committed.

The crate file comment still mentions occupancy fill and vehicle kinematics; those exports are not what `wasm.ts` loads. See [[decisions]].

## Key files

- `game/crates/autonomy-sim/src/lib.rs`
- `game/src/sim/wasm.ts`
- `game/src/types/autonomy-sim.d.ts`
