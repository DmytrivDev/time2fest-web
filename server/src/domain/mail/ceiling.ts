/** Добові стелі постачальників (SPEC-10 AC-43/44), ring 1. */
import type { MailClass } from './types';

export type Admission = 'primary' | 'fallback' | 'refuse';

export interface AdmitInput {
  readonly class: MailClass;
  readonly primaryCount: number;
  readonly primaryCeiling: number;
  readonly fallbackCount: number;
  readonly fallbackCeiling: number;
}

/** ≥80 % основного відмовляє класу `other`; коди — до 100 % основного, далі запасний до його стелі. */
export function admit(i: AdmitInput): Admission {
  const limit = i.class === 'code' ? i.primaryCeiling : i.primaryCeiling * 0.8;
  if (i.primaryCount < limit) return 'primary';
  if (i.class === 'other') return 'refuse';
  return i.fallbackCount < i.fallbackCeiling ? 'fallback' : 'refuse';
}

/** Чи перетнув лічильник 80 % стелі між `before` і `after`. */
export function levelsCrossed(before: number, after: number, ceiling: number): boolean {
  const line = ceiling * 0.8;
  return before < line && after >= line;
}
