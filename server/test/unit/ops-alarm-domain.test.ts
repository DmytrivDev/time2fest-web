/** SPEC-13b AC-4, AC-6, AC-7, AC-10, AC-11, AC-13: pure alarm rules — retries, coalescing, storm, text, redaction, route. */
import { describe, expect, it } from 'vitest';
import type { AlarmDeliveryOutcome, AlarmDetails } from '../../src/alarms/ports';
import { sanitizeDetails } from '../../src/domain/ops/alarmDetails';
import {
  ALARM_TEXT_MAX_CHARS,
  buildAlarmText,
  buildDigestText,
  buildHeartbeatText,
  buildStormSummary,
  timesWord,
} from '../../src/domain/ops/alarmText';
import {
  coalesce,
  nextAttemptAt,
  STORM_CEILING,
  stormBudget,
  stormGate,
  stormSlotKey,
  stormWindowStart,
  type DeliveredOfKind,
} from '../../src/domain/ops/delivery';
import { telegramRoute } from '../../src/domain/ops/route';
import { findKind, opsRegistry } from '../../src/registries/ops';

const TEST_TOKEN = 'test-telegram-token-not-real'; // check-secrets: allow test fake
const SEC = 1_000;
const MIN = 60 * SEC;
/** 31.12.2026 21:05:00 UTC = 23:05:00 за Києвом. */
const RAISED = Date.UTC(2026, 11, 31, 21, 5, 0);

function rowOf(source: string, code: string) {
  const row = findKind(source, code);
  if (!row) throw new Error(`kind ${source}/${code} not in the registry`);
  return row;
}

/** Drives `nextAttemptAt` with a fake sink that answers `outcome(attempt)` instantly; returns attempt times relative to raise, s. */
function attemptTimes(outcome: (attempt: number) => AlarmDeliveryOutcome): { offsets: number[]; end: string } {
  const offsets: number[] = [];
  let now = RAISED;
  for (let attempt = 1; attempt < 100; attempt += 1) {
    offsets.push((now - RAISED) / SEC);
    const next = nextAttemptAt({ raisedAt: RAISED, attempts: attempt, outcome: outcome(attempt), now });
    if (next.kind !== 'retry') return { offsets, end: next.kind === 'failed' ? `failed:${next.reason}` : 'delivered' };
    expect(next.at).toBeGreaterThanOrEqual(now);
    now = next.at;
  }
  throw new Error('no end');
}

describe('retries (AC-4)', () => {
  it('network / 5xx: 5, 10, 20 s, then every 60 s, never after 10 min', () => {
    const { offsets, end } = attemptTimes(() => ({ result: 'retry', status: 502 }));
    expect(offsets).toEqual([0, 5, 10, 20, 80, 140, 200, 260, 320, 380, 440, 500, 560]);
    expect(end).toBe('failed:expired');
    expect(Math.max(...offsets)).toBeLessThanOrEqual(600);
  });

  it('429 honours retry_after (capped at 300 s) and stays inside the window', () => {
    const { offsets, end } = attemptTimes((a) => (a === 1 ? { result: 'retry', status: 429, retryAfterSec: 42 } : { result: 'ok', status: 200 }));
    expect(offsets).toEqual([0, 42]);
    expect(end).toBe('delivered');

    const short = attemptTimes((a) => (a === 2 ? { result: 'retry', status: 429, retryAfterSec: 1 } : a < 4 ? { result: 'retry' } : { result: 'ok' }));
    expect(short.offsets).toEqual([0, 5, 10, 20]);

    const capped = nextAttemptAt({ raisedAt: RAISED, attempts: 1, outcome: { result: 'retry', status: 429, retryAfterSec: 10_000 }, now: RAISED });
    expect(capped).toEqual({ kind: 'retry', at: RAISED + 300 * SEC });
    const late = nextAttemptAt({ raisedAt: RAISED, attempts: 9, outcome: { result: 'retry', status: 429, retryAfterSec: 300 }, now: RAISED + 400 * SEC });
    expect(late).toEqual({ kind: 'failed', reason: 'expired' });
  });

  it('400 and 403 → one attempt, no retry', () => {
    for (const status of [400, 403]) {
      const { offsets, end } = attemptTimes(() => ({ result: 'fatal', status }));
      expect(offsets).toEqual([0]);
      expect(end).toBe('failed:fatal');
    }
  });

  it('a late sender never schedules into the past', () => {
    const next = nextAttemptAt({ raisedAt: RAISED, attempts: 1, outcome: { result: 'retry' }, now: RAISED + 30 * SEC });
    expect(next).toEqual({ kind: 'retry', at: RAISED + 30 * SEC });
  });
});

describe('coalescing (AC-6)', () => {
  it('50 raises of scheduler/lag in 10 min → 1 message; a raise at 11 min → «повторилось 49 разів»', () => {
    const lag = rowOf('scheduler', 'lag');
    const messages: string[] = [];
    let delivered: DeliveredOfKind | null = null;
    const raise = (at: number) => {
      const d = coalesce(delivered, at);
      if (d.action === 'repeat') {
        if (delivered) delivered = { ...delivered, repeatCount: delivered.repeatCount + 1 };
        return;
      }
      messages.push(buildAlarmText({ row: lag, kind: { source: 'scheduler', code: 'lag' }, cls: 'test', raisedAt: at, repeatCount: d.repeatsSincePrevious }));
      delivered = { id: `row-${messages.length}`, deliveredAt: at, repeatCount: 0 };
    };
    for (let i = 0; i < 50; i += 1) raise(RAISED + i * 12 * SEC);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('повторилось');
    raise(RAISED + 11 * MIN);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain('повторилось 49 разів');
  });

  it('no previous delivered row → new without repeats', () => {
    expect(coalesce(null, RAISED)).toEqual({ action: 'new', repeatsSincePrevious: 0 });
    expect(coalesce({ id: 'x', deliveredAt: null, repeatCount: 3 }, RAISED)).toEqual({ action: 'new', repeatsSincePrevious: 0 });
    expect(coalesce({ id: 'x', deliveredAt: RAISED, repeatCount: 0 }, RAISED + 10 * MIN)).toEqual({ action: 'repeat', id: 'x' });
  });

  it('Ukrainian plural of «раз»', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 49, 101, 112].map(timesWord)).toEqual([
      '1 раз', '2 рази', '4 рази', '5 разів', '11 разів', '12 разів', '14 разів', '21 раз', '22 рази', '49 разів', '101 раз', '112 разів',
    ]);
  });
});

describe('storm ceiling (AC-7)', () => {
  it('40 different kinds in a minute → 20 messages + 1 summary listing the domains', () => {
    const domains = opsRegistry.filter((r) => r.alarms.length > 0).map((r) => r.title);
    const raised = Array.from({ length: 40 }, (_, i) => ({ at: RAISED + i * 1_500, domain: domains[i % domains.length] ?? 'невідомо' }));
    const sent: number[] = [];
    const held: typeof raised = [];
    for (const a of raised) {
      const inWindow = sent.filter((t) => t > a.at - 10 * MIN).length;
      if (stormGate(inWindow) === 'send') sent.push(a.at);
      else held.push(a);
    }
    expect(sent).toHaveLength(STORM_CEILING);
    expect(held).toHaveLength(20);
    const boundary = stormWindowStart(RAISED) + 10 * MIN;
    const summary = buildStormSummary({ cls: 'test', held: held.length, domains: held.map((h) => h.domain), at: boundary });
    const messages = sent.length + 1;
    expect(messages).toBe(21);
    expect(summary).toContain('ще 20 без окремих повідомлень, див. Моніторинг');
    for (const d of new Set(held.map((h) => h.domain))) expect(summary).toContain(d);
    expect(summary.length).toBeLessThanOrEqual(ALARM_TEXT_MAX_CHARS);
  });

  it('budget and slot key', () => {
    expect(stormBudget(0)).toBe(20);
    expect(stormBudget(19)).toBe(1);
    expect(stormBudget(25)).toBe(0);
    expect(stormGate(19)).toBe('send');
    expect(stormGate(20)).toBe('hold');
    expect(stormWindowStart(RAISED + 4 * MIN)).toBe(Date.UTC(2026, 11, 31, 21, 0, 0));
    expect(stormSlotKey(Date.UTC(2026, 11, 31, 21, 0, 0))).toBe('storm:2026-12-31T21:00:00.000Z');
  });
});

describe('alarm text (AC-10)', () => {
  it('scheduler/lag', () => {
    const row = rowOf('scheduler', 'lag');
    const details = sanitizeDetails({ action: 'stream-start', at: '2026-12-31T21:00:00.000Z', lagMs: 4210 }, row.alarm.detailKeys);
    expect(buildAlarmText({ row, kind: { source: 'scheduler', code: 'lag' }, cls: 'rehearsal', details, raisedAt: RAISED, repeatCount: 0 })).toBe(
      [
        'ТРИВОГА · середовище: репетиція (rehearsal)',
        `Домен: ${row.domain.title}`,
        `Що сталося: ${row.alarm.meaning}`,
        `Що робити: ${row.alarm.action}`,
        'Час: 31.12.2026 23:05:00 за Києвом · 31.12.2026 21:05:00 UTC',
        'Деталі:',
        'action: stream-start',
        'at: 2026-12-31T21:00:00.000Z',
        'lagMs: 4210',
        'Підтвердити: адмінка → Моніторинг',
      ].join('\n'),
    );
  });

  it('ops/backup-failed with stage, repeated', () => {
    const row = rowOf('ops', 'backup-failed');
    const details = sanitizeDetails({ stage: 'upload', path: '/var/tmp' }, row.alarm.detailKeys);
    expect(buildAlarmText({ row, kind: { source: 'ops', code: 'backup-failed' }, cls: 'production', details, raisedAt: Date.UTC(2026, 6, 1, 3, 0, 0), repeatCount: 3 })).toBe(
      [
        'ТРИВОГА · середовище: робоче (production)',
        'Домен: Копії й моніторинг',
        'Що сталося: Копія бази не вдалася; етап — у деталях.',
        'Що робити: Подивитися рядок журналу копій; запустити копію вручну після виправлення.',
        'Час: 01.07.2026 06:00:00 за Києвом · 01.07.2026 03:00:00 UTC',
        'Деталі:',
        'stage: upload',
        'Після попереднього повідомлення повторилось 3 рази.',
        'Підтвердити: адмінка → Моніторинг',
      ].join('\n'),
    );
  });

  it('live/quota-80', () => {
    const row = rowOf('live', 'live/quota-80');
    const details = sanitizeDetails({ bucket: '2026-12-31' }, row.alarm.detailKeys);
    expect(buildAlarmText({ row, kind: { source: 'live', code: 'live/quota-80' }, cls: 'test', details, raisedAt: RAISED })).toBe(
      [
        'ТРИВОГА · середовище: тест (test)',
        `Домен: ${row.domain.title}`,
        'Що сталося: Використано 80 % добової квоти YouTube.',
        'Що робити: Зменшити частоту позачергових перевірок; стежити за квотою до 00:00 за тихоокеанським часом.',
        'Час: 31.12.2026 23:05:00 за Києвом · 31.12.2026 21:05:00 UTC',
        'Деталі:',
        'bucket: 2026-12-31',
        'Підтвердити: адмінка → Моніторинг',
      ].join('\n'),
    );
  });

  it('unregistered kind → domain «невідомо»', () => {
    const text = buildAlarmText({ row: undefined, kind: { source: 'x', code: 'y' }, cls: 'test', raisedAt: RAISED });
    expect(text).toContain('Домен: невідомо');
    expect(text).toContain('x/y');
    expect(text.endsWith('Підтвердити: адмінка → Моніторинг')).toBe(true);
  });

  it('long details are cut to 1 000 characters; fixed parts and the hint stay', () => {
    const row = rowOf('scheduler', 'lag');
    const details: AlarmDetails = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`key${String.fromCharCode(65 + (i % 26))}${i}`, 'v'.repeat(64)]));
    const text = buildAlarmText({ row, kind: { source: 'scheduler', code: 'lag' }, cls: 'test', details, raisedAt: RAISED, repeatCount: 7 });
    expect(text.length).toBeLessThanOrEqual(ALARM_TEXT_MAX_CHARS);
    expect(text.length).toBeGreaterThan(ALARM_TEXT_MAX_CHARS - 70);
    expect(text.startsWith('ТРИВОГА · середовище: тест (test)')).toBe(true);
    expect(text).toContain('…');
    expect(text).toContain('повторилось 7 разів');
    expect(text.endsWith('Підтвердити: адмінка → Моніторинг')).toBe(true);
  });

  it('heartbeat and digest texts', () => {
    expect(buildHeartbeatText({ cls: 'rehearsal', openPage: 0, lastBackupAgeMs: 65 * MIN, delivery: 'ok', at: RAISED })).toBe(
      [
        'Усе гаразд · середовище: репетиція (rehearsal)',
        'Відкритих тривог: 0',
        'Остання копія бази: 1 год 5 хв тому',
        'Доставка: усе доставлено',
        'Час: 31.12.2026 23:05:00 за Києвом · 31.12.2026 21:05:00 UTC',
      ].join('\n'),
    );
    expect(buildHeartbeatText({ cls: 'test', openPage: 2, lastBackupAgeMs: null, delivery: 'retrying', at: RAISED })).toContain(
      "Зв'язок працює; відкритих тривог: 2",
    );
    const digest = buildDigestText({
      cls: 'test',
      date: '2027-01-01',
      logKinds: [
        { domain: 'Планувальник', kind: 'scheduler/action_failed', count: 3 },
        { domain: 'Сайт', kind: 'site/site/purge-failed', count: 2 },
        { domain: 'Час', kind: 'clock/refresh_failed', count: 2 },
      ],
      openPage: 1,
      lastBackupAgeMs: 30 * MIN,
      spendOver50: [{ title: 'AI', percent: 61.4 }],
      at: Date.UTC(2027, 0, 1, 7, 0, 0),
    });
    expect(digest).toContain('Тривог рівня log за 24 год: 7');
    expect(digest).toContain('Планувальник: 3');
    expect(digest).toContain('Витрати понад 50 %: AI 61 %');
    expect(digest).toContain('scheduler/action_failed: 3');
  });
});

describe('redaction (AC-11)', () => {
  const lag = rowOf('scheduler', 'lag');
  const BAD = [
    'owner@example.com',
    '192.168.10.20',
    'node/10.0.0.7',
    '2001:db8::1',
    'fe80::1',
    'Привіт, це текст повідомлення',
    'hello world',
    TEST_TOKEN,
    `prefix-${TEST_TOKEN}`,
    'bot123456:ABCdef',
    '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    'https://api.telegram.org/bot1/sendMessage',
    'x'.repeat(65),
  ];

  it('only allow-listed keys with numbers or codes ≤64; personal data and secrets never pass', () => {
    for (const bad of BAD) {
      const raw = { action: bad, at: bad, lagMs: 12, nick: 'kitty_2027', email: 'owner@example.com', text: 'hi' };
      const clean = sanitizeDetails(raw, lag.alarm.detailKeys, { secretValues: [TEST_TOKEN] });
      expect(clean, bad).toEqual({ lagMs: 12 });
      const text = buildAlarmText({ row: lag, kind: { source: 'scheduler', code: 'lag' }, cls: 'test', details: clean, raisedAt: RAISED });
      expect(text).not.toContain(bad);
      expect(text).not.toContain('kitty_2027');
      expect(text).not.toContain('owner@example.com');
      expect(JSON.stringify(clean)).not.toContain(bad);
    }
  });

  it('keeps codes, times and numbers; drops non-finite numbers and non-objects', () => {
    expect(sanitizeDetails({ action: 'stream-start', at: '23:05:00', lagMs: 1.5 }, lag.alarm.detailKeys)).toEqual({ action: 'stream-start', at: '23:05:00', lagMs: 1.5 });
    expect(sanitizeDetails({ lagMs: Number.NaN, action: null }, lag.alarm.detailKeys)).toBeUndefined();
    expect(sanitizeDetails('text', lag.alarm.detailKeys)).toBeUndefined();
    expect(sanitizeDetails([1, 2], lag.alarm.detailKeys)).toBeUndefined();
    expect(sanitizeDetails({ action: 'a' }, [])).toBeUndefined();
  });
});

describe('route by class (AC-13, AC-14)', () => {
  const FAKE = 'http://127.0.0.1:45123';
  const full = {
    T2F_TELEGRAM_BOT_TOKEN: TEST_TOKEN,
    T2F_TELEGRAM_CHAT_ID: '-100111',
    T2F_TELEGRAM_TEST_CHAT_ID: '-100222',
  };

  it('production → owner chat only', () => {
    expect(telegramRoute('production', full)).toEqual({ chatId: '-100111', apiBase: 'https://api.telegram.org' });
    expect(telegramRoute('production', { ...full, T2F_TELEGRAM_CHAT_ID: undefined })).toEqual({ disabled: 'not-configured', missing: ['T2F_TELEGRAM_CHAT_ID'] });
    expect(telegramRoute('production', { ...full, T2F_TELEGRAM_API_BASE: 'http://telegram.example' })).toEqual({ disabled: 'insecure-base' });
  });

  it('rehearsal → test chat; a set owner chat is ignored with one warning', () => {
    expect(telegramRoute('rehearsal', full)).toEqual({ chatId: '-100222', apiBase: 'https://api.telegram.org', warn: 'owner-chat-ignored' });
    expect(telegramRoute('rehearsal', { ...full, T2F_TELEGRAM_CHAT_ID: undefined })).toEqual({ chatId: '-100222', apiBase: 'https://api.telegram.org' });
    expect(telegramRoute('rehearsal', { T2F_TELEGRAM_BOT_TOKEN: TEST_TOKEN, T2F_TELEGRAM_CHAT_ID: '-100111' })).toEqual({
      disabled: 'not-configured',
      missing: ['T2F_TELEGRAM_TEST_CHAT_ID'],
      warn: 'owner-chat-ignored',
    });
    expect(telegramRoute('rehearsal', {})).toEqual({ disabled: 'not-configured', missing: ['T2F_TELEGRAM_BOT_TOKEN', 'T2F_TELEGRAM_TEST_CHAT_ID'] });
  });

  it('test → loopback fake only; non-loopback or missing base → disabled', () => {
    const noOwner = { T2F_TELEGRAM_BOT_TOKEN: TEST_TOKEN, T2F_TELEGRAM_TEST_CHAT_ID: '-100222' };
    expect(telegramRoute('test', { ...noOwner, T2F_TELEGRAM_API_BASE: FAKE })).toEqual({ chatId: '-100222', apiBase: FAKE });
    expect(telegramRoute('test', { ...noOwner, T2F_TELEGRAM_API_BASE: 'https://api.telegram.org' })).toEqual({ disabled: 'non-loopback' });
    expect(telegramRoute('test', noOwner)).toEqual({ disabled: 'non-loopback', missing: ['T2F_TELEGRAM_API_BASE'] });
    expect(telegramRoute('test', { ...full, T2F_TELEGRAM_API_BASE: FAKE })).toEqual({ chatId: '-100222', apiBase: FAKE, warn: 'owner-chat-ignored' });
    expect(telegramRoute('test', { T2F_TELEGRAM_API_BASE: FAKE })).toEqual({
      disabled: 'not-configured',
      missing: ['T2F_TELEGRAM_BOT_TOKEN', 'T2F_TELEGRAM_TEST_CHAT_ID'],
    });
  });

  it('never returns the token', () => {
    for (const cls of ['test', 'rehearsal', 'production'] as const) {
      expect(JSON.stringify(telegramRoute(cls, { ...full, T2F_TELEGRAM_API_BASE: FAKE }))).not.toContain(TEST_TOKEN);
    }
  });
});
