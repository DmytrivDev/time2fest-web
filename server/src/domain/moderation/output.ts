/**
 * Checks of what a model answered (SPEC-09 AC-14, AC-24, С14), ring 1: pure. A model's answer is
 * untrusted: anything but the exact expected shape is a provider error, never an `allow`.
 */
import { checkToastText } from '@time2fest/rules/text';

export const TRANSLATION_MAX = 600;

/** AC-14: only a JSON object with exactly one key `score`, a finite number in [0, 1]; else `null`. */
export function parseScore(raw: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'score') return null;
  const score = (value as { score: unknown }).score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return null;
  return score;
}

export type TranslationError = 'empty' | 'too-long' | 'link' | 'contact';

/**
 * AC-24: the translation is an error when it is empty, longer than 600 characters, or carries a
 * link or contact (shared rules) that the source does not contain.
 */
export function checkTranslation(source: string, out: string): TranslationError | null {
  if (out.trim() === '') return 'empty';
  if ([...out].length > TRANSLATION_MAX) return 'too-long';
  // Walk every link / contact: each found span is blanked out so the next one shows up.
  let rest = out;
  for (let i = 0; i < out.length; i++) {
    const issue = checkToastText(rest);
    if (!issue || issue.kind === 'word') return null;
    if (!source.includes(out.slice(issue.start, issue.end))) return issue.kind;
    rest = rest.slice(0, issue.start) + ' '.repeat(issue.end - issue.start) + rest.slice(issue.end);
  }
  return null;
}
