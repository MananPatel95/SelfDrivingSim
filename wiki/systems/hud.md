---
tags: [system]
updated: 2026-10-14
sources: [3, 10, 13, 15, 16, 19, 20, 25, 27, 28, 29, 30, 31, 33]
---

# HUD and menus

Left: speed, stopping distance, control source, detections, collisions, weather, FPS. Stopping Dist is `ego.stoppingDistance` from the sedan ABS model (peak-μ plus the ~0.12 s pressure rise), so it matches a panic stop (~38 m at 100 km/h, ~10 m at 50 km/h) ([[pr-27]]). A counted world collision increments **Collisions**, flashes **COLLISION**, and drops autopilot to **Manual** (`takeover('collision')`). Top-left minimap is ego-up; scroll over it zooms the map ([[pr-15]]); autopilot paints the remaining route purple ([[pr-16]]). A **hot-pink pin** (`#ff2d8a`) marks the roadside trip pad whenever `getTripDestination()` is set, including in manual — distinct from ped dots (`#ff66cc`). After [[pr-20]] the minimap also marks junctions: stop (red square), yield (yellow triangle), uncontrolled (grey dot). Escape / gear opens pause (quality, camera, shadows). The same pink pin stands at the **front-right** of the 3D pad and **hides once parked** so it does not pierce the sedan. On the pad the badge, Control, and banner all read **Arrived**.

Tesla **Detections** counts vision boxes (`hudDetectionCount`), including `stop_sign` / `yield_sign`, matching AI View — not leftover lidar tracks ([[pr-20]]). Other stacks still count lidar tracks.

Parked or driving in manual: the decision banner is **Manual — press T to re-engage**, not “Cruising: lane clear” ([[ai-view]]). The banner is a button: click it (or press **T**) to re-engage Auto from the current pose. A short **Autopilot engaged** flash follows. WASD still takes over on a new key press.

Right-side cards (stack explainer, AI View, info) are one column: each has collapse and close, and is draggable by its header. Positions and collapsed state live in `localStorage` (`autonomy-hud-panels`). **P** resets a customised layout, or toggles the column if it is already the default. Floating cards are pushed off the minimap, speed HUD, and centre banner ([[pr-25]]).

Start / arrived menu: a glass overlay over a slowly orbiting city. Title is **AUTONOMY CITY: How Machines See**. The car’s current pose is the start (white triangle). Click the north-up city map (minimap colours, larger) or **Random destination** to set a pink curb pad via `snapTripEnd` + `resolveTripDestination` ([[pr-33]]): the pad sits on the arrival-side right curb; a left-of-approach click is an opposite-side dest (legal U-turn). F1 / F2 / F3 cards pick the stack; Chase / First person pick the camera. **Start** / Enter begins an autopilot `beginTrip`. **Just drive** still parks with no route. The sim does not step while the overlay is open. Esc on the first-launch menu does nothing; Esc on the arrived variant dismisses it; Esc while driving still opens the pause menu. After `hasArrived()` the same overlay returns as **Arrived — choose next destination** with the parked pose as the new start; Continue / Start calls `beginTrip` again without reloading. `?demo=` / `?shot=` skip the overlay and do not reopen it on arrival. Overlay cards use the same HUD glass (`#2a5a72` / `#7fd7ff`) as the right-side panels.

This **supersedes** the two-click start-then-end map from [[pr-13]] / [[pr-19]] for the live overlay. Autopilot still needs a destination to *start* from the menu; T can cruise with no trip after you are in the car.

Query params ([[pr-20]]): `?seed=` (default **3**) and `?demo=lane|left|right|stop|yield|mix|queue|arrive|arrive-opp|hit-car|hit-pole|hit-sign|hit-ped` skip the menu for reproducible shots. `arrive` is a mid-block northbound trip onto the pink pad; `arrive-opp` is a left-curb dest that U-turns at the next junction.

## Key files

- `game/src/main.ts`
- `game/index.html`
- `game/src/ui/startMenu.ts`
- `game/src/ui/minimapRoute.ts`
- `game/src/stacks/tesla.ts`
- `game/src/sim/startDrive.test.ts`
- `game/src/ui/startMenu.test.ts`
- `game/src/ui/hudPanels.ts`
