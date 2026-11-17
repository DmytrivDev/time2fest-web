/**
 * Catalog documents → the text of the data files (AC-82), ring 1: pure.
 *
 * The files are written the way Python's `json.dumps(ensure_ascii=False, indent=2)` writes them:
 * two-space indent, keys in the assembled order, non-ASCII kept as is, a closing newline. The line
 * ending follows the target file (`detectEol`), because the existing files may be checked out with CRLF.
 */
import type { CatalogCountries, CatalogSchedule } from '@time2fest/contracts';

export type Eol = '\n' | '\r\n';

/** The line ending of an existing file's text; LF when it has no line break. */
export function detectEol(existing: string | undefined): Eol {
  return existing !== undefined && existing.includes('\r\n') ? '\r\n' : '\n';
}

/** One document as file text: indent 2, closing newline, the given line ending. */
export function toFileText(doc: CatalogSchedule | CatalogCountries, eol: Eol = '\n'): string {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  return eol === '\n' ? text : text.replace(/\n/g, '\r\n');
}

export interface DataFiles {
  schedule: string;
  countries: string;
}

/** Both files; `existing` supplies the line ending of each target. */
export function toData(
  docs: { schedule: CatalogSchedule; countries: CatalogCountries },
  existing: { schedule?: string; countries?: string } = {},
): DataFiles {
  return {
    schedule: toFileText(docs.schedule, detectEol(existing.schedule)),
    countries: toFileText(docs.countries, detectEol(existing.countries)),
  };
}
