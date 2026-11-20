/**
 * `POST /api/_test/site` (SPEC-08 AC-68, W19): the site-state controls of the tests. Part of the doors module, so
 * it exists only in the `test` class with `T2F_TEST_DOORS=1`. Body `SiteDoorBodySchema`:
 * - `switch` — toggle-with-reason through the site service, actor `system:test-door`, the given mode;
 * - `products` — replaces the list of the products fake (test data only; no route, admin action or door of a
 *   real class sets an amount, AC-21);
 * - `select` — chooses a listed product through the site service;
 * - `redButton` — `put` writes `<prefix>site/red-button.json` = the current snapshot with `outage: 'technical'`
 *   into the test bucket, `delete` removes it;
 * - `reset` — the record back to its defaults (version 1, nothing fanned out yet) and an empty fake.
 */
import { SITE_R2_KEYS } from '@time2fest/contracts';
import { SiteDoorBodySchema, type SiteDoorBody } from '@time2fest/contracts/schemas';
import { TEST_DOOR_ACTOR } from '../clock';
import { technicalOf } from '../domain/site/snapshot';
import { siteOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Outcome } from '../endpoints/types';
import { chooseProduct, toggle, type SiteResult } from '../site/service';
import { readSnapshot } from '../site/snapshot';
import type { DoorRow } from './registry';

const DOOR_REASON = 'test door';

function resultOf(result: SiteResult): Outcome {
  if (result.ok) return { ok: true, value: { version: result.version, changed: result.changed } };
  return failure(result.reason === 'forbidden' ? 'forbidden' : 'validation', result.detail ? { reason: result.detail } : {});
}

export const siteDoor: DoorRow = {
  key: 'site',
  method: 'POST',
  path: '/api/_test/site',
  body: SiteDoorBodySchema,
  async handler(ctx) {
    const site = siteOf(ctx.deps);
    const body = ctx.body as SiteDoorBody;
    switch (body.action) {
      case 'switch': {
        const { key, value, mode, room, tier, reason } = body;
        const input = { key, value, reason: reason ?? DOOR_REASON, ...(room === undefined ? {} : { room }), ...(tier === undefined ? {} : { tier }) };
        return resultOf(await toggle(site, null, TEST_DOOR_ACTOR, input, mode));
      }
      case 'products': {
        if (!site.testProducts) return failure('unavailable');
        site.testProducts.set(body.list.map((p) => ({ id: p.productId, key: p.key, price: { amount: p.price.amount, currency: p.price.currency } })));
        return { ok: true, value: {} };
      }
      case 'select':
        return resultOf(await chooseProduct(site, null, TEST_DOOR_ACTOR, { key: body.key, productId: body.productId, reason: DOOR_REASON }));
      case 'redButton': {
        const bucket = ctx.deps.catalogCopy?.();
        if (!bucket) return failure('unavailable', { reason: 'no-bucket' });
        const key = `${bucket.prefix}${SITE_R2_KEYS.redButton}`;
        if (body.op === 'delete') {
          if (!bucket.objects.delete) return failure('unavailable', { reason: 'no-delete' });
          await bucket.objects.delete(key);
          return { ok: true, value: {} };
        }
        const read = await readSnapshot(site.snapshot);
        if (!read.ok) return failure('unavailable', { reason: read.reason });
        await bucket.objects.put(key, JSON.stringify(technicalOf(read.state)), 'application/json');
        return { ok: true, value: { version: read.state.version } };
      }
      case 'reset': {
        if (!site.resetForTests) return failure('unavailable');
        await site.resetForTests();
        return { ok: true, value: {} };
      }
    }
  },
};
