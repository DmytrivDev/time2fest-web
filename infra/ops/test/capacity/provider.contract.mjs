// @ts-check
// Контрактний набір провайдера потужності (AC-45): фейк і адаптер провайдера проходять одні й ті самі перевірки.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../../lib/capacity/provider.mjs';

/**
 * @typedef {import('../../lib/capacity/fake.mjs').SeedNode} SeedNode
 * @typedef {{
 *   provider: import('../../lib/capacity/provider.mjs').Provider,
 *   failNext: (status: number, retryAfterSec?: number) => void,
 *   close?: () => Promise<void> | void,
 * }} ProviderHarness
 */

const MANAGED = 't2f-managed';
const ENV = 't2f-env-rehearsal';

/** @type {SeedNode[]} */
export const CONTRACT_SEED = [
  { name: 't2f-rehearsal-main', size: 's-2vcpu-4gb', diskGb: 80, tags: [MANAGED, ENV, 't2f-role-main'] },
  { name: 'manual-box', size: 's-2vcpu-4gb', diskGb: 80, tags: [ENV] },
  { name: 't2f-production-main', size: 's-4vcpu-8gb', diskGb: 160, tags: [MANAGED, 't2f-env-production', 't2f-role-main'] },
];

/**
 * @param {string} name
 * @param {(seed: SeedNode[]) => Promise<ProviderHarness>} makeProvider
 */
export function describeProvider(name, makeProvider) {
  describe(`контракт провайдера: ${name}`, () => {
    /** @type {ProviderHarness} */
    let h;
    beforeEach(async () => {
      h = await makeProvider(CONTRACT_SEED);
    });
    afterEach(async () => {
      await h.close?.();
    });

    it('список за тегами — лише вузли з усіма тегами', async () => {
      const both = await h.provider.listNodes([MANAGED, ENV]);
      expect(both.map((n) => n.name)).toEqual(['t2f-rehearsal-main']);
      const managed = await h.provider.listNodes([MANAGED]);
      expect(managed.map((n) => n.name).sort()).toEqual(['t2f-production-main', 't2f-rehearsal-main']);
      const env = await h.provider.listNodes([ENV]);
      expect(env.map((n) => n.name).sort()).toEqual(['manual-box', 't2f-rehearsal-main']);
      expect(both[0]).toMatchObject({ size: 's-2vcpu-4gb', status: 'active', diskGb: 80 });
      expect(typeof both[0].id).toBe('string');
    });

    it('створений вузол активний, з тегами й адресою', async () => {
      const tags = [MANAGED, ENV, 't2f-role-realtime'];
      const n = await h.provider.createNode({ name: 't2f-rehearsal-realtime', region: 'fra1', size: 's-2vcpu-4gb', tags });
      expect(n.status).toBe('active');
      expect(n.publicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      const listed = await h.provider.listNodes([MANAGED, ENV, 't2f-role-realtime']);
      expect(listed.map((x) => [x.id, x.status])).toEqual([[n.id, 'active']]);
      expect(listed[0].tags).toEqual(expect.arrayContaining(tags));
    });

    it('зміна розміру міняє розмір, диск лишається, вузол знову активний', async () => {
      const [main] = await h.provider.listNodes([MANAGED, ENV]);
      await h.provider.resizeNode(main.id, 's-4vcpu-8gb');
      const [after] = await h.provider.listNodes([MANAGED, ENV]);
      expect(after).toMatchObject({ id: main.id, size: 's-4vcpu-8gb', diskGb: main.diskGb, status: 'active' });
    });

    it('видалений вузол зникає зі списку', async () => {
      const [main] = await h.provider.listNodes([MANAGED, ENV]);
      await h.provider.deleteNode(main.id);
      expect(await h.provider.listNodes([MANAGED, ENV])).toEqual([]);
    });

    it('обмеження частоти (429) — ProviderError зі статусом 429', async () => {
      h.failNext(429, 7);
      const e = await h.provider.listNodes([MANAGED]).catch((x) => x);
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.status).toBe(429);
      expect(e.retryAfterSec).toBeGreaterThanOrEqual(0);
    });

    it('розміри мають ціну за годину > 0', async () => {
      const sizes = await h.provider.sizes();
      expect(sizes.length).toBeGreaterThan(0);
      for (const s of sizes) {
        expect(s.priceHourly).toBeGreaterThan(0);
        expect(s.vcpus).toBeGreaterThan(0);
        expect(s.memoryMb).toBeGreaterThan(0);
      }
      expect(sizes.map((s) => s.slug)).toEqual(expect.arrayContaining(['s-2vcpu-4gb', 's-4vcpu-8gb']));
    });
  });
}
