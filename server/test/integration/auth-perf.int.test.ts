/**
 * SPEC-10 W39 (NFR-2): `get-session` with a live session answers in <= 50 ms at p95 on the local stack — the real
 * pipeline in-process (Better Auth, this slot's Postgres and Redis). 500 sequential calls after a warm-up; the
 * numbers go to stdout (`T2F_MEASURE` + the p95 line).
 * SPEC-11 W14 (NFR-1): the same with an unattached pass on the device — the pass fields cost one indexed query.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightsOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, signIn, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';
import { note, percentile, printMeasure } from './measure';

const redis = ownRedis();
const started = new Date();
const grantTag = `perf-${randomBytes(4).toString('hex')}-`;
let pool: pg.Pool;
let h: AuthHarness;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`${grantTag}%`]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('get-session latency (NFR-2)', () => {
  it('500 calls with a session: p95 <= 50 ms', { timeout: 120_000 }, async () => {
    const jar = new CookieJar();
    const email = testEmail(`perf-${randomBytes(2).toString('hex')}`);
    expect((await signIn(h, redis, jar, email)).status).toBe(200);
    const one = async () => {
      const t0 = performance.now();
      const res = await h.call('/api/auth/get-session', { jar, ip: '198.18.7.7' });
      const ms = performance.now() - t0;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { value: { user: { id: string } | null } };
      expect(body.value.user).not.toBeNull();
      return ms;
    };
    for (let i = 0; i < 20; i += 1) await one();
    const times: number[] = [];
    for (let i = 0; i < 500; i += 1) times.push(await one());
    const s = printMeasure('auth.get-session', times);
    const p95 = percentile([...times].sort((a, b) => a - b), 0.95);
    note(`T2F_MEASURE_P95 auth.get-session n=${times.length} p50=${s.p50} p95=${Math.round(p95 * 10) / 10} p99=${s.p99} max=${s.max}`);
    expect(p95).toBeLessThanOrEqual(50);
  });

  it('500 calls with a device pass: p95 <= 50 ms (SPEC-11 NFR-1)', { timeout: 120_000 }, async () => {
    const jar = new CookieJar();
    const email = testEmail(`perf-pass-${randomBytes(2).toString('hex')}`);
    expect((await signIn(h, redis, jar, email)).status).toBe(200);
    const device = jar.get(DEVICE_COOKIE) ?? '';
    const granted = await rightsOf(h.deps).passes.grantPass({
      holder: { device, paymentEmail: testEmail('perf-pay') },
      source: 'purchase',
      grantRef: `${grantTag}1`,
    });
    expect(granted.kind).toBe('granted');
    const one = async () => {
      const t0 = performance.now();
      const res = await h.call('/api/auth/get-session', { jar, ip: '198.18.7.8' });
      const ms = performance.now() - t0;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { value: { hasPass: boolean; passOn: string | null } };
      expect(body.value).toMatchObject({ hasPass: true, passOn: 'device' });
      return ms;
    };
    for (let i = 0; i < 20; i += 1) await one();
    const times: number[] = [];
    for (let i = 0; i < 500; i += 1) times.push(await one());
    const s = printMeasure('auth.get-session.pass', times);
    const p95 = percentile([...times].sort((a, b) => a - b), 0.95);
    note(`T2F_MEASURE_P95 auth.get-session.pass n=${times.length} p50=${s.p50} p95=${Math.round(p95 * 10) / 10} p99=${s.p99} max=${s.max}`);
    expect(p95).toBeLessThanOrEqual(50);
  });
});
