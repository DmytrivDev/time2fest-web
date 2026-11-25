/**
 * SPEC-10 W37 (AC-45): the `mail-plan` job through the `ops-tick` door over real Redis/Postgres —
 * 30.12 09:00 Kyiv raises one `page` alarm `mail/plan-free`, a second tick and another process raise none,
 * `T2F_MAIL_PLAN=pro` and 29.12 raise none.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { alarmStoreOf, buildDispatcher } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { post, testDeps } from './helpers';

describe('mail plan reminder through the ops-tick door (AC-45)', () => {
  const live: Deps[] = [];
  const fresh = (env: Record<string, string | undefined> = {}): Deps => {
    const d = testDeps({}, env);
    live.push(d);
    return d;
  };
  afterAll(async () => {
    for (const d of live.splice(0)) await d.opsRunner?.stop();
  });

  async function tick(deps: Deps, iso: string): Promise<{ result: string }> {
    const dispatch = await buildDispatcher(deps);
    const res = await dispatch(post('/api/_test/ops-tick', { now: iso, jobs: ['mail-plan'] }));
    expect(res.status).toBe(200);
    return ((await res.json()) as { value: { jobs: Record<string, { result: string }> } }).value.jobs['mail-plan']!;
  }
  const planAlarms = async (deps: Deps) => (await alarmStoreOf(deps).listOpenPage()).filter((a) => a.code === 'mail/plan-free').length;

  it('free plan: one page alarm per Kyiv day, none on 29.12, none on pro', async () => {
    const a = fresh({ T2F_MAIL_PLAN: 'free' });
    await a.redis.deleteByPrefix('mail:alarm:plan-free:');
    const base = await planAlarms(a);
    expect((await tick(a, '2026-12-29T07:00:00Z')).result).toBe('idle');
    expect((await tick(a, '2026-12-30T07:00:00Z')).result).toBe('raised');
    expect((await tick(a, '2026-12-30T07:05:00Z')).result).toBe('idle');
    await a.opsRunner?.stop(); // the first process releases its lease; the next one finds the day claimed
    const b = fresh({ T2F_MAIL_PLAN: 'free' });
    expect((await tick(b, '2026-12-30T07:10:00Z')).result).toBe('duplicate');
    expect(await planAlarms(a)).toBeLessThanOrEqual(base + 1);
    const pro = fresh({ T2F_MAIL_PLAN: 'pro' });
    expect((await tick(pro, '2026-12-31T07:00:00Z')).result).toBe('idle');
  }, 60_000);
});
