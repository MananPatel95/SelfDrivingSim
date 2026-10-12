---
tags: [system]
updated: 2026-10-12
sources: [3, 10, 13, 15, 16, 19, 20, 27]
---

# HUD and menus

Left: speed, stopping distance, control source, detections, collisions, weather, FPS. Stopping Dist is `ego.stoppingDistance` from the sedan ABS model (peak-μ plus the ~0.12 s pressure rise), so it matches a panic stop (~38 m at 100 km/h, ~10 m at 50 km/h) ([[pr-27]]). Top-left minimap is ego-up; scroll over it zooms the map ([[pr-15]]); autopilot paints the remaining route purple ([[pr-16]]). After [[pr-20]] the minimap also marks junctions: stop (red square), yield (yellow triangle), uncontrolled (grey dot). Escape / gear opens pause (quality, camera, shadows).

Tesla **Detections** counts vision boxes (`hudDetectionCount`), including `stop_sign` / `yield_sign`, matching AI View — not leftover lidar tracks ([[pr-20]]). Other stacks still count lidar tracks.

Parked or driving in manual: the decision banner is **Manual**, not “Cruising: lane clear” ([[ai-view]]).

Start menu ([[pr-13]], [[pr-19]]): click start then end on the city map. **Just drive** parks with no route. Autopilot stays disabled until both points exist. T / Take over hands the wheel without moving the car.

Query params ([[pr-20]]): `?seed=` (default **3**) and `?demo=lane|stop|yield|mix|queue` skip the menu for reproducible shots.

## Key files

- `game/src/main.ts`
- `game/index.html`
- `game/src/ui/minimapRoute.ts`
- `game/src/stacks/tesla.ts`
- `game/src/sim/startDrive.test.ts`
