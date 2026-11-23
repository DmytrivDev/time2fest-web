/**
 * Subscriber registry of internal events (AC-40): sorted, unique rows, one line per domain.
 * `testOnly` rows are delivered to only in the `test` class (`startBackground`).
 */
import { processDeps } from '../adapters/processDeps';
import { createCatalogR2Subscriber } from '../catalog/copy';
import type { EventSubscriber, InternalEvent } from '../events/ports';
import { createLiveFanOutSubscribers } from '../live/fanout';
import { assertRegistry } from '../platform/registry';
import { createSchedulerRecomputeSubscribers } from '../scheduler/recompute';
import { createSiteFanOutSubscribers } from '../site/fanout';
import { createRebuildSubscriber } from '../site/rebuild';
import { createClockRefreshSubscriber } from '../timekeeping/shared';

const RECORDED = Symbol.for('t2f.test.recordedEvents');

/** Events the test recorder received in this process (test class only). */
export function recordedEvents(): InternalEvent[] {
  const g = globalThis as unknown as Record<symbol, InternalEvent[] | undefined>;
  return (g[RECORDED] ??= []);
}

const testRecorder: EventSubscriber = {
  key: 'test-recorder',
  topic: '*',
  testOnly: true,
  handle(event) {
    recordedEvents().push(event);
  },
};

/** The R2 copy of the catalog (AC-72): its dependencies come from the process deps (`Deps.catalogCopy`). */
const catalogR2Copy = createCatalogR2Subscriber(async () => (await processDeps()).catalogCopy?.());

/** The clock cache of this process follows every committed clock change (SPEC-07 AC-49). */
const clockRefresh = createClockRefreshSubscriber(async () => (await processDeps()).sharedClock);

/** The scheduler's moment list follows every committed catalog change and correction (SPEC-07 AC-25, AC-74). */
const [schedulerRecomputeCatalog, schedulerRecomputePatch] = createSchedulerRecomputeSubscribers(async () => (await processDeps()).scheduler);

/** The `site` snapshot follows every committed site, catalog and correction change (SPEC-08 AC-5 … AC-7, AC-33 … AC-36). */
const [siteFanOutCatalog, siteFanOutPatch, siteFanOutSite] = createSiteFanOutSubscribers(async () => (await processDeps()).siteFanOut?.());

/** The live chains follow every committed live change and correction (SPEC-12 AC-5 … AC-7, AC-14, AC-15). */
const [liveFanOutChange, liveFanOutPatch] = createLiveFanOutSubscribers(async () => (await processDeps()).liveFanOut?.());

/** The catalog rebuild follows every committed catalog change, 150 s after the last (SPEC-08 AC-61). */
const siteRebuild = createRebuildSubscriber(async () => (await processDeps()).rebuild?.());

export const subscriberRegistry: readonly EventSubscriber[] = [
  catalogR2Copy,
  clockRefresh,
  liveFanOutChange,
  liveFanOutPatch,
  schedulerRecomputeCatalog,
  schedulerRecomputePatch,
  siteFanOutCatalog,
  siteFanOutPatch,
  siteFanOutSite,
  siteRebuild,
  testRecorder,
];

assertRegistry('subscribers', subscriberRegistry, (r) => r.key);
