/**
 * Вікно втрати (SPEC-13b AC-57, [А16]), ring 1: найбільший проміжок між знімками сусідніх успішних копій за
 * 24 год до `now`. Менше двох знімків у цих 24 год — `null` (проміжок не визначений).
 */

const DAY_MS = 86_400_000;

export function lossWindow(manifests: readonly { snapshotAt: number }[], now: number): number | null {
  const times = manifests
    .map((m) => m.snapshotAt)
    .filter((t) => Number.isFinite(t) && t <= now && t >= now - DAY_MS)
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  let gap = 0;
  for (let i = 1; i < times.length; i += 1) gap = Math.max(gap, times[i]! - times[i - 1]!);
  return gap;
}
