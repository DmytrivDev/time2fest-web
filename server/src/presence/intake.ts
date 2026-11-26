/**
 * Beat-intake counters of the health log (SPEC-14 [П-5], AC-4, AC-14, AC-17, AC-56), application ring.
 * - Per node, in process: beats accepted and failed since the last sample (`take()` reads and resets).
 * - Per event × moment, in the fast store: how many DISTINCT subjects beat before the window
 *   (`[m − 5 min; window start)`) and inside it. Keys `pr:pre:<season>:<event>:<moment>:<subject>` /
 *   `pr:in:…:<subject>` (`setIfAbsent`) feed the counters `pr:cnt:pre|in:<season>:<event>:<moment>` (`incrWindow`).
 *   A subject counts in `in` only when its `pre` marker exists (AC-17: "less than half OF THEM"). Every key lives
 *   ≤ 48 h (AC-56).
 * Counter writes never fail a beat: a fast-store error is swallowed and reported as `false` (missing counters make
 * the window a downtime at finalisation, AC-15). Subject ids stay in the keys only — never in a log (NFR-5).
 */
import { phaseOf } from '../domain/presence/window';
import type { FastStore } from '../ports';

/** Lifetime of every presence key in the fast store (AC-56: ≤ 48 h). */
export const PRESENCE_KEY_TTL_MS = 48 * 3_600_000;

export interface NodeCounts {
  accepted: number;
  failed: number;
}

export interface NodeIntake {
  accepted(n?: number): void;
  failed(n?: number): void;
  /** The counts since the previous `take()`, then zero. */
  take(): NodeCounts;
  /** The counts since the previous `take()`, without resetting. */
  peek(): NodeCounts;
}

export function createNodeIntake(): NodeIntake {
  let accepted = 0;
  let failed = 0;
  return {
    accepted(n = 1) {
      accepted += n;
    },
    failed(n = 1) {
      failed += n;
    },
    take() {
      const out = { accepted, failed };
      accepted = 0;
      failed = 0;
      return out;
    },
    peek: () => ({ accepted, failed }),
  };
}

export interface WindowRef {
  season: string;
  eventId: string;
  momentMs: number;
}

const tail = (w: WindowRef): string => `${w.season}:${w.eventId}:${w.momentMs}`;
export const preMarkerKey = (w: WindowRef, subject: string): string => `pr:pre:${tail(w)}:${subject}`;
export const inMarkerKey = (w: WindowRef, subject: string): string => `pr:in:${tail(w)}:${subject}`;
export const preCountKey = (w: WindowRef): string => `pr:cnt:pre:${tail(w)}`;
export const inCountKey = (w: WindowRef): string => `pr:cnt:in:${tail(w)}`;

export interface WindowCounts {
  pre: number;
  in: number;
}

export interface WindowIntake {
  /**
   * Counts the subject for the window when `receivedAt` is in its `pre` span or inside it; `true` when the counters
   * are up to date (counted or nothing to count), `false` when the fast store failed.
   */
  count(w: WindowRef, subject: string, receivedAt: number): Promise<boolean>;
  /** The distinct-subject counters of the window; `null` when the fast store cannot be read. */
  counts(w: WindowRef): Promise<WindowCounts | null>;
}

export function createWindowIntake(fast: () => FastStore): WindowIntake {
  return {
    async count(w, subject, receivedAt) {
      const phase = phaseOf(receivedAt, w.momentMs);
      if (phase === null) return true;
      try {
        const store = fast();
        if (phase === 'pre') {
          if (await store.setIfAbsent(preMarkerKey(w, subject), '1', PRESENCE_KEY_TTL_MS)) {
            await store.incrWindow(preCountKey(w), PRESENCE_KEY_TTL_MS);
          }
          return true;
        }
        if ((await store.get(preMarkerKey(w, subject))) === null) return true;
        if (await store.setIfAbsent(inMarkerKey(w, subject), '1', PRESENCE_KEY_TTL_MS)) {
          await store.incrWindow(inCountKey(w), PRESENCE_KEY_TTL_MS);
        }
        return true;
      } catch {
        return false;
      }
    },
    async counts(w) {
      try {
        const store = fast();
        const [pre, inside] = await Promise.all([store.get(preCountKey(w)), store.get(inCountKey(w))]);
        const num = (v: string | null): number => (v === null ? 0 : Number(v) || 0);
        return { pre: num(pre), in: num(inside) };
      } catch {
        return null;
      }
    },
  };
}
