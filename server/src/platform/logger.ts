/**
 * Structured stdout logger and the alarm interface (AC-56, NFR-4). Ring 4: it writes to the
 * process stdout. Every secret value (length ≥ 4) in any string field — nested objects,
 * arrays and `Error` messages included — is replaced with `***` before the line is written.
 */
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

/**
 * One line `{ level: 'alarm', alarm, source, code, ...details }` per alarm.
 * Never throws, even when the write fails.
 */
export function createAlarm(logger: Logger): Alarm {
  return {
    raise(a: AlarmInput): void {
      try {
        logger.error({ ...a.details, level: 'alarm', alarm: a.level, source: a.source, code: a.code });
      } catch {
        /* never throw */
      }
    },
  };
}
