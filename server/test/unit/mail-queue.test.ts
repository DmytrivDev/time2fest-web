/**
 * SPEC-10 F1 / W19 (AC-48, NFR-3, S10-11): the send queue `mail/queue.ts` over the SMTP adapter and the in-process
 * fake SMTP — rate ≤8/s per provider, the 4 s attempt race from dequeue, codes before other mail, queue overflow,
 * the `mail-send` log line without address or response text.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeSmtp } from '../../../fakes/smtp/server.mjs';
import { createSmtpTransport } from '../../src/adapters/smtpMail';
import { MAIL_QUEUE_OVERFLOW, type MailMessage } from '../../src/mail/ports';
import { createMailQueue, type QueuedMailTransport } from '../../src/mail/queue';

let fake: Awaited<ReturnType<typeof startFakeSmtp>>;
const lines: Record<string, unknown>[] = [];
const log = { info: (f: Record<string, unknown>) => lines.push(f), warn: () => {}, error: () => {} };
const open: QueuedMailTransport[] = [];

const transport = (extra: { queueMaxWaitMs?: number; queueMaxLength?: number } = {}) => {
  const smtp = createSmtpTransport({ host: '127.0.0.1', port: fake.port, user: 'fake-user', password: 'fake-pass' }); // check-secrets: allow test fake
  const t = createMailQueue(smtp, { provider: 'primary', log, ...extra });
  open.push(t);
  return t;
};
const msg = (to: string, id = 'id-1', cls: MailMessage['class'] = 'code'): MailMessage => ({
  id,
  to,
  subject: 'Код',
  text: 'Ваш код: 123456',
  html: '<p>123456</p>',
  class: cls,
  headers: { From: 'Time2Fest <code@example.test>', 'Message-ID': `<${id}@mail.time2fest.com>`, 'X-Entity-Ref-ID': id },
});

beforeAll(async () => {
  fake = await startFakeSmtp({ port: 0 });
});
afterAll(async () => {
  for (const t of open) t.close();
  await fake.close();
});

describe('mail send queue', () => {
  it('logs one mail-send line per attempt with no address and no response text (AC-48)', async () => {
    const t = transport();
    lines.length = 0;
    expect(await t.send(msg('plain@example.test', 'lg1'))).toEqual({ ok: true });
    const q = await t.send(msg('who+q550@example.test'));
    expect(q).toMatchObject({ ok: false, err: { code: 'EMESSAGE', responseCode: 550 } });
    const r = await t.send(msg('who+rcpt550@example.test'));
    expect(r).toMatchObject({ ok: false, err: { code: 'EENVELOPE', responseCode: 550 } });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('who');
    expect(text).not.toContain('quota');
    expect(lines[0]).toEqual({ event: 'mail-send', provider: 'primary', outcome: 'sent' });
    expect(lines.at(-1)).toEqual({ event: 'mail-send', provider: 'primary', outcome: 'failed', code: 'EENVELOPE', responseCode: 550 });
  });

  it('+slow returns a timeout within 4.5 s (outer race)', async () => {
    const started = Date.now();
    const res = await transport().send(msg('who+slow@example.test'));
    expect(res).toMatchObject({ ok: false, err: { code: 'ETIMEDOUT' } });
    expect(Date.now() - started).toBeLessThanOrEqual(4500);
  }, 10_000);

  it('NFR-3: 30 messages queued within 1 s reach the server at ≤8 per second', async () => {
    const t = transport();
    const before = fake.messages().length;
    const sends: Promise<unknown>[] = [];
    for (let i = 0; i < 30; i += 1) {
      sends.push(t.send(msg(`rate-${i}@example.test`, `r${i}`)));
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 300));
    }
    await Promise.all(sends);
    const at = fake.messages().slice(before).map((m) => Date.parse(m.at)).sort((a, b) => a - b);
    expect(at).toHaveLength(30);
    // Any 9 consecutive arrivals span close to a second (rate window 1 s; ~100 ms for handshakes and timer jitter).
    for (let i = 0; i + 8 < at.length; i += 1) expect(at[i + 8]! - at[i]!).toBeGreaterThanOrEqual(900);
  }, 15_000);

  it('F1: queue wait is not part of the 4 s race — 40 mails at once all go (the last waits ~4.9 s)', async () => {
    const t = transport();
    const sends = Array.from({ length: 40 }, (_, i) => t.send(msg(`burst-${i}@example.test`, `b${i}`)));
    expect(t.backlog()).toBeGreaterThan(25);
    const res = await Promise.all(sends);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(t.backlog()).toBe(0);
  }, 15_000);

  it('F1: codes leave the queue before other mail', async () => {
    const t = transport();
    const before = fake.messages().length;
    const sends = [
      ...Array.from({ length: 12 }, (_, i) => t.send(msg(`oth-${i}@example.test`, `o${i}`, 'other'))),
      ...Array.from({ length: 3 }, (_, i) => t.send(msg(`cod-${i}@example.test`, `c${i}`))),
    ];
    await Promise.all(sends);
    const order = fake.messages().slice(before).map((m) => (/^Message-ID: <(\w+)@/im.exec(m.raw) ?? [])[1]);
    const lastCode = Math.max(...['c0', 'c1', 'c2'].map((id) => order.indexOf(id)));
    expect(lastCode).toBeGreaterThanOrEqual(0);
    expect(lastCode).toBeLessThan(10);
  }, 15_000);

  it('F1: a mail that waits past the queue limit returns EQUEUE and never reaches the server', async () => {
    const t = transport({ queueMaxWaitMs: 300 });
    const before = fake.messages().length;
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => t.send(msg(`ovf-${i}@example.test`, `v${i}`))));
    const ok = res.filter((r) => r.ok).length;
    expect(ok).toBeGreaterThanOrEqual(5);
    expect(ok).toBeLessThanOrEqual(8);
    expect(res.filter((r) => !r.ok && r.err.code === MAIL_QUEUE_OVERFLOW)).toHaveLength(20 - ok);
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.messages().length - before).toBe(ok);
  }, 15_000);

  it('S10-11: a mail that finds the queue full returns EQUEUE at once', async () => {
    const t = transport({ queueMaxLength: 3 });
    const before = fake.messages().length;
    // 5 leave the queue at once (in flight), 3 wait; the 9th and 10th find it full.
    const pending = Array.from({ length: 8 }, (_, i) => t.send(msg(`full-${i}@example.test`, `f${i}`)));
    const started = Date.now();
    const refused = await Promise.all([t.send(msg('full-8@example.test', 'f8')), t.send(msg('full-9@example.test', 'f9'))]);
    expect(Date.now() - started).toBeLessThan(100);
    for (const r of refused) expect(!r.ok && r.err.code).toBe(MAIL_QUEUE_OVERFLOW);
    expect((await Promise.all(pending)).every((r) => r.ok)).toBe(true);
    expect(fake.messages().length - before).toBe(8);
  }, 15_000);
});
