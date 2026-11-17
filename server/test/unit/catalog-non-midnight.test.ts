/**
 * The non-midnight read port (AC-66): an event without a valid `startsAt` (impossible through the
 * API, AC-48) is left out instead of throwing `RangeError: Invalid time value` (B1).
 */
import { describe, expect, it } from 'vitest';
import type { CatalogStore, StoredCatalog } from '../../src/catalog/ports';
import { nonMidnightEvents } from '../../src/catalog/service';

const event = (eventId: string, slot: string | null, startsAt: unknown) => ({ eventId, cityId: 'c', zoneId: 'z', countryIso: 'UA', slot, startsAt });

const storeOf = (events: Record<string, unknown>[]): CatalogStore => ({
  read: async (): Promise<StoredCatalog> => ({ season: null, zones: [], countries: [], cities: [], events, traditions: [] }),
});

describe('nonMidnightEvents (AC-66)', () => {
  it('returns non-midnight events with their startsAt and skips those without a valid one', async () => {
    const got = await nonMidnightEvents(
      storeOf([
        event('m', 'midnight', null),
        event('ok', 'dawn', '2026-12-31T22:00:00.000Z'),
        event('date', 'jan-1', new Date('2027-01-01T08:00:00Z')),
        event('null', 'fireworks-20', null),
        event('absent', 'dawn', undefined),
        event('garbage', 'dawn', 'not a date'),
      ]),
    );
    expect(got).toEqual([
      { eventId: 'ok', cityId: 'c', zoneId: 'z', countryIso: 'UA', slot: 'dawn', startsAt: '2026-12-31T22:00:00.000Z' },
      { eventId: 'date', cityId: 'c', zoneId: 'z', countryIso: 'UA', slot: 'jan-1', startsAt: '2027-01-01T08:00:00.000Z' },
    ]);
  });
});
