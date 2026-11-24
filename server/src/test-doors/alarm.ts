/**
 * `POST /api/_test/alarm` (AC-39): saves a `page` alarm through the alarm store port and answers
 * its id. With `level` (SPEC-13b AC-2, AC-12, AC-27) it instead raises the alarm through the process
 * alarm — the delivering one: `alarms`, the Telegram outbox, `log-alarms` — and answers `{ raised: true }`.
 * Part of the doors module, so it exists only in the `test` class with `T2F_TEST_DOORS=1`.
 */
import { alarmStoreOf } from '../endpoints/deps';
import { z } from 'zod';
import type { DoorRow } from './registry';

export const AlarmDoorBodySchema = z
  .object({
    source: z.string().min(1).max(100),
    code: z.string().min(1).max(100),
    level: z.enum(['page', 'log']).optional(),
    details: z.record(z.string(), z.union([z.string().max(200), z.number()])).optional(),
  })
  .strict();

export const alarmDoor: DoorRow = {
  key: 'alarm',
  method: 'POST',
  path: '/api/_test/alarm',
  body: AlarmDoorBodySchema,
  async handler(ctx) {
    const { source, code, level, details } = ctx.body as z.infer<typeof AlarmDoorBodySchema>;
    if (level !== undefined) {
      ctx.deps.alarm.raise({ level, source, code, ...(details ? { details } : {}) });
      return { ok: true, value: { raised: true } };
    }
    const { id } = await alarmStoreOf(ctx.deps).save({ source, code });
    ctx.deps.log.error({ level: 'alarm', alarm: 'page', source, code });
    return { ok: true, value: { id } };
  },
};
