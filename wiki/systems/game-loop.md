---
tags: [system]
updated: 2026-10-14
sources: [3, 4]
---

# Game loop and fixed step

`requestAnimationFrame` renders every frame. Simulation uses a fixed timestep.

`SIM_DT` is `1/30`. `simAccumulator` adds real frame time (capped at 0.25 s) and `simulation.step(SIM_DT, humanInput)` runs in a while-loop until the accumulator is below one step. Camera pose is interpolated with `simAccumulator / SIM_DT` so the car does not stutter when the display rate is not 30 Hz.

Perception visualisation (AI View, F3 BEV overlay, detection boxes) is throttled to **10 Hz** (`PERCEPTION_PERIOD_MS = 100`) and does not feed the planner. Pause (`Escape` / gear) skips `step` but still renders. Quality (Low / Med / High) changes pixel ratio, draw distance, and lidar density. **Look High** turns on tight-frustum PCF shadows plus half-res bloom/LUT ([[city-look]]). Pixel ratio is capped at 1.5.

## Key files

- `game/src/main.ts`
- `game/src/sim/simulation.ts`
- `game/src/render/bevOverlay.ts`
