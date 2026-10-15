import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSignGroup, getSignAssets, octagonPath, SIGN_BLADE_Y } from './trafficSigns';

describe('traffic signs', () => {
  it('shares one pole / stop / yield material across groups', () => {
    const a = getSignAssets();
    const stop = createSignGroup('stop_sign');
    const yieldG = createSignGroup('yield_sign');
    const stopBlade = stop.children[1] as THREE.Mesh;
    const yieldBlade = yieldG.children[1] as THREE.Mesh;
    expect(stopBlade.material).toBe(a.stopMat);
    expect(yieldBlade.material).toBe(a.yieldMat);
    expect((stop.children[0] as THREE.Mesh).material).toBe(a.poleMat);
    expect((yieldG.children[0] as THREE.Mesh).material).toBe(a.poleMat);
  });

  it('places the blade above the pole facing local +X', () => {
    const a = getSignAssets();
    const pos = a.stopGeo.getAttribute('position')!;
    let sx = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      sx += pos.getX(i);
      n++;
    }
    expect(sx / n).toBeGreaterThan(0.04);
    expect(sx / n).toBeLessThan(0.12);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect((minY + maxY) / 2).toBeCloseTo(SIGN_BLADE_Y, 1);
    const nor = a.stopGeo.getAttribute('normal');
    if (nor) {
      expect(Math.abs(nor.getX(0))).toBeGreaterThan(0.9);
    }
  });

  it('marks groups so shared geos survive dispose', () => {
    const stop = createSignGroup('stop_sign');
    expect(stop.userData.sharedSignAssets).toBe(true);
    expect(stop.children.every(c => c.userData.sharedSignAssets)).toBe(true);
  });

  it('caches one shared asset set', () => {
    expect(getSignAssets()).toBe(getSignAssets());
  });

  it('draws a flat-top octagon (8 vertices)', () => {
    const cmds: string[] = [];
    const ctx = {
      beginPath() { cmds.push('begin'); },
      moveTo() { cmds.push('move'); },
      lineTo() { cmds.push('line'); },
      closePath() { cmds.push('close'); },
    } as unknown as CanvasRenderingContext2D;
    octagonPath(ctx, 0, 0, 1);
    expect(cmds.filter(c => c === 'line').length).toBe(7);
    expect(cmds).toContain('close');
  });
});
