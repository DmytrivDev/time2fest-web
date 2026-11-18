/**
 * The batcher of batched channel classes (ring 3, SPEC-06 AC-37, AC-38, AC-39, AC-40, NFR-5).
 *
 * Per channel: the first event of an empty queue schedules a flush at `first + 300 ms`, and never
 * earlier than `previous flush + 250 ms`. A flush takes the whole queue, splits it (`splitBatch`) and
 * publishes the batches one after another with the batch id as the idempotency key. Flushes of one
 * channel never overlap: the next one is scheduled only after the running one is over, so order holds
 * across batch boundaries. A failed batch is dropped with one `warn` line (class, event count, result;
 * never a body, a token or a key) and the schedule continues. Nothing here throws into domain code.
 *
 * A channel's queue holds at most `BATCH_QUEUE_CAP` events (10 × the batch event cap): beyond it `enqueue`
 * answers `full` and writes one `warn` line per flush window at most, so a stalled API cannot grow memory
 * without bound or flood the log.
 *
 * Timers come from the `Scheduler` port (the composition root passes `unref`'d global timers, so they
 * never keep a process alive) and time from `Clock`; `stop()` clears every timer.
 */
import { REALTIME_MAX_BATCH_EVENTS, type RealtimeEnvelope } from '@time2fest/contracts';
import { splitBatch } from '../domain/realtime/batch';
import type { Clock, Logger } from '../ports';
import type { CentrifugoApi, PublishOutcome, Scheduler } from './ports';

/** The first event of a batch waits this long (AC-37: at most 300 ms). */
export const BATCH_WINDOW_MS = 300;
/** Adjacent flushes of one channel are at least this far apart (AC-37). */
export const BATCH_MIN_GAP_MS = 250;
/** Events one channel may hold queued: 10 batches' worth. */
export const BATCH_QUEUE_CAP = 10 * REALTIME_MAX_BATCH_EVENTS;

/** `queued`, `stopped` (the batcher is stopped) or `full` (the channel's queue is at `BATCH_QUEUE_CAP`). */
export type EnqueueResult = 'queued' | 'stopped' | 'full';

export interface ChannelBatcherOptions {
  api: CentrifugoApi;
  scheduler: Scheduler;
  clock: Clock;
  log: Logger;
  /** A fresh batch id (the Centrifugo idempotency key). */
  makeId: () => string;
}

export interface ChannelBatcher {
  /** Queues `event` for `channel`; `stopped` once the batcher is stopped, `full` at the queue cap. */
  enqueue(channel: string, classKey: string, event: RealtimeEnvelope): EnqueueResult;
  /** Resolves when no flush is running (tests). */
  idle(): Promise<void>;
  /** Clears every timer and drops what is queued; later events are refused. */
  stop(): void;
}

interface Lane {
  classKey: string;
  queue: RealtimeEnvelope[];
  /** Clock time of the first queued event. */
  firstAt: number;
  timer?: unknown;
  running?: Promise<void>;
  /** Clock time the last flush of this channel started. */
  lastFlushAt?: number;
  /** Clock time of the last queue-full warn line of this channel. */
  fullWarnedAt?: number;
}

export function createChannelBatcher({ api, scheduler, clock, log, makeId }: ChannelBatcherOptions): ChannelBatcher {
  const lanes = new Map<string, Lane>();
  let stopped = false;

  /** The flush time of a lane: first event + window, and not before the last flush + minimum gap. */
  function schedule(channel: string, lane: Lane): void {
    const now = clock.now();
    const due = Math.max(lane.firstAt + BATCH_WINDOW_MS, (lane.lastFlushAt ?? -Infinity) + BATCH_MIN_GAP_MS);
    lane.timer = scheduler.setTimeout(() => fire(channel, lane), Math.max(0, due - now));
  }

  async function publishBatches(classKey: string, channel: string, events: RealtimeEnvelope[]): Promise<void> {
    for (const batch of splitBatch(events, makeId)) {
      let outcome: PublishOutcome;
      try {
        outcome = await api.publish({ channel, data: batch, idempotencyKey: batch.id });
      } catch {
        // The adapter never throws; this keeps the schedule alive even if one does.
        outcome = { status: 'unavailable' };
      }
      if (outcome.status !== 'ok') {
        log.warn({
          event: 'realtime_publish',
          class: classKey,
          events: batch.events.length,
          result: 'unavailable',
          ...(outcome.status === 'rejected' ? { apiCode: outcome.code } : {}),
        });
      }
    }
  }

  function fire(channel: string, lane: Lane): void {
    lane.timer = undefined;
    if (stopped) return;
    const now = clock.now();
    // Spacing guard (AC-37): a timer that fires early never flushes closer than the minimum gap.
    if (lane.lastFlushAt !== undefined && now < lane.lastFlushAt + BATCH_MIN_GAP_MS) {
      lane.timer = scheduler.setTimeout(() => fire(channel, lane), lane.lastFlushAt + BATCH_MIN_GAP_MS - now);
      return;
    }
    lane.lastFlushAt = now;
    const events = lane.queue.splice(0);
    lane.running = publishBatches(lane.classKey, channel, events).finally(() => {
      lane.running = undefined;
      if (stopped) return;
      if (lane.queue.length > 0) schedule(channel, lane);
      // An idle lane is forgotten: its next first event is later than this flush, so the gap holds.
      else if (lanes.get(channel) === lane) lanes.delete(channel);
    });
  }

  return {
    enqueue(channel, classKey, event) {
      if (stopped) return 'stopped';
      let lane = lanes.get(channel);
      if (lane === undefined) {
        lane = { classKey, queue: [], firstAt: clock.now() };
        lanes.set(channel, lane);
      }
      if (lane.queue.length >= BATCH_QUEUE_CAP) {
        const now = clock.now();
        if (lane.fullWarnedAt === undefined || now - lane.fullWarnedAt >= BATCH_WINDOW_MS) {
          lane.fullWarnedAt = now;
          log.warn({ event: 'realtime_publish', class: lane.classKey, events: 1, result: 'unavailable', queue: 'full' });
        }
        return 'full';
      }
      if (lane.queue.length === 0) lane.firstAt = clock.now();
      lane.queue.push(event);
      if (lane.timer === undefined && lane.running === undefined) schedule(channel, lane);
      return 'queued';
    },
    async idle() {
      for (;;) {
        const running = [...lanes.values()].flatMap((l) => (l.running ? [l.running] : []));
        if (running.length === 0) return;
        await Promise.all(running);
      }
    },
    stop() {
      stopped = true;
      for (const lane of lanes.values()) {
        if (lane.timer !== undefined) scheduler.clearTimeout(lane.timer);
        lane.timer = undefined;
        lane.queue.length = 0;
      }
    },
  };
}
