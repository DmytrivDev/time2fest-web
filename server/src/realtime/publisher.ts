/**
 * The publish port (ring 3, SPEC-06 C4: AC-30, AC-31, AC-33, NFR-5). Validates before anything leaves the
 * process — a class of the registry, a key that builds a channel name, the C3 envelope schema, at most
 * 65 536 serialized bytes — and only then calls Centrifugo, with the envelope `id` as the idempotency key.
 *
 * Never throws into domain code. Every refusal or failure writes exactly one `warn` line with the class,
 * the event count and the result; never the envelope, a token or a key.
 * A batched class (`batched: true`) is validated the same way, also against the size of a batch of one,
 * then queued for the batcher (AC-37 … AC-40), and the call returns `queued`.
 */
import { REALTIME_MAX_PUBLICATION_BYTES } from '@time2fest/contracts';
import { RealtimeEnvelopeSchema } from '@time2fest/contracts/schemas';
import { batchOverheadBytes } from '../domain/realtime/batch';
import { channelName, type ChannelClassRow } from '../domain/realtime/channels';
import type { Clock, Logger } from '../ports';
import { createChannelBatcher } from './batcher';
import type { CentrifugoApi, ChannelPublisher, PublishResult, Scheduler } from './ports';

export interface ChannelPublisherOptions {
  api: CentrifugoApi;
  /** The channel classes of this environment class (`channelClassesFor`). */
  rows: readonly ChannelClassRow[];
  /** Channel prefix `<slug>_` in `test`; `''` everywhere else. */
  prefix: string;
  log: Logger;
  /** Timers of the batcher (`unref`'d global timers in the composition root, a manual one in tests). */
  scheduler: Scheduler;
  /** Real time for the batch window and spacing. */
  clock: Clock;
  /** A fresh batch id (the Centrifugo idempotency key of a batch); ids have one fixed length. */
  makeId: () => string;
}

/** The publish port plus the lifecycle of its batcher (tests and shutdown). */
export interface BatchingChannelPublisher extends ChannelPublisher {
  /** Resolves when no batch flush is running. */
  idle(): Promise<void>;
  /** Clears the batcher's timers; queued events are dropped and later batched publishes are `unavailable`. */
  stop(): void;
}

/** Serialized size in bytes, or `undefined` when the value cannot be serialized (a cycle, a `BigInt`). */
function serializedBytes(value: unknown): number | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : Buffer.byteLength(text, 'utf8');
  } catch {
    return undefined;
  }
}

export function createChannelPublisher({ api, rows, prefix, log, scheduler, clock, makeId }: ChannelPublisherOptions): BatchingChannelPublisher {
  const batcher = createChannelBatcher({ api, scheduler, clock, log, makeId });
  // What a batch costs before its events; a batched event must fit a batch on its own (AC-31).
  const batchOverhead = batchOverheadBytes(makeId());
  return {
    idle: () => batcher.idle(),
    stop: () => batcher.stop(),
    async publish(classKey, key, envelope): Promise<PublishResult> {
      const refuse = (result: 'validation' | 'unavailable', apiCode?: number): PublishResult => {
        log.warn({ event: 'realtime_publish', class: classKey, events: 1, result, ...(apiCode !== undefined ? { apiCode } : {}) });
        return { status: result };
      };

      const row = rows.find((r) => r.key === classKey);
      if (row === undefined) return refuse('validation');
      const channel = channelName(row, key, prefix);
      if (channel === undefined) return refuse('validation');
      if (!RealtimeEnvelopeSchema.safeParse(envelope).success) return refuse('validation');
      const bytes = serializedBytes(envelope);
      if (bytes === undefined || bytes > REALTIME_MAX_PUBLICATION_BYTES) return refuse('validation');
      if (row.batched) {
        if (bytes + batchOverhead > REALTIME_MAX_PUBLICATION_BYTES) return refuse('validation');
        let copy: typeof envelope;
        try {
          // A snapshot: domain code may reuse its object before the flush.
          copy = structuredClone(envelope);
        } catch {
          return refuse('validation');
        }
        const queued = batcher.enqueue(channel, classKey, copy);
        if (queued === 'queued') return { status: 'queued' };
        // A full queue: the batcher already wrote its rate-limited warn line.
        if (queued === 'full') return { status: 'unavailable' };
        return refuse('unavailable');
      }

      let outcome;
      try {
        outcome = await api.publish({ channel, data: envelope, idempotencyKey: envelope.id });
      } catch {
        // The adapter never throws; this keeps the promise to domain code even if one does.
        outcome = { status: 'unavailable' } as const;
      }
      if (outcome.status === 'ok') {
        return {
          status: 'ok',
          ...(outcome.offset !== undefined ? { offset: outcome.offset } : {}),
          ...(outcome.epoch !== undefined ? { epoch: outcome.epoch } : {}),
        };
      }
      return refuse('unavailable', outcome.status === 'rejected' ? outcome.code : undefined);
    },
  };
}
