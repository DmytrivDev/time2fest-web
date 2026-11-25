import { describe, expect, it } from 'vitest';
import { brokenUntil } from '../../src/domain/mail/breaker';
import { admit, levelsCrossed } from '../../src/domain/mail/ceiling';
import { classifyMailError } from '../../src/domain/mail/classify';
import { msToUtcMidnight, utcDayKey } from '../../src/domain/mail/day';
import { MAIL_QUEUE_OVERFLOW, type MailMessage, type MailTransportResult } from '../../src/mail/ports';
import { createMailService, MAIL_FALLBACK, MAIL_PRIMARY, MAIL_SPILL_BACKLOG, mailBrokenKey, mailSentKey } from '../../src/mail/service';

describe('classifyMailError', () => {
  it('RCPT TO 550 -> recipient', () => {
    expect(classifyMailError({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', response: '550 no such user' })).toEqual({ kind: 'recipient' });
  });
  it('EMESSAGE 451 after DATA -> fallback', () => {
    expect(classifyMailError({ code: 'EMESSAGE', responseCode: 451, command: 'DATA' })).toEqual({ kind: 'fallback', broken: 'other' });
  });
  it('5xx daily quota -> fallback quota', () => {
    expect(classifyMailError({ responseCode: 550, command: 'RCPT TO', response: '550 daily quota exceeded' })).toEqual({ kind: 'fallback', broken: 'quota' });
  });
  it('5xx rate text -> fallback other', () => {
    expect(classifyMailError({ responseCode: 554, command: 'DATA', response: 'too many requests' })).toEqual({ kind: 'fallback', broken: 'other' });
  });
  it('EAUTH / ETIMEDOUT / ECONNECTION -> fallback', () => {
    for (const code of ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS']) {
      expect(classifyMailError({ code })).toEqual({ kind: 'fallback', broken: 'other' });
    }
  });
  it('plain 5xx not on RCPT -> fallback', () => {
    expect(classifyMailError({ responseCode: 554, command: 'DATA', response: 'rejected' }).kind).toBe('fallback');
  });
  it('result never carries the response text', () => {
    expect(JSON.stringify(classifyMailError({ responseCode: 550, command: 'RCPT TO', response: 'secret@x.com' }))).not.toContain('secret');
  });
});

describe('breaker and day', () => {
  const now = new Date('2026-12-31T22:30:00Z');
  it('quota until next 00:00 UTC', () => {
    expect(brokenUntil('quota', now)).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });
  it('other for 5 minutes', () => {
    expect(brokenUntil('other', now)).toBe(now.getTime() + 300_000);
  });
  it('day key and ms to midnight', () => {
    expect(utcDayKey(now)).toBe('20261231');
    expect(msToUtcMidnight(now)).toBe(90 * 60_000);
    expect(msToUtcMidnight(new Date('2027-01-01T00:00:00Z'))).toBe(86_400_000);
  });
});

describe('admit (ceiling 10)', () => {
  const base = { primaryCeiling: 10, fallbackCeiling: 10, fallbackCount: 0 };
  it('below 80 % both classes primary', () => {
    expect(admit({ ...base, class: 'other', primaryCount: 7 })).toBe('primary');
    expect(admit({ ...base, class: 'code', primaryCount: 7 })).toBe('primary');
  });
  it('at 80 % other refused, code primary', () => {
    expect(admit({ ...base, class: 'other', primaryCount: 8 })).toBe('refuse');
    expect(admit({ ...base, class: 'code', primaryCount: 8 })).toBe('primary');
    expect(admit({ ...base, class: 'code', primaryCount: 9 })).toBe('primary');
  });
  it('at 100 % code goes to fallback, then refuse when both full', () => {
    expect(admit({ ...base, class: 'code', primaryCount: 10 })).toBe('fallback');
    expect(admit({ ...base, class: 'code', primaryCount: 10, fallbackCount: 9 })).toBe('fallback');
    expect(admit({ ...base, class: 'code', primaryCount: 10, fallbackCount: 10 })).toBe('refuse');
    expect(admit({ ...base, class: 'other', primaryCount: 10 })).toBe('refuse');
  });
  it('levelsCrossed fires once at 80 %', () => {
    expect(levelsCrossed(6, 7, 10)).toBe(false);
    expect(levelsCrossed(7, 8, 10)).toBe(true);
    expect(levelsCrossed(8, 9, 10)).toBe(false);
  });
});

describe('mail service: queue wait is not a failure, spill-over ([А14], F1)', () => {
  const memStore = () => {
    const m = new Map<string, string>();
    return {
      m,
      async incrWindow(k: string) {
        const n = Number(m.get(k) ?? 0) + 1;
        m.set(k, String(n));
        return { count: n, ttlMs: 1000 };
      },
      async setIfAbsent(k: string, v: string) {
        if (m.has(k)) return false;
        m.set(k, v);
        return true;
      },
      async get(k: string) {
        return m.get(k) ?? null;
      },
      async set(k: string, v: string) {
        m.set(k, v);
      },
      async del(k: string) {
        m.delete(k);
      },
      async deleteByPrefix() {
        return 0;
      },
    };
  };
  const msg: MailMessage = { id: 'i', to: 'a@example.test', subject: 's', text: 't', html: 'h', headers: {}, class: 'code' };
  const fake = (result: MailTransportResult, backlog = 0) => {
    const sent: string[] = [];
    return { sent, backlog: () => backlog, async send(x: MailMessage) { sent.push(x.id); return result; } };
  };
  const make = (primary: ReturnType<typeof fake>, fallback: ReturnType<typeof fake>) => {
    const store = memStore();
    const alarms: string[] = [];
    const lines: Record<string, unknown>[] = [];
    const svc = createMailService({
      primary,
      fallback,
      store,
      alarm: { raise: (a) => alarms.push(a.code) },
      clock: { now: () => Date.UTC(2026, 11, 31, 12) },
      ceilings: { primary: 1000, fallback: 1000 },
      log: { info: (f) => lines.push(f), warn: () => {}, error: () => {} },
    });
    return { svc, store, alarms, lines };
  };

  it('primary queue overflow: no breaker, no alarm, the fallback sends once', async () => {
    const p = fake({ ok: false, err: { code: MAIL_QUEUE_OVERFLOW } });
    const f = fake({ ok: true });
    const { svc, store, alarms } = make(p, f);
    expect(await svc.send(msg)).toEqual({ ok: true, provider: MAIL_FALLBACK });
    expect(store.m.has(mailBrokenKey(MAIL_PRIMARY))).toBe(false);
    expect(alarms).toEqual([]);
    expect(f.sent).toEqual(['i']);
  });

  it('a real timeout still trips the breaker and fails over (unchanged)', async () => {
    const { svc, store, alarms } = make(fake({ ok: false, err: { code: 'ETIMEDOUT' } }), fake({ ok: true }));
    expect(await svc.send(msg)).toEqual({ ok: true, provider: MAIL_FALLBACK });
    expect(store.m.has(mailBrokenKey(MAIL_PRIMARY))).toBe(true);
    expect(alarms).toEqual(['mail/provider-failover']);
  });

  it('spill: primary backlog >= MAIL_SPILL_BACKLOG and longer than the fallback -> only the fallback, counted there, log only', async () => {
    const p = fake({ ok: true }, MAIL_SPILL_BACKLOG);
    const f = fake({ ok: true }, 3);
    const { svc, store, alarms, lines } = make(p, f);
    expect(await svc.send(msg)).toEqual({ ok: true, provider: MAIL_FALLBACK });
    expect(p.sent).toEqual([]);
    expect(f.sent).toEqual(['i']);
    expect(store.m.get(mailSentKey(MAIL_FALLBACK, '20261231'))).toBe('1');
    expect(store.m.has(mailBrokenKey(MAIL_PRIMARY))).toBe(false);
    expect(alarms).toEqual([]);
    expect(lines).toContainEqual({ event: 'mail-spill', provider: MAIL_FALLBACK });
  });

  it('no spill below the threshold or when the fallback queue is as long', async () => {
    const a = make(fake({ ok: true }, MAIL_SPILL_BACKLOG - 1), fake({ ok: true }, 0));
    expect(await a.svc.send(msg)).toEqual({ ok: true, provider: MAIL_PRIMARY });
    const b = make(fake({ ok: true }, 20), fake({ ok: true }, 20));
    expect(await b.svc.send(msg)).toEqual({ ok: true, provider: MAIL_PRIMARY });
  });

  it('spilled mail the fallback could not take goes to the primary; both failing -> unavailable, no second fallback try', async () => {
    const p = fake({ ok: true }, 30);
    const f = fake({ ok: false, err: { code: MAIL_QUEUE_OVERFLOW } }, 0);
    expect(await make(p, f).svc.send(msg)).toEqual({ ok: true, provider: MAIL_PRIMARY });
    const p2 = fake({ ok: false, err: { code: 'ECONNECTION' } }, 30);
    const f2 = fake({ ok: false, err: { code: 'ECONNECTION' } }, 0);
    expect(await make(p2, f2).svc.send(msg)).toEqual({ ok: false, reason: 'unavailable' });
    expect(f2.sent).toHaveLength(1);
  });
});
