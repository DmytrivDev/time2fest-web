/**
 * The Telegram sender (SPEC-13b AC-2 … AC-5, AC-7, AC-8, NFR-1), ring 3: one tick of the outbox under the
 * `ops-telegram` lease. Takes ports only, never the container; time is the caller's wall-clock `now` (AC-22).
 *
 * - Control rows (heartbeat, digest, storm summary) are always sent; a storm summary gets its text when it is
 *   sent: «ще N тривог» with the domains of the rows held in its 10-min window (AC-7).
 * - `alarm` rows: at most `STORM_CEILING` sent per sliding 10 min; over it, due rows with no attempt yet are
 *   closed into the window's summary row (`storm:<window start>`, sent at the window end) (AC-7).
 * - After an attempt: delivered, retry at `nextAttemptAt` (AC-4), or final failure → `failed` + journal row in
 *   the store (AC-5) and ONE `log` alarm `ops/telegram-delivery-failed` per 10 min, which the delivering alarm
 *   keeps out of the outbox (no recursion).
 * - A claim pushes a row 30 s forward, so two instances never send one row, and a crashed holder's claimed
 *   row is retried; a crash between Telegram's 200 and `markDelivered` can repeat one message (accepted).
 */
import { buildStormSummary, UNKNOWN_DOMAIN_TITLE } from '../domain/ops/alarmText';
import { nextAttemptAt, STORM_CEILING, STORM_WINDOW_MS, stormBudget, stormSlotKey, stormWindowStart } from '../domain/ops/delivery';
import type { EnvClass } from '../platform/env';
import type { Alarm } from '../ports';
import type { OpsLease, Outbox, OutboxRow } from '../ops/ports';
import { findKind } from '../registries/ops';
import type { AlarmSink } from './ports';

export const TELEGRAM_LEASE_TTL_MS = 15_000;
/** One `ops/telegram-delivery-failed` alarm per this window (AC-5). */
export const DELIVERY_FAILED_ALARM_WINDOW_MS = 600_000;
const CONTROL_PER_TICK = 5;
const HELD_PER_TICK = 200;

export interface SenderDeps {
  lease: OpsLease;
  outbox: Outbox;
  sink: AlarmSink;
  chatId: string;
  cls: EnvClass;
  /** The process alarm (the delivering one): only `log` alarms are raised here. */
  alarm: Alarm;
}

export interface SenderTickResult {
  held: boolean;
  sent: number;
  retried: number;
  failed: number;
  summarized: number;
}

export interface Sender {
  tick(now: number): Promise<SenderTickResult>;
  release(): Promise<void>;
}

export function createSender(deps: SenderDeps): Sender {
  let lastFailedAlarm: number | undefined;

  function domainTitle(row: OutboxRow): string {
    const kind = row.alarm ? findKind(row.alarm.source, row.alarm.code) : undefined;
    return kind ? kind.domain.title : UNKNOWN_DOMAIN_TITLE;
  }

  async function attempt(row: OutboxRow, now: number, result: SenderTickResult): Promise<void> {
    const out = await deps.sink.deliver({ text: row.text, chatId: deps.chatId });
    const next = nextAttemptAt({ raisedAt: row.createdAt, attempts: row.attempts + 1, outcome: out, now });
    if (next.kind === 'delivered') {
      await deps.outbox.markDelivered(row.id, now, out.status);
      result.sent += 1;
    } else if (next.kind === 'retry') {
      await deps.outbox.markRetry(row.id, next.at, out.status);
      result.retried += 1;
    } else {
      await deps.outbox.markFailed(row.id, now, out.status);
      result.failed += 1;
      if (lastFailedAlarm === undefined || now - lastFailedAlarm >= DELIVERY_FAILED_ALARM_WINDOW_MS) {
        lastFailedAlarm = now;
        deps.alarm.raise({
          level: 'log',
          source: 'ops',
          code: 'telegram-delivery-failed',
          details: { attempts: row.attempts + 1, ...(out.status !== undefined ? { status: out.status } : {}) },
        });
      }
    }
  }

  async function sendControl(now: number, result: SenderTickResult): Promise<void> {
    const rows = await deps.outbox.claimDue(CONTROL_PER_TICK, now, ['heartbeat', 'digest', 'storm-summary']);
    for (const row of rows) {
      if (row.kind === 'storm-summary') {
        const windowStart = row.createdAt - STORM_WINDOW_MS;
        const held = await deps.outbox.listSummarized(windowStart, row.createdAt);
        const text = buildStormSummary({ cls: deps.cls, held: held.length, domains: held.map(domainTitle), at: now });
        await deps.outbox.setText(row.id, text);
        await attempt({ ...row, text }, now, result);
      } else {
        await attempt(row, now, result);
      }
    }
  }

  async function sendAlarms(now: number, result: SenderTickResult): Promise<void> {
    const budget = stormBudget(await deps.outbox.countSent(now - STORM_WINDOW_MS, now));
    if (budget > 0) {
      for (const row of await deps.outbox.claimDue(Math.min(budget, STORM_CEILING), now, ['alarm'])) await attempt(row, now, result);
      return;
    }
    const due = await deps.outbox.claimDue(HELD_PER_TICK, now, ['alarm']);
    // A row already in retry was never sent: it keeps its own retries (rare: an outage during a storm).
    for (const row of due.filter((r) => r.attempts > 0)) await attempt(row, now, result);
    const held = due.filter((r) => r.attempts === 0);
    if (held.length === 0) return;
    const windowStart = stormWindowStart(now);
    const windowEnd = windowStart + STORM_WINDOW_MS;
    await deps.outbox.markSummarized(
      held.map((r) => r.id),
      now,
    );
    result.summarized += held.length;
    // The text is rewritten with the final count when the summary is sent at the window end.
    await deps.outbox.insert({
      kind: 'storm-summary',
      slotKey: stormSlotKey(windowStart),
      text: buildStormSummary({ cls: deps.cls, held: held.length, domains: held.map(domainTitle), at: windowEnd }),
      chatId: deps.chatId,
      createdAt: windowEnd,
    });
  }

  return {
    async tick(now) {
      const result: SenderTickResult = { held: false, sent: 0, retried: 0, failed: 0, summarized: 0 };
      if (!(await deps.lease.acquire('ops-telegram', TELEGRAM_LEASE_TTL_MS))) return result;
      result.held = true;
      await sendControl(now, result);
      await sendAlarms(now, result);
      return result;
    },
    release: () => deps.lease.release('ops-telegram'),
  };
}
