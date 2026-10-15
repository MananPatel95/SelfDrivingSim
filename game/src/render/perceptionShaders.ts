/**
 * GPU overlay materials. Motion is driven by uTime / uSweep / uAlpha.
 * Box/voxel instance buffers rewrite on 10 Hz snapshots; lidar trail slots
 * rewrite in-place as the visual sweep crosses each azimuth.
 */

import * as THREE from 'three';
import { BOX_POP_S, LIDAR_DECAY_S } from './snapshotLerp';

export interface AnimUniforms {
  uTime: { value: number };
  uAlpha: { value: number };
  uSweep: { value: number };
  uPulse: { value: number };
  uEgoPos: { value: THREE.Vector3 };
  uEgoYaw: { value: number };
}

export function createAnimUniforms(): AnimUniforms {
  return {
    uTime: { value: 0 },
    uAlpha: { value: 1 },
    uSweep: { value: 0 },
    uPulse: { value: 1 },
    uEgoPos: { value: new THREE.Vector3() },
    uEgoYaw: { value: 0 },
  };
}

export function makeLidarPointsMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime,
      uSweep: u.uSweep,
      uDecay: { value: LIDAR_DECAY_S },
      uPointSize: { value: 0.38 },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uSweep;
      uniform float uDecay;
      uniform float uPointSize;
      attribute float aBirth;
      attribute float aAzimuth;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        float age = uTime - aBirth;
        float live = step(0.0, age) * step(age, uDecay * 1.05);
        vAlpha = exp(-age / max(uDecay, 0.001)) * live;
        float twoPi = 6.28318530718;
        float d = mod(uSweep - aAzimuth + twoPi, twoPi);
        float beam = (1.0 - smoothstep(0.0, 0.07, d)) * live;
        vColor = mix(vColor, vec3(0.75, 1.0, 1.0), beam);
        vAlpha = max(vAlpha, beam * 0.95);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(2.4, uPointSize * (320.0 / max(0.8, -mv.z)) * (0.7 + 1.9 * beam));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        if (vAlpha < 0.03) discard;
        float core = 1.0 - smoothstep(0.0, 1.0, r2);
        gl_FragColor = vec4(vColor * (0.45 + 0.85 * core), vAlpha * core);
      }
    `,
  });
}

export function makeVoxelMaterial(
  u: AnimUniforms,
  color: THREE.ColorRepresentation,
  baseAlpha: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime,
      uAlpha: u.uAlpha,
      uColor: { value: new THREE.Color(color) },
      uBaseAlpha: { value: baseAlpha },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      uniform float uTime;
      uniform float uAlpha;
      attribute vec3 aPosA;
      attribute vec3 aPosB;
      attribute vec3 aSizeA;
      attribute vec3 aSizeB;
      attribute float aHash;
      varying float vAlpha;
      void main() {
        vec3 c = mix(aPosA, aPosB, uAlpha);
        vec3 s = mix(aSizeA, aSizeB, uAlpha);
        float pulse = 0.88 + 0.12 * sin(uTime * 3.2 + aHash * 6.28318);
        vec3 transformed = position;
        transformed.x *= s.x;
        transformed.z *= s.z;
        float h = max(0.02, s.y * pulse);
        transformed.y = (position.y + 0.5) * h;
        vAlpha = smoothstep(0.04, 0.28, s.y);
#ifdef USE_INSTANCING
        vec4 worldPos = instanceMatrix * vec4(transformed + c, 1.0);
#else
        vec4 worldPos = vec4(transformed + c, 1.0);
#endif
        gl_Position = projectionMatrix * modelViewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uBaseAlpha;
      varying float vAlpha;
      void main() {
        if (vAlpha < 0.04) discard;
        gl_FragColor = vec4(uColor, uBaseAlpha * vAlpha);
      }
    `,
  });
}

export function makeBoxMaterial(u: AnimUniforms, color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime,
      uColor: { value: new THREE.Color(color) },
      uPop: { value: BOX_POP_S },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    wireframe: true,
    vertexShader: `
      uniform float uTime;
      uniform float uPop;
      attribute float aBirth;
      varying float vFade;
      void main() {
        float age = max(0.0, uTime - aBirth);
        float x = clamp(age / max(uPop, 0.001), 0.0, 1.0);
        float pop = x * x * (3.0 - 2.0 * x);
        vFade = pop;
        vec3 transformed = position * mix(0.18, 1.0, pop);
#ifdef USE_INSTANCING
        vec4 worldPos = instanceMatrix * vec4(transformed, 1.0);
#else
        vec4 worldPos = vec4(transformed, 1.0);
#endif
        gl_Position = projectionMatrix * modelViewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(uColor, 0.22 + 0.62 * vFade);
      }
    `,
  });
}

export function makeBarMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vColor;
      varying float vFade;
      uniform float uTime;
      attribute float aBirth;
      attribute vec3 instanceColor;
      void main() {
        float age = max(0.0, uTime - aBirth);
        float x = clamp(age / 0.22, 0.0, 1.0);
        vFade = x * x * (3.0 - 2.0 * x);
#ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
#else
        vColor = vec3(0.35, 1.0, 0.45);
#endif
        vec3 transformed = position;
#ifdef USE_INSTANCING
        vec4 worldPos = instanceMatrix * vec4(transformed, 1.0);
#else
        vec4 worldPos = vec4(transformed, 1.0);
#endif
        gl_Position = projectionMatrix * modelViewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(vColor, 0.35 + 0.6 * vFade);
      }
    `,
  });
}

export function makeFrustumMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime, uPulse: u.uPulse },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aCam;
      varying float vU;
      varying float vCam;
      void main() {
        vU = uv.x;
        vCam = aCam;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uPulse;
      varying float vU;
      varying float vCam;
      void main() {
        float sweep = fract(uTime * 0.55 + vCam * 0.11);
        float beam = 1.0 - smoothstep(0.0, 0.08, abs(vU - sweep));
        float pulse = 0.12 + 0.10 * uPulse;
        gl_FragColor = vec4(0.40, 0.86, 1.0, pulse + 0.55 * beam);
      }
    `,
  });
}

export function makeRayMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime, uPulse: u.uPulse },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying float vT;
      void main() {
        vT = uv.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uPulse;
      varying float vT;
      void main() {
        float pulse = 0.28 + 0.55 * uPulse;
        float dash = 0.55 + 0.45 * sin(vT * 28.0 - uTime * 8.0);
        gl_FragColor = vec4(0.45, 0.88, 1.0, pulse * dash);
      }
    `,
  });
}

/** Visual sweep width. Thin enough that returns, not the beam, dominate. */
export const LIDAR_SWEEP_WEDGE_DEG = 4;

/** Flat 3–5° sector in ego XY (Three +X forward). Shader fades by UV. */
export function makeSweepWedgeGeometry(
  radius = 56,
  angleDeg = LIDAR_SWEEP_WEDGE_DEG,
): THREE.BufferGeometry {
  const half = (angleDeg * Math.PI) / 180 / 2;
  const radialSegs = 5;
  const angleSegs = 4;
  const inner = 1.6;
  const col = angleSegs + 1;
  const positions = new Float32Array((radialSegs + 1) * col * 3);
  const uvs = new Float32Array((radialSegs + 1) * col * 2);
  let p = 0;
  let t = 0;
  for (let ri = 0; ri <= radialSegs; ri++) {
    const dist = ri / radialSegs;
    const r = inner + (radius - inner) * dist;
    for (let ai = 0; ai <= angleSegs; ai++) {
      const u = (ai / angleSegs) * 2 - 1;
      const a = u * half;
      positions[p++] = r * Math.cos(a);
      positions[p++] = 0.1;
      positions[p++] = r * Math.sin(a);
      uvs[t++] = u;
      uvs[t++] = dist;
    }
  }
  const indices: number[] = [];
  for (let ri = 0; ri < radialSegs; ri++) {
    for (let ai = 0; ai < angleSegs; ai++) {
      const a = ri * col + ai;
      const b = a + col;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function makeSweepMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSweep: u.uSweep },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uSweep;
      varying float vU;
      varying float vDist;
      void main() {
        vU = uv.x;
        vDist = uv.y;
        float c = cos(-uSweep);
        float s = sin(-uSweep);
        vec3 p = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying float vU;
      varying float vDist;
      void main() {
        float core = 1.0 - smoothstep(0.0, 0.28, abs(vU));
        float edge = 1.0 - smoothstep(0.45, 1.0, abs(vU));
        float dist = pow(1.0 - clamp(vDist, 0.0, 1.0), 1.35);
        float alpha = (0.12 * edge + 0.32 * core) * dist;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(0.40, 0.95, 1.0, alpha);
      }
    `,
  });
}

export function makeRadarMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime;
      attribute float aPhase;
      varying float vFade;
      void main() {
        float t = fract(uTime * 0.85 + aPhase);
        vFade = 1.0 - t;
        vec3 p = position * vec3(t * 38.0, 1.0, t * 38.0);
#ifdef USE_INSTANCING
        vec4 worldPos = instanceMatrix * vec4(p, 1.0);
#else
        vec4 worldPos = vec4(p, 1.0);
#endif
        gl_Position = projectionMatrix * modelViewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        gl_FragColor = vec4(1.0, 0.55, 0.15, 0.55 * vFade);
      }
    `,
  });
}

export function makeLaneMaterial(u: AnimUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      attribute float aAlong;
      varying float vAlong;
      void main() {
        vAlong = aAlong;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying float vAlong;
      void main() {
        float dash = fract(vAlong * 0.18 - uTime * 2.4);
        if (dash > 0.55) discard;
        gl_FragColor = vec4(0.35, 0.75, 1.0, 0.7);
      }
    `,
  });
}

export function makeTrajMaterial(u: AnimUniforms, selected: boolean): THREE.ShaderMaterial {
  const col = selected ? new THREE.Color(0x33ff66) : new THREE.Color(0xff8833);
  return new THREE.ShaderMaterial({
    uniforms: { uTime: u.uTime, uColor: { value: col } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      attribute float aAlong;
      varying float vAlong;
      void main() {
        vAlong = aAlong;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying float vAlong;
      void main() {
        float sweep = fract(uTime * 0.7);
        float head = 1.0 - smoothstep(0.0, 0.14, abs(fract(vAlong * 0.04) - sweep));
        float dash = fract(vAlong * 0.22 - uTime * 1.6);
        if (dash > 0.72 && head < 0.4) discard;
        gl_FragColor = vec4(uColor, 0.35 + 0.6 * head);
      }
    `,
  });
}
