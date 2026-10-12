---
tags: [system]
updated: 2026-10-12
sources: [2, 3, 14, 20]
---

# AI View

Top-right insets: a raw forward camera and a stack-specific canvas (`renderAIViewCanvas`). F1 boxes `visionDetections` (cars, peds, and after [[pr-20]] `stop_sign` / `yield_sign`); F2 uses lidar tracks; F3 draws BEV occupancy via `writeOccupancyRgbaAiView` (one `putImageData`, not per-cell `fillRect`). The F3 BEV HUD lives in [[bev-overlay]] and is independent of this inset.

`computeDecision` writes the green/amber/red banner. If `controlSource === 'human'` the text is **Manual** (including parked) — this **supersedes** showing “Cruising: lane clear” while idle in manual. Otherwise a non-go `rule` from `decideIntersection` wins (stop / yield copy), then TTC / planner accel, then cruising.

Tesla camera frustums are the eight-camera ring from [[pr-14]]. HUD Detections on Tesla equals the vision-box count ([[perception-tesla]]).

G toggles a ground-truth miss overlay. M opens Tesla vs Waymo compare.

## Key files

- `game/src/render/perceptionViz.ts`
- `game/src/render/occupancyPaint.ts`
- `game/src/render/bevOverlay.ts`
- `game/src/main.ts`
- `game/src/ui/viewCopy.ts`
- `game/src/stacks/tesla.ts`
