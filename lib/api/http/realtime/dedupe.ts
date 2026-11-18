/** Per-channel duplicate and stale-event filter of the realtime transport (AC-54). Pure, no I/O. */
import type { RealtimeEnvelope } from '@time2fest/contracts';

/** How many accepted ids a channel remembers for envelopes without `version`. */
export const DEDUPE_ID_WINDOW = 1_000;

export interface ChannelFilter {
  /** `true` when the envelope is new for this channel and must reach the listeners. */
  accept(envelope: RealtimeEnvelope): boolean;
}

/**
 * One filter per channel:
 * - with `version`: accepted only when greater than the last accepted `version`;
 * - without `version`: refused when its `id` is among the last {@link DEDUPE_ID_WINDOW} accepted ids (FIFO).
 */
export function createChannelFilter(): ChannelFilter {
  let lastVersion: number | undefined;
  // A Set keeps insertion order, so its first value is the oldest remembered id.
  const recentIds = new Set<string>();

  function remember(id: string): void {
    recentIds.delete(id);
    recentIds.add(id);
    if (recentIds.size > DEDUPE_ID_WINDOW) {
      const oldest = recentIds.values().next();
      if (!oldest.done) recentIds.delete(oldest.value);
    }
  }

  return {
    accept(envelope) {
      if (envelope.version !== undefined) {
        if (lastVersion !== undefined && envelope.version <= lastVersion) return false;
        lastVersion = envelope.version;
      } else if (recentIds.has(envelope.id)) {
        return false;
      }
      remember(envelope.id);
      return true;
    },
  };
}
