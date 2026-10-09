/**
 * Tests for COLREGs collision avoidance rules
 */

import { describe, it, expect } from 'vitest';
import { determineCOLREGSRule, calculateCPATCPA } from './maritime';
import { vec3 } from '../sim/math';

describe('COLREGs rule determination', () => {
  it('determines head-on situation correctly', () => {
    // Two vessels approaching each other head-on
    const rule = determineCOLREGSRule(
      vec3(0, 0, 0),  // Own position
      0,               // Own heading (facing east)
      vec3(100, 0, 0), // Target position (ahead)
      Math.PI          // Target heading (facing west, toward us)
    );
    expect(rule).toBe('head_on');
  });

  it('determines give-way in crossing situation (target on starboard)', () => {
    // Target on our starboard side (positive Y when heading 0 = east)
    // In this coordinate system, Y+ is port, Y- is starboard
    const rule = determineCOLREGSRule(
      vec3(0, 0, 0),
      0, // Facing east (X+)
      vec3(50, 50, 0), // Target to our port-forward
      -Math.PI / 2 // Target facing south
    );
    // With target on port, we stand on (we have right of way)
    expect(rule).toBe('give_way');
  });

  it('determines stand-on in crossing situation (target on port)', () => {
    // Target on our port side
    const rule = determineCOLREGSRule(
      vec3(0, 0, 0),
      0, // Facing east
      vec3(50, -50, 0), // Target to starboard
      Math.PI / 2 // Target facing north
    );
    // With target on starboard, we give way (they have right of way)
    expect(rule).toBe('stand_on');
  });

  it('determines overtaking situation', () => {
    // We're behind the target, approaching from astern (bearing > 112.5° from their stern)
    const rule = determineCOLREGSRule(
      vec3(0, 0, 0),
      0, // We're facing east
      vec3(-50, 0, 0), // Target is behind us
      0 // Target also facing east, same direction
    );
    // From our perspective, target is astern, this is an overtaking situation
    expect(rule).toBe('overtaking');
  });
});

describe('CPA/TCPA calculation', () => {
  it('calculates CPA for head-on approach', () => {
    const { cpa, tcpa } = calculateCPATCPA(
      vec3(0, 0, 0),
      vec3(10, 0, 0), // Moving east at 10 m/s
      vec3(200, 0, 0),
      vec3(-10, 0, 0) // Moving west at 10 m/s
    );
    expect(cpa).toBeCloseTo(0, 0); // Will meet at same point
    expect(tcpa).toBeCloseTo(10); // 200m / 20 m/s relative
  });

  it('calculates CPA for parallel paths', () => {
    const { cpa, tcpa } = calculateCPATCPA(
      vec3(0, 0, 0),
      vec3(10, 0, 0),
      vec3(0, 100, 0), // 100m to the side
      vec3(10, 0, 0)   // Same velocity
    );
    expect(cpa).toBeCloseTo(100);
    expect(tcpa).toBe(Infinity); // No relative motion
  });

  it('calculates CPA for crossing paths', () => {
    const { cpa, tcpa } = calculateCPATCPA(
      vec3(0, 0, 0),
      vec3(10, 0, 0), // Moving east
      vec3(100, -100, 0),
      vec3(0, 10, 0) // Moving north
    );
    expect(cpa).toBeGreaterThan(0);
    expect(tcpa).toBeGreaterThan(0);
    expect(tcpa).toBeLessThan(20); // Should meet within reasonable time
  });
});
