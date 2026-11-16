/**
 * Static check of a shared registry (AC-62): one sorted list, one row per key.
 * Ring 1 — pure.
 */
export function assertRegistry<T>(name: string, rows: readonly T[], keyOf: (row: T) => string): void {
  const seen = new Set<string>();
  let prev: string | undefined;
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) throw new Error(`registry ${name}: row ${key} duplicate`);
    if (prev !== undefined && key < prev) throw new Error(`registry ${name}: row ${key} out of order`);
    seen.add(key);
    prev = key;
  }
}
