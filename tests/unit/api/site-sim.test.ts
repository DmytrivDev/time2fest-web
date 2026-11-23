/** Шов: адаптер `sim` домену `site` — типові значення, `peek`, відмови й реєстр. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getService, MIGRATED_DOMAINS } from '@/lib/api/services';
import { catalogVersionOf } from '@/lib/api/contracts/site';
import { resetSimSiteForTest } from '@/lib/api/sim/site';
import { resetSimFaultsForTest, simFaults } from '@/lib/api/sim/faults';
import { getData } from '@/lib/data/load';

beforeEach(() => {
  resetSimSiteForTest();
  resetSimFaultsForTest();
});
afterEach(() => resetSimFaultsForTest());

describe('sim-адаптер site', () => {
  it('state: типові значення й catalogVersion з meta каталогу', async () => {
    const r = await getService('site').state();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const price = (amount: number) => ({ amount, currency: 'USD' });
    expect(r.value).toEqual({
      version: 1,
      at: new Date(0).toISOString(),
      switches: {
        chat: true,
        toasts: true,
        pass: true,
        passGift: true,
        payments: true,
        viewersMap: true,
        viewersCount: true,
        passOffer: true,
        chatRooms: {},
        toastTiers: { '2': true, '5': true, '10': true },
      },
      products: [
        { key: 'pass', price: price(500), priceVersion: 1 },
        { key: 'toast:2', price: price(200), priceVersion: 1 },
        { key: 'toast:5', price: price(500), priceVersion: 1 },
        { key: 'toast:10', price: price(1000), priceVersion: 1 },
      ],
      catalogVersion: catalogVersionOf(getData().meta),
      eventPatches: {},
    });
    expect(r.value.catalogVersion).toBe(`${getData().meta.generatedAt}+${getData().meta.tzdbVersion}`);
  });

  it('peek: undefined до state(), після — те саме значення', async () => {
    const svc = getService('site');
    expect(svc.peek()).toBeUndefined();
    const r = await svc.state();
    expect(r.ok && svc.peek()).toBe(r.ok ? r.value : undefined);
  });

  it('сервіс є в sim, відмова network працює, site у MIGRATED_DOMAINS (SPEC-08, адаптер http)', async () => {
    const svc = getService('site');
    simFaults.failNext('site', 'state', 'network');
    const r = await svc.state();
    expect(r).toMatchObject({ ok: false, error: { code: 'network' } });
    expect(MIGRATED_DOMAINS).toContain('site');
  });
});
