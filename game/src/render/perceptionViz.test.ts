import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createEgoState } from '../sim/vehicle';
import { vec3 } from '../sim/math';
import {
  DRAW_WORLD_LABEL_SPRITES,
  PerceptionVisualizer,
} from './perceptionViz';

describe('perception world labels', () => {
  it('does not draw world-space confidence sprites over the HUD', () => {
    expect(DRAW_WORLD_LABEL_SPRITES).toBe(false);
    const scene = new THREE.Scene();
    const viz = new PerceptionVisualizer(scene);
    viz.setEnabled(true);
    const ego = createEgoState('car', vec3(0, 0, 0), Math.PI / 2);
    viz.update({
      stack: 'tesla',
      ego,
      tracks: [{
        id: 7,
        classType: 'car',
        box: {
          center: { x: 0.4, y: 1.2, z: 0.6 },
          size: { x: 4.5, y: 1.8, z: 1.5 },
          yaw: 0,
        },
        velocity: vec3(0, 0, 0),
        confidence: 0.2775,
        age: 3,
        missedFrames: 0,
      }],
      lidarPoints: [],
      agents: [],
      groundTruth: [],
      showGroundTruth: false,
      plannerOutput: null,
      visionDetections: [],
      controlSource: 'policy',
      rule: { reason: 'Cruising: lane clear', severity: 'go' },
    });
    let sprites = 0;
    viz.group.traverse((obj) => {
      if (obj instanceof THREE.Sprite) sprites += 1;
    });
    expect(sprites).toBe(0);
  });
});
