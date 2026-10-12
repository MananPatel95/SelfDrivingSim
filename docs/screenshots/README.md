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
