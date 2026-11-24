/**
 * The delivering alarm (SPEC-13b [П-4], AC-1, AC-2, AC-5, AC-6, AC-9, AC-11, AC-12, AC-27), ring 3. Wraps the
 * unchanged `createAlarm` (`platform/logger.ts`): the stdout line, its 60 s throttle and the `alarms` save stay
 * exactly as before (AC-1); the save now carries the sanitized details. Then, fire-and-forget:
 *
 * - `log` → one `log-alarms` row (sanitized details), at most one per kind per throttle window; no message (AC-12).
 * - `page` → the Telegram outbox: a pending or recently delivered row of the same kind gets `repeatCount += n`
 *   (AC-6, also while Telegram is down: one pending row per kind, not one per raise), else a new row with the
 *   final text (AC-10) and sanitized details (AC-11). Raises of one kind are serialized in memory: while one
 *   outbox write of a kind is in flight, further raises only count and are folded in after it.
 * - `ops/telegram-*` never reach the outbox, whatever the level (no recursion, AC-5): `log-alarms` only.
 * - The outbox write failed or did not settle in `outboxTimeoutMs` (Postgres down) → stdout `alarm_outbox_failed`
 *   and a direct send from memory through the sink, at most once per 10 min per kind in this process (AC-9).
 *   A write that settles after the timeout may still deliver once more through the outbox (accepted duplicate).
 * - Unregistered kind (AC-27): domain «невідомо» in the text; in class `test` an extra `log-alarms` row
 *   `ops/unregistered-alarm` with `{source, code}`.
 * - No Telegram configured (sink `null`): no outbox row (nothing would send it); `alarms` and `log-alarms` as usual.
 *
 * `raise` never throws and never awaits; every async path is caught.
 */
import type { EnvClass } from '../platform/env';
import { ALARM_THROTTLE_MS, createAlarm } from '../platform/logger';
import type { Alarm, AlarmInput, Logger } from '../ports';
import { buildAlarmText } from '../domain/ops/alarmText';
import { sanitizeDetails } from '../domain/ops/alarmDetails';
import { coalesce } from '../domain/ops/delivery';
import type { Outbox, WallClock } from '../ops/ports';
import { findKind } from '../registries/ops';
import type { AlarmDetails, AlarmSink, AlarmStore, LogAlarmStore } from './ports';

/** Direct sends from memory when the outbox is down: one per kind per this window (AC-9). */
export const DIRECT_SEND_WINDOW_MS = 600_000;
/** An outbox write that has not settled by then counts as failed (AC-9: the direct send stays within 60 s). */
export const OUTBOX_TIMEOUT_MS = 15_000;
/** How far back the previous delivered message of a kind is looked up for its repeat count (AC-6). */
const PREVIOUS_LOOKBACK_MS = 86_400_000;
const UNREGISTERED = { source: 'ops', code: 'unregistered-alarm' } as const;
const MAX_TRACKED_KINDS = 1_000;

export interface TelegramTarget {
  sink: AlarmSink;
  chatId: string;
}

export interface DeliveringAlarmDeps {
  /** The stdout logger of the process (the base alarm writes its line through it). */
  logger: Logger;
  /** The `alarms` store of `page` alarms (SPEC-04 AC-37); saves are throttled by the base alarm. */
  alarmStore?: Pick<AlarmStore, 'save'>;
  outbox: Outbox;
  logStore: Pick<LogAlarmStore, 'insert'>;
  /** `null` when Telegram is not configured (AC-14). */
  telegram: TelegramTarget | null;
  cls: EnvClass;
  /** Values of the secret env variables: a detail containing one is dropped (AC-11). */
  secretValues: readonly string[];
  /** The wall clock (AC-22). */
  clock: WallClock;
  throttleMs?: number;
  outboxTimeoutMs?: number;
}

/** `ops/telegram-*` codes: never routed to the outbox (AC-5). */
export function isTelegramOpsAlarm(a: { source: string; code: string }): boolean {
  return a.source === 'ops' && a.code.startsWith('telegram-');
}

interface PageItem {
  a: AlarmInput;
  row: ReturnType<typeof findKind>;
  details: AlarmDetails | undefined;
  at: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('outbox: timeout')), ms);
    (timer as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('outbox: failed'));
      },
    );
  });
}

export function createDeliveringAlarm(deps: DeliveringAlarmDeps): Alarm {
  const throttleMs = deps.throttleMs ?? ALARM_THROTTLE_MS;
  const outboxTimeoutMs = deps.outboxTimeoutMs ?? OUTBOX_TIMEOUT_MS;
  const now = () => deps.clock.now();

  // The base alarm calls `store.save` synchronously inside `raise`: the details of the raise in progress are
  // handed over through this slot, so `createAlarm` itself stays unchanged (AC-1).
  let saving: AlarmDetails | undefined;
  const store = deps.alarmStore;
  const base = createAlarm(
    deps.logger,
    store ? { save: (a) => store.save(saving ? { ...a, details: saving } : a) } : undefined,
    { throttleMs, now },
  );

  const logSeen = new Map<string, number>();
  const directSent = new Map<string, number>();
  const queues = new Map<string, { repeats: number; last: PageItem }>();

  const quiet = (p: Promise<unknown>) => {
    p.catch(() => {});
  };
  const line = (fields: Record<string, unknown>) => {
    try {
      deps.logger.error({ level: 'alarm', alarm: 'log', source: 'alarms', ...fields });
    } catch {
      /* never throw */
    }
  };

  function admitLog(key: string, at: number): boolean {
    const seen = logSeen.get(key);
    if (seen !== undefined && at - seen < throttleMs) return false;
    if (seen === undefined && logSeen.size >= MAX_TRACKED_KINDS) logSeen.clear();
    logSeen.set(key, at);
    return true;
  }

  function textOf(item: PageItem, repeatCount: number): string {
    return buildAlarmText({
      row: item.row,
      kind: { source: item.a.source, code: item.a.code },
      cls: deps.cls,
      ...(item.details ? { details: item.details } : {}),
      raisedAt: item.at,
      repeatCount,
    });
  }

  /** One outbox write for `count` raises of one kind (the first is `item`). */
  async function writeOutbox(item: PageItem, count: number, chatId: string): Promise<void> {
    const kind = { source: item.a.source, code: item.a.code };
    const pending = await withTimeout(deps.outbox.pendingOfKind(kind), outboxTimeoutMs);
    if (pending) {
      await withTimeout(deps.outbox.incrementRepeat(pending.id, count), outboxTimeoutMs);
      return;
    }
    const previous = await withTimeout(deps.outbox.latestDeliveredOfKind(kind, item.at - PREVIOUS_LOOKBACK_MS), outboxTimeoutMs);
    const decision = coalesce(previous, item.at);
    if (decision.action === 'repeat') {
      await withTimeout(deps.outbox.incrementRepeat(decision.id, count), outboxTimeoutMs);
      return;
    }
    const inserted = await withTimeout(
      deps.outbox.insert({
        kind: 'alarm',
        alarm: { ...kind, level: 'page' },
        ...(item.details ? { details: item.details } : {}),
        text: textOf(item, decision.repeatsSincePrevious),
        chatId,
        createdAt: item.at,
      }),
      outboxTimeoutMs,
    );
    if (inserted !== 'duplicate-slot' && count > 1) await withTimeout(deps.outbox.incrementRepeat(inserted.id, count - 1), outboxTimeoutMs);
  }

  /** AC-9: the outbox is down — straight to the sink, once per kind per 10 min. */
  function sendDirect(item: PageItem, target: TelegramTarget, key: string): void {
    line({ code: 'alarm_outbox_failed', kind: `${item.a.source}/${item.a.code}` });
    const at = now();
    const last = directSent.get(key);
    if (last !== undefined && at - last < DIRECT_SEND_WINDOW_MS) return;
    if (last === undefined && directSent.size >= MAX_TRACKED_KINDS) directSent.clear();
    directSent.set(key, at);
    quiet(
      target.sink.deliver({ text: textOf(item, 0), chatId: target.chatId }).then((out) => {
        if (out.result !== 'ok') line({ code: 'alarm_direct_send_failed', ...(out.status !== undefined ? { status: out.status } : {}) });
      }),
    );
  }

  async function drain(key: string, first: PageItem, target: TelegramTarget): Promise<void> {
    let item = first;
    let count = 1;
    for (;;) {
      try {
        await writeOutbox(item, count, target.chatId);
      } catch {
        sendDirect(item, target, key);
      }
      const q = queues.get(key);
      if (!q || q.repeats === 0) {
        queues.delete(key);
        return;
      }
      item = q.last;
      count = q.repeats;
      q.repeats = 0;
    }
  }

  function page(item: PageItem, target: TelegramTarget): void {
    const key = `${item.a.source}\u0000${item.a.code}`;
    const q = queues.get(key);
    if (q) {
      q.repeats += 1;
      q.last = item;
      return;
    }
    queues.set(key, { repeats: 0, last: item });
    quiet(drain(key, item, target));
  }

  return {
    raise(a: AlarmInput): void {
      try {
        const row = findKind(a.source, a.code);
        const details = sanitizeDetails(a.details, row?.alarm.detailKeys ?? [], { secretValues: deps.secretValues });
        saving = details;
        try {
          base.raise(a);
        } finally {
          saving = undefined;
        }
        const at = now();
        if (!row && deps.cls === 'test' && !(a.source === UNREGISTERED.source && a.code === UNREGISTERED.code)) {
          const marker = sanitizeDetails({ source: a.source, code: a.code }, ['source', 'code'], { secretValues: deps.secretValues });
          quiet(deps.logStore.insert({ ...UNREGISTERED, ...(marker ? { details: marker } : {}) }));
        }
        if (a.level === 'log' || isTelegramOpsAlarm(a)) {
          if (admitLog(`${a.level}\u0000${a.source}\u0000${a.code}`, at)) {
            quiet(deps.logStore.insert({ source: a.source, code: a.code, ...(details ? { details } : {}) }));
          }
          return;
        }
        if (deps.telegram) page({ a, row, details, at }, deps.telegram);
      } catch {
        /* never throw (AC-1) */
      }
    },
  };
}
