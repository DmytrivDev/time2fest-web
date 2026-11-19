/**
 * Measurement lines of the evidence suites (SPEC-07 NFR-5): ONE stdout line per metric,
 * `T2F_MEASURE {"metric":"<name>","n":<count>,"p50":<ms>,"p99":<ms>,"max":<ms>}`, the same shape as
 * `infra/ops` prints, so the wave report quotes them verbatim (`grep T2F_MEASURE`). Values in ms.
 */

export interface MeasureSummary {
  metric: string;
  n: number;
  p50: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentile of sorted `values` (`q` in 0..1); 0 for an empty list. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1] ?? 0;
}

export function summarize(metric: string, values: readonly number[]): MeasureSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    metric,
    n: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/**
 * Prints the line and returns the summary (for assertions). Straight to stdout: vitest shows the
 * console output of a passing test only in some reporters, the measurement must always be there.
 */
export function printMeasure(metric: string, values: readonly number[]): MeasureSummary {
  const s = summarize(metric, values);
  process.stdout.write(`T2F_MEASURE ${JSON.stringify(s)}\n`);
  return s;
}

/** One informational line straight to stdout (see `printMeasure`). */
export function note(line: string): void {
  process.stdout.write(`${line}\n`);
}
