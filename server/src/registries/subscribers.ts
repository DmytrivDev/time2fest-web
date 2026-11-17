/**
 * Subscriber registry of internal events (AC-40): sorted, unique rows, one line per domain.
 * `testOnly` rows are delivered to only in the `test` class (`startBackground`).
 */
import { processDeps } from '../adapters/processDeps';
import { createCatalogR2Subscriber } from '../catalog/copy';
import type { EventSubscriber, InternalEvent } from '../events/ports';
import { assertRegistry } from '../platform/registry';

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

export const subscriberRegistry: readonly EventSubscriber[] = [
  catalogR2Copy,
  testRecorder,
];

assertRegistry('subscribers', subscriberRegistry, (r) => r.key);
