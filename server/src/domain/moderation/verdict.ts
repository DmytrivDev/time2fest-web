/** Score → outcome (SPEC-09 AC-11, С3), ring 1: pure. Thresholds come from the admin slice. */

export type Outcome = 'allow' | 'review' | 'block';

export interface Thresholds {
  review: number;
  block: number;
}

/** Defaults of the admin slice (С3). */
export const DEFAULT_THRESHOLDS: Thresholds = { review: 0.5, block: 0.8 };

export function outcomeOf(score: number, { review, block }: Thresholds): Outcome {
  if (score >= block) return 'block';
  if (score >= review) return 'review';
  return 'allow';
}
