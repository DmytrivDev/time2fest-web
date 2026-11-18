/**
 * SPEC-13a AC-35: during an edge-secret rotation the gate admits the current and the previous
 * secret, and nothing else.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';
import { createEdgeGate, type EdgeGate } from '../../src/platform/edge';
import type { EnvClass } from '../../src/platform/env';
import { daySalts } from '../../src/platform/fingerprint';
import type { Clock } from '../../src/ports';

// Every secret is built at runtime: no secret-looking literal in the test.
const CURRENT = randomBytes(24).toString('hex');
const PREVIOUS = randomBytes(24).toString('hex');
const OTHER = randomBytes(24).toString('hex');
const clock: Clock = { now: () => Date.parse('2026-12-31T12:00:00Z') };

function gate(envClass: EnvClass, previousSecret: string | undefined): EdgeGate {
  const salts = daySalts({ fast: createMemoryStore(realClock), clock });
  return createEdgeGate({ envClass, secret: CURRENT, previousSecret, salts, clock });
}

const admits = (g: EdgeGate, value: string | undefined) =>
  g.admit(new Request('http://server.test/api/time', { headers: value === undefined ? {} : { 'x-t2f-edge': value } })) !== null;

describe('edge gate rotation (SPEC-13a AC-35)', () => {
  for (const envClass of ['rehearsal', 'production', 'test'] as const) {
    it(`${envClass}: the current and the previous secret are admitted; a third value and none are refused`, () => {
      const g = gate(envClass, PREVIOUS);
      expect(g.active).toBe(true);
      expect(admits(g, CURRENT)).toBe(true);
      expect(admits(g, PREVIOUS)).toBe(true);
      expect(admits(g, OTHER)).toBe(false);
      expect(admits(g, undefined)).toBe(false);
      expect(admits(g, '')).toBe(false);
      expect(admits(g, PREVIOUS.slice(0, 16))).toBe(false);
    });
  }

  it('previous unset or empty: only the current secret is admitted', () => {
    for (const previous of [undefined, '']) {
      const g = gate('rehearsal', previous);
      expect(admits(g, CURRENT)).toBe(true);
      expect(admits(g, PREVIOUS)).toBe(false);
      expect(admits(g, '')).toBe(false);
    }
  });

  it('a previous secret without a current one opens nothing', () => {
    const salts = daySalts({ fast: createMemoryStore(realClock), clock });
    const g = createEdgeGate({ envClass: 'rehearsal', secret: undefined, previousSecret: PREVIOUS, salts, clock });
    expect(admits(g, PREVIOUS)).toBe(false);
    expect(admits(g, '')).toBe(false);
  });

  it('the admitted client is edge-verified whichever secret it carried', () => {
    const g = gate('rehearsal', PREVIOUS);
    for (const value of [CURRENT, PREVIOUS]) {
      const client = g.admit(new Request('http://server.test/api/time', { headers: { 'x-t2f-edge': value, 'x-t2f-client': '203.0.113.5;UA' } }));
      expect(client).toMatchObject({ edgeVerified: true, country: 'UA', addressPresent: true });
    }
  });
});
