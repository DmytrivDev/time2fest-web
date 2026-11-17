/**
 * Subject-data registry runner (ring 3, AC-57): export, erase or anonymise one subject across
 * every capability that holds its data. No adapter or registry import — the caller passes
 * `subjectDataRegistry`, and handlers bring their own ports.
 */
export type SubjectDataOp = 'export' | 'erase' | 'anonymise';

/** One capability holding subject data; registered in `registries/subjectData.ts`. */
export interface SubjectDataHandler {
  capability: string;
  export(subjectId: string): Promise<unknown>;
  erase(subjectId: string): Promise<unknown>;
  anonymise(subjectId: string): Promise<unknown>;
}

/** A capability that keeps subject data without a handler (a short-lived key, nothing to export or erase). */
export interface SubjectDataDeclaration {
  capability: string;
  declarative: true;
  retention: string;
  description: string;
}

export type SubjectDataRow = SubjectDataHandler | SubjectDataDeclaration;

export type SubjectDataResult =
  | { ok: true; results: Record<string, unknown>; declarative: string[] }
  | { ok: false; failed: string[]; declarative: string[] };

function isDeclaration(row: SubjectDataRow): row is SubjectDataDeclaration {
  return 'declarative' in row && row.declarative === true;
}

/** Calls every handler (none is skipped when another fails); declarative rows are only named. */
export async function runSubjectData(
  op: SubjectDataOp,
  subjectId: string,
  rows: readonly SubjectDataRow[],
): Promise<SubjectDataResult> {
  const declarative = rows.filter(isDeclaration).map((r) => r.capability);
  const handlers = rows.filter((r): r is SubjectDataHandler => !isDeclaration(r));
  const settled = await Promise.allSettled(handlers.map((h) => h[op](subjectId)));
  const failed: string[] = [];
  const results: Record<string, unknown> = {};
  settled.forEach((s, i) => {
    const capability = (handlers[i] as SubjectDataHandler).capability;
    if (s.status === 'rejected') failed.push(capability);
    else results[capability] = s.value;
  });
  return failed.length > 0 ? { ok: false, failed, declarative } : { ok: true, results, declarative };
}
