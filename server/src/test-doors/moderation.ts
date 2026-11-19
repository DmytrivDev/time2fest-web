/**
 * `POST /api/_test/moderation` (SPEC-09 AC-50): the moderation controls of the tests and the load run.
 * Part of the doors module, so it exists only in the `test` class with `T2F_TEST_DOORS=1`.
 * - `reset`: the layer's health windows and states, the counter's in-memory sums and cached settings;
 * - `setSpend`: the bucket of `period` near now gets exactly `usd` (database and counter), ceiling re-judged;
 * - `status`: the state of both AI tasks;
 * - `verdict`: one verdict of the service (the NFR-1 load run). The text is never logged.
 */
import type { ModerationDoorBody, ModerationDoorValue } from '@time2fest/contracts';
import { ModerationDoorBodySchema } from '@time2fest/contracts/schemas';
import { moderationOf } from '../endpoints/deps';
import type { DoorRow } from './registry';

export const moderationDoor: DoorRow = {
  key: 'moderation',
  method: 'POST',
  path: '/api/_test/moderation',
  body: ModerationDoorBodySchema,
  async handler(ctx) {
    const m = moderationOf(ctx.deps);
    const body = ctx.body as ModerationDoorBody;
    let value: ModerationDoorValue;
    switch (body.op) {
      case 'reset':
        m.spend.reset();
        m.layer.reset();
        value = { op: 'reset' };
        break;
      case 'setSpend':
        await m.spend.setSpendForDoor(body.period, body.usd);
        value = { op: 'setSpend', period: body.period, usd: body.usd };
        break;
      case 'status':
        value = { op: 'status', statuses: [m.layer.state('moderation'), m.layer.state('translation')] };
        break;
      case 'verdict': {
        const v = await m.verdict.verdict({ kind: body.kind, text: body.text });
        value = { op: 'verdict', outcome: v.outcome, source: v.source, ...(v.reason === undefined ? {} : { reason: v.reason }) };
        break;
      }
    }
    return { ok: true, value };
  },
};
