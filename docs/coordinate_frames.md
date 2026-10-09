# Coordinate Frames

This document describes the coordinate systems used in AUTONOMY CITY.

## World Frame (ENU - East-North-Up)

The world frame follows the East-North-Up (ENU) convention:

- **X-axis**: East (positive X = east)
- **Y-axis**: North (positive Y = north)
- **Z-axis**: Up (positive Z = up, height above ground)

All world positions, velocities, and accelerations are expressed in this frame.

### Units

- Position: meters
- Velocity: meters/second
- Acceleration: meters/second²
- Angles: radians

## Ego Vehicle Frame

The ego vehicle frame is attached to the vehicle's center of rear axle:

- **X-axis**: Forward (along vehicle heading)
- **Y-axis**: Left (perpendicular to heading, port side)
- **Z-axis**: Up

### Transform

From world to ego frame:
```
p_ego = R(-yaw) * (p_world - p_ego_world)
```

Where `R(-yaw)` is a rotation matrix around Z by negative yaw angle.

## Sensor Frames

### Lidar Frame

Lidars are mounted at specific positions on the vehicle. The lidar frame origin is at the sensor position:

- **X-axis**: Forward (parallel to vehicle)
- **Y-axis**: Left
- **Z-axis**: Up

Lidar point coordinates `(x, y, z)` are returned in the lidar frame. To convert to world frame:
```
p_world = R(yaw) * p_lidar + lidar_mount_position + ego_position
```

### Radar Frame

Radar returns are typically in polar coordinates:
- **Range**: Distance to target (meters)
- **Azimuth**: Horizontal angle from forward (radians, positive = left)
- **Elevation**: Vertical angle (radians, positive = up)
- **Radial velocity**: Range rate (m/s, negative = approaching)

### Camera Frame

Camera frames follow standard computer vision conventions:
- **X-axis**: Right in image
- **Y-axis**: Down in image
- **Z-axis**: Forward (optical axis)

Depth images store distance from camera plane.

## Bounding Boxes

3D bounding boxes are defined by:
- **center**: (x, y, z) in world frame - center of the box
- **size**: (length, width, height) - dimensions along box axes
- **yaw**: Rotation around Z-axis (heading)

Box corners can be computed as:
```
corners = center ± R(yaw) * (size/2)
```

## Angular Conventions

- **Yaw**: Rotation around Z-axis
  - 0 = facing East (+X)
  - π/2 = facing North (+Y)
  - ±π = facing West (-X)
  - -π/2 = facing South (-Y)
  
- All angles are normalized to [-π, π] range.

## Vehicle Dynamics

The kinematic bicycle model uses:
- **Position**: (x, y) of rear axle center in world frame
- **Heading (yaw)**: Direction the vehicle is facing
- **Velocity**: Scalar speed (always forward)
- **Steering angle**: Front wheel angle relative to vehicle axis

```
x_dot = v * cos(yaw)
y_dot = v * sin(yaw)
yaw_dot = v * tan(steering) / wheelbase
```

## Maritime Frame

For ships, the coordinate system follows maritime conventions:
- **Heading**: Direction the bow is pointing (0 = North, 90° = East)
- **Course Over Ground (COG)**: Actual direction of travel
- **Speed Over Ground (SOG)**: Actual speed

COLREGs bearings are relative to own ship's heading:
- Starboard (right): 0° to 180° (clockwise from bow)
- Port (left): 0° to -180° (counter-clockwise from bow)

## Rail Frame

For trains, the coordinate system is simplified to 1D track coordinates:
- **Position**: Distance along track from a reference point
- **Velocity**: Speed along track (positive = forward direction)
- **Grade**: Track incline (percentage)
