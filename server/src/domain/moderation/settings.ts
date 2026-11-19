/** Moderation thresholds and spend ceilings (SPEC-09 AC-42, С3, С9), ring 1: pure. */
import { DEFAULT_THRESHOLDS } from './verdict';

export interface ModerationSettings {
  reviewThreshold: number;
  blockThreshold: number;
  nightCeilingUsd: number;
  monthCeilingUsd: number;
  /** Bumped by one on every save. */
  version: number;
}

/** Defaults of the global's fields (the global holds no row before its first save). */
export const DEFAULT_SETTINGS: ModerationSettings = {
  reviewThreshold: DEFAULT_THRESHOLDS.review,
  blockThreshold: DEFAULT_THRESHOLDS.block,
  nightCeilingUsd: 50,
  monthCeilingUsd: 100,
  version: 0,
};

export interface SettingsInput {
  review: number;
  block: number;
  nightCeilingUsd: number;
  monthCeilingUsd: number;
}

export type SettingsField = keyof SettingsInput;

/** Accepts only `0 < review < block ≤ 1` and finite ceilings > 0 (AC-42); names every field that fails. */
export function validateSettings(input: SettingsInput): { ok: true } | { ok: false; fields: SettingsField[] } {
  const fields: SettingsField[] = [];
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const { review, block, nightCeilingUsd, monthCeilingUsd } = input;
  if (!finite(block) || !(block > 0) || !(block <= 1)) fields.push('block');
  if (!finite(review) || !(review > 0) || !(finite(block) && review < block) || !(review < 1)) fields.push('review');
  if (!finite(nightCeilingUsd) || !(nightCeilingUsd > 0)) fields.push('nightCeilingUsd');
  if (!finite(monthCeilingUsd) || !(monthCeilingUsd > 0)) fields.push('monthCeilingUsd');
  return fields.length === 0 ? { ok: true } : { ok: false, fields };
}
