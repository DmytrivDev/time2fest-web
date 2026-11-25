import { describe, expect, it } from 'vitest';
import { planReminderDue } from '../../src/domain/mail/planReminder';
import { createMailPlanJob } from '../../src/ops/mailPlan';

const at = (s: string) => Date.parse(s);

describe('plan reminder (AC-45)', () => {
  it('fires 30.12 and 31.12 from 09:00 Kyiv on the free plan', () => {
    expect(planReminderDue(at('2026-12-30T06:59:59Z'), 'free')).toBeNull();
    expect(planReminderDue(at('2026-12-30T07:00:00Z'), 'free')).toEqual({ dueKey: '2026-12-30' });
    expect(planReminderDue(at('2026-12-31T18:00:00Z'), 'free')).toEqual({ dueKey: '2026-12-31' });
  });
  it('is silent on other days and on the pro plan', () => {
    expect(planReminderDue(at('2026-12-29T12:00:00Z'), 'free')).toBeNull();
    expect(planReminderDue(at('2026-11-30T12:00:00Z'), 'free')).toBeNull();
    expect(planReminderDue(at('2026-12-30T12:00:00Z'), 'pro')).toBeNull();
  });
});

describe('plan reminder job', () => {
  function build(plan: 'free' | 'pro', held = true) {
    const claims = new Set<string>();
    const raised: unknown[] = [];
    const job = createMailPlanJob({
      plan,
      lease: { acquire: async () => held, release: async () => {} } as never,
      store: { setIfAbsent: async (k: string) => (claims.has(k) ? false : (claims.add(k), true)) } as never,
      alarm: { raise: (a: unknown) => raised.push(a) } as never,
    });
    return { job, raised };
  }
  it('raises one page alarm per day', async () => {
    const { job, raised } = build('free');
    expect(await job.run(at('2026-12-30T07:00:00Z'))).toEqual({ result: 'raised', dueKey: '2026-12-30' });
    expect(await job.run(at('2026-12-30T08:00:00Z'))).toEqual({ result: 'idle' });
    expect(raised).toEqual([{ level: 'page', source: 'mail', code: 'mail/plan-free' }]);
    expect((await job.run(at('2026-12-31T07:00:00Z'))).result).toBe('raised');
  });
  it('does nothing without the lease or on pro', async () => {
    expect((await build('free', false).job.run(at('2026-12-30T07:00:00Z'))).result).toBe('not-held');
    expect((await build('pro').job.run(at('2026-12-30T07:00:00Z'))).result).toBe('idle');
  });
});
