/**
 * `POST /api/_test/ops-tick` (SPEC-13b W18): one tick of the process's ops runner at a substitute wall-clock
 * `now` — the heartbeat and digest planners, the `log-alarms` prune and the Telegram sender (`jobs` narrows them,
 * run order stays) — and answers each job's outcome. The ops schedules run on the real wall clock (AC-22), so
 * this door, not the SPEC-07 test clock, is how tests reach 31.12 or 09:00 Kyiv. Part of the doors module, so it
 * exists only in the `test` class with `T2F_TEST_DOORS=1`.
 */
import { z } from 'zod';
import { failure } from '../endpoints/pipeline';
import { OPS_JOBS } from '../ops/runner';
import type { DoorRow } from './registry';

export const OpsTickBodySchema = z
  .object({
    now: z.string().datetime({ offset: true }),
    jobs: z.array(z.enum(OPS_JOBS)).min(1).optional(),
  })
  .strict();

export const opsTickDoor: DoorRow = {
  key: 'ops-tick',
  method: 'POST',
  path: '/api/_test/ops-tick',
  body: OpsTickBodySchema,
  async handler(ctx) {
    const { now, jobs } = ctx.body as z.infer<typeof OpsTickBodySchema>;
    const runner = ctx.deps.opsRunner;
    if (!runner) return failure('unavailable', { reason: 'ops-not-wired' });
    return { ok: true, value: { jobs: await runner.tick(Date.parse(now), jobs) } };
  },
};
