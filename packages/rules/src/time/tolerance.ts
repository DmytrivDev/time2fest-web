/** Δ (clock tolerance, ms) must be a finite number >= 0. */
export function assertTolerance(delta: number): void {
  if (!Number.isFinite(delta) || delta < 0) {
    throw new RangeError(`Clock tolerance must be a finite number >= 0, got ${String(delta)}`);
  }
}

/** Pulse interval I (ms) must be a finite number > 0. */
export function assertPulseInterval(interval: number): void {
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError(`Pulse interval must be a finite number > 0, got ${String(interval)}`);
  }
}
