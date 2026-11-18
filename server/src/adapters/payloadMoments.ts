/**
 * Moment source of the scheduler over the stored catalog and the event corrections (SPEC-07 AC-24,
 * AC-25), ring 4. Returns the INPUT of `seasonMoments` (the scheduler service calls the rule):
 * - zones: their tzdb midnight (`midnightUtc`), never patched — `zone-midnight`, `pin-end`,
 *   `poll-start`, `poll-end` follow them;
 * - events: only slot `midnight` (the catalog's season events, like `assemble.ts`), each at its
 *   effective moment (correction applied, `momentsWithPatches`), with its `sortIndex` and `hidden`;
 * - `seasonId`: the season key (`2026-27`); empty when the catalog has no season (then no zones are
 *   returned either, and the list is empty).
 * Connection failures surface as `DependencyUnavailable('postgres')`. Payload rows never leave.
 */
import type { Payload } from 'payload';
import type { CatalogStore } from '../catalog/ports';
import { momentsWithPatches } from '../corrections/service';
import { isDependencyFailure } from '../endpoints/pipeline';
import { DependencyUnavailable } from '../ports';
import type { MomentSource, SeasonInput } from '../scheduler/ports';
import { createPayloadCorrectionReader } from './payloadCorrections';

const MIDNIGHT_SLOT = 'midnight';

export interface PayloadMomentSourceOptions {
  payload: () => Promise<Payload>;
  catalog: CatalogStore;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export function createPayloadMomentSource({ payload, catalog }: PayloadMomentSourceOptions): MomentSource {
  const reader = createPayloadCorrectionReader(payload);
  return {
    async load(): Promise<SeasonInput> {
      try {
        const [stored, patched] = await Promise.all([catalog.read(), momentsWithPatches(reader)]);
        if (!stored.season) return { seasonId: '', zones: [], events: [] };
        const zones = stored.zones
          .map((z) => ({ zoneId: str(z.zoneId), midnightMs: Date.parse(str(z.midnightUtc)) }))
          .filter((z) => z.zoneId !== '' && Number.isFinite(z.midnightMs));
        const rows = new Map(stored.events.map((e) => [str(e.eventId), e]));
        const events = patched.events
          .filter((e) => {
            const slot = str(rows.get(e.eventId)?.slot) || MIDNIGHT_SLOT;
            return slot === MIDNIGHT_SLOT && Number.isFinite(e.moment);
          })
          .map((e) => {
            const sortIndex = Number(rows.get(e.eventId)?.sortIndex);
            return {
              eventId: e.eventId,
              zoneId: e.zoneId,
              countryIso: e.countryIso,
              momentMs: e.moment,
              sortIndex: Number.isFinite(sortIndex) ? sortIndex : 0,
              ...(e.hidden ? { hidden: true } : {}),
            };
          });
        return { seasonId: stored.season.key, zones, events };
      } catch (err) {
        if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
        throw err;
      }
    },
  };
}
