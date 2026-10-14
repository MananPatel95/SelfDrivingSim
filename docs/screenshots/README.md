# AUTONOMY CITY Screenshots

Screenshots demonstrating the key features of AUTONOMY CITY.

## Core Features

### 01-city-view.png
Default city view with blue ego vehicle, buildings, roads, and traffic.

### 02-gt-overlay.png
Ground truth overlay (G key) showing detection boxes:
- Green = matched detections
- Red = false negatives
- Orange = false positives

### 02-waabi-bev.png
Waabi-style BEV overlay (F3) showing:
- Occupancy heatmaps (current, +1s, +2s, +3s)
- Sim World variant table (20+ variants with pass/fail)

### 04-compare-mode.png
Compare mode (M key) split-screen:
- Left: Tesla-style voxels with depth jitter
- Right: Waymo-style point cloud + fused boxes
- Detection timing differences shown

### 09-escape-menu.png
Escape / gear pause menu: Resume, Restart, Quality, Perception, Shadow Mode, camera mode, controls.

### 10-manual-drive.png
MANUAL badge after WASD / T takeover.

### 11-collision.png
Ego stopped against an NPC with COLLISION flash (no interpenetration).

### 24-hit-car.png
Impulse car-to-car: both cars separated, traffic car shoved/spun, HUD collisions ≥ 1, Manual after autopilot drop. `?demo=hit-car`.

### 25-hit-pole.png
Fast pole snap: pole lying on the ground, ego slowed, no pass-through. `?demo=hit-pole`.

### 26-hit-sign.png
Fast stop-sign fall, ego slowed, HUD collision counted. `?demo=hit-sign`.

### 27-hit-ped.png
Pedestrian knocked into a tumble, hit logged. `?demo=hit-ped`.

## First-person cockpit (live driving)

Live hood-camera stills (not `?shot=cabin` rigs). Compare with a real Model 3/Y interior.

### fp_straight.png
First person while driving straight: locked eye point, Kenney body hidden, open windshield (no A-pillars or header), solid full-width dash filling the lower ~30% of the frame, two-spoke wheel, tablet inset to the right of the wheel.

### fp_steer_left.png
Full left lock (~450°) while driving.

### fp_steer_right.png
Full right lock while driving.

### fp_intersection_50.png
First person at about 50 km/h at an intersection.

### compare_fp_straight.png / compare_fp_steer_left.png / compare_fp_steer_right.png / compare_fp_intersection_50.png
Side-by-side of the Tesla Model 3/Y reference (left) and the live hood shot (right).

### hud_panels_open.png
Right-side column with explainer, AI View, and info all open — no overlap.

### hud_panels_collapsed.png
One card collapsed in the column.

### hud_panels_dragged.png
One card dragged off the stack, still clear of the minimap / speed HUD / banner.

### autopilot_engaged.png
Centre banner after T / banner click re-engages Auto.

## Environment Effects

### 07-night-fog.png
Night mode with fog showing degraded visibility.

### 08-dashboard.png
Status HUD with speed, control, detections, collisions, and FPS.

## Right-hand traffic and intersections

### 16-right-lane-straight.png
Chase/orbit on a straight: ego stays in the right-hand lane under autopilot.

### 17-stop-sign-banner.png
Full stop at an all-way stop. Red stop sign, `stop_sign` label, banner "Stopping: stop sign".

### 18-yield-intersection.png
Yield approach with a `yield_sign` on the right of the minor road.

### 19-minimap-intersection-mix.png
Minimap marks stop (red), yield (yellow), and uncontrolled (grey) junctions.

### 20-traffic-queued-at-stop.png
Several AI traffic cars stopped at an all-way stop, not colliding.

## Traffic random walk (PR #24)

### 21-traffic-flow-intersection.png
F2 Waymo BEV after `?seed=3&demo=mix`. Minimap shows AI cars spread across the grid (not piled in one box). Live junctions have magenta NPCs on crossing streets.

### 22-traffic-car-turning.png
High orbit on the origin junction. An NPC is in the intersection with a fused box; another has already cleared north. Cross-street cars are on the east–west approaches.

### 23-ego-autopilot-intersection.png
F2, `?seed=3&demo=stop`. Ego AUTOPILOT has fully stopped then is moving through the all-way stop at ~8–10 km/h (`Cruising: lane clear`), not stuck at 0 km/h behind a deadlocked NPC.

## Pink roadside destination

### 24-destination-marker-road.png
`?seed=3&demo=arrive`. Short mid-block northbound trip. The hot-pink pad and teardrop pin sit on the right-hand curb ahead of the sedan.

### 25-destination-minimap.png
Same trip. Minimap shows the purple remaining route and the pink destination pin (not a ped dot).

### 26-destination-pullover-stop.png
Arrival: ego pulled over onto the pad and stopped. Speed ~0, nose in the right-hand roadside, pin beside the car.

## Modern cabin and Kenney sedan-sports

### cabin3_cockpit_straight.png
First person, left-hand seat, full-width dash, hood sliver, A-pillars, 15" centre tablet, 36 cm wheel.

### cabin3_cockpit_steer_left.png
A held: hand wheel at full lock, counter-clockwise (~450°).

### cabin3_cockpit_steer_right.png
D held: hand wheel at full lock, clockwise (~450°).

### cabin3_cockpit_wide.png
Same cockpit at a wider FOV (`?shot=cabin-wide`).

### cabin3_exterior_three_quarter.png
Front 3/4 of the CC0 Kenney sedan-sports (silver paint, dark glass).

### cabin3_exterior_hood.png
Top-down / front view: the hood, roof and doors are silver.

### cabin3_exterior_low_side.png
Low side view: tires inside the arches and on the road.

### cabin3_wheel_closeup.png
Close-up of a road wheel sitting in its arch.

## F2/F3 view performance

### verify-f1-fps.png
F1 Tesla-style chase after `?demo=lane`. HUD FPS comparable to the other stacks.

### verify-f2-fps.png
F2 Waymo-style: lidar points + fused boxes, HUD FPS.

### verify-f3-fps.png
F3 Waabi-style: BEV occupancy current/+1s/+2s/+3s, trajectory fan, Sim World table, HUD FPS.

### verify-f1-look-before.png / verify-f1-look-after.png
F1 before the city-look upgrade vs Look High after (ACES + fog + bloom).

### verify-f2-look-before.png / verify-f2-look-after.png
F2 lidar ring stays readable on the graded scene.

### verify-f3-look-before.png / verify-f3-look-after.png
F3 BEV panels stay readable over the graded scene.

### verify-look-orbit-low.png / verify-look-orbit-high.png
Same 3/4 orbit, Look Low vs Look High (lamp bloom).
