/**
 * Structured stdout logger and the alarm interface (AC-56, NFR-4). Ring 4: it writes to the
 * process stdout. Every secret value (length ≥ 4) in any string field — nested objects,
 * arrays and `Error` messages included — is replaced with `***` before the line is written.
 */
import type { AlarmStore } from '../alarms/ports';
import type { Alarm, AlarmInput, Clock, Logger } from '../ports';

export const MASK = '***';
const MIN_SECRET_LENGTH = 4;
const MAX_DEPTH = 8;

export type LineWriter = (line: string) => void;

export interface LoggerOptions {
  clock: Clock;
  /** Defaults to `process.stdout.write`. */
  write?: LineWriter;
}

const stdoutWriter: LineWriter = (line) => {
  process.stdout.write(line);
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function masker(secrets: readonly string[]): (s: string) => string {
  // Longest first, so a secret that contains another is masked whole.
  const list = [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return (s) => s;
  const re = new RegExp(list.map(escapeRegExp).join('|'), 'g');
  return (s) => s.replace(re, MASK);
}

function redact(value: unknown, mask: (s: string) => string, depth: number): unknown {
  if (typeof value === 'string') return mask(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (value instanceof Error) {
    return { name: value.name, message: mask(value.message), ...(value.stack ? { stack: mask(value.stack) } : {}) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, mask, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = redact(v, mask, depth + 1);
  return out;
}

export function createLogger(secrets: readonly string[], options: LoggerOptions): Logger {
  const mask = masker(secrets);
  const write = options.write ?? stdoutWriter;
  const line = (level: string, fields: Record<string, unknown>) => {
    const body = redact(fields, mask, 0) as Record<string, unknown>;
    write(`${JSON.stringify({ t: options.clock.now(), level, ...body })}\n`);
  };
  return {
    info: (fields) => line('info', fields),
    warn: (fields) => line('warn', fields),
    error: (fields) => line('error', fields),
  };
}

/** Repeats of one alarm kind inside this window are suppressed (counted, not written or saved). */
export const ALARM_THROTTLE_MS = 60_000;
const MAX_TRACKED_KINDS = 1_000;

export interface AlarmOptions {
  throttleMs?: number;
  /** Epoch ms for the throttle; defaults to `Date.now` (real time, like log timestamps). */
  now?: () => number;
}

/**
 * One line `{ level: 'alarm', alarm, source, code, ...details }` per alarm; with `store`, a `page`
 * alarm is also saved, fire-and-forget (AC-37 of SPEC-04): a failed save writes one log-level
 * alarm line and is otherwise swallowed. Never throws, even when the write or the save fails.
 *
 * Per kind (`level`, `source`, `code`), at most one line and one save per `throttleMs`; the next
 * line after a suppressed burst carries `suppressed: <count>`. This keeps a failure that repeats on
 * every request (e.g. `access-jwks-unreachable`) from flooding the log and the alarm store.
 */
export function createAlarm(logger: Logger, store?: Pick<AlarmStore, 'save'>, options: AlarmOptions = {}): Alarm {
  const throttleMs = options.throttleMs ?? ALARM_THROTTLE_MS;
  const now = options.now ?? Date.now;
  const kinds = new Map<string, { at: number; suppressed: number }>();

  function admit(a: AlarmInput): { suppressed: number } | null {
    const key = `${a.level}\u0000${a.source}\u0000${a.code}`;
    const t = now();
    const seen = kinds.get(key);
    if (seen && t - seen.at < throttleMs) {
      seen.suppressed += 1;
      return null;
    }
    if (!seen && kinds.size >= MAX_TRACKED_KINDS) kinds.clear();
    kinds.set(key, { at: t, suppressed: 0 });
    return { suppressed: seen?.suppressed ?? 0 };
  }

  return {
    raise(a: AlarmInput): void {
      try {
        const admitted = admit(a);
        if (!admitted) return;
        const extra = admitted.suppressed > 0 ? { suppressed: admitted.suppressed } : {};
        try {
          logger.error({ ...a.details, ...extra, level: 'alarm', alarm: a.level, source: a.source, code: a.code });
        } catch {
          /* never throw */
        }
        if (a.level !== 'page' || !store) return;
        store.save({ source: a.source, code: a.code }).catch(() => {
          try {
            logger.error({ level: 'alarm', alarm: 'log', source: 'alarms', code: 'alarm_store_failed' });
          } catch {
            /* never throw */
          }
        });
      } catch {
        /* never throw */
      }
    },
  };
}
