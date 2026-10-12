---
tags: [system]
updated: 2026-10-12
sources: [3, 4, 26]
---

# Game loop and fixed step

`requestAnimationFrame` renders every frame. Simulation uses a fixed timestep.

`SIM_DT` is `1/30`. `simAccumulator` adds real frame time (capped at 0.25 s) and `simulation.step(SIM_DT, humanInput)` runs in a while-loop until the accumulator is below one step. Camera pose is interpolated with `simAccumulator / SIM_DT` so the car does not stutter when the display rate is not 30 Hz.

Pause (`Escape` / gear) skips `step` but still renders. Quality (Low / Med / High) changes pixel ratio, draw distance, lidar density, and shadows. F3 occupancy prediction is a separate 10 Hz tick inside [[bev-overlay]], not the 30 Hz physics step.

## Key files

- `game/src/main.ts`
- `game/src/sim/simulation.ts`
