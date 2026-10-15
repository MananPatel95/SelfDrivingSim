import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyVertexAO, instanceAO, FOG_FAR_DEFAULT, SKY_DAY } from './cityLook';
import { getCityTextures } from './cityTextures';

describe('city look helpers', () => {
  it('writes vertex AO colours onto geometry', () => {
    const geo = new THREE.BoxGeometry(2, 4, 2);
    applyVertexAO(geo, 0.3);
    const col = geo.getAttribute('color');
    expect(col).toBeTruthy();
    expect(col!.count).toBeGreaterThan(0);
    let min = 1;
    for (let i = 0; i < col!.count; i++) min = Math.min(min, col!.getX(i));
    expect(min).toBeLessThan(1);
  });

  it('instance AO is deterministic and in (0,1]', () => {
    const a = instanceAO(10, 20, 30);
    const b = instanceAO(10, 20, 30);
    expect(a.getHex()).toBe(b.getHex());
    expect(a.r).toBeGreaterThan(0.4);
    expect(a.r).toBeLessThanOrEqual(1);
  });

  it('keeps fog far tight enough to hide pop-in', () => {
    expect(FOG_FAR_DEFAULT).toBeLessThanOrEqual(280);
    expect(SKY_DAY).toBeGreaterThan(0);
  });

  it('builds procedural textures without throwing', () => {
    const tex = getCityTextures();
    expect(tex.asphalt).toBeTruthy();
    expect(tex.facade).toBeTruthy();
    expect(tex.windows).toBeTruthy();
    expect(tex.lut).toBeTruthy();
  });
});
