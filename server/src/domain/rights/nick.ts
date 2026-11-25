/** SPEC-11 W19 — nick uniqueness key (AC-29). Pure. */

/** The stored form of a nick: trimmed, inner runs of whitespace collapsed. */
export function nickDisplay(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/** Case- and space-insensitive key: `Ліра` and ` ліра ` are one nick. */
export function nickKey(raw: string): string {
  return nickDisplay(raw).toLowerCase();
}
