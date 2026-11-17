/**
 * `POST /api/_test/alarm` (AC-39): saves a `page` alarm through the alarm store port and answers
 * its id. Part of the doors module, so it exists only in the `test` class with `T2F_TEST_DOORS=1`.
 */
import { z } from 'zod';
import type { DoorRow } from './registry';

export const AlarmDoorBodySchema = z
  .object({
    source: z.string().min(1).max(100),
    code: z.string().min(1).max(100),
  })
  .strict();

export const alarmDoor: DoorRow = {
  key: 'alarm',
  method: 'POST',
  path: '/api/_test/alarm',
  body: AlarmDoorBodySchema,
  async handler(ctx) {
    // The composition root holds the store; the doors module is itself loaded by it dynamically.
    const { alarmStoreOf } = await import('../container');
    const { source, code } = ctx.body as z.infer<typeof AlarmDoorBodySchema>;
    const { id } = await alarmStoreOf(ctx.deps).save({ source, code });
    ctx.deps.log.error({ level: 'alarm', alarm: 'page', source, code });
    return { ok: true, value: { id } };
  },
};
