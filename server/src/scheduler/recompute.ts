/**
 * Subscriber rows "recompute the moments" (SPEC-07 AC-25, AC-74): a committed `catalog.changed` or
 * `event-patch.changed` marks the scheduler's moment list stale; its next pass (≤ 250 ms later)
 * reloads it, well within the 2 s of AC-25. Two rows, so each `topic` stays exact; both keys start
 * with `scheduler-recompute`. `scheduler` resolves to `undefined` in a process without one.
 */
import { CATALOG_CHANGED_TOPIC } from '../catalog/service';
import { EVENT_PATCH_CHANGED_TOPIC } from '../corrections/service';
import type { EventSubscriber } from '../events/ports';
import type { SchedulerHandle } from './service';

export const SCHEDULER_RECOMPUTE = 'scheduler-recompute';

export function createSchedulerRecomputeSubscribers(
  scheduler: () => Promise<Pick<SchedulerHandle, 'recompute'> | undefined>,
): readonly [EventSubscriber, EventSubscriber] {
  const row = (suffix: string, topic: string): EventSubscriber => ({
    key: `${SCHEDULER_RECOMPUTE}-${suffix}`,
    topic,
    async handle() {
      (await scheduler())?.recompute();
    },
  });
  return [row('catalog', CATALOG_CHANGED_TOPIC), row('patch', EVENT_PATCH_CHANGED_TOPIC)] as const;
}
