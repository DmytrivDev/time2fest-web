/**
 * Нагадування про план пошти (SPEC-10 AC-45, [А10]), ring 3 — лише порти, годинник стінний. Раз на добу
 * (30.12 і 31.12 від 09:00 Києва, поки `T2F_MAIL_PLAN=free`) піднімає тривогу `page` `mail/plan-free`: захоплення
 * `setIfAbsent mail:alarm:plan-free:<дата>` під орендою `ops-mail`, тож на весь кластер рівно одна.
 */
import { planReminderDue, type MailPlan } from '../domain/mail/planReminder';
import type { Alarm, FastStore } from '../ports';
import type { OpsLease } from './ports';

const LEASE_TTL_MS = 15_000;
/** Ключ захоплення живе довше за добу: наступний день має інший ключ. */
const CLAIM_TTL_MS = 3 * 24 * 3_600_000;

export type MailPlanOutcome = { result: 'idle' | 'not-held' | 'duplicate' } | { result: 'raised'; dueKey: string };

export interface MailPlanJob {
  run(now: number): Promise<MailPlanOutcome>;
  release(): Promise<void>;
}

export interface MailPlanJobDeps {
  lease: OpsLease;
  store: FastStore;
  alarm: Alarm;
  plan: MailPlan;
}

export const mailPlanClaimKey = (dueKey: string): string => `mail:alarm:plan-free:${dueKey}`;

export function createMailPlanJob(deps: MailPlanJobDeps): MailPlanJob {
  // Дні, які цей процес уже обробив: далі протягом дня жодних звернень до оренди чи сховища.
  const handled = new Set<string>();
  return {
    async run(now) {
      const due = planReminderDue(now, deps.plan);
      if (!due || handled.has(due.dueKey)) return { result: 'idle' };
      if (!(await deps.lease.acquire('ops-mail', LEASE_TTL_MS))) return { result: 'not-held' };
      const claimed = await deps.store.setIfAbsent(mailPlanClaimKey(due.dueKey), '1', CLAIM_TTL_MS);
      handled.add(due.dueKey);
      if (!claimed) return { result: 'duplicate' };
      deps.alarm.raise({ level: 'page', source: 'mail', code: 'mail/plan-free' });
      return { result: 'raised', dueKey: due.dueKey };
    },
    async release() {
      await deps.lease.release('ops-mail').catch(() => {});
    },
  };
}
