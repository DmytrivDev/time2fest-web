/** Catalog integrity on save (AC-49, W27): one refused save per rule, with the rule name in the error. */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { createTinyCatalog, errorText, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';

const run = `ci${Date.now()}`;

describe('catalog integrity (AC-49)', () => {
  let payload: Payload;
  let tiny: TinyCatalog;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    tiny = await createTinyCatalog(payload, run);
  });

  afterAll(async () => {
    await removeTinyCatalog(payload, run);
  });

  const event = (suffix: string, patch: Record<string, unknown> = {}) => ({
    eventId: `evt-${suffix}-${run}`,
    cityId: tiny.keys.city,
    zoneId: tiny.keys.zone,
    countryIso: tiny.keys.country,
    midnightUtc: '2026-12-31T23:00:00Z',
    isMainCelebration: false,
    ...patch,
  });

  const refused = async (data: Record<string, unknown>, rule: string) => {
    const err = await payload.create({ collection: 'events', data: data as never }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, rule).not.toBeNull();
    expect(errorText(err)).toContain(rule);
  };

  it('event-zone-missing', async () => refused(event('z', { zoneId: `nope-${run}` }), 'event-zone-missing'));
  it('event-city-missing', async () => refused(event('c', { cityId: `nope-${run}` }), 'event-city-missing'));
  it('event-country-missing', async () => refused(event('k', { countryIso: `NO${run}` }), 'event-country-missing'));
  it('city-zone-mismatch', async () => refused(event('m', { zoneId: tiny.keys.zone2, isMainCelebration: true }), 'city-zone-mismatch'));
  it('pair-main-count: a second main event in a pair', async () => refused(event('p', { isMainCelebration: true }), 'pair-main-count'));

  it('a valid non-main event in the pair is saved', async () => {
    const doc = await payload.create({ collection: 'events', data: event('ok') as never });
    expect(doc.eventId).toBe(`evt-ok-${run}`);
  });

  it('a city moved to another zone while its event stays is refused', async () => {
    const err = await payload
      .update({ collection: 'cities', id: tiny.ids.cities, data: { zoneId: tiny.keys.zone2 } })
      .then(() => null, (e: unknown) => e);
    expect(errorText(err)).toContain('city-zone-mismatch');
  });
});
