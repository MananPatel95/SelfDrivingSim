---
tags: [system]
updated: 2026-10-15
sources: [2, 3, 14, 20, 25, 28, 32, 33]
---

# AI View

Top-right insets sit in the shared 300px HUD column ([[hud]]). A raw forward camera and a stack-specific canvas (`renderAIViewCanvas`). F1 boxes `visionDetections` (cars, peds, and after [[pr-20]] `stop_sign` / `yield_sign`); F2 uses lidar tracks; F3 draws BEV occupancy on a 2D canvas. The F3 BEV HUD is painted in `renderBEVHeatmaps` (`main.ts`) inside the same-width Waabi BEV + Sim World card. The **?** on AI View / BEV explains box colours, +1s/+2s/+3s heat, Sim World variants, and TTC.

`computeDecision` writes the green/amber/red banner. If `controlSource === 'human'` the text is **Manual — press T to re-engage** (including parked) — this **supersedes** the shorter “Manual” copy. Otherwise a non-go `rule` from `decideIntersection` wins (stop / yield copy), then TTC / planner accel, then cruising. Roadside poles, trees, and buildings are ignored for the Slowing banner so a corner pole does not look like an in-path obstacle. The 3D overlay group is hidden in first person so debug rays do not pass through the cabin ([[pr-25]]). World-space confidence sprites (`car #id 28%`) stay **off** so a near-camera label cannot paint a huge green `%` over the HUD; boxes and `%` stay on the AI View canvas.

Tesla camera frustums are the eight-camera ring from [[pr-14]]. HUD Detections on Tesla equals the vision-box count ([[perception-tesla]]).

G toggles a ground-truth miss overlay. M opens Tesla vs Waymo compare.

## Key files

- `game/src/render/perceptionViz.ts`
- `game/src/main.ts`
- `game/src/ui/viewCopy.ts`
- `game/src/ui/panelHelp.ts`
- `game/src/stacks/tesla.ts`
