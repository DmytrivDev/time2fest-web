/**
 * SPEC-10 W22: the /48 key of the code limits and the keyed limits (AC-8, AC-9, EC-6, EC-7).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';
import { createEdgeGate } from '../../src/platform/edge';
import { daySalts, network48Of } from '../../src/platform/fingerprint';
import { checkKeyedLimit, peekKeyedLimit, type RateLimitRow } from '../../src/platform/rateLimit';
import { DependencyUnavailable, type FastStore } from '../../src/ports';
import { rateLimitRegistry } from '../../src/registries/rateLimits';

const clock = realClock;

function gate() {
  const store = createMemoryStore(clock);
  // Built at runtime: no secret-looking literal in the test.
  const secret = randomBytes(24).toString('hex');
  const edge = createEdgeGate({ envClass: 'test', secret, salts: daySalts({ fast: store, clock }), clock });
  const client = (ip: string) => {
    const req = new Request('http://127.0.0.1/api/x', { headers: { 'x-t2f-edge': secret, 'x-t2f-client': `${ip};UA` } });
    const c = edge.admit(req);
    if (c === null) throw new Error('refused');
    return c;
  };
  return { client };
}

const row = (key: string): RateLimitRow => {
  const found = rateLimitRegistry.find((r) => r.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
};

describe('SPEC-10 W22 — /48 key and keyed limits', () => {
  it('network48Of: IPv6 → /48, IPv4 and mapped IPv4 unchanged, junk → undefined', () => {
    expect(network48Of('2001:db8:abcd:1234::1')).toBe('2001:0db8:abcd::/48');
    expect(network48Of('2001:db8:abcd:9999:ffff::2')).toBe('2001:0db8:abcd::/48');
    expect(network48Of('198.51.100.7')).toBe('198.51.100.7');
    expect(network48Of('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(network48Of('not-an-ip')).toBeUndefined();
  });

  it('EC-6: two IPv6 addresses in different /64s of one /48 share ip48Day, not ipDay', async () => {
    const { client } = gate();
    const a = client('2001:db8:abcd:1::5');
    const b = client('2001:db8:abcd:2::5');
    expect(await a.ip48Day()).toMatch(/^fp48:[0-9a-f]{64}$/);
    expect(await a.ip48Day()).toBe(await b.ip48Day());
    expect(await a.ipDay()).not.toBe(await b.ipDay());
    const other = client('2001:db8:abce:1::5');
    expect(await other.ip48Day()).not.toBe(await a.ip48Day());
  });

  it('EC-7: without an address ip48Day is the no-address bucket of ipDay', async () => {
    const { client } = gate();
    const c = client('nonsense');
    expect(await c.ip48Day()).toBe(await c.ipDay());
    expect(await c.ip48Day()).toMatch(/^noaddr:/);
  });

  it('AC-9: the keyed limit refuses the 6th hit with rate_limited + retryAfterMs to the window end; peek does not count', async () => {
    const stores = { fast: createMemoryStore(clock), memory: createMemoryStore(clock) };
    const r = row('auth-code-email');
    const now = 1_800_000_000_000 + 60_000; // one minute into an aligned 10-minute window
    for (let i = 0; i < 3; i += 1) expect((await peekKeyedLimit(r, 'abc', stores, now)).ok).toBe(true);
    for (let i = 0; i < 5; i += 1) expect((await checkKeyedLimit(r, 'abc', stores, now)).ok).toBe(true);
    expect(await peekKeyedLimit(r, 'abc', stores, now)).toEqual({ ok: false, error: { code: 'rate_limited', retryAfterMs: 540_000 } });
    expect(await checkKeyedLimit(r, 'abc', stores, now)).toEqual({ ok: false, error: { code: 'rate_limited', retryAfterMs: 540_000 } });
    expect((await checkKeyedLimit(r, 'other', stores, now)).ok).toBe(true);
    // The next window starts afresh.
    expect((await peekKeyedLimit(r, 'abc', stores, now + 600_000)).ok).toBe(true);
  });

  it('NFR-4: a fail-closed keyed row answers unavailable when the store is down', async () => {
    const down = (): Promise<never> => Promise.reject(new DependencyUnavailable('redis'));
    const broken: FastStore = {
      incrWindow: down,
      setIfAbsent: down,
      get: down,
      set: down,
      del: down,
      deleteByPrefix: down,
    };
    const stores = { fast: broken, memory: createMemoryStore(clock) };
    for (const key of ['auth-code-email', 'auth-code-ip', 'auth-code-ip48']) {
      expect(await peekKeyedLimit(row(key), 'k', stores, Date.now())).toEqual({ ok: false, error: { code: 'unavailable' } });
      expect(await checkKeyedLimit(row(key), 'k', stores, Date.now())).toEqual({ ok: false, error: { code: 'unavailable' } });
    }
  });
});
