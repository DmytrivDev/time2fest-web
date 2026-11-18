import { RealtimeTokenResponseSchema } from '@time2fest/contracts/schemas';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { createHs256Signer } from '../../src/adapters/centrifugoToken';
import { realtimeTokenRoute } from '../../src/endpoints/realtimeToken';
import { errors } from '../../src/endpoints/pipeline';
import type { Ctx, Deps } from '../../src/endpoints/types';
import type { Clock } from '../../src/ports';
import type { RandomSource, RealtimeSubject, SubjectResolver, TokenClaims, TokenSigner } from '../../src/realtime/ports';
import { issueRealtimeToken } from '../../src/realtime/token';

const TOKEN_SECRET = 'centrifugo-token-secret-for-the-unit-test-0000'; // check-secrets: allow test fake
const START_MS = Date.UTC(2026, 11, 31, 22, 0, 0);

/** Deterministic `RandomSource` (mulberry32) so the bucket assertion cannot flake. */
function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function manualClock(startMs: number): Clock & { advance(ms: number): void } {
  let now = startMs;
  return { now: () => now, advance: (ms) => void (now += ms) };
}

const subjectOf = (subject: RealtimeSubject | null): SubjectResolver => ({ resolve: async () => subject });

function recordingSigner(): TokenSigner & { calls: TokenClaims[] } {
  const calls: TokenClaims[] = [];
  return { calls, sign: async (claims) => (calls.push(claims), `signed-${calls.length}`) };
}

const request = () => new Request('http://127.0.0.1:4120/api/realtime/token');

describe('realtime token', () => {
  it('AC-14: 1 000 tokens over 60 s expire 2 700–4 500 s after iat, no 60-s bucket above 5%', async () => {
    const clock = manualClock(START_MS);
    const signer = recordingSigner();
    const deps = { resolver: subjectOf({ kind: 'guest', id: 'g1' }), signer, clock, random: mulberry32(20261231) };
    for (let i = 0; i < 1000; i += 1) {
      const result = await issueRealtimeToken(deps, request());
      expect(result.ok).toBe(true);
      clock.advance(60);
    }
    expect(signer.calls).toHaveLength(1000);
    const buckets = new Map<number, number>();
    for (const { iat, exp } of signer.calls) {
      expect(exp - iat).toBeGreaterThanOrEqual(2700);
      expect(exp - iat).toBeLessThanOrEqual(4500);
      const bucket = Math.floor(exp / 60);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    expect(Math.max(...buckets.values())).toBeLessThanOrEqual(50);
  });

  it('AC-18: a subject id outside ^[A-Za-z0-9_-]{1,64}$ gets `unknown` and is never signed', async () => {
    const signer = recordingSigner();
    for (const id of ['a#b', 'a,b', 'a'.repeat(65)]) {
      const result = await issueRealtimeToken(
        { resolver: subjectOf({ kind: 'guest', id }), signer, clock: manualClock(START_MS), random: () => 0.5 },
        request(),
      );
      expect(result).toEqual({ ok: false, error: { code: 'unknown' } });
    }
    expect(signer.calls).toHaveLength(0);
    expect(errors.unknown).toBe(500);
  });

  it('AC-12: the HS256 token carries exactly sub, iat and exp', async () => {
    const result = await issueRealtimeToken(
      { resolver: subjectOf({ kind: 'account', id: 'acc_1-x' }), signer: createHs256Signer(TOKEN_SECRET), clock: manualClock(START_MS), random: () => 0 },
      request(),
    );
    const parsed = RealtimeTokenResponseSchema.parse(result);
    if (!parsed.ok || parsed.value.token === null) throw new Error('expected a token');
    expect(decodeProtectedHeader(parsed.value.token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const { payload } = await jwtVerify(parsed.value.token, new TextEncoder().encode(TOKEN_SECRET), {
      algorithms: ['HS256'],
      currentDate: new Date(START_MS),
    });
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(payload).toEqual({ sub: 'acc_1-x', iat: START_MS / 1000, exp: START_MS / 1000 + 2700 });
    expect(parsed.value.expiresAt).toBe(new Date(START_MS + 2700 * 1000).toISOString());
  });

  it('AC-19: without a signer the route answers 503 `unavailable` / `realtime-not-configured`', async () => {
    const deps = { realtime: { random: () => 0.5, prefix: '' }, subjects: subjectOf({ kind: 'guest', id: 'g1' }) } as Partial<Deps> as Deps;
    const ctx = { req: request(), clock: manualClock(START_MS), deps } as Partial<Ctx> as Ctx;
    const outcome = await realtimeTokenRoute.handler(ctx);
    expect(outcome).toEqual({ ok: false, error: { code: 'unavailable', reason: 'realtime-not-configured' } });
    expect(errors.unavailable).toBe(503);
  });

  it('AC-19: the use case itself answers `realtime-not-configured` without a signer and never resolves the subject', async () => {
    let resolved = 0;
    const resolver: SubjectResolver = { resolve: async () => ((resolved += 1), { kind: 'guest', id: 'g1' }) };
    const outcome = await issueRealtimeToken({ resolver, clock: manualClock(START_MS), random: () => 0.5 }, request());
    expect(outcome).toEqual({ ok: false, error: { code: 'unavailable', reason: 'realtime-not-configured' } });
    expect(resolved).toBe(0);
  });

  it('AC-58: the test-only `ttlSeconds` replaces the spread lifetime', async () => {
    const signer = recordingSigner();
    const deps = { resolver: subjectOf({ kind: 'guest', id: 'g1' }), signer, clock: manualClock(START_MS), random: () => 0.99 };
    const result = await issueRealtimeToken(deps, request(), 5);
    expect(result.ok).toBe(true);
    expect(signer.calls.map((c) => c.exp - c.iat)).toEqual([5]);
  });
});
