/**
 * Health of one AI provider (SPEC-09 AC-17 … AC-19, С5), ring 1: pure, time and samples are
 * parameters. A provider is judged on the calls of the last 60 s; once `unavailable` it comes back
 * only after 120 s of clean probes.
 */

export const WINDOW_MS = 60_000;
/** From this many calls in the window the share rules apply (AC-17); below it, the streak rule (AC-18). */
export const MIN_SAMPLES = 20;
export const SLOW_MS = 1_000;
export const MAX_ERROR_SHARE = 0.05;
export const FAIL_STREAK = 3;
export const PROBE_INTERVAL_MS = 10_000;
export const RECOVERY_MS = 120_000;

/** One finished call: when it ended (`at`, ms), how long it took and whether it gave a usable answer. */
export interface HealthSample {
  at: number;
  ms: number;
  ok: boolean;
}

export type HealthReason = 'slow' | 'unavailable' | 'not-configured';

export interface Health {
  status: 'available' | 'unavailable';
  reason?: HealthReason;
}

export const AVAILABLE: Health = { status: 'available' };

/** The samples still inside the 60 s window at `now`, oldest first. */
export function inWindow(samples: readonly HealthSample[], now: number): HealthSample[] {
  return samples.filter((s) => s.at > now - WINDOW_MS && s.at <= now);
}

/** Nearest-rank 95th percentile of the call durations. */
export function p95(ms: readonly number[]): number {
  if (ms.length === 0) return 0;
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0;
}

/** AC-17 / AC-18: the verdict on the calls of the last 60 s. */
export function assess(samples: readonly HealthSample[], now: number): Health {
  const recent = inWindow(samples, now);
  if (recent.length >= MIN_SAMPLES) {
    const errors = recent.filter((s) => !s.ok).length;
    if (errors / recent.length > MAX_ERROR_SHARE) return { status: 'unavailable', reason: 'unavailable' };
    if (p95(recent.map((s) => s.ms)) > SLOW_MS) return { status: 'unavailable', reason: 'slow' };
    return AVAILABLE;
  }
  const tail = recent.slice(-FAIL_STREAK);
  if (tail.length === FAIL_STREAK && tail.every((s) => !s.ok)) return { status: 'unavailable', reason: 'unavailable' };
  return AVAILABLE;
}

/** A probe passes when it answered and took at most 1 s (AC-19). */
export function probePassed(sample: HealthSample): boolean {
  return sample.ok && sample.ms <= SLOW_MS;
}

/**
 * AC-19: where the current clean run of probes starts and whether it already covers 120 s.
 * `since` is when the provider became `unavailable`; any failed or slow probe restarts the run at
 * that probe. Recovered when a clean probe lands ≥120 s after the start of the run.
 */
export function probeStreak(probes: readonly HealthSample[], since: number): { from: number; recovered: boolean } {
  let from = since;
  let lastClean: number | null = null;
  for (const p of probes) {
    if (p.at < since) continue;
    if (probePassed(p)) {
      lastClean = p.at;
    } else {
      from = p.at;
      lastClean = null;
    }
  }
  return { from, recovered: lastClean !== null && lastClean - from >= RECOVERY_MS };
}

/** A probe is due when none was sent yet or the last one was ≥10 s ago. */
export function probeDue(lastProbeAt: number | null, now: number, intervalMs: number = PROBE_INTERVAL_MS): boolean {
  return lastProbeAt === null || now - lastProbeAt >= intervalMs;
}
