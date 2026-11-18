/** Межі швидкості машини часу (`contracts/time-machine.md`). Окремо від машини: розбір `?speed=` її не тягне. */
export const MAX_SPEED = 600;

/** `0 ≤ speed ≤ 600`, скінченне; інакше `1`. */
export function sanitizeSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_SPEED ? n : 1;
}
