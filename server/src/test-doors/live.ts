/**
 * `POST /api/_test/live` (SPEC-12 AC-72, W38): the live-air controls of the tests. Part of the doors module, so it
 * exists only in the `test` class with `T2F_TEST_DOORS=1`. Body `LiveDoorBodySchema` (discriminator `door`):
 * - `video-status` — sets one video's state in the YouTube fake (`/_control/videos` of `T2F_YOUTUBE_BASE_URL`);
 * - `quota` — the `queries` bucket of the current quota day is `used` (and stopped until the next day boundary when
 *   `exceeded`); the quota counters are replaced, not added to;
 * - `viewers` — fixture entries that replace presence in the viewers aggregator of THIS process: `countries` each get
 *   `viewersMinPerCountry` entries, the rest of `people` are counted without a country (so the summary shows exactly
 *   `people` and the listed countries that have a catalog row);
 * - `hide` — the owner's hide action (journal row, version bump, `live.changed`), reason «test door»;
 * - `reset-live` — the fake emptied, the quota counters and stream sources emptied, the seed's stream sources
 *   re-applied, the viewer fixture dropped.
 */
import { LiveDoorBodySchema } from '@time2fest/contracts/schemas';
import type { LiveDoorBody, LiveVideoState } from '@time2fest/contracts';
import type { Actor } from '../audit/ports';
import { TEST_DOOR_ACTOR } from '../clock';
import { nextDayBoundary, quotaDay } from '../domain/live/quota';
import type { PresenceEntry } from '../domain/live/viewers';
import { liveOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Ctx, Outcome } from '../endpoints/types';
import { applyLiveAction } from '../live/actions';
import { liveActionsOf } from '../registries/revertHandlers';
import { runSeed } from '../seed/index';
import { seedRegistry } from '../seed/registry';
import type { DoorRow } from './registry';

const DOOR_REASON = 'test door';
/** The hide door acts as the owner would (AC-51), named as the test door in the journal. */
const DOOR_OWNER: Actor = Object.freeze({ ...TEST_DOOR_ACTOR, kind: 'owner' });
const STREAM_SOURCES_ROW = 'live-1-stream-sources';
const LIVE_COLLECTIONS = ['live-quota', 'stream-sources'] as const;

/** The fake's `/_control/videos` row of a contract state. */
const FAKE_STATE: Record<LiveVideoState, { state: string; embeddable?: boolean }> = {
  live: { state: 'live' },
  upcoming: { state: 'upcoming' },
  ended: { state: 'ended' },
  private: { state: 'private' },
  'not-embeddable': { state: 'live', embeddable: false },
  missing: { state: 'deleted' },
};

/** POSTs a control call to the YouTube fake: `null` when it answered 2xx, else the failure to return. */
async function controlFake(ctx: Ctx, path: string, body: unknown): Promise<Outcome | null> {
  const base = ctx.env.vars.T2F_YOUTUBE_BASE_URL as string | undefined;
  if (base === undefined) return failure('unavailable', { reason: 'no-youtube-fake' });
  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return res.ok ? null : failure('unavailable', { reason: 'youtube-fake-refused' });
}

/** The fixture entries of `{people, countries}`; `null` when `people` cannot cover the countries' minimum. */
function viewerEntries(people: number, countries: readonly string[], perCountry: number): PresenceEntry[] | null {
  const unique = [...new Set(countries)];
  const placed = unique.length * perCountry;
  if (placed > people) return null;
  const entries: PresenceEntry[] = [];
  // Every person carries its own nonce: the aggregate counts one person per nonce (presence entries without one are dropped).
  for (const c of unique) for (let i = 0; i < perCountry; i += 1) entries.push({ chanInfo: { p: 1, n: `door-${entries.length}`, c } });
  for (let i = placed; i < people; i += 1) entries.push({ chanInfo: { p: 1, n: `door-${entries.length}` } });
  return entries;
}

export const liveDoor: DoorRow = {
  key: 'live',
  method: 'POST',
  path: '/api/_test/live',
  body: LiveDoorBodySchema,
  async handler(ctx, { seed }) {
    const live = liveOf(ctx.deps);
    const body = ctx.body as LiveDoorBody;
    switch (body.door) {
      case 'video-status': {
        const refused = await controlFake(ctx, '/_control/videos', { videos: [{ id: body.videoId, ...FAKE_STATE[body.state] }] });
        return refused ?? { ok: true, value: {} };
      }
      case 'quota': {
        const now = ctx.deps.clock.now();
        const day = quotaDay(now, live.cfg.dayTimeZone);
        await seed.clear('live-quota');
        if (body.used > 0) await live.quota.charge(day, 'queries', body.used);
        if (body.exceeded === true) await live.quota.markExceeded(day, 'queries', nextDayBoundary(now, live.cfg.dayTimeZone));
        return { ok: true, value: { day } };
      }
      case 'viewers': {
        const aggregator = live.viewers?.aggregator;
        if (aggregator?.setFixture === undefined) return failure('unavailable', { reason: 'no-viewer-fixtures' });
        const entries = viewerEntries(body.people, body.countries, live.cfg.viewersMinPerCountry);
        if (entries === null) return failure('validation', { reason: 'people-below-countries' });
        aggregator.setFixture(entries);
        return { ok: true, value: {} };
      }
      case 'hide': {
        const result = await applyLiveAction(liveActionsOf(ctx.deps), null, DOOR_OWNER, {
          action: 'hide',
          eventId: body.eventId,
          sourceId: body.sourceId,
          reason: DOOR_REASON,
        });
        if (result.ok) return { ok: true, value: { version: result.version, changed: result.changed } };
        const code = result.reason === 'not-found' ? 'not_found' : result.reason === 'forbidden' ? 'forbidden' : 'validation';
        return failure(code, result.detail ? { reason: result.detail } : {});
      }
      case 'reset-live': {
        if (ctx.env.vars.T2F_YOUTUBE_BASE_URL !== undefined) {
          const refused = await controlFake(ctx, '/_control/reset', {});
          if (refused) return refused;
        }
        for (const c of LIVE_COLLECTIONS) await seed.clear(c);
        await runSeed(seed, seedRegistry.filter((r) => r.key === STREAM_SOURCES_ROW));
        live.viewers?.aggregator.setFixture?.(null);
        return { ok: true, value: {} };
      }
      // SPEC-21a variants: wired in phase S3 (W15).
      case 'channels':
      case 'search-results':
        return failure('unavailable', { reason: 'not-implemented' });
    }
  },
};
