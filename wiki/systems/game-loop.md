---
tags: [system]
updated: 2026-10-12
sources: [3, 4]
---

# Game loop and fixed step

`requestAnimationFrame` renders every frame. Simulation uses a fixed timestep.

`SIM_DT` is `1/30`. `simAccumulator` adds real frame time (capped at 0.25 s) and `simulation.step(SIM_DT, humanInput)` runs in a while-loop until the accumulator is below one step. Camera pose is interpolated with `simAccumulator / SIM_DT` so the car does not stutter when the display rate is not 30 Hz.

Pause (`Escape` / gear) skips `step` but still renders. Quality (Low / Med / High) changes pixel ratio, draw distance, lidar density, and shadows.

## Key files

- `game/src/main.ts`
- `game/src/sim/simulation.ts`
