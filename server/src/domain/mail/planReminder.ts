/**
 * Нагадування «перевести Resend на Pro» (SPEC-10 AC-45, [А10]), ring 1 — чиста функція.
 * Спрацьовує 30.12 і 31.12 від 09:00 за `Europe/Kyiv`, поки план `free`; ключ дня — київська дата
 * (`2026-12-30`), за ним задача піднімає тривогу один раз на день. Час — завжди параметр `now` стінного годинника.
 */
import { localParts } from '../ops/schedule';

export type MailPlan = 'free' | 'pro';

const REMIND_DAYS: readonly number[] = [30, 31];
const REMIND_HOUR = 9;

export interface PlanReminder {
  dueKey: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `{dueKey}` у 30.12 / 31.12 від 09:00 Києва на плані `free`, інакше `null`. */
export function planReminderDue(now: number, plan: MailPlan): PlanReminder | null {
  if (plan !== 'free') return null;
  const p = localParts(now);
  if (p.m !== 12 || !REMIND_DAYS.includes(p.d) || p.h < REMIND_HOUR) return null;
  return { dueKey: `${p.y}-${pad(p.m)}-${pad(p.d)}` };
}
