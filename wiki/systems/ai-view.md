---
tags: [system]
updated: 2026-10-12
sources: [2, 3, 14]
---

# AI View

Top-right insets: a raw forward camera and a stack-specific canvas (`renderAIViewCanvas`). F1 boxes `visionDetections`; F2 uses lidar tracks; F3 draws BEV occupancy.

`computeDecision` writes the green/amber/red banner (cruising / slowing / braking). Tesla camera frustums are the eight-camera ring from [[pr-14]].

G toggles a ground-truth miss overlay. M opens Tesla vs Waymo compare.

## Key files

- `game/src/render/perceptionViz.ts`
- `game/src/main.ts`
- `game/src/ui/viewCopy.ts`
