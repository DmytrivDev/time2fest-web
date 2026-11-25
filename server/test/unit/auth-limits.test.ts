/**
 * SPEC-10 W22: the /48 key of the code limits and the keyed limits (AC-8, AC-9, EC-6, EC-7).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';
import { createEdgeGate } from '../../src/platform/edge';
import { daySalts, network48Of } from '../../src/platform/fingerprint';
import { admitCode, releaseCode, type CodeLimitKeys } from '../../src/auth/codeLimits';
import { checkKeyedLimit, peekKeyedLimit, releaseKeyedLimit, type RateLimitRow } from '../../src/platform/rateLimit';
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
      decrIfPresent: down,
      get: down,
      set: down,
      del: down,
      deleteByPrefix: down,
    };
    const stores = { fast: broken, memory: createMemoryStore(clock) };
    for (const key of ['auth-code-device', 'auth-code-email', 'auth-code-ip', 'auth-code-ip48']) {
      expect(await peekKeyedLimit(row(key), 'k', stores, Date.now())).toEqual({ ok: false, error: { code: 'unavailable' } });
      expect(await checkKeyedLimit(row(key), 'k', stores, Date.now())).toEqual({ ok: false, error: { code: 'unavailable' } });
    }
  });
});

describe('S10-01 — code windows are reserved before the send', () => {
  const now = 1_800_000_000_000 + 60_000;
  const stores = () => ({ fast: createMemoryStore(clock), memory: createMemoryStore(clock) });
  const keys = (email: string, over: Partial<CodeLimitKeys> = {}): CodeLimitKeys => ({
    email,
    device: 'dev-1',
    ipDay: 'fp:client',
    ip48Day: 'fp48:net',
    ...over,
  });

  it('12 parallel requests from one client for 12 addresses: exactly 5 admitted, the rest too-many', async () => {
    const s = stores();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => admitCode(s, keys(`e${i}`), now)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    for (const r of results.filter((x) => !x.ok)) expect(r).toMatchObject({ ok: false, error: { code: 'rate_limited', reason: 'too-many' } });
    // A refused request gave its hits back: a new address from another client is not charged for them.
    expect((await admitCode(s, keys('e0b', { device: 'dev-2', ipDay: 'fp:other', ip48Day: 'fp48:other' }), now)).ok).toBe(true);
  });

  it('EC-7: without an address the device window still applies', async () => {
    const s = stores();
    const noaddr = { ipDay: 'noaddr:2027-01-01', ip48Day: 'noaddr:2027-01-01' };
    const results = await Promise.all(Array.from({ length: 7 }, (_, i) => admitCode(s, keys(`n${i}`, noaddr), now)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await admitCode(s, keys('n9', { ...noaddr, device: 'dev-9' }), now)).ok).toBe(true);
  });

  it('releaseCode (nothing sent) gives the hits and the gap back; a wait refusal does not consume a hit', async () => {
    const s = stores();
    for (let i = 0; i < 5; i += 1) expect((await admitCode(s, keys(`r${i}`), now)).ok).toBe(true);
    expect((await admitCode(s, keys('r5'), now)).ok).toBe(false);
    await releaseCode(s, keys('r4'), now);
    expect((await admitCode(s, keys('r4'), now)).ok).toBe(true);
    await releaseCode(s, keys('r3'), now);
    // Same address again inside the gap: `wait`, and the hit it reserved is given back (r3 still fits).
    expect(await admitCode(s, keys('r4'), now)).toMatchObject({ ok: false, error: { reason: 'wait' } });
    expect(await admitCode(s, keys('r3'), now)).toEqual({ ok: true });
  });

  it('releaseKeyedLimit never goes below zero and never creates a key', async () => {
    const s = stores();
    const r = row('auth-code-email');
    await releaseKeyedLimit(r, 'none', s, now);
    for (let i = 0; i < 5; i += 1) expect((await checkKeyedLimit(r, 'none', s, now)).ok).toBe(true);
    expect((await checkKeyedLimit(r, 'none', s, now)).ok).toBe(false);
  });
});
