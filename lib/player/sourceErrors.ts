import { SOURCE_ERROR_CODES, type SourceErrorCode } from '@time2fest/contracts';

/** Не частіше одного звіту на джерело за цей час (AC-41). */
export const SOURCE_ERROR_MIN_GAP_MS = 30_000;

export function isReportableCode(code: number): code is SourceErrorCode {
  return (SOURCE_ERROR_CODES as readonly number[]).includes(code);
}

/**
 * Чисте правило: чи слати звіт про помилку плеєра. `last` — час (мс) останнього надісланого звіту по кожному джерелу;
 * виклик, що повернув `true`, сам запису в `last` не робить.
 */
export function shouldReport(code: number, sourceId: string, now: number, last: ReadonlyMap<string, number>): boolean {
  if (!isReportableCode(code)) return false;
  const prev = last.get(sourceId);
  return prev === undefined || now - prev >= SOURCE_ERROR_MIN_GAP_MS;
}
