// @ts-check
/**
 * Pure rewriter for the `down` function of a Payload-generated migration.
 *
 * Payload's generated `down` drops a table with `DROP TABLE "x" CASCADE` before it drops the
 * foreign key `payload_locked_documents_rels_x_fk` and its index; the cascade has already
 * removed them, so the later `DROP CONSTRAINT` / `DROP INDEX` fails with "does not exist".
 * The rewrite adds `IF EXISTS` to those two statements, only inside `down`. Idempotent.
 */

const DOWN_START = /export\s+async\s+function\s+down\s*\(/;

/**
 * @param {string} source full migration file text
 * @returns {{ text: string, changed: number }}
 */
export function fixMigrationDown(source) {
  const match = DOWN_START.exec(source);
  if (!match) return { text: source, changed: 0 };
  const head = source.slice(0, match.index);
  let changed = 0;
  const tail = source
    .slice(match.index)
    .replace(/\bDROP (CONSTRAINT|INDEX) (?!IF EXISTS\b)/g, (_all, kind) => {
      changed += 1;
      return `DROP ${kind} IF EXISTS `;
    });
  return { text: head + tail, changed };
}
