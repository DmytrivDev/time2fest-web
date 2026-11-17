/** Pure helpers of the corrections slice: the form's values → the `PatchChange` the save API takes. */
export interface EffectiveForm {
  /** Epoch ms. */
  moment: number;
  isMainCelebration: boolean;
  restrained: boolean;
  note: string;
  hidden: boolean;
}

export interface PatchChange {
  moment?: number;
  isMainCelebration?: boolean;
  restrained?: { note: string } | null;
  hidden?: boolean;
}

/** Only the fields that differ from the current values; an empty object = nothing to save. */
export function buildChange(current: EffectiveForm, next: EffectiveForm): PatchChange {
  const change: PatchChange = {};
  if (next.moment !== current.moment) change.moment = next.moment;
  if (next.isMainCelebration !== current.isMainCelebration) change.isMainCelebration = next.isMainCelebration;
  if (next.restrained !== current.restrained || (next.restrained && next.note !== current.note)) {
    change.restrained = next.restrained ? { note: next.note } : null;
  }
  if (next.hidden !== current.hidden) change.hidden = next.hidden;
  return change;
}

/** `datetime-local` text (`YYYY-MM-DDTHH:mm`, read as UTC) → epoch ms, or `null` when it is not a time. */
export function utcInputToMs(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Epoch ms → `YYYY-MM-DDTHH:mm` in UTC (the `datetime-local` value). */
export function msToUtcInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}
