/** Saving the moderation settings (SPEC-09 AC-42, AC-43): validate, then write through the store (one journal row, version + 1). */
import { validateSettings, type ModerationSettings, type SettingsField, type SettingsInput } from '../domain/moderation/settings';
import type { Actor, Tx } from '../audit/ports';
import type { ModerationSettingsStore } from './spend';

export type SaveSettingsResult =
  | { ok: true; value: ModerationSettings }
  | { ok: false; code: 'validation'; fields: SettingsField[] };

export async function saveSettings(
  store: ModerationSettingsStore,
  tx: Tx | null,
  input: SettingsInput,
  actor: Actor,
): Promise<SaveSettingsResult> {
  const verdict = validateSettings(input);
  if (!verdict.ok) return { ok: false, code: 'validation', fields: verdict.fields };
  const value = await store.write(
    tx,
    {
      reviewThreshold: input.review,
      blockThreshold: input.block,
      nightCeilingUsd: input.nightCeilingUsd,
      monthCeilingUsd: input.monthCeilingUsd,
    },
    actor,
  );
  return { ok: true, value };
}
