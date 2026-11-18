/**
 * The batch split rule (SPEC-06 AC-39, C3). Ring 1: pure — the batch id comes from the caller's
 * `makeId`, no clock, no I/O.
 *
 * Events of one flush are packed, in order, into `{type:'batch', id, events}` publications of at most
 * `maxEvents` events and at most `maxBytes` serialized UTF-8 bytes each. A new batch starts only when
 * the next event does not fit, so order holds inside a batch and across batches.
 */
import { REALTIME_MAX_BATCH_EVENTS, REALTIME_MAX_PUBLICATION_BYTES, type RealtimeBatch, type RealtimeEnvelope } from '@time2fest/contracts';

const encoder = new TextEncoder();

/** Serialized UTF-8 size of `value` in bytes. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Bytes of an empty batch with this id: the wrapper every batch pays before its events. */
export function batchOverheadBytes(id: string): number {
  return jsonBytes({ type: 'batch', id, events: [] } satisfies RealtimeBatch);
}

/**
 * Splits `events` into ordered batches. Each batch has 1..`maxEvents` events and serializes to at most
 * `maxBytes` bytes. The caller guarantees that a single event fits a batch on its own (AC-31 refuses it
 * at enqueue); if one does not, it still gets a batch of its own rather than being dropped.
 */
export function splitBatch(
  events: readonly RealtimeEnvelope[],
  makeId: () => string,
  maxEvents: number = REALTIME_MAX_BATCH_EVENTS,
  maxBytes: number = REALTIME_MAX_PUBLICATION_BYTES,
): RealtimeBatch[] {
  const out: RealtimeBatch[] = [];
  let current: RealtimeBatch | undefined;
  let bytes = 0;
  for (const event of events) {
    const eventBytes = jsonBytes(event);
    // An event after the first adds one comma.
    const fits = current !== undefined && current.events.length < maxEvents && bytes + 1 + eventBytes <= maxBytes;
    if (current !== undefined && fits) {
      current.events.push(event);
      bytes += 1 + eventBytes;
      continue;
    }
    current = { type: 'batch', id: makeId(), events: [event] };
    bytes = batchOverheadBytes(current.id) + eventBytes;
    out.push(current);
  }
  return out;
}
