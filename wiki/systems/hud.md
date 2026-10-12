---
tags: [system]
updated: 2026-10-12
sources: [3, 10, 13, 15, 16, 19]
---

# HUD and menus

Left: speed, stopping distance, control source, detections, collisions, weather, FPS. Top-left minimap is ego-up; scroll over it zooms the map ([[pr-15]]); autopilot paints the remaining route purple ([[pr-16]]). Escape / gear opens pause (quality, camera, shadows).

Start menu ([[pr-13]], [[pr-19]]): click start then end on the city map. **Just drive** parks with no route. Autopilot stays disabled until both points exist. T / Take over hands the wheel without moving the car.

## Key files

- `game/src/main.ts`
- `game/index.html`
- `game/src/ui/minimapRoute.ts`
- `game/src/sim/startDrive.test.ts`
