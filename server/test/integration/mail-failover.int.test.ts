/**
 * SPEC-10 W21 (AC-36 … AC-44): the mail service in-process over real SMTP — Mailpit (1025), the chaos Mailpit
 * (1026, only under the cross-worktree lock) and the in-process fake SMTP — with this worktree's Redis and a
 * substitute wall clock. Unique `*.t2f.test` recipients; chaos triggers are 0 after the file.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeSmtp } from '../../../fakes/smtp/server.mjs';
import { createSmtpTransport } from '../../src/adapters/smtpMail';
import { createMailQueue, type QueuedMailTransport } from '../../src/mail/queue';
import { utcDayKey } from '../../src/domain/mail/day';
import type { MailMessage, MailTransport } from '../../src/mail/ports';
import { createMailService, mailSentKey } from '../../src/mail/service';
import { signInCodeMail } from '../../src/mail/templates/signInCode';
import type { AlarmInput } from '../../src/ports';
import { getChaos, withChaos } from '../support/mailChaos';
import { countMessages, MAILPIT_API, type MailpitMessage, waitForMessage } from '../support/mailpit';
import { ownRedis } from './helpers';

const redis = ownRedis();
let fake: Awaited<ReturnType<typeof startFakeSmtp>>;
let open: QueuedMailTransport[] = [];
let raised: AlarmInput[] = [];
let now = Date.UTC(2026, 11, 31, 12, 0, 0);
const clock = { now: () => now };
const alarm = { raise: (a: AlarmInput) => void raised.push(a) };

const smtp = (port: number, provider: string): QueuedMailTransport => {
  const t = createMailQueue(createSmtpTransport({ host: '127.0.0.1', port }), { provider });
  open.push(t);
  return t;
};
const mailpit = () => smtp(1025, 'fallback');
const chaosPit = () => smtp(1026, 'primary');
const fakeSmtp = (provider: string) => smtp(fake.port, provider);

/** Counts calls on a transport. */
function spy(t: MailTransport): MailTransport & { calls: number } {
  const s = {
    calls: 0,
    send: (m: MailMessage) => {
      s.calls += 1;
      return t.send(m);
    },
  };
  return s;
}

const service = (primary: MailTransport, fallback?: MailTransport, ceilings = { primary: 1000, fallback: 1000 }) =>
  createMailService({ primary, ...(fallback ? { fallback } : {}), store: redis, alarm, clock, ceilings });

const recipient = (tag = '') => `mf-${randomUUID().slice(0, 8)}${tag ? `+${tag}` : ''}@t2f.test`;
const codeMail = (to: string, code = String(100000 + Math.floor(Math.random() * 899999))) =>
  signInCodeMail({ code, id: randomUUID(), from: 'Time2Fest <code@t2f.test>', to });
const other = (to: string): MailMessage => ({ ...codeMail(to), class: 'other' });
/** Mailpit canonicalizes header names (`X-Entity-Ref-Id`): look up case-insensitively. */
const header = (m: MailpitMessage, name: string) =>
  Object.entries(m.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]?.[0];
const codesOf = (code: string) => raised.filter((a) => a.code === code);
const seed = (provider: 'primary' | 'fallback', n: number) => redis.set(mailSentKey(provider, utcDayKey(new Date(now))), String(n), 86_400_000);

beforeAll(async () => {
  fake = await startFakeSmtp({ port: 0 });
});
beforeEach(async () => {
  raised = [];
  now = Date.UTC(2026, 11, 31, 12, 0, 0);
  await redis.deleteByPrefix('mail:');
});
afterEach(() => {
  for (const t of open) t.close();
  open = [];
});
afterAll(async () => {
  await redis.deleteByPrefix('mail:');
  await redis.close();
  await fake.close();
  const chaos = await getChaos();
  expect([chaos.Sender.Probability, chaos.Recipient.Probability, chaos.Authentication.Probability]).toEqual([0, 0, 0]);
});

describe('mail service over SMTP (SPEC-10)', () => {
  it('AC-36: a code mail reaches Mailpit within 5 s with the code, the headers and no link', async () => {
    const to = recipient();
    const msg = codeMail(to, '482913');
    const started = Date.now();
    expect(await service(smtp(1025, 'primary')).send(msg)).toEqual({ ok: true, provider: 'primary' });
    const got = await waitForMessage(MAILPIT_API, to, 5000);
    expect(Date.now() - started).toBeLessThanOrEqual(5000);
    expect(got.subject).toContain('482913');
    expect(got.text).toContain('482913');
    expect(`${got.text}${got.html}`).not.toMatch(/https?:/);
    expect(header(got, 'Auto-Submitted')).toBe('auto-generated');
    expect(header(got, 'Resend-Idempotency-Key')).toBe(msg.id);
    expect(header(got, 'X-Entity-Ref-ID')).toBe(msg.id);
    expect(header(got, 'Message-ID')).toBe(`<${msg.id}@mail.time2fest.com>`);
  });

  it('AC-37 (a): chaos Sender:451 on the primary → the same code once via the fallback, one failover alarm', async () => {
    const to = recipient();
    const msg = codeMail(to, '551177');
    const res = await withChaos({ Sender: { ErrorCode: 451, Probability: 100 } }, () => service(chaosPit(), mailpit()).send(msg));
    expect(res).toEqual({ ok: true, provider: 'fallback' });
    const got = await waitForMessage(MAILPIT_API, to);
    expect(got.text).toContain('551177');
    expect(header(got, 'Resend-Idempotency-Key')).toBe(msg.id);
    expect(await countMessages(MAILPIT_API, to)).toBe(1);
    expect(codesOf('mail/provider-failover')).toEqual([{ level: 'page', source: 'mail', code: 'mail/provider-failover', details: { provider: 'primary' } }]);
  });

  it.each(['q451', 'q550'])('AC-37 (b): fake SMTP +%s after DATA → fallback exactly once', async (tag) => {
    const to = recipient(tag);
    const primary = spy(fakeSmtp('primary'));
    const fallback = spy(mailpit());
    expect(await service(primary, fallback).send(codeMail(to, '300300'))).toEqual({ ok: true, provider: 'fallback' });
    expect([primary.calls, fallback.calls]).toEqual([1, 1]);
    expect((await waitForMessage(MAILPIT_API, to)).text).toContain('300300');
    expect(await countMessages(MAILPIT_API, to)).toBe(1);
  });

  it('AC-38: chaos Recipient:550 → recipient, the fallback is never called, no failover alarm', async () => {
    const fallback = spy(mailpit());
    const res = await withChaos({ Recipient: { ErrorCode: 550, Probability: 100 } }, () => service(chaosPit(), fallback).send(codeMail(recipient())));
    expect(res).toEqual({ ok: false, reason: 'recipient' });
    expect(fallback.calls).toBe(0);
    expect(raised).toEqual([]);
  });

  it('AC-39: after a quota failover the primary is skipped until 00:00 UTC, then used again', async () => {
    const primary = spy(fakeSmtp('primary'));
    const fallback = spy(mailpit());
    const svc = service(primary, fallback);
    expect(await svc.send(codeMail(recipient('q550')))).toEqual({ ok: true, provider: 'fallback' });
    primary.calls = 0;
    fallback.calls = 0;
    now += 60 * 60 * 1000;
    expect(await svc.send(codeMail(recipient()))).toEqual({ ok: true, provider: 'fallback' });
    expect([primary.calls, fallback.calls]).toEqual([0, 1]);
    now = Date.UTC(2027, 0, 1, 0, 0, 1);
    expect(await svc.send(codeMail(recipient()))).toEqual({ ok: true, provider: 'primary' });
    expect(primary.calls).toBe(1);
  });

  it('AC-40: both providers fail → unavailable and one all-providers-down page', async () => {
    const svc = service(fakeSmtp('primary'), fakeSmtp('fallback'));
    expect(await svc.send(codeMail(recipient('q451')))).toEqual({ ok: false, reason: 'unavailable' });
    expect(await svc.send(codeMail(recipient('q451')))).toEqual({ ok: false, reason: 'unavailable' });
    expect(codesOf('mail/all-providers-down')).toEqual([{ level: 'page', source: 'mail', code: 'mail/all-providers-down' }]);
  });

  it('AC-41: 10 failovers within 5 minutes → one failover alarm', async () => {
    const primary = spy(fakeSmtp('primary'));
    const svc = service(primary, mailpit());
    for (let i = 0; i < 10; i += 1) {
      expect(await svc.send(codeMail(recipient('rate')))).toEqual({ ok: true, provider: 'fallback' });
      now += 25_000;
    }
    expect(codesOf('mail/provider-failover')).toHaveLength(1);
    expect(primary.calls).toBe(1);
  });

  it('AC-42: the primary counter at 69 → one daily-70 alarm on the 70th mail, none on the 71st', async () => {
    await seed('primary', 69);
    const svc = service(fakeSmtp('primary'));
    await svc.send(codeMail(recipient()));
    expect(codesOf('mail/daily-70')).toEqual([{ level: 'page', source: 'mail', code: 'mail/daily-70' }]);
    await svc.send(codeMail(recipient()));
    expect(codesOf('mail/daily-70')).toHaveLength(1);
  });

  it('AC-43: ceiling 10 → ceiling-80 with the provider on the 8th mail, once', async () => {
    await seed('primary', 7);
    const svc = service(fakeSmtp('primary'), undefined, { primary: 10, fallback: 10 });
    await svc.send(codeMail(recipient()));
    expect(codesOf('mail/ceiling-80')).toEqual([{ level: 'page', source: 'mail', code: 'mail/ceiling-80', details: { provider: 'primary' } }]);
    await svc.send(codeMail(recipient()));
    expect(codesOf('mail/ceiling-80')).toHaveLength(1);
  });

  it('AC-44: ceiling 10 — «other» refused from the 8th, codes 9–10 primary, 11th fallback, both full → unavailable', async () => {
    const primary = spy(fakeSmtp('primary'));
    const fallback = spy(fakeSmtp('fallback'));
    const svc = service(primary, fallback, { primary: 10, fallback: 10 });
    await seed('primary', 6);
    expect(await svc.send(other(recipient()))).toEqual({ ok: true, provider: 'primary' }); // 7th
    expect(await svc.send(other(recipient()))).toEqual({ ok: true, provider: 'primary' }); // 8th: counter 7 < 8
    expect(await svc.send(other(recipient()))).toEqual({ ok: false, reason: 'unavailable' }); // counter 8 = 80 %
    expect(await svc.send(codeMail(recipient()))).toEqual({ ok: true, provider: 'primary' }); // 9th
    expect(await svc.send(codeMail(recipient()))).toEqual({ ok: true, provider: 'primary' }); // 10th
    expect(await svc.send(codeMail(recipient()))).toEqual({ ok: true, provider: 'fallback' }); // 11th
    expect([primary.calls, fallback.calls]).toEqual([4, 1]);
    await seed('fallback', 10);
    expect(await svc.send(codeMail(recipient()))).toEqual({ ok: false, reason: 'unavailable' });
    expect([primary.calls, fallback.calls]).toEqual([4, 1]);
  });
});
