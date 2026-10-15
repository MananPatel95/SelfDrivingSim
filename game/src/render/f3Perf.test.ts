import { describe, it, expect, beforeEach } from 'vitest';
import { Simulation } from '../sim/simulation';
import { vec3 } from '../sim/math';
import type { EgoState } from '../sim/types';
import {
  createBEVOccupancyFromAgents,
  f3WorkStats,
  makeFutureOccupancy,
  occupancyAgentsFromEntities,
  predictFutureOccupancyFromAgents,
  resetF3WorkStats,
  tickWaabiView,
  WAABI_BEV_EXTENT,
  WAABI_BEV_GRID,
  WAABI_BEV_RESOLUTION,
  emptyWaabiState,
} from '../stacks/waabi';
import {
  getDisplayedOccupancy,
  paintOccupancyPanelsToRgba,
  resetWaabiOverlay,
  tickWaabiBevOverlay,
} from './bevOverlay';
import { writeOccupancyRgba } from './occupancyPaint';
import { PerceptionVisualizer, resetVizWorkStats, vizWorkStats } from './perceptionViz';
import * as THREE from 'three';

function egoAtOrigin(): EgoState {
  return {
    vehicleType: 'car',
    transform: { position: vec3(0, 0, 0), rotation: Math.PI / 2 },
    velocity: vec3(0, 8, 0),
    acceleration: vec3(0, 0, 0),
    steering: 0,
    throttle: 0,
    brake: 0,
    mass: 1500,
    stoppingDistance: 10,
  };
}

describe('F3 occupancy hot path', () => {
  beforeEach(() => {
    resetF3WorkStats();
    resetWaabiOverlay();
    resetF3WorkStats();
  });

  it('reuses occupancy grids after warmup (no per-frame Float32Array allocs)', () => {
    const sim = new Simulation({ seed: 3, maxDuration: 3600 });
    sim.beginParked();
    sim.step(1 / 30);

    const into = makeFutureOccupancy();
    const state = emptyWaabiState();
    const s = sim.getState();
    // Lane spawn (#36) can park ego with no traffic inside the 24 m BEV. Keep one
    // car in range so reuse stats still measure a real splat, not empty grids.
    const sample = s.trafficVehicles[0]!;
    const nearPos = {
      x: s.ego.transform.position.x,
      y: s.ego.transform.position.y + 12,
      z: 0.8,
    };
    const nearby = {
      ...sample,
      id: 424242,
      isStatic: false,
      transform: { ...sample.transform, position: nearPos },
      boundingBox: { ...sample.boundingBox, center: nearPos },
    };
    resetF3WorkStats();
    for (let i = 0; i < 30; i++) {
      tickWaabiView(
        s.ego,
        [[nearby, ...s.trafficVehicles], s.pedestrians],
        state,
        s.timestamp + i * 100,
        42,
        into,
      );
    }
    expect(f3WorkStats.lidarScans).toBe(0);
    expect(f3WorkStats.occupancyAllocs).toBe(0);
    expect(f3WorkStats.staticEntitiesTouched).toBe(0);
    expect(f3WorkStats.predictCalls).toBe(30);
    expect(f3WorkStats.gridFills).toBe(30 * 4);
    expect(into.current.grid.length).toBe(WAABI_BEV_GRID * WAABI_BEV_GRID);
    expect(f3WorkStats.agentsSplat).toBeLessThanOrEqual(30 * 4 * 80);
    expect(f3WorkStats.cellsWritten).toBeGreaterThan(0);
    expect(f3WorkStats.cellsWritten).toBeLessThan(30 * 4 * WAABI_BEV_GRID * WAABI_BEV_GRID);
  });

  it('does not walk static buildings when only traffic and peds are passed', () => {
    const sim = new Simulation({ seed: 3, maxDuration: 3600 });
    sim.beginParked();
    sim.step(1 / 30);
    const s = sim.getState();
    expect(s.worldMap.staticEntities.length).toBeGreaterThan(100);
    resetF3WorkStats();
    occupancyAgentsFromEntities([s.trafficVehicles, s.pedestrians]);
    expect(f3WorkStats.staticEntitiesTouched).toBe(0);
    occupancyAgentsFromEntities([s.worldMap.staticEntities]);
    expect(f3WorkStats.staticEntitiesTouched).toBe(s.worldMap.staticEntities.length);
  });

  it('keeps createBEVOccupancyFromAgents blobs and predicted motion', () => {
    const agents = [
      { position: vec3(0, 20, 0.7), size: vec3(4.5, 1.8, 1.5), yaw: Math.PI / 2, velocity: vec3(0, 10, 0), confidence: 1 },
    ];
    const occ = createBEVOccupancyFromAgents(agents, egoAtOrigin(), 1.5, 24, 0);
    let occupied = 0;
    for (const v of occ.grid) if (v > 0.08) occupied++;
    expect(occupied).toBeGreaterThan(8);

    const future = predictFutureOccupancyFromAgents(agents, egoAtOrigin(), 0.8, 32);
    const peak = (grid: Float32Array) => {
      let best = 0;
      let idx = 0;
      grid.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
      return idx;
    };
    expect(peak(future.t3s.grid)).not.toBe(peak(future.current.grid));
  });

  it('throttles overlay predicts to ~10 Hz and interpolates displayed occupancy', () => {
    const sim = new Simulation({ seed: 3, maxDuration: 3600 });
    sim.beginParked();
    sim.step(1 / 30);
    resetF3WorkStats();
    const s0 = sim.getState();
    tickWaabiBevOverlay({
      ego: s0.ego,
      traffic: s0.trafficVehicles,
      pedestrians: s0.pedestrians,
      timestamp: s0.timestamp,
      nowMs: 1000,
      force: true,
    });
    const predictsAfterFirst = f3WorkStats.predictCalls;
    tickWaabiBevOverlay({
      ego: s0.ego,
      traffic: s0.trafficVehicles,
      pedestrians: s0.pedestrians,
      timestamp: s0.timestamp,
      nowMs: 1040,
    });
    expect(f3WorkStats.predictCalls).toBe(predictsAfterFirst);
    tickWaabiBevOverlay({
      ego: s0.ego,
      traffic: s0.trafficVehicles,
      pedestrians: s0.pedestrians,
      timestamp: s0.timestamp,
      nowMs: 1120,
    });
    expect(f3WorkStats.predictCalls).toBe(predictsAfterFirst + 1);
    const displayed = getDisplayedOccupancy(1070);
    expect(displayed.grid.length).toBe(WAABI_BEV_GRID * WAABI_BEV_GRID);
    expect(displayed.resolution).toBe(WAABI_BEV_RESOLUTION);
    expect(displayed.extent).toBe(WAABI_BEV_EXTENT);
  });

  it('paints four occupancy panels without per-cell string colours', () => {
    const agents = [
      { position: vec3(4, 12, 0.7), size: vec3(4.5, 1.8, 1.5), yaw: 0, velocity: vec3(4, 0, 0), confidence: 0.9 },
    ];
    const future = predictFutureOccupancyFromAgents(agents, egoAtOrigin(), WAABI_BEV_RESOLUTION, WAABI_BEV_EXTENT);
    const w = 320;
    const h = 200;
    const pixels = new Uint8ClampedArray(w * h * 4);
    resetF3WorkStats();
    paintOccupancyPanelsToRgba(pixels, w, h, future);
    expect(f3WorkStats.canvasPuts).toBe(4);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if ((pixels[i] ?? 0) > 40) lit++;
    }
    expect(lit).toBeGreaterThan(40);
    writeOccupancyRgba(pixels, w, future.current, 0, 0, 32, 32);
    expect(f3WorkStats.canvasPuts).toBe(5);
  });

  it('bounds PerceptionVisualizer per-frame typed-array allocs on F3', () => {
    const scene = new THREE.Scene();
    const viz = new PerceptionVisualizer(scene);
    viz.setEnabled(true);
    const sim = new Simulation({ seed: 3, maxDuration: 3600 });
    sim.beginParked();
    sim.step(1 / 30);
    const s = sim.getState();
    const into = makeFutureOccupancy();
    const state = emptyWaabiState();
    tickWaabiView(s.ego, [s.trafficVehicles, s.pedestrians], state, s.timestamp, 42, into);
    resetVizWorkStats();
    for (let i = 0; i < 10; i++) {
      viz.update({
        stack: 'waabi',
        ego: s.ego,
        tracks: [],
        lidarPoints: sim.getLidarPoints(),
        agents: s.trafficVehicles,
        groundTruth: [],
        showGroundTruth: false,
        plannerOutput: s.lastPlannerOutput,
        visionDetections: [],
        occupancy: into.current,
      });
    }
    expect(vizWorkStats.predArrayAllocs).toBe(0);
    expect(vizWorkStats.planArrayAllocs).toBe(0);
    expect(vizWorkStats.occupancyCellsVisited).toBeGreaterThan(0);
    expect(vizWorkStats.occupancyCellsVisited).toBeLessThanOrEqual(10 * WAABI_BEV_GRID * WAABI_BEV_GRID);
  });
});
