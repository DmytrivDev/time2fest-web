/**
 * Revert rules of the audit journal (AC-22, AC-23), ring 1 — pure.
 *
 * A row may be reverted only while the target still holds the row's `after`: every field present
 * in `after` (except the bookkeeping fields) must deep-equal the current value; otherwise the
 * answer is `changed-since`. A deleted target is `changed-since` too.
 */

/** Fields Payload maintains itself; they never take part in the check or the restore. */
export const BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set(['id', 'createdAt', 'updatedAt']);

export type RevertCheck = 'ok' | 'changed-since';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // `undefined` and `null` both mean "no value" in a stored document.
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  return [...keys].every((k) => deepEqual(ra[k], rb[k]));
}

/** Whether the target still holds the entry's `after`. */
export function canRevert(entry: { after: Record<string, unknown> | null }, current: Record<string, unknown> | null): RevertCheck {
  const after = entry.after;
  if (after === null || current === null) return 'changed-since';
  for (const [field, value] of Object.entries(after)) {
    if (BOOKKEEPING_FIELDS.has(field)) continue;
    if (!deepEqual(value, current[field])) return 'changed-since';
  }
  return 'ok';
}

/** The fields to write back: every field of `after` (bookkeeping excluded) set to its `before` value. */
export function restoreData(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of Object.keys(after ?? {})) {
    if (BOOKKEEPING_FIELDS.has(field)) continue;
    data[field] = before?.[field] ?? null;
  }
  return data;
}
