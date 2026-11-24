/**
 * The morning digest at 09:00 `Europe/Kyiv` (SPEC-13b AC-20, AC-21, AC-22), ring 3 — ports only, wall-clock `now`.
 *
 * `log` alarms of the 24 h before the slot grouped by domain with the 10 most frequent kinds, open `page` alarms,
 * the age of the last backup and the spend rows over 50 % (a port: `[]` until the spend counters land, W29).
 * One per day across the cluster: the `ops-heartbeat` lease and the unique slot `digest:<Kyiv date>`. A slot
 * ≤10 min late is queued; later within its first hour → a journal line `ops.digest-skipped` (a restart, AC-21);
 * a process that starts later than that just waits for the next morning (no line on every start).
 */
import type { LogAlarmStore } from '../alarms/ports';
import { buildDigestText, UNKNOWN_DOMAIN_TITLE, type DigestLogKind } from '../domain/ops/alarmText';
import { digestSlotAt } from '../domain/ops/schedule';
import { findKind } from '../registries/ops';
import { planSlot, slotMemory, type PlanJob, type PlanJobDeps } from './heartbeat';

const DAY_MS = 86_400_000;
/** After this, a missed digest slot is not journalled: the process simply started later that day. */
const SKIP_LINE_WITHIN_MS = 3_600_000;

/** A spend row over 50 % of its limit in the current period. */
export interface SpendOver50 {
  title: string;
  percent: number;
}

export interface DigestJobDeps extends PlanJobDeps {
  logAlarms: Pick<LogAlarmStore, 'listLog'>;
  spendOver50(now: number): Promise<readonly SpendOver50[]>;
}

/** `log` alarms of `[now − 24 h, now]` as digest rows: domain title, `source/code`, count. */
export async function digestLogKinds(store: Pick<LogAlarmStore, 'listLog'>, now: number): Promise<DigestLogKind[]> {
  const counts = new Map<string, DigestLogKind>();
  for (const r of await store.listLog(now - DAY_MS)) {
    if (r.raisedAt > now) continue;
    const kind = `${r.source}/${r.code}`;
    const row = counts.get(kind) ?? { domain: findKind(r.source, r.code)?.domain.title ?? UNKNOWN_DOMAIN_TITLE, kind, count: 0 };
    row.count += 1;
    counts.set(kind, row);
  }
  return [...counts.values()];
}

export function createDigestJob(deps: DigestJobDeps): PlanJob {
  const memory = slotMemory();
  return {
    async run(now) {
      const slot = digestSlotAt(now);
      if (memory.has(slot.key)) return { result: 'idle' };
      if (now - slot.due > SKIP_LINE_WITHIN_MS) {
        memory.add(slot.key);
        return { result: 'too-late', slotKey: slot.key };
      }
      return planSlot(deps, memory, slot, now, 'ops.digest-skipped', 'digest', async () => {
        const [logKinds, openPage, lastBackupAt, spend] = await Promise.all([
          digestLogKinds(deps.logAlarms, slot.due),
          deps.reads.openPageCount(),
          deps.reads.lastBackupAt(),
          deps.spendOver50(now),
        ]);
        return buildDigestText({
          cls: deps.cls,
          date: slot.key.slice('digest:'.length),
          logKinds,
          openPage,
          lastBackupAgeMs: lastBackupAt === null ? null : now - lastBackupAt,
          spendOver50: spend,
          at: slot.due,
        });
      });
    },
  };
}
