/**
 * SPEC-10 W19 (AC-37, AC-48): the plain SMTP adapter over the in-process fake SMTP — From, Message-ID and headers
 * passed through, errors mapped for classification. The queue, rate, race and log line: `mail-queue.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeSmtp } from '../../../fakes/smtp/server.mjs';
import { createSmtpTransport, smtpErrorOf, type SmtpTransport } from '../../src/adapters/smtpMail';
import type { MailMessage } from '../../src/mail/ports';

let fake: Awaited<ReturnType<typeof startFakeSmtp>>;
const open: SmtpTransport[] = [];

const transport = () => {
  const t = createSmtpTransport({ host: '127.0.0.1', port: fake.port, user: 'fake-user', password: 'fake-pass' }); // check-secrets: allow test fake
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

describe('SMTP transport', () => {
  it('sends with the given From, Message-ID and headers', async () => {
    const res = await transport().send(msg('plain@example.test', 'abc'));
    expect(res).toEqual({ ok: true });
    const raw = fake.messages().at(-1)?.raw ?? '';
    expect(raw).toMatch(/^Message-ID: <abc@mail\.time2fest\.com>/im);
    expect(raw).toMatch(/^From: Time2Fest <code@example\.test>/im);
    expect(raw).toMatch(/^X-Entity-Ref-ID: abc/im);
  });

  it('maps failures for classification (the response text only in err.response)', async () => {
    const t = transport();
    const q = await t.send(msg('who+q550@example.test'));
    expect(q).toMatchObject({ ok: false, err: { code: 'EMESSAGE', responseCode: 550 } });
    if (!q.ok) expect(q.err.response).toMatch(/quota/);
    const r = await t.send(msg('who+rcpt550@example.test'));
    expect(r).toMatchObject({ ok: false, err: { code: 'EENVELOPE', responseCode: 550 } });
    expect(smtpErrorOf('x')).toEqual({ code: 'EUNKNOWN' });
  });
});
