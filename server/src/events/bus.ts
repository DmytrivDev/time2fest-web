/**
 * Delivery loop of internal events (AC-40), ring 3. One per process:
 * - starts at the highest committed id, so only events committed after the start are delivered;
 * - drains on every wake-up of the source (a commit notification) and on a 500 ms poll that covers
 *   lost notifications;
 * - delivers each event, in id order, to every matching subscriber, at most once per process
 *   (`lastSeen` in memory); a failing subscriber is logged and does not stop the others.
 */
import type { Logger } from '../ports';
import type { EventSource, EventSubscriber, InternalEvent } from './ports';

export const POLL_MS = 500;
const BATCH = 100;

export interface EventBus {
  stop(): Promise<void>;
}

export interface BusDeps {
  source: EventSource;
  subscribers: readonly EventSubscriber[];
  log: Logger;
  pollMs?: number;
}

const matches = (s: EventSubscriber, e: InternalEvent) => s.topic === '*' || s.topic === e.topic;

export async function startEventBus({ source, subscribers, log, pollMs = POLL_MS }: BusDeps): Promise<EventBus> {
  let lastSeen = await source.maxId();
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  async function deliver(event: InternalEvent): Promise<void> {
    for (const s of subscribers) {
      if (!matches(s, event)) continue;
      try {
        await s.handle(event);
      } catch (err) {
        log.error({ msg: 'event subscriber failed', subscriber: s.key, topic: event.topic, eventId: event.id, err });
      }
    }
  }

  async function drainOnce(): Promise<void> {
    for (;;) {
      const batch = await source.after(lastSeen, BATCH);
      for (const event of batch) {
        lastSeen = event.id;
        await deliver(event);
      }
      if (batch.length < BATCH || stopped) return;
    }
  }

  /** One drain at a time; a wake-up during a drain schedules exactly one more. */
  function drain(): void {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = drainOnce()
      .catch((err: unknown) => log.warn({ msg: 'event drain failed', err }))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          drain();
        }
      });
  }

  const unwatch = source.watch(drain);
  const timer = setInterval(drain, pollMs);
  timer.unref?.();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await unwatch();
      await running;
    },
  };
}
