---
tags: [system]
updated: 2026-10-14
sources: [3, 10, 13, 15, 16, 19, 20, 25, 27, 28, 29, 30]
---

# HUD and menus

Left: speed, stopping distance, control source, detections, collisions, weather, FPS. Stopping Dist is `ego.stoppingDistance` from the sedan ABS model (peak-μ plus the ~0.12 s pressure rise), so it matches a panic stop (~38 m at 100 km/h, ~10 m at 50 km/h) ([[pr-27]]). A counted world collision increments **Collisions**, flashes **COLLISION**, and drops autopilot to **Manual** (`takeover('collision')`). Top-left minimap is ego-up; scroll over it zooms the map ([[pr-15]]); autopilot paints the remaining route purple ([[pr-16]]). A **hot-pink pin** (`#ff2d8a`) marks the roadside trip pad whenever `getTripDestination()` is set, including in manual — distinct from ped dots (`#ff66cc`). After [[pr-20]] the minimap also marks junctions: stop (red square), yield (yellow triangle), uncontrolled (grey dot). Escape / gear opens pause (quality, camera, shadows). The same pink pin stands at the **front-right** of the 3D pad and **hides once parked** so it does not pierce the sedan. On the pad the badge, Control, and banner all read **Arrived**.

Tesla **Detections** counts vision boxes (`hudDetectionCount`), including `stop_sign` / `yield_sign`, matching AI View — not leftover lidar tracks ([[pr-20]]). Other stacks still count lidar tracks.

Parked or driving in manual: the decision banner is **Manual — press T to re-engage**, not “Cruising: lane clear” ([[ai-view]]). The banner is a button: click it (or press **T**) to re-engage Auto from the current pose. A short **Autopilot engaged** flash follows. WASD still takes over on a new key press.

Right-side cards (stack explainer, AI View, info, and on F3 the Waabi BEV + Sim World card) share one width (`min(300px, 100vw − 24px)`) and one right edge, stacked with an 8px gap. Each header has **?**, collapse, and close, and is draggable. **?** opens a popover (no backdrop) with the long uses / unlike / how-to-read copy; it closes on click-outside or Esc and does not swallow WASD. Positions and collapsed state live in `localStorage` (`autonomy-hud-panels`). **P** resets a customised layout, or toggles the column if it is already the default. Floating cards are pushed off the minimap, speed HUD, and centre banner ([[pr-25]]). The view-info card itself is only the stack name, a one-line sensor summary, and the current camera mode.

Start menu ([[pr-13]], [[pr-19]]): click start then end on the city map. The end point is the pink pin. **Just drive** parks with no route. Autopilot still needs both map points to *start*, but T can cruise with no trip after you are in the car.

Query params ([[pr-20]]): `?seed=` (default **3**) and `?demo=lane|left|right|stop|yield|mix|queue|arrive|hit-car|hit-pole|hit-sign|hit-ped` skip the menu for reproducible shots. `arrive` is a mid-block northbound trip onto the pink pad.

## Key files

- `game/src/main.ts`
- `game/index.html`
- `game/src/ui/minimapRoute.ts`
- `game/src/stacks/tesla.ts`
- `game/src/sim/startDrive.test.ts`
- `game/src/ui/hudPanels.ts`
- `game/src/ui/panelHelp.ts`
- `game/src/ui/viewCopy.ts`
- `game/src/ui/hudPanelDom.test.ts`
