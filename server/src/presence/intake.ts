/**
 * Beat-intake counters of the health log (SPEC-14 [П-5], AC-4, AC-14, AC-17, AC-56), application ring.
 * - Per node, in process: beats accepted and failed since the last sample (`take()` reads and resets).
 * - Per event × moment, in the fast store: how many DISTINCT subjects beat before the window
 *   (`[m − 5 min; window start)`) and inside it. Keys `pr:pre:<season>:<event>:<moment>:<subject>` /
 *   `pr:in:…:<subject>` (`setIfAbsent`) feed the counters `pr:cnt:pre|in:<season>:<event>:<moment>` (`incrWindow`).
 *   A subject counts in `in` only when its `pre` marker exists (AC-17: "less than half OF THEM"), and gets a `pre`
 *   marker only when it is ESTABLISHED for the window (created ≥ 1 h before the window start, S14-01) — so both
 *   counters count established subjects only and fresh throwaway guests cannot steer `beat-rate-drop`. Every key
 *   lives ≤ 48 h (AC-56).
 * Pre-window EVIDENCE (S14-01): every subject that beats in the pre span — established or not — gets
 * `pr:ev:<season>:<event>:<moment>:<subject>`. When a window's only sign is `beat-rate-drop`, a downtime stamp goes only to
 * subjects with this evidence (or a proof). The finaliser writes the window's ANCHOR `pr:eva:…` after the window end and
 * before such a record, expiring no later than the earliest evidence key: anchor present ⇒ the evidence of the window
 * is complete and readable (a Redis restart that lost the evidence lost the anchor too, as both live in one
 * ordered store). Lifetime 48 h from the pre span start ≥ rating close + Δ of any event (the last zone midnight + 12 h).
 * Counter writes never fail a beat: a fast-store error is swallowed and reported as `false` (missing counters make
 * the window a downtime at finalisation, AC-15). Subject ids stay in the keys only — never in a log (NFR-5).
 */
import { isEstablishedFor } from '../domain/presence/healthSigns';
import { phaseOf, PRE_WINDOW_LEAD_MS } from '../domain/presence/window';
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
export const evidenceKey = (w: WindowRef, subject: string): string => `pr:ev:${tail(w)}:${subject}`;
export const evidenceAnchorKey = (w: WindowRef): string => `pr:eva:${tail(w)}`;
/** When every evidence key of the window has expired (the earliest is written at the pre span start). */
export const evidenceExpiresAt = (w: WindowRef): number => w.momentMs - PRE_WINDOW_LEAD_MS + PRESENCE_KEY_TTL_MS;

export interface WindowCounts {
  pre: number;
  in: number;
}

export interface WindowIntake {
  /**
   * Counts the subject for the window when `receivedAt` is in its `pre` span or inside it; `true` when the counters
   * are up to date (counted or nothing to count), `false` when the fast store failed. `createdAt` is the subject's
   * creation time (`users.created_at`, ms; `null` unknown): only established subjects enter `pre` (S14-01).
   */
  count(w: WindowRef, subject: string, receivedAt: number, createdAt: number | null): Promise<boolean>;
  /** The distinct-subject counters of the window; `null` when the fast store cannot be read. */
  counts(w: WindowRef): Promise<WindowCounts | null>;
  /** Marks the window's evidence complete (finaliser, after the window end); throws when the fast store fails. */
  anchorEvidence(w: WindowRef, now: number): Promise<void>;
  /**
   * The subject's pre-window evidence for the window: `true` it beat in the pre span, `false` it did not (the anchor
   * is present, so the evidence is complete), `null` unknown (no anchor — lost or never written — or a read failure).
   */
  evidence(w: WindowRef, subject: string): Promise<boolean | null>;
}

export function createWindowIntake(fast: () => FastStore): WindowIntake {
  return {
    async count(w, subject, receivedAt, createdAt) {
      const phase = phaseOf(receivedAt, w.momentMs);
      if (phase === null) return true;
      try {
        const store = fast();
        if (phase === 'pre') {
          await store.setIfAbsent(evidenceKey(w, subject), '1', Math.max(1, evidenceExpiresAt(w) - receivedAt));
          if (!isEstablishedFor(createdAt, w.momentMs)) return true;
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
    async anchorEvidence(w, now) {
      const ttl = evidenceExpiresAt(w) - now;
      if (ttl <= 0) return;
      await fast().set(evidenceAnchorKey(w), '1', ttl);
    },
    async evidence(w, subject) {
      try {
        const store = fast();
        const [anchor, mine] = await Promise.all([store.get(evidenceAnchorKey(w)), store.get(evidenceKey(w, subject))]);
        if (mine !== null) return true;
        return anchor === null ? null : false;
      } catch {
        return null;
      }
    },
  };
}
