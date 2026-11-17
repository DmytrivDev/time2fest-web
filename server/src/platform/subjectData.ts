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

export type SubjectDataResult =
  | { ok: true; results: Record<string, unknown> }
  | { ok: false; failed: string[] };

/** Calls every handler (none is skipped when another fails); all results or the failed capabilities. */
export async function runSubjectData(
  op: SubjectDataOp,
  subjectId: string,
  handlers: readonly SubjectDataHandler[],
): Promise<SubjectDataResult> {
  const settled = await Promise.allSettled(handlers.map((h) => h[op](subjectId)));
  const failed: string[] = [];
  const results: Record<string, unknown> = {};
  settled.forEach((s, i) => {
    const capability = (handlers[i] as SubjectDataHandler).capability;
    if (s.status === 'rejected') failed.push(capability);
    else results[capability] = s.value;
  });
  return failed.length > 0 ? { ok: false, failed } : { ok: true, results };
}
