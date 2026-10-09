# Data Recording Schema

Version: 1.0.0

## Overview

Recordings capture the full state of simulation runs for data pipeline processing, including sensor data, perception outputs, planner decisions, and ground truth labels.

## Directory Structure

```
recording_<profile>_seed<N>_<env>_<timestamp>/
  manifest.json       Recording metadata
  frames.json         All frame data (excluding large binary)
  lidar_0.bin         Lidar point cloud for frame 0
  lidar_1.bin         ...
```

## Manifest Schema

```json
{
  "version": "1.0.0",
  "profile": "baseline_lidar",
  "scenarioSeed": 42,
  "startTimestamp": 1699000000000,
  "environment": {
    "timeOfDay": "day",
    "weather": "clear",
    "visibility": 1.0
  },
  "metadata": {
    "totalFrames": 600,
    "duration": 60.0,
    "totalTakeovers": 2,
    "totalCollisions": 0,
    "distanceTraveled": 1250.5,
    "scenarios": ["jaywalker", "vehicle_cutin"]
  },
  "frameCount": 600
}
```

## Frame Schema

```json
{
  "profile": "baseline_lidar",
  "timestamp": 1000,
  "frameNumber": 10,
  "environment": {
    "timeOfDay": "day",
    "weather": "clear",
    "visibility": 1.0
  },
  "scenario": {
    "type": "jaywalker",
    "triggeredAt": 900,
    "params": {}
  },
  "scenarioSeed": 42,
  
  "egoState": {
    "vehicleType": "car",
    "transform": {
      "position": {"x": 100.5, "y": 50.2, "z": 0.0},
      "rotation": 1.57
    },
    "velocity": {"x": 10.0, "y": 0.0, "z": 0.0},
    "acceleration": {"x": 0.5, "y": 0.0, "z": 0.0},
    "steering": 0.1,
    "throttle": 0.5,
    "brake": 0.0,
    "mass": 1500,
    "stoppingDistance": 12.5
  },
  
  "groundTruth": [
    {
      "id": 1001,
      "classType": "car",
      "transform": {
        "position": {"x": 120.0, "y": 52.0, "z": 0.8},
        "rotation": 1.57
      },
      "boundingBox": {
        "center": {"x": 120.0, "y": 52.0, "z": 0.8},
        "size": {"x": 4.5, "y": 1.8, "z": 1.5},
        "yaw": 1.57
      },
      "velocity": {"x": 8.0, "y": 0.0, "z": 0.0},
      "isStatic": false,
      "occlusionLevel": 0
    }
  ],
  
  "trafficLights": [
    {
      "id": 1,
      "position": {"x": 95.0, "y": 48.0, "z": 4.0},
      "state": "green",
      "forLaneIds": [0, 1]
    }
  ],
  
  "sensorData": {
    "lidarBinaryIndex": 10,
    "radarDetections": [],
    "aisMessages": []
  },
  
  "perceptionOutput": {
    "timestamp": 1000,
    "detections": [
      {
        "id": 1,
        "classType": "car",
        "confidence": 0.92,
        "boundingBox": {
          "center": {"x": 119.8, "y": 52.1, "z": 0.9},
          "size": {"x": 4.4, "y": 1.9, "z": 1.6},
          "yaw": 1.55
        },
        "velocity": {"x": 7.8, "y": 0.1, "z": 0.0},
        "trackId": 1,
        "pointsInBox": 245
      }
    ]
  },
  
  "plannerInput": {
    "egoState": "...",
    "detections": "...",
    "route": [{"x": 100, "y": 50, "z": 0}, "..."],
    "trafficLightStates": {"1": "green"}
  },
  
  "plannerOutput": {
    "trajectory": {
      "points": [
        {"position": {"x": 100.5, "y": 50.2, "z": 0}, "velocity": 10.0, "timestamp": 0},
        "..."
      ],
      "cost": 15.2
    },
    "acceleration": 0.5,
    "steering": 0.05
  },
  
  "controlSource": "policy",
  "activeModelVersions": {
    "perception": "v1",
    "policy": "v1"
  },
  
  "takeover": null
}
```

## Takeover Event Schema

```json
{
  "timestamp": 5000,
  "frameNumber": 50,
  "reason": "perception_miss",
  "egoState": "...",
  "duration": 3500
}
```

Takeover reasons:
- `perception_miss`: Object not detected
- `planning_too_cautious`: Overly conservative behavior
- `planning_unsafe`: Unsafe trajectory
- `other`: Other reason

## Lidar Binary Format

Little-endian float32 arrays:

```
Header (4 bytes): uint32 point_count
Per point (20 or 24 bytes):
  float32 x
  float32 y
  float32 z
  float32 intensity
  float32 ring
  [float32 radial_velocity]  # FMCW only
```

## Coordinate Frames

### World Frame
- X: East
- Y: North
- Z: Up
- Origin: Center of map

### Ego Frame
- X: Forward
- Y: Left
- Z: Up
- Origin: Rear axle center

### Sensor Frame
- Defined relative to ego frame via config

## Validation Rules

1. Timestamps must be monotonically increasing
2. Frame numbers must be sequential
3. Yaw angles must be in [-π, π]
4. Box sizes must be positive
5. Coordinates must be finite
6. Class types must be from taxonomy
